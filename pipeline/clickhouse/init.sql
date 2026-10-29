-- Tables Flink writes to. Each row is one finished tumbling window, so plain MergeTree (no merge-time dedup).
CREATE DATABASE IF NOT EXISTS slime;

-- production_tick events summed over all players, per station per minute.
CREATE TABLE IF NOT EXISTS slime.production_1m (
    window_start DateTime('UTC'),
    station      LowCardinality(String),
    players      UInt32,   -- distinct players that reported
    slimes       UInt32,
    produced     UInt64,
    consumed     UInt64,
    input_stock  UInt64    -- queue size at window end, summed over players
) ENGINE = MergeTree ORDER BY (window_start, station);

-- Pipeline health: volume and end-to-end latency (ingested_at - event_time) per event type per minute.
CREATE TABLE IF NOT EXISTS slime.pipeline_1m (
    window_start   DateTime('UTC'),
    event_type     LowCardinality(String),
    events         UInt64,
    avg_latency_ms Float64,
    max_latency_ms UInt64
) ENGINE = MergeTree ORDER BY (window_start, event_type);
