# Stock Flink plus the Kafka SQL connector (Flink SQL has no ClickHouse sink; results go back to Kafka, see DECISIONS.md).
FROM flink:1.20.1-java17
ADD https://repo1.maven.org/maven2/org/apache/flink/flink-sql-connector-kafka/3.3.0-1.20/flink-sql-connector-kafka-3.3.0-1.20.jar /opt/flink/lib/
RUN chmod 644 /opt/flink/lib/flink-sql-connector-kafka-*.jar
# checkpoints and savepoints live on a shared volume (docker-compose mounts it here) so a restarted job can resume where it stopped
RUN mkdir -p /opt/flink/state && chown flink:flink /opt/flink/state
