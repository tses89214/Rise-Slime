SET 'table.local-time-zone' = 'UTC';
-- a quiet partition must not hold the watermark back
SET 'table.exec.source.idle-timeout' = '10 s';
-- Late events: a window keeps accepting rows for 15 min after the watermark passes it (a bot can be offline for 10) and
-- re-emits its result on each one. Sinks are therefore upserts keyed by the window; `version` (rows in the window) orders them.
SET 'table.exec.emit.allow-lateness' = '15 min';
SET 'table.exec.emit.late-fire.enabled' = 'true';
SET 'table.exec.emit.late-fire.delay' = '0 s';
-- dedup state (one key per event_id) expires after this; a duplicate arriving later slips through (ClickHouse's ReplacingMergeTree still collapses it in `events`)
SET 'table.exec.state.ttl' = '1 h';

-- Source: raw JSON lines from the collector's valid-event topic.
CREATE TABLE events_raw (
  line STRING
) WITH (
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
  event_id STRING, event_type STRING, player_id STRING, client STRING,
  event_time TIMESTAMP_LTZ(3), ingested_at TIMESTAMP_LTZ(3),
  stations ARRAY<ROW<station STRING, slimes INT, `level` INT, produced INT, consumed INT, input_stock INT>>,
  is_new_player BOOLEAN, mutated BOOLEAN, session_seconds DOUBLE, bread_sold BIGINT, coins_earned BIGINT,
  -- ingested_at - event_time in ms: whole seconds via UNIX_TIMESTAMP (session zone is UTC), milliseconds added back
  latency_ms AS (UNIX_TIMESTAMP(DATE_FORMAT(ingested_at, 'yyyy-MM-dd HH:mm:ss')) * 1000 + MOD(EXTRACT(MILLISECOND FROM ingested_at), 1000))
              - (UNIX_TIMESTAMP(DATE_FORMAT(event_time, 'yyyy-MM-dd HH:mm:ss')) * 1000 + MOD(EXTRACT(MILLISECOND FROM event_time), 1000)),
  WATERMARK FOR event_time AS event_time - INTERVAL '10' SECOND
) WITH (
  'connector' = 'kafka', 'topic' = 'events',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092',
  'properties.group.id' = 'flink-typed', 'scan.startup.mode' = 'earliest-offset',
  'format' = 'json', 'json.timestamp-format.standard' = 'ISO-8601', 'json.ignore-parse-errors' = 'true');

-- Same topic again, but the clock is sent_at: late arrivals are counted when they arrive, because event-time windows drop them.
CREATE TABLE events_sent (
  event_time TIMESTAMP_LTZ(3), sent_at TIMESTAMP_LTZ(3), client STRING,
  WATERMARK FOR sent_at AS sent_at - INTERVAL '10' SECOND
) WITH (
  'connector' = 'kafka', 'topic' = 'events',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092',
  'properties.group.id' = 'flink-sent', 'scan.startup.mode' = 'earliest-offset',
  'format' = 'json', 'json.timestamp-format.standard' = 'ISO-8601', 'json.ignore-parse-errors' = 'true');

-- First copy of each event_id wins (ordered by event_time, so the rowtime attribute survives). Sums and counts read this, not events_typed.
CREATE VIEW events_dedup AS
SELECT event_type, player_id, client, event_time, ingested_at, stations, is_new_player, mutated, session_seconds, bread_sold, coins_earned
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY event_time ASC) AS rn FROM events_typed)
WHERE rn = 1;

CREATE TABLE ch_production_1m (
  window_start STRING, client STRING, station STRING, players BIGINT, slimes DOUBLE, produced BIGINT, consumed BIGINT, input_stock DOUBLE,
  version BIGINT, PRIMARY KEY (window_start, client, station) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka', 'topic' = 'ch.production_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'key.format' = 'json', 'value.format' = 'json');

CREATE TABLE ch_pipeline_1m (
  window_start STRING, client STRING, event_type STRING, events BIGINT, duplicates BIGINT, avg_latency_ms DOUBLE, max_latency_ms BIGINT,
  version BIGINT, PRIMARY KEY (window_start, client, event_type) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka', 'topic' = 'ch.pipeline_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'key.format' = 'json', 'value.format' = 'json');

CREATE TABLE ch_late_1m (
  window_start STRING, client STRING, events BIGINT, late_events BIGINT, max_delay_s BIGINT,
  version BIGINT, PRIMARY KEY (window_start, client) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka', 'topic' = 'ch.late_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'key.format' = 'json', 'value.format' = 'json');

CREATE TABLE ch_ops_1m (
  window_start STRING, client STRING, active_players BIGINT, new_players BIGINT, sessions_started BIGINT,
  sessions_ended BIGINT, avg_session_seconds DOUBLE, slimes_purchased BIGINT, station_upgrades BIGINT,
  achievements_unlocked BIGINT, bread_sold BIGINT, coins_earned BIGINT, slimes_merged BIGINT, mutations BIGINT, station_expansions BIGINT,
  version BIGINT, PRIMARY KEY (window_start, client) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka', 'topic' = 'ch.ops_1m',
  'properties.bootstrap.servers' = 'kafka:29092,kafka2:29092', 'key.format' = 'json', 'value.format' = 'json');

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
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), client, s.station,
  COUNT(DISTINCT player_id), AVG(CAST(s.slimes AS DOUBLE)), SUM(s.produced), SUM(s.consumed), AVG(CAST(s.input_stock AS DOUBLE)), COUNT(*)
FROM events_dedup CROSS JOIN UNNEST(stations) AS s
WHERE event_type = 'production_tick'
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), client, s.station;
INSERT INTO ch_pipeline_1m
SELECT DATE_FORMAT(TUMBLE_START(event_time, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), client, event_type,
  COUNT(DISTINCT event_id), COUNT(*) - COUNT(DISTINCT event_id), AVG(CAST(latency_ms AS DOUBLE)), MAX(latency_ms), COUNT(*)
FROM events_typed
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), client, event_type;

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
  COALESCE(SUM(coins_earned) FILTER (WHERE event_type = 'production_tick'), 0),
  COUNT(*) FILTER (WHERE event_type = 'slime_merged'),
  COUNT(*) FILTER (WHERE event_type = 'slime_merged' AND mutated),
  COUNT(*) FILTER (WHERE event_type = 'station_expanded'),
  COUNT(*)
FROM events_dedup
GROUP BY TUMBLE(event_time, INTERVAL '1' MINUTE), client;

INSERT INTO ch_late_1m
SELECT DATE_FORMAT(TUMBLE_START(sent_at, INTERVAL '1' MINUTE), 'yyyy-MM-dd HH:mm:ss'), client,
  COUNT(*), COUNT(*) FILTER (WHERE TIMESTAMPDIFF(SECOND, event_time, sent_at) > 10),
  MAX(TIMESTAMPDIFF(SECOND, event_time, sent_at)), COUNT(*)
FROM events_sent
GROUP BY TUMBLE(sent_at, INTERVAL '1' MINUTE), client;
END;
