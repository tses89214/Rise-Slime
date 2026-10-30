# Data pipeline map

How an event travels from a player's click to a dashboard chart. Source of truth for the SQL is
`pipeline/flink/job.sql` and `pipeline/clickhouse/init.sql`; this page explains how the pieces connect.

Rendered copies (regenerate with `npx @mermaid-js/mermaid-cli` if you edit the diagrams): [services](pipeline-services.png), [tables](pipeline-tables.png).

## Legend (both diagrams use the same shapes and colours)

| Technology | Shape | Colour |
| --- | --- | --- |
| Kafka topic | cylinder | orange |
| Flink (job, source / sink tables, view) | hexagon | purple |
| ClickHouse table / Kafka-engine table | rectangle | yellow |
| ClickHouse view | rectangle, dashed border | light yellow |
| HTML / browser (game page, dashboard page) | rounded pill | blue |
| Node service (collector, bots) | rectangle with slanted edges | grey |

## 1. Services (who talks to whom)

```mermaid
flowchart LR
  classDef kafka fill:#FFD9A0,stroke:#C26A00,color:#3a2200,stroke-width:2px
  classDef flink fill:#E3D4FF,stroke:#6A3DC8,color:#22104d,stroke-width:2px
  classDef ch fill:#FFF2A8,stroke:#B39B00,color:#3b3300,stroke-width:2px
  classDef html fill:#CFE6FF,stroke:#2F6FB5,color:#0d2a4a,stroke-width:2px
  classDef node fill:#E6E6E6,stroke:#666,color:#222,stroke-width:2px

  game(["Browser game<br/>HTML + TS<br/>(VITE_TELEMETRY=true)"]):::html
  bots[/"Bots (Node)<br/>duplicates, malformed,<br/>disconnect + late resend"/]:::node
  collector[/"Collector (Node)<br/>Fastify + zod<br/>POST /events"/]:::node

  t_events[("Kafka topic<br/>events")]:::kafka
  t_dlq[("Kafka topic<br/>events.dlq")]:::kafka
  t_ch[("Kafka topics<br/>ch.events, ch.production_1m,<br/>ch.pipeline_1m, ch.ops_1m,<br/>ch.late_1m")]:::kafka

  flink{{"Flink job<br/>one SQL statement set"}}:::flink

  chk["ClickHouse<br/>Kafka-engine tables + materialized views"]:::ch
  store["ClickHouse<br/>MergeTree tables"]:::ch

  api[/"Collector (Node)<br/>GET /api/dashboard<br/>fixed read-only queries"/]:::node
  dash(["Ops dashboard page<br/>HTML + uPlot, polls every 5 s"]):::html

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
  classDef kafka fill:#FFD9A0,stroke:#C26A00,color:#3a2200,stroke-width:2px
  classDef flink fill:#E3D4FF,stroke:#6A3DC8,color:#22104d,stroke-width:2px
  classDef ch fill:#FFF2A8,stroke:#B39B00,color:#3b3300,stroke-width:2px
  classDef chview fill:#FFFBE0,stroke:#B39B00,color:#3b3300,stroke-width:2px,stroke-dasharray:5 3
  classDef html fill:#CFE6FF,stroke:#2F6FB5,color:#0d2a4a,stroke-width:2px

  t_events[("Kafka<br/>events")]:::kafka
  t_dlq[("Kafka<br/>events.dlq")]:::kafka

  subgraph flinkjob["Flink job.sql"]
    raw{{"events_raw<br/>raw JSON line"}}:::flink
    typed{{"events_typed<br/>rowtime = event_time<br/>watermark -10 s"}}:::flink
    sent{{"events_sent<br/>rowtime = sent_at"}}:::flink
    dedup{{"events_dedup (view)<br/>first row per event_id<br/>state TTL 1 h"}}:::flink
    o_events{{"sink ch_events"}}:::flink
    o_prod{{"sink ch_production_1m<br/>upsert"}}:::flink
    o_ops{{"sink ch_ops_1m<br/>upsert"}}:::flink
    o_pipe{{"sink ch_pipeline_1m<br/>upsert"}}:::flink
    o_late{{"sink ch_late_1m<br/>upsert"}}:::flink
    raw -->|flatten| o_events
    typed --> dedup
    dedup -->|"1-min window<br/>per client, station"| o_prod
    dedup -->|"1-min window<br/>per client"| o_ops
    typed -->|"1-min window per client, event_type<br/>events = distinct ids, duplicates = copies"| o_pipe
    sent -->|"1-min window by sent_at<br/>late = sent_at - event_time > 10 s"| o_late
  end

  t_events --> raw & typed & sent
  o_events --> k_events[("Kafka<br/>ch.events")]:::kafka
  o_prod --> k_prod[("Kafka<br/>ch.production_1m")]:::kafka
  o_ops --> k_ops[("Kafka<br/>ch.ops_1m")]:::kafka
  o_pipe --> k_pipe[("Kafka<br/>ch.pipeline_1m")]:::kafka
  o_late --> k_late[("Kafka<br/>ch.late_1m")]:::kafka

  subgraph clickhouse["ClickHouse slime.*"]
    ev["events<br/>ReplacingMergeTree (dedup by id)"]:::ch
    prod["production_1m<br/>ReplacingMergeTree(version)"]:::ch
    ops["ops_1m<br/>ReplacingMergeTree(version)"]:::ch
    pipe["pipeline_1m<br/>ReplacingMergeTree(version)"]:::ch
    late["late_1m<br/>ReplacingMergeTree(version)"]:::ch
    dl["dead_letters"]:::ch
    ps["player_state<br/>max / min / argMax by event_time"]:::ch
    lb["view leaderboard"]:::chview
    eff["view efficiency (1 h)"]:::chview
    act["view activity_daily"]:::chview
  end

  k_events -->|"kafka_events + MV"| ev
  k_prod -->|"kafka_production_1m + MV"| prod
  k_ops -->|"kafka_ops_1m + MV"| ops
  k_pipe -->|"kafka_pipeline_1m + MV"| pipe
  k_late -->|"kafka_late_1m + MV"| late
  t_dlq -->|"kafka_dead_letters + MV"| dl
  ev -->|player_state_mv| ps
  ps --> lb
  ev --> eff
  ev --> act

  subgraph dashboard["Dashboard page (HTML)"]
    p1(["Output / queues"]):::html
    p2(["Player activity + merges"]):::html
    p3(["Late arrivals"]):::html
    p4(["Pipeline health + duplicates"]):::html
    p5(["Leaderboards"]):::html
    p6(["KPIs: online, DAU, events, dead-letter rate"]):::html
    p7(["Latest dead letters"]):::html
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
- Editing `job.sql` and resubmitting: `scripts/flink-restart.sh` stops the running job with a savepoint and starts the new one from it, so Kafka is not replayed (checked: `ch.events` end offset unchanged). If the change is not savepoint-compatible, cancel the job and run `docker compose --profile submit run --rm flink-sql`: that replays all of Kafka (the versioned tables absorb it, `events` collapses duplicates at merge, but windows older than the allowed lateness are dropped).
- Checkpoints run every 10 s into the `flink-state` volume.
- Deleting a Kafka topic that a ClickHouse Kafka table reads leaves that consumer stale. Drop and recreate the `kafka_*` table and its MV, and reset the group offset if needed (`kafka-consumer-groups.sh --reset-offsets`).
- Windows still open at the end of a run (no later event pushes the watermark past them) are not emitted yet: compare totals excluding the newest minute.
