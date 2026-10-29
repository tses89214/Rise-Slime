SET 'table.local-time-zone' = 'UTC';
-- a quiet partition must not hold the watermark back
SET 'table.exec.source.idle-timeout' = '10 s';

-- Source: raw JSON lines from the collector's valid-event topic.
CREATE TABLE events_raw (line STRING) WITH (
  'connector' = 'kafka', 'topic' = 'events',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092',
  'properties.group.id' = 'flink-events', 'scan.startup.mode' = 'earliest-offset',
  'format' = 'raw');

-- Sink: one flat row per event; ClickHouse's Kafka engine reads this topic into slime.events.
CREATE TABLE ch_events (
  event_type STRING, event_time STRING, event_id STRING, schema_version INT, game_version STRING,
  player_id STRING, session_id STRING, client STRING, bot_persona STRING, seq BIGINT,
  sent_at STRING, ingested_at STRING, payload STRING
) WITH (
  'connector' = 'kafka', 'topic' = 'ch.events',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'format' = 'json');

-- Typed view of the same topic for windowing. event_time drives the watermark (10 s of out-of-order allowed).
CREATE TABLE events_typed (
  event_type STRING, player_id STRING, client STRING,
  event_time TIMESTAMP_LTZ(3), ingested_at TIMESTAMP_LTZ(3),
  stations ARRAY<ROW<station STRING, slimes INT, `level` INT, produced INT, consumed INT, input_stock INT>>,
  is_new_player BOOLEAN, session_seconds DOUBLE, bread_sold BIGINT, coins_earned BIGINT,
  -- ingested_at - event_time in ms: whole seconds via UNIX_TIMESTAMP (session zone is UTC), milliseconds added back
  latency_ms AS (UNIX_TIMESTAMP(DATE_FORMAT(ingested_at, 'yyyy-MM-dd HH:mm:ss')) * 1000 + MOD(EXTRACT(MILLISECOND FROM ingested_at), 1000))
              - (UNIX_TIMESTAMP(DATE_FORMAT(event_time, 'yyyy-MM-dd HH:mm:ss')) * 1000 + MOD(EXTRACT(MILLISECOND FROM event_time), 1000)),
  WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND
) WITH (
  'connector' = 'kafka', 'topic' = 'events',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092',
  'properties.group.id' = 'flink-typed', 'scan.startup.mode' = 'earliest-offset',
  'format' = 'json', 'json.timestamp-format.standard' = 'ISO-8601', 'json.ignore-parse-errors' = 'true');

CREATE TABLE ch_production_1m (
  window_start STRING, station STRING, players BIGINT, slimes DOUBLE, produced BIGINT, consumed BIGINT, input_stock DOUBLE
) WITH (
  'connector' = 'kafka', 'topic' = 'ch.production_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'format' = 'json');

CREATE TABLE ch_pipeline_1m (
  window_start STRING, event_type STRING, events BIGINT, avg_latency_ms DOUBLE, max_latency_ms BIGINT
) WITH (
  'connector' = 'kafka', 'topic' = 'ch.pipeline_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'format' = 'json');

CREATE TABLE ch_ops_1m (
  window_start STRING, client STRING, active_players BIGINT, new_players BIGINT, sessions_started BIGINT,
  sessions_ended BIGINT, avg_session_seconds DOUBLE, slimes_purchased BIGINT, station_upgrades BIGINT,
  achievements_unlocked BIGINT, bread_sold BIGINT, coins_earned BIGINT
) WITH (
  'connector' = 'kafka', 'topic' = 'ch.ops_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'format' = 'json');

-- One Flink job for all INSERTs: one thing to cancel and resubmit.
EXECUTE STATEMENT SET
BEGIN
INSERT INTO ch_events SELECT
  JSON_VALUE(line, '$.event_type'), JSON_VALUE(line, '$.event_time'), JSON_VALUE(line, '$.event_id'),
  CAST(JSON_VALUE(line, '$.schema_version') AS INT), JSON_VALUE(line, '$.game_version'),
  JSON_VALUE(line, '$.player_id'), JSON_VALUE(line, '$.session_id'), JSON_VALUE(line, '$.client'),
  JSON_VALUE(line, '$.bot_persona'), CAST(JSON_VALUE(line, '$.seq') AS BIGINT),
  JSON_VALUE(line, '$.sent_at'), JSON_VALUE(line, '$.ingested_at'), line
FROM events_raw;

-- Group-window syntax (not the TUMBLE table function): the table function plus a view trips a planner bug in statement sets.
INSERT INTO ch_production_1m
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), s.station,
  COUNT(DISTINCT player_id), AVG(CAST(s.slimes AS DOUBLE)), SUM(s.produced), SUM(s.consumed), AVG(CAST(s.input_stock AS DOUBLE))
FROM events_typed CROSS JOIN UNNEST(stations) AS s
WHERE event_type = 'production_tick'
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), s.station;
INSERT INTO ch_pipeline_1m
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), event_type,
  COUNT(*), AVG(CAST(latency_ms AS DOUBLE)), MAX(latency_ms)
FROM events_typed
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), event_type;

INSERT INTO ch_ops_1m
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), client,
  COUNT(DISTINCT player_id),
  COUNT(DISTINCT player_id) FILTER (WHERE event_type = 'session_start' AND is_new_player),
  COUNT(*) FILTER (WHERE event_type = 'session_start'),
  COUNT(*) FILTER (WHERE event_type = 'session_end'),
  COALESCE(AVG(session_seconds) FILTER (WHERE event_type = 'session_end'), 0.0),
  COUNT(*) FILTER (WHERE event_type = 'slime_purchased'),
  COUNT(*) FILTER (WHERE event_type = 'station_upgraded'),
  COUNT(*) FILTER (WHERE event_type = 'achievement_unlocked'),
  COALESCE(SUM(bread_sold) FILTER (WHERE event_type = 'production_tick'), 0),
  COALESCE(SUM(coins_earned) FILTER (WHERE event_type = 'production_tick'), 0)
FROM events_typed
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), client;
END;
