# Progress

_Last updated: 2026-10-29 (clocked out)_

## Status
M1 done and verified end to end: game -> collector -> Kafka (2 nodes, replicated, data in volumes) -> Kafka UI.
160 tests, typecheck and build pass. Game is considered finished; moving on to M2.

## Done (latest session)
- Flink 1.20 in compose (UI :8081; `pipeline/flink/Dockerfile` adds the Kafka SQL connector). `docker compose --profile submit run --rm flink-sql` submits `pipeline/flink/job.sql`. Verified: events -> flat rows on `ch.events`, 1057/1057 historical events. Not yet: ClickHouse Kafka engine reading `ch.*` topics, aggregates, DLQ job. Resubmitting without cancelling the old job runs it twice (cancel in the UI first).
- ClickHouse in compose (:8123), `pipeline/clickhouse/init.sql`. Pipeline: `events` (ReplacingMergeTree dedup, payload JSON), `production_1m`, `pipeline_1m` (duplicates/late = 0 until M3), `dead_letters`. Live ops: `ops_1m` (Flink-written), `player_state` + MV from `events`, views `leaderboard` (richest, online flag), `efficiency` (coins/min and per slime, last hour), `activity_daily` (DAU/WAU/MAU per client). Verified with hand-made rows: dedup, latest-balance-wins, duplicate tick not double counted, rolling windows. init.sql runs on first start only; schema change needs `down -v` of clickhouse-data (or DROP DATABASE slime + rerun).
- Kafka path tested for real: 10 bots x 300s = 1057 events in `events`, 4 in `events.dlq` (malformed injection), survives `docker compose down/up`.
- `docker-compose.yml`: Kafka UI (http://localhost:8080), listeners WEB_GAME/DOCKER/CONTROLLER, volumes, broker-only `kafka2` (replication factor 2).
- `scripts/demo.sh`: dev server + seeded demo state.

## Next
1. Finish Flink SQL job + ClickHouse Kafka-engine tables (events -> `events`, per-minute aggregates incl. `ops_1m`, `events.dlq` -> `dead_letters`) in `pipeline/flink/`, add Flink + ClickHouse to compose.
2. uPlot dashboard in `dashboard/`.

## Open / not verified
- Browser -> collector with `VITE_TELEMETRY=true` never run in a real browser.
- Right after `docker compose up`, wait ~40s before sending: first topic auto-create can fail with "does not host this topic-partition".
- Collector prints a `TimeoutNegativeWarning` at startup (cause not investigated, harmless so far).
- Not built: Phaser, bot `disconnect_rate`/`max_buffer`, Level-up/squish sounds.
