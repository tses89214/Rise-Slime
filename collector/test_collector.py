import subprocess
import tempfile
import json
import pytest
from collector.main import route

NOW = 1793606400000  # 2026-11-02T08:00:00Z
T = "2026-11-02T07:59:59.000Z"
valid = {"event_id": "01934e5a-7b3c-7abc-8def-0123456789ab", "event_type": "achievement_unlocked", "schema_version": 1, "game_version": "0.1.0",
         "player_id": "p1", "session_id": "s", "client": "browser", "bot_persona": None, "seq": 0, "event_time": T, "sent_at": T,
         "achievement_id": "first_bread", "total_unlocked": 1}


def test_valid_goes_to_events_keyed_by_player_with_ingested_at_from_supplied_clock():
    r = route(valid, NOW)
    assert (r["topic"], r["key"]) == ("events", "p1")
    assert r["value"] == {**valid, "ingested_at": "2026-11-02T08:00:00.000Z"}


def test_sender_ingested_at_is_overwritten():
    r = route({**valid, "ingested_at": "2020-01-01T00:00:00.000Z"}, NOW)
    assert r["value"]["ingested_at"] == "2026-11-02T08:00:00.000Z"


def test_every_event_a_bot_can_produce_is_accepted():
    with tempfile.NamedTemporaryFile(suffix=".jsonl") as f:
        subprocess.run(["npx", "tsx", "src/bots/run.ts", "--bots", "4", "--seconds", "600", "--out", f.name,
                        "--duplicate-rate", "0", "--malformed-rate", "0", "--disconnect-rate", "0"], check=True)
        events = [json.loads(line) for line in open(f.name)]
    assert len(events) > 200
    assert {e["event_type"] for e in events} >= {"session_start", "production_tick"}
    for e in events:
        assert route(e, NOW)["topic"] == "events", e


def test_unknown_type_keeps_raw_and_reason():
    raw = {**valid, "event_type": "nonsense"}
    r = route(raw, NOW)
    assert (r["topic"], r["key"]) == ("events.dlq", None)
    assert r["value"]["raw"] == raw and "event_type" in r["value"]["error"]


def test_missing_field_names_the_field():
    raw = {k: v for k, v in valid.items() if k != "achievement_id"}
    assert "achievement_id" in route(raw, NOW)["value"]["error"]


@pytest.mark.parametrize("raw", [None, "a string", 42, [], {}])
def test_garbage_body_is_dead_lettered(raw):
    assert route(raw, NOW)["topic"] == "events.dlq"


@pytest.mark.parametrize("patch", [{"seq": -1}, {"event_time": "x"}, {"client": "x"}, {"schema_version": 9}, {"event_id": "nope"}])
def test_malformed_copy_of_valid_event_never_reaches_events(patch):
    assert route({**valid, **patch}, NOW)["topic"] == "events.dlq"
