# Decisions

Game/spec decisions live in `docs/decisions/`. This file holds the infrastructure ones.

## 2026-10-29
- **One repo for game + pipeline.** Shared zod schema must change together with Flink DDL / ClickHouse tables; portfolio is easier to clone and run. Layout: `src/` (TS), `pipeline/flink/`, `pipeline/clickhouse/`, `dashboard/`. No npm workspaces needed.
- **Kafka listener labels** are ours to name: `WEB_GAME` (:9092, clients on the host: collector, bots), `DOCKER` (:29092, other containers: Kafka UI, later Flink), `CONTROLLER` (:9093, internal). Protocol side of the map stays `PLAINTEXT`.
- **Second Kafka node is broker-only** (node 1 is the only controller): demo of roles and replication, not HA. Real HA needs 3 controllers.
- **`KAFKA_LOG_DIRS=/var/lib/kafka/data`**: the apache/kafka image defaults to `/tmp`, so a volume on the data path alone persisted nothing.
- **CLAUDE.md dev rules: dropped "ask rather than guess" and token budgets.** Owner wants small details decided autonomously; budgets are unworkable for multi-step sessions.
- **ClickHouse in three layers**: raw `events` (all valid events, payload as JSON text), Flink aggregates, `dead_letters`. Raw kept so M3/M4 analysis (retention, economy, A/B, seq gaps) needs no new pipeline. Dedup in M2 is `ReplacingMergeTree`; M3 moves it into Flink state.
- **Leaderboard state comes from a ClickHouse materialized view, not Flink.** `player_state` merges with max/min/argMax by event_time, so duplicates and out-of-order events are harmless. Sums (lifetime coins earned) are not idempotent, so efficiency is a view over `events FINAL` with a 1h window instead. DAU/WAU/MAU is a view over `events`; materialize if it gets slow.
- **Flink -> Kafka -> ClickHouse, not Flink -> ClickHouse.** The official ClickHouse Flink connector is DataStream-only (no Flink SQL); JDBC has no ClickHouse dialect as far as we know. Flink SQL jobs write `ch.*` topics and ClickHouse's Kafka engine + materialized views load them. Also decouples the two: ClickHouse down does not stall Flink. Kafka Streams / ksqlDB rejected: weaker event-time and state story, M3 depends on it.
- **Flink windows use `GROUP BY TUMBLE(...)`, not the TUMBLE table function.** The TVF over a temporary view inside `EXECUTE STATEMENT SET` fails with a Calcite 'belongs to a different planner' assertion (Flink 1.20.1). Also: no inline `-- comment` after a statement in job.sql (sql-client then merges it with the next statement).
