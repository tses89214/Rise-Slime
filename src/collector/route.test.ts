import { describe, expect, test } from 'vitest';
import { runBot } from '../bots/bot';
import { uuid7 } from '../events/emitter';
import type { GameEvent } from '../events/schema';
import { route } from './route';

const NOW = Date.UTC(2026, 10, 2, 8, 0, 0);
const T = '2026-11-02T07:59:59.000Z';
const valid = { event_id: uuid7(NOW), event_type: 'achievement_unlocked', schema_version: 1, game_version: '0.1.0', player_id: 'p1', session_id: 's', client: 'browser', bot_persona: null, seq: 0, event_time: T, sent_at: T, achievement_id: 'first_bread', total_unlocked: 1 };

describe('valid events', () => {
  test('go to `events`, keyed by player, with ingested_at stamped from the supplied clock', () => {
    const r = route(valid, NOW);
    expect(r.topic).toBe('events');
    expect(r.key).toBe('p1');
    expect(r.value).toMatchObject({ ...valid, ingested_at: '2026-11-02T08:00:00.000Z' });
  });
  test('ingested_at supplied by the sender is overwritten by the collector', () => {
    const r = route({ ...valid, ingested_at: '2020-01-01T00:00:00.000Z' }, NOW);
    expect((r.value as { ingested_at: string }).ingested_at).toBe('2026-11-02T08:00:00.000Z');
  });
  test('every event a bot can produce is accepted', async () => {
    const events: GameEvent[] = [];
    for (const persona of ['random_assigner', 'optimizer', 'quitter'] as const) {
      await runBot({ id: `b-${persona}`, persona, seed: 7, startMs: NOW, seconds: 600, sink: (e) => void events.push(e) });
    }
    expect(events.length).toBeGreaterThan(200);
    for (const e of events) expect(route(e, NOW).topic).toBe('events');
  });
});

describe('invalid events go to the dead-letter topic, never dropped', () => {
  test('unknown type: raw payload and reason are kept', () => {
    const raw = { ...valid, event_type: 'nonsense' };
    const r = route(raw, NOW);
    expect(r.topic).toBe('events.dlq');
    expect(r.key).toBeNull();
    expect(r.value).toMatchObject({ raw, ingested_at: '2026-11-02T08:00:00.000Z' });
    expect((r.value as { error: string }).error).toContain('event_type');
  });
  test('missing field names the field in the error', () => {
    const { achievement_id: _drop, ...raw } = valid;
    expect((route(raw, NOW).value as { error: string }).error).toContain('achievement_id');
  });
  test.each([[null], [undefined], ['a string'], [42], [[]], [{}]])('garbage body %j is dead-lettered', (raw) => {
    expect(route(raw, NOW).topic).toBe('events.dlq');
  });
  test('a malformed copy of a valid event never reaches `events`', () => {
    for (const patch of [{ seq: -1 }, { event_time: 'x' }, { client: 'x' }, { schema_version: 9 }, { event_id: 'nope' }]) {
      expect(route({ ...valid, ...patch }, NOW).topic).toBe('events.dlq');
    }
  });
});
