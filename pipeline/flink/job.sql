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

INSERT INTO ch_events SELECT
  JSON_VALUE(line, '$.event_type'), JSON_VALUE(line, '$.event_time'), JSON_VALUE(line, '$.event_id'),
  CAST(JSON_VALUE(line, '$.schema_version') AS INT), JSON_VALUE(line, '$.game_version'),
  JSON_VALUE(line, '$.player_id'), JSON_VALUE(line, '$.session_id'), JSON_VALUE(line, '$.client'),
  JSON_VALUE(line, '$.bot_persona'), CAST(JSON_VALUE(line, '$.seq') AS BIGINT),
  JSON_VALUE(line, '$.sent_at'), JSON_VALUE(line, '$.ingested_at'), line
FROM events_raw;
