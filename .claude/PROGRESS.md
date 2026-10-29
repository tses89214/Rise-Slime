# Progress

_Last updated: 2026-10-29 (clocked out)_

## Status
M1 done and verified end to end: game -> collector -> Kafka (2 nodes, replicated, data in volumes) -> Kafka UI.
160 tests, typecheck and build pass. Game is considered finished; moving on to M2.

## Done (latest session)
- Kafka path tested for real: 10 bots x 300s = 1057 events in `events`, 4 in `events.dlq` (malformed injection), survives `docker compose down/up`.
- `docker-compose.yml`: Kafka UI (http://localhost:8080), listeners WEB_GAME/DOCKER/CONTROLLER, volumes, broker-only `kafka2` (replication factor 2).
- `scripts/demo.sh`: dev server + seeded demo state.

## Next
1. M2: ClickHouse DDL in `pipeline/clickhouse/`.
2. Flink SQL job (per-minute aggregation) in `pipeline/flink/`, add Flink + ClickHouse to compose.
3. uPlot dashboard in `dashboard/`.

## Open / not verified
- Browser -> collector with `VITE_TELEMETRY=true` never run in a real browser.
- Right after `docker compose up`, wait ~40s before sending: first topic auto-create can fail with "does not host this topic-partition".
- Collector prints a `TimeoutNegativeWarning` at startup (cause not investigated, harmless so far).
- Not built: Phaser, bot `disconnect_rate`/`max_buffer`, Level-up/squish sounds.
