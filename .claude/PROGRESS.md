# Progress

_Last updated: 2026-10-29 (clocked out)_

## Status
M1 done and verified end to end: game -> collector -> Kafka (2 nodes, replicated, data in volumes) -> Kafka UI.
160 tests, typecheck and build pass. Game is considered finished; moving on to M2.

## Done (latest session)
- ClickHouse in compose (:8123), `pipeline/clickhouse/init.sql`: `events` (valid events, ReplacingMergeTree dedup, payload JSON), `production_1m`, `pipeline_1m` (duplicates/late = 0 until M3), `dead_letters`. Verified: tables exist, HTTP insert works, duplicate row collapses after OPTIMIZE FINAL. init.sql runs on first start only; schema change needs `down -v` of clickhouse-data.
- Kafka path tested for real: 10 bots x 300s = 1057 events in `events`, 4 in `events.dlq` (malformed injection), survives `docker compose down/up`.
- `docker-compose.yml`: Kafka UI (http://localhost:8080), listeners WEB_GAME/DOCKER/CONTROLLER, volumes, broker-only `kafka2` (replication factor 2).
- `scripts/demo.sh`: dev server + seeded demo state.

## Next
1. Flink SQL job (events -> `events`, per-minute aggregates, `events.dlq` -> `dead_letters`) in `pipeline/flink/`, add Flink + ClickHouse to compose.
2. uPlot dashboard in `dashboard/`.

## Open / not verified
- Browser -> collector with `VITE_TELEMETRY=true` never run in a real browser.
- Right after `docker compose up`, wait ~40s before sending: first topic auto-create can fail with "does not host this topic-partition".
- Collector prints a `TimeoutNegativeWarning` at startup (cause not investigated, harmless so far).
- Not built: Phaser, bot `disconnect_rate`/`max_buffer`, Level-up/squish sounds.
