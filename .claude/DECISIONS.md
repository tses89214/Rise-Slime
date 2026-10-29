# Decisions

Game/spec decisions live in `docs/decisions/`. This file holds the infrastructure ones.

## 2026-10-29
- **One repo for game + pipeline.** Shared zod schema must change together with Flink DDL / ClickHouse tables; portfolio is easier to clone and run. Layout: `src/` (TS), `pipeline/flink/`, `pipeline/clickhouse/`, `dashboard/`. No npm workspaces needed.
- **Kafka listener labels** are ours to name: `WEB_GAME` (:9092, clients on the host: collector, bots), `DOCKER` (:29092, other containers: Kafka UI, later Flink), `CONTROLLER` (:9093, internal). Protocol side of the map stays `PLAINTEXT`.
- **Second Kafka node is broker-only** (node 1 is the only controller): demo of roles and replication, not HA. Real HA needs 3 controllers.
- **`KAFKA_LOG_DIRS=/var/lib/kafka/data`**: the apache/kafka image defaults to `/tmp`, so a volume on the data path alone persisted nothing.
- **CLAUDE.md dev rules: dropped "ask rather than guess" and token budgets.** Owner wants small details decided autonomously; budgets are unworkable for multi-step sessions.
- **ClickHouse in three layers**: raw `events` (all valid events, payload as JSON text), Flink aggregates, `dead_letters`. Raw kept so M3/M4 analysis (retention, economy, A/B, seq gaps) needs no new pipeline. Dedup in M2 is `ReplacingMergeTree`; M3 moves it into Flink state.
