# Progress

_Last updated: 2026-10-29 (clocked out)_

## Status
Dashboard has an All / Browser / Bots switch (`?client=`); `production_1m` and `pipeline_1m` carry `client`. `production_tick` now also carries `slimes_owned` and `achievements_unlocked` (state snapshot, see `docs/decisions/2026-10-29-tick-state-fields.md`). Offline progress no longer leaks into the next tick (bug fixed in `applyOffline`, test added). 162 tests, typecheck pass.
M2 pipeline + dashboard first version done: bots/browser -> collector -> Kafka -> Flink -> Kafka -> ClickHouse -> `http://localhost:3000/dashboard` (KPIs, per-station output and queues, activity, pipeline health, richest and most efficient players). Browser telemetry verified in headless Chrome: session_start/production_tick/achievement_unlocked/session_end land in ClickHouse with client=browser.
M1 done and verified end to end: game -> collector -> Kafka (2 nodes, replicated, data in volumes) -> Kafka UI.
160 tests, typecheck and build pass. Game is considered finished; moving on to M2.

## Done (latest session)
- Flink 1.20 in compose (UI :8081; `pipeline/flink/Dockerfile` adds the Kafka SQL connector). `docker compose --profile submit run --rm flink-sql` (one statement set = one job) submits `pipeline/flink/job.sql`. Verified: events -> flat rows on `ch.events`, 1057/1057 historical events. ClickHouse Kafka engine (`kafka_events` + `kafka_events_mv`) loads `ch.events` into `slime.events`: 1057 messages -> 1046 rows = the 1046 unique event_ids (bot duplicate injection), leaderboard view returns real players. `production_1m` done: Flink 1-min tumbling window (watermark 10 s) -> `ch.production_1m` -> ClickHouse; verified per-minute against `events FINAL`: equal except duplicates (Flink sums duplicate ticks twice until M3 dedup, e.g. 06:41 farm 670 vs 665). Last window stays open until later events arrive. `pipeline_1m` and `ops_1m` done the same way (verified: 06:41 ops shows 9 new players/sessions, 43 purchases = pipeline_1m's slime_purchased count). Latency is negative for historical bot data (bots stamp event_time ahead of ingestion in fast-forward), so `max_latency_ms` is Int64; real-time bot runs should give sane values - not yet checked. `dead_letters` loaded straight from `events.dlq` by a ClickHouse Kafka engine (no Flink job: nothing to compute); 4 rows = the 4 injected malformed events, error rate 0.19%. Live run done (20 bots, `--speed 1`, 150 s): 08:43/08:44 windows in all three tables, 20 active players, 2239 events. Latency still reads about -800 ms: bots stamp `event_time` from simulated time, slightly ahead of ingestion, so `pipeline_1m` latency is only meaningful for browser clients (real clock). Not a pipeline bug. `production_1m.slimes`/`input_stock` are now per-player averages (Float64). Resubmitting without cancelling the old job runs it twice (cancel in the UI first).
- ClickHouse in compose (:8123), `pipeline/clickhouse/init.sql`. Pipeline: `events` (ReplacingMergeTree dedup, payload JSON), `production_1m`, `pipeline_1m` (duplicates/late = 0 until M3), `dead_letters`. Live ops: `ops_1m` (Flink-written), `player_state` + MV from `events`, views `leaderboard` (richest, online flag), `efficiency` (coins/min and per slime, last hour), `activity_daily` (DAU/WAU/MAU per client). Verified with hand-made rows: dedup, latest-balance-wins, duplicate tick not double counted, rolling windows. init.sql runs on first start only; schema change needs `down -v` of clickhouse-data (or DROP DATABASE slime + rerun).
- Kafka path tested for real: 10 bots x 300s = 1057 events in `events`, 4 in `events.dlq` (malformed injection), survives `docker compose down/up`.
- `docker-compose.yml`: Kafka UI (http://localhost:8080), listeners WEB_GAME/DOCKER/CONTROLLER, volumes, broker-only `kafka2` (replication factor 2).
- `scripts/demo.sh`: dev server + seeded demo state.

## Next
1. M3: Flink-side dedup, late events, schema change (merge/mutation). `pipeline_1m.duplicates/late` are still 0.
2. Dashboard polish: DLQ/duplicate panels, time-range picker, a way to see browser vs bot.

## Open / not verified
- Resubmitting `job.sql` replays all of Kafka (no checkpoints/savepoints, `earliest-offset`): `events` gets duplicate rows (ReplacingMergeTree collapses them at merge; dashboard KPIs use count(), so they read high until then) and the plain-MergeTree `production_1m` / `pipeline_1m` / `ops_1m` get duplicate windows. Truncate those three (or `down -v`) before resubmitting.
- `player_state` was changed to take slimes/levels from the latest `production_tick` (purchase/achievement events are missing for progress made before telemetry was on). Existing rows were backfilled by running the MV's SELECT once; a fresh `init.sql` start has no backfill need. Achievement totals are not on the dashboard for the same reason: the game would have to send a state snapshot.
- Right after `docker compose up`, the first collector posts hit topic auto-create errors (kafkajs ERROR logs for a few seconds); events flow afterwards. From-scratch start (`down -v`, `up`, init.sql, collector, bots, flink-sql) verified once.
- Collector prints a `TimeoutNegativeWarning` at startup (cause not investigated, harmless so far).
- Not built: Phaser, bot `disconnect_rate`/`max_buffer`, Level-up/squish sounds.
