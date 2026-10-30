"""Collector: POST /events validates against src/events/event.schema.json (generated from the zod schema),
valid events go to Kafka `events`, everything else to `events.dlq`. Also serves the ops dashboard."""
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from aiokafka import AIOKafkaProducer
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "src/events/event.schema.json").read_text())
BRANCHES = {b["properties"]["event_type"]["const"]: Draft202012Validator(b) for b in SCHEMA["oneOf"]}
CH = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")


def _iso(now_ms: float) -> str:
    return datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate(raw) -> str | None:
    """None if valid, else the reasons joined by '; '."""
    if not isinstance(raw, dict):
        return "expected object"
    v = BRANCHES.get(raw.get("event_type"))
    if v is None:
        return "event_type: unknown event_type"
    return "; ".join(f"{'.'.join(map(str, e.absolute_path))}: {e.message}" for e in v.iter_errors(raw)) or None


def route(raw, now_ms: float) -> dict:
    """Valid events go to `events`; anything else goes to the dead-letter topic with raw payload and reason."""
    error = validate(raw)
    if error is None:
        return {"topic": "events", "key": raw["player_id"], "value": {**raw, "ingested_at": _iso(now_ms)}}
    return {"topic": "events.dlq", "key": None, "value": {"raw": raw, "error": error, "ingested_at": _iso(now_ms)}}


@asynccontextmanager
async def lifespan(app: FastAPI):
    brokers = os.environ.get("KAFKA_BROKERS")
    app.state.producer = AIOKafkaProducer(bootstrap_servers=brokers.split(",")) if brokers else None
    if app.state.producer:
        await app.state.producer.start()
    yield
    if app.state.producer:
        await app.state.producer.stop()


app = FastAPI(lifespan=lifespan)
# The browser game posts cross-origin (vite :5173 -> :3000) with a JSON content-type, which triggers a preflight.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["content-type"])


@app.post("/events")
async def events(request: Request):
    try:
        raw = await request.json()
    except ValueError:
        return JSONResponse({"error": "body is not JSON"}, status_code=400)
    m = route(raw, time.time() * 1000)
    value = json.dumps(m["value"])
    if request.app.state.producer:
        await request.app.state.producer.send_and_wait(m["topic"], value.encode(), key=m["key"] and m["key"].encode())
    else:
        print(m["topic"], value, flush=True)  # no broker configured: dev mode
    return JSONResponse({"topic": m["topic"]}, status_code=202 if m["topic"] == "events" else 422)


# ---- dashboard: read-only API + static page. The browser never talks to ClickHouse: it gets this fixed set of queries. ----
def dashboard_sql(minutes: int, client: str) -> dict[str, str]:
    # client is validated against the allowed values before it gets here; dead letters keep the original JSON as text, so read client out of it
    c = "1" if client == "all" else f"client = '{client}'"
    dead = "1" if client == "all" else f"JSONExtractString(raw, 'client') = '{client}'"
    since = f"window_start > now() - INTERVAL {minutes} MINUTE AND {c}"
    return {
        "production": f"SELECT toUnixTimestamp(window_start) t, station, sum(produced) produced, round(sum(input_stock * players)) queue FROM slime.production_1m FINAL WHERE {since} GROUP BY t, station ORDER BY t",
        "ops": f"SELECT toUnixTimestamp(window_start) t, sum(active_players) active, sum(slimes_purchased) purchases, sum(station_upgrades) upgrades, sum(coins_earned) coins, sum(slimes_merged) merges, sum(mutations) mutations FROM slime.ops_1m FINAL WHERE {since} GROUP BY t ORDER BY t",
        "pipeline": f"SELECT toUnixTimestamp(window_start) t, sum(p.events) events, round(sum(p.avg_latency_ms * p.events) / sum(p.events)) latency_ms, sum(p.duplicates) duplicates FROM slime.pipeline_1m AS p FINAL WHERE {since} GROUP BY t ORDER BY t",
        "late": f"SELECT toUnixTimestamp(window_start) t, sum(late_events) late, max(max_delay_s) max_delay_s FROM slime.late_1m FINAL WHERE {since} GROUP BY t ORDER BY t",
        "richest": f"SELECT player_id, bot_persona persona, round(coins_now) coins, slimes_owned slimes, achievements_unlocked achievements, station_levels levels, online FROM slime.leaderboard WHERE {c} LIMIT 10",
        "efficiency": f"SELECT player_id, bot_persona persona, round(earned) coins_earned, round(coins_per_min, 1) per_min, round(coins_per_min_per_slime, 2) per_slime FROM slime.efficiency WHERE coins_per_min IS NOT NULL AND {c} LIMIT 10",
        "dead": f"SELECT formatDateTime(received_at, '%H:%i:%S') at, error, substring(raw, 1, 2000) snippet FROM slime.dead_letters WHERE {dead} ORDER BY received_at DESC LIMIT 8",
        "kpi": f"""SELECT (SELECT countIf(online) FROM slime.leaderboard WHERE {c}) online, (SELECT count() FROM slime.events WHERE {c}) events,
      (SELECT count() FROM slime.dead_letters WHERE {dead}) dead,
      uniqIf(player_id, event_time > now() - INTERVAL 1 DAY) dau, uniqIf(player_id, event_time > now() - INTERVAL 7 DAY) wau, uniqIf(player_id, event_time > now() - INTERVAL 30 DAY) mau
      FROM slime.events WHERE {c}""",
    }


FILES = {
    "/dashboard": "dashboard/index.html",
    "/dashboard/uplot.js": "node_modules/uplot/dist/uPlot.iife.min.js",
    "/dashboard/uplot.css": "node_modules/uplot/dist/uPlot.min.css",
    "/dashboard/font.ttf": "assets/fonts/monogram.ttf",
}
for _url, _path in FILES.items():
    app.add_api_route(_url, (lambda p: lambda: FileResponse(ROOT / p))(_path), methods=["GET"])


@app.get("/api/dashboard")
async def dashboard(minutes: str = "60", client: str = "all"):
    try:
        m = min(max(int(minutes) or 60, 5), 1440)
    except ValueError:
        m = 60
    client = client if client in ("browser", "bot") else "all"
    async with httpx.AsyncClient() as http:
        async def q(sql: str):
            r = await http.post(f"{CH}/?default_format=JSON", content=sql)
            if r.status_code != 200:
                raise RuntimeError(f"clickhouse: {r.text[:300]}")
            return r.json()["data"]
        try:
            return {k: await q(sql) for k, sql in dashboard_sql(m, client).items()}
        except Exception as e:  # ClickHouse down or query error: tell the page, don't 500
            return JSONResponse({"error": str(e)}, status_code=502)
