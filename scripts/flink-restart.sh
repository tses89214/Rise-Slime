#!/bin/sh
# Resubmit pipeline/flink/job.sql without replaying Kafka: stop the running job with a savepoint, start the new one from it.
# Use after editing job.sql in a way that keeps the same operators; for incompatible changes cancel and resubmit (replays Kafka).
cd "$(dirname "$0")/.." || exit 1
JM=http://localhost:8081
JOB=$(curl -s $JM/jobs/overview | python3 -c "import json,sys;print(next((j['jid'] for j in json.load(sys.stdin)['jobs'] if j['state']=='RUNNING'),''))")
[ -z "$JOB" ] && { echo "no running job; use: docker compose --profile submit run --rm flink-sql"; exit 1; }
REQ=$(curl -s -X POST $JM/jobs/$JOB/stop -H 'content-type: application/json' -d '{"drain":false}' | python3 -c "import json,sys;print(json.load(sys.stdin)['request-id'])")
for i in $(seq 1 60); do
  R=$(curl -s $JM/jobs/$JOB/savepoints/$REQ)
  SP=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print((d.get('operation') or {}).get('location',''))")
  [ -n "$SP" ] && break; sleep 2
done
[ -z "$SP" ] && { echo "savepoint failed: $R"; exit 1; }
echo "savepoint: $SP"
SQL_ARGS="-Dexecution.savepoint.path=$SP" docker compose --profile submit run --rm flink-sql
