-- Three layers: events (every valid event), aggregates (Flink windows), dead_letters (rejected input).
CREATE DATABASE IF NOT EXISTS slime;

-- Valid events as sent; event-specific fields stay in payload (JSON text), so new event types need no DDL.
-- ReplacingMergeTree drops rows with an identical sorting key (duplicate sends) at merge time; use FINAL for exact reads.
-- M3 moves dedup into Flink state.
CREATE TABLE IF NOT EXISTS slime.events (
    event_type     LowCardinality(String),
    event_time     DateTime64(3, 'UTC'),
    event_id       UUID,
    schema_version UInt8,
    game_version   LowCardinality(String),
    player_id      String,
    session_id     String,
    client         LowCardinality(String),
    bot_persona    LowCardinality(Nullable(String)),
    seq            UInt32,
    sent_at        DateTime64(3, 'UTC'),
    ingested_at    Nullable(DateTime64(3, 'UTC')),
    payload        String
) ENGINE = ReplacingMergeTree ORDER BY (event_type, event_time, event_id);

-- Intake from Flink: this table stores nothing, it is a Kafka consumer. Reading it (the MV below does) advances the offset.
-- Times arrive as ISO strings and are parsed in the MV, so Flink and ClickHouse never have to agree on a time format.
CREATE TABLE IF NOT EXISTS slime.kafka_events (
    event_type String, event_time String, event_id String, schema_version UInt8, game_version String,
    player_id String, session_id String, client String, bot_persona Nullable(String), seq UInt32,
    sent_at String, ingested_at Nullable(String), payload String
) ENGINE = Kafka SETTINGS kafka_broker_list = 'kafka:29092,kafka2:29092', kafka_topic_list = 'ch.events',
    kafka_group_name = 'clickhouse-events', kafka_format = 'JSONEachRow', kafka_num_consumers = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.kafka_events_mv TO slime.events AS
SELECT
    event_type,
    parseDateTime64BestEffort(event_time, 3, 'UTC') AS event_time,
    toUUID(event_id) AS event_id,
    schema_version, game_version, player_id, session_id, client, bot_persona, seq,
    parseDateTime64BestEffort(sent_at, 3, 'UTC') AS sent_at,
    parseDateTime64BestEffortOrNull(ingested_at, 3, 'UTC') AS ingested_at,
    payload
FROM slime.kafka_events;

-- production_tick per station per minute. One row per finished window: plain MergeTree.
-- produced / consumed are sums over players; slimes / input_stock are per-player averages over the minute's ticks
-- (summing every tick would multiply them by the tick count); multiply by players for a fleet total.
CREATE TABLE IF NOT EXISTS slime.production_1m (
    window_start DateTime('UTC'),
    client       LowCardinality(String),   -- browser | bot: the dashboard can filter by it
    station      LowCardinality(String),
    players      UInt32,
    slimes       Float64,
    produced     UInt64,
    consumed     UInt64,
    input_stock  Float64
) ENGINE = MergeTree ORDER BY (window_start, client, station);

CREATE TABLE IF NOT EXISTS slime.kafka_production_1m (
    window_start String, client String, station String, players UInt32, slimes Float64, produced UInt64, consumed UInt64, input_stock Float64
) ENGINE = Kafka SETTINGS kafka_broker_list = 'kafka:29092,kafka2:29092', kafka_topic_list = 'ch.production_1m',
    kafka_group_name = 'clickhouse-production-1m', kafka_format = 'JSONEachRow', kafka_num_consumers = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.kafka_production_1m_mv TO slime.production_1m AS
SELECT parseDateTimeBestEffort(window_start, 'UTC') AS window_start, client, station, players, slimes, produced, consumed, input_stock
FROM slime.kafka_production_1m;

-- Pipeline health per event type per minute. latency = ingested_at - event_time. duplicates = copies beyond the first per event_id (counted by Flink); late stays 0: SQL windows drop late rows without a side output.
CREATE TABLE IF NOT EXISTS slime.pipeline_1m (
    window_start   DateTime('UTC'),
    client         LowCardinality(String),
    event_type     LowCardinality(String),
    events         UInt64,
    duplicates     UInt64 DEFAULT 0,
    late           UInt64 DEFAULT 0,
    avg_latency_ms Float64,
    max_latency_ms Int64     -- can be negative: bots in fast-forward stamp event_time ahead of ingestion
) ENGINE = MergeTree ORDER BY (window_start, client, event_type);

