# Data pipeline map

How an event travels from a player's click to a dashboard chart. Source of truth for the SQL is
`pipeline/flink/job.sql` and `pipeline/clickhouse/init.sql`; this page explains how the pieces connect.

## 1. Services (who talks to whom)

```mermaid
flowchart LR
  subgraph clients[Event producers]
    game["Browser game<br/>(VITE_TELEMETRY=true)"]
    bots["Bots (Node)<br/>duplicates, malformed,<br/>disconnect + late resend"]
  end
  collector["Collector<br/>Fastify + zod<br/>POST /events"]
  subgraph kafka[Kafka x2 nodes]
    t_events[("events")]
    t_dlq[("events.dlq")]
    t_ch[("ch.events<br/>ch.production_1m<br/>ch.pipeline_1m<br/>ch.ops_1m<br/>ch.late_1m")]
  end
  flink["Flink job<br/>(one SQL statement set)"]
  subgraph ch[ClickHouse]
    chk["Kafka-engine tables<br/>+ materialized views"]
    store[("MergeTree tables")]
  end
  api["Collector<br/>GET /api/dashboard<br/>(fixed read-only queries)"]
  dash["Ops dashboard page<br/>(uPlot, polls every 5 s)"]

  game -->|JSON| collector
  bots -->|JSON| collector
  collector -->|valid| t_events
  collector -->|invalid| t_dlq
  t_events --> flink
  flink --> t_ch
  t_ch --> chk
  t_dlq --> chk
  chk --> store
  store --> api
  api --> dash
```

- The collector is the only writer to Kafka from the outside. A schema-invalid event is never dropped: it goes to `events.dlq` with the error.
- Flink reads only `events` (valid events). Dead letters skip Flink: ClickHouse reads `events.dlq` directly.
- Flink never writes ClickHouse directly. It writes `ch.*` topics and ClickHouse's Kafka engine loads them, so a ClickHouse outage does not stall Flink (the topics buffer).

## 2. Tables (what feeds what)

```mermaid
flowchart TB
  t_events[("Kafka: events")]
  t_dlq[("Kafka: events.dlq")]

  subgraph flink[Flink job.sql]
    raw["events_raw<br/>(raw JSON line)"]
    typed["events_typed<br/>rowtime = event_time<br/>watermark -10 s"]
    sent["events_sent<br/>rowtime = sent_at"]
    dedup["events_dedup (view)<br/>first row per event_id<br/>state TTL 1 h"]
    raw -->|"flatten"| o_events["ch_events"]
    typed --> dedup
    dedup -->|"1-min window<br/>per client, station"| o_prod["ch_production_1m"]
    dedup -->|"1-min window<br/>per client"| o_ops["ch_ops_1m"]
    typed -->|"1-min window per client, event_type<br/>events = distinct ids, duplicates = copies"| o_pipe["ch_pipeline_1m"]
    sent -->|"1-min window by sent_at<br/>late = sent_at - event_time > 10 s"| o_late["ch_late_1m"]
  end

  t_events --> raw & typed & sent
  o_events --> k_events[("Kafka: ch.events")]
  o_prod --> k_prod[("Kafka: ch.production_1m")]
  o_ops --> k_ops[("Kafka: ch.ops_1m")]
  o_pipe --> k_pipe[("Kafka: ch.pipeline_1m")]
  o_late --> k_late[("Kafka: ch.late_1m")]

  subgraph clickhouse[ClickHouse slime.*]
    ev["events<br/>ReplacingMergeTree (dedup by id)"]
    prod["production_1m<br/>ReplacingMergeTree(version)"]
    ops["ops_1m<br/>ReplacingMergeTree(version)"]
    pipe["pipeline_1m<br/>ReplacingMergeTree(version)"]
    late["late_1m<br/>ReplacingMergeTree(version)"]
    dl["dead_letters"]
    ps["player_state<br/>(max / min / argMax by event_time)"]
    lb(["view leaderboard"])
    eff(["view efficiency (1 h)"])
    act(["view activity_daily"])
  end

  k_events -->|"kafka_events + MV"| ev
  k_prod -->|"kafka_production_1m + MV"| prod
  k_ops -->|"kafka_ops_1m + MV"| ops
  k_pipe -->|"kafka_pipeline_1m + MV"| pipe
  k_late -->|"kafka_late_1m + MV"| late
  t_dlq -->|"kafka_dead_letters + MV"| dl
  ev -->|"player_state_mv"| ps
  ps --> lb
  ev --> eff
  ev --> act

  subgraph dashboard[Dashboard panels]
    p1["Output / queues"]
    p2["Player activity + merges"]
    p3["Late arrivals"]
    p4["Pipeline health + duplicates"]
    p5["Leaderboards"]
    p6["KPIs (online, DAU, events, dead-letter rate)"]
    p7["Latest dead letters"]
  end
  prod --> p1
  ops --> p2
  late --> p3
  pipe --> p4
  lb --> p5
  eff --> p5
  ev --> p6
  act --> p6
  dl --> p6
  dl --> p7
```

## 3. Why it is built this way

| Problem | Where it is handled |
| --- | --- |
| Bot/network resends the same event | `events_dedup` in Flink (counts and sums); `ReplacingMergeTree` on `events` (raw store). `pipeline_1m.duplicates` counts the copies. |
| Event arrives after its window closed (client was offline) | Flink `allow-lateness 15 min` + late-fire: the window is re-emitted with the new total. The sinks are `upsert-kafka`; ClickHouse keeps the row with the highest `version` (= rows in the window, which only grows). Read these tables with `FINAL`. |
| How many events were late? | `late_1m`: windowed by `sent_at`, because late rows are the ones event-time windows would otherwise hide. |
| Malformed event | Collector zod check -> `events.dlq` -> `dead_letters`. |
| Old clients (schema v1) and new (v2) at once | v2 only adds events and optional fields; `payload` keeps the full JSON in `events`, so new event types need no DDL. |
| Leaderboard needs "latest state" | `player_state` merges idempotently, so duplicate or reordered events change nothing. |

## 4. Operating notes

- Start order: `docker compose up -d`, collector, bots, then `docker compose --profile submit run --rm flink-sql`.
- Resubmitting `job.sql` replays all of Kafka (no checkpoints yet). Cancel the old job first; the versioned tables absorb the replay, `events` collapses duplicates at merge.
- Deleting a Kafka topic that a ClickHouse Kafka table reads leaves that consumer stale. Drop and recreate the `kafka_*` table and its MV, and reset the group offset if needed (`kafka-consumer-groups.sh --reset-offsets`).
- Windows still open at the end of a run (no later event pushes the watermark past them) are not emitted yet: compare totals excluding the newest minute.
