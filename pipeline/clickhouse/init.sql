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

-- production_tick summed over players, per station per minute. One row per finished window: plain MergeTree.
CREATE TABLE IF NOT EXISTS slime.production_1m (
    window_start DateTime('UTC'),
    station      LowCardinality(String),
    players      UInt32,
    slimes       UInt32,
    produced     UInt64,
    consumed     UInt64,
    input_stock  UInt64    -- queue size at window end, summed over players
) ENGINE = MergeTree ORDER BY (window_start, station);

-- Pipeline health per event type per minute. latency = ingested_at - event_time. duplicates/late stay 0 until M3.
CREATE TABLE IF NOT EXISTS slime.pipeline_1m (
    window_start   DateTime('UTC'),
    event_type     LowCardinality(String),
    events         UInt64,
    duplicates     UInt64 DEFAULT 0,
    late           UInt64 DEFAULT 0,
    avg_latency_ms Float64,
    max_latency_ms UInt64
) ENGINE = MergeTree ORDER BY (window_start, event_type);

-- From the events.dlq topic: error rate = dead_letters / (events + dead_letters).
CREATE TABLE IF NOT EXISTS slime.dead_letters (
    received_at DateTime64(3, 'UTC'),
    error       String,
    raw         String
) ENGINE = MergeTree ORDER BY received_at;