CREATE TABLE IF NOT EXISTS slime.kafka_pipeline_1m (
    window_start String, client String, event_type String, events UInt64, duplicates UInt64, avg_latency_ms Float64, max_latency_ms Int64
) ENGINE = Kafka SETTINGS kafka_broker_list = 'kafka:29092,kafka2:29092', kafka_topic_list = 'ch.pipeline_1m',
    kafka_group_name = 'clickhouse-pipeline-1m', kafka_format = 'JSONEachRow', kafka_num_consumers = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.kafka_pipeline_1m_mv TO slime.pipeline_1m
    (window_start DateTime('UTC'), client String, event_type String, events UInt64, duplicates UInt64, avg_latency_ms Float64, max_latency_ms Int64) AS
SELECT parseDateTimeBestEffort(window_start, 'UTC') AS window_start, client, event_type, events, duplicates, avg_latency_ms, max_latency_ms
FROM slime.kafka_pipeline_1m;

-- Rejected events. Read straight from the collector's events.dlq topic (nothing to compute, so no Flink job).
-- error rate = dead_letters / (events + dead_letters). raw is the original JSON as text.
CREATE TABLE IF NOT EXISTS slime.dead_letters (
    received_at DateTime64(3, 'UTC'),
    error       String,
    raw         String
) ENGINE = MergeTree ORDER BY received_at;

CREATE TABLE IF NOT EXISTS slime.kafka_dead_letters (
    raw String, error String, ingested_at String
) ENGINE = Kafka SETTINGS kafka_broker_list = 'kafka:29092,kafka2:29092', kafka_topic_list = 'events.dlq',
    kafka_group_name = 'clickhouse-dlq', kafka_format = 'JSONEachRow', kafka_num_consumers = 1,
    input_format_json_read_objects_as_strings = 1;   -- raw is a JSON object (or anything); keep it as text

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.kafka_dead_letters_mv TO slime.dead_letters AS
SELECT parseDateTime64BestEffort(ingested_at, 3, 'UTC') AS received_at, error, raw
FROM slime.kafka_dead_letters;

-- ---- Live ops: "how is the game doing right now" ----

-- Game activity per minute and client (browser vs bot), written by Flink. uniq counts are not additive, so this is
-- computed per window, not derived from other aggregates. Daily DAU / retention: query `events` directly, add a table if slow.
CREATE TABLE IF NOT EXISTS slime.ops_1m (
    window_start          DateTime('UTC'),
    client                LowCardinality(String),
    active_players        UInt32,   -- players with any event in the window
    new_players           UInt32,   -- session_start with is_new_player
    sessions_started      UInt32,
    sessions_ended        UInt32,
    avg_session_seconds   Float64,  -- over sessions ended in the window
    slimes_purchased      UInt32,
    station_upgrades      UInt32,
    achievements_unlocked UInt32,
    bread_sold            UInt64,
    coins_earned          UInt64
) ENGINE = MergeTree ORDER BY (window_start, client);

CREATE TABLE IF NOT EXISTS slime.kafka_ops_1m (
    window_start String, client String, active_players UInt32, new_players UInt32, sessions_started UInt32,
    sessions_ended UInt32, avg_session_seconds Float64, slimes_purchased UInt32, station_upgrades UInt32,
    achievements_unlocked UInt32, bread_sold UInt64, coins_earned UInt64
) ENGINE = Kafka SETTINGS kafka_broker_list = 'kafka:29092,kafka2:29092', kafka_topic_list = 'ch.ops_1m',
    kafka_group_name = 'clickhouse-ops-1m', kafka_format = 'JSONEachRow', kafka_num_consumers = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.kafka_ops_1m_mv TO slime.ops_1m AS
SELECT parseDateTimeBestEffort(window_start, 'UTC') AS window_start, * EXCEPT window_start
FROM slime.kafka_ops_1m;

-- Latest state per player, for the leaderboard. Fed by a materialized view on `events`, not by Flink.
-- Every column merges idempotently (max / min / argMax by event_time), so duplicate or re-ordered events change nothing.
-- slimes / achievements / levels come from the latest production_tick snapshot, not from purchase/achievement events:
-- a player whose progress predates telemetry has no such events but still reports the right totals.
-- (Ticks recorded before the snapshot fields existed lack them; JSONHas keeps those from overwriting real values with 0.)
CREATE TABLE IF NOT EXISTS slime.player_state (
    player_id     String,
    client        SimpleAggregateFunction(anyLast, String),
    bot_persona   SimpleAggregateFunction(anyLast, Nullable(String)),
    first_seen    SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen     SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    coins         AggregateFunction(argMax, Float64, DateTime64(3, 'UTC')),   -- balance goes up and down: latest wins
    slimes        AggregateFunction(argMax, UInt32, DateTime64(3, 'UTC')),    -- owned, lounge included
    achievements  AggregateFunction(argMax, UInt32, DateTime64(3, 'UTC')),
    levels        AggregateFunction(argMax, UInt32, DateTime64(3, 'UTC'))     -- sum of the three station levels
) ENGINE = AggregatingMergeTree ORDER BY player_id;

CREATE MATERIALIZED VIEW IF NOT EXISTS slime.player_state_mv TO slime.player_state AS
SELECT
    player_id,
    client,
    bot_persona,
    event_time AS first_seen,
    event_time AS last_seen,
    argMaxStateIf(JSONExtractFloat(payload, 'coins_balance'), event_time, event_type = 'production_tick') AS coins,
    argMaxStateIf(toUInt32(JSONExtractUInt(payload, 'slimes_owned')), event_time, event_type = 'production_tick' AND JSONHas(payload, 'slimes_owned')) AS slimes,
    argMaxStateIf(toUInt32(JSONExtractUInt(payload, 'achievements_unlocked')), event_time, event_type = 'production_tick' AND JSONHas(payload, 'achievements_unlocked')) AS achievements,
    argMaxStateIf(toUInt32(arraySum(arrayMap(x -> JSONExtractUInt(x, 'level'), JSONExtractArrayRaw(payload, 'stations')))), event_time, event_type = 'production_tick') AS levels
FROM slime.events
GROUP BY player_id, client, bot_persona, event_time;

-- What the dashboard reads. online = seen in the last 2 minutes (production_tick is the heartbeat).
CREATE VIEW IF NOT EXISTS slime.leaderboard AS
SELECT
    player_id,
    any(client) AS client,
    any(bot_persona) AS bot_persona,
    argMaxMerge(coins) AS coins_now,
    argMaxMerge(slimes) AS slimes_owned,
    argMaxMerge(achievements) AS achievements_unlocked,
    argMaxMerge(levels) AS station_levels,
    min(first_seen) AS first_seen_at,
    max(last_seen) AS last_seen_at,
    last_seen_at > now64(3) - INTERVAL 2 MINUTE AS online
FROM slime.player_state
GROUP BY player_id
ORDER BY coins_now DESC;

-- Efficiency ranking, last hour: coins earned per minute of reported production time, per slime owned.
-- Reads `events` FINAL so duplicate ticks are not double counted; fine at demo volume, move to a table if slow.
CREATE VIEW IF NOT EXISTS slime.efficiency AS
SELECT
    player_id,
    any(client) AS client,
    any(bot_persona) AS bot_persona,
    sum(JSONExtractUInt(payload, 'coins_earned')) AS earned,
    sum(dateDiff('second', parseDateTime64BestEffort(JSONExtractString(payload, 'window_start')),
                           parseDateTime64BestEffort(JSONExtractString(payload, 'window_end')))) / 60 AS minutes,
    earned / nullIf(minutes, 0) AS coins_per_min,
    coins_per_min / nullIf(max(arraySum(arrayMap(s -> s.1, JSONExtract(payload, 'stations', 'Array(Tuple(slimes UInt32))')))), 0) AS coins_per_min_per_slime
FROM slime.events FINAL
WHERE event_type = 'production_tick' AND event_time > now64(3) - INTERVAL 1 HOUR
GROUP BY player_id
ORDER BY coins_per_min DESC, player_id;

-- DAU / WAU / MAU per day and client (rolling 1 / 7 / 30 days, UTC days). Reads `events`, no extra state.
CREATE VIEW IF NOT EXISTS slime.activity_daily AS
WITH pd AS (SELECT DISTINCT toDate(event_time) AS day, player_id, client FROM slime.events),
     days AS (SELECT DISTINCT day AS d FROM pd)
SELECT d AS day, pd.client AS client,
    uniqIf(player_id, pd.day = d) AS dau,
    uniqIf(player_id, pd.day > d - 7) AS wau,
    uniq(player_id) AS mau
FROM days CROSS JOIN pd
WHERE pd.day <= d AND pd.day > d - 30
GROUP BY day, client
ORDER BY day, client;
