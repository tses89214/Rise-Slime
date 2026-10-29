import { describe, expect, test } from 'vitest';
import { makeEmitter, uuid7 } from './emitter';
import { GameEvent } from './schema';

const ctx = { game_version: '0.1.0', player_id: 'p', session_id: 's', client: 'bot' as const, bot_persona: 'x' };
const T = '2026-11-02T08:15:05.000Z';
const base = { event_id: uuid7(Date.UTC(2026, 10, 2)), schema_version: 1, game_version: '0.1.0', player_id: 'p', session_id: 's', client: 'browser', bot_persona: null, seq: 0, event_time: T, sent_at: T };
const station = { station: 'farm', slimes: 1, level: 0, produced: 1, consumed: 0, input_stock: 0 };

const VALID: Record<string, object> = {
  session_start: { offline_seconds: null, is_new_player: true },
  session_end: { session_seconds: 60, reason: 'closed' },
  offline_progress_applied: { offline_seconds: 100, credited_seconds: 100, produced: { farm: 5 }, bread_sold: 1, coins_earned: 10 },
  slime_purchased: { slime_id: 'slime-1', cost: 20, total_purchased: 1, coins_after: 0 },
  slime_assigned: { slime_id: 'slime-1', from_station: null, to_station: 'farm' },
  station_upgraded: { station: 'farm', new_level: 1, cost: 50, speed_multiplier: 1.1, milestone_reached: false, coins_after: 5 },
  achievement_unlocked: { achievement_id: 'first_bread', total_unlocked: 1 },
  production_tick: { window_start: T, window_end: T, stations: [station], bread_sold: 0, coins_earned: 0, coins_balance: 20 },
};

describe('uuid7', () => {
  test('valid v7 format, embeds the timestamp, sorts by time, random part differs', () => {
    const ms = Date.UTC(2026, 10, 2);
    const id = uuid7(ms);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
    expect(uuid7(ms + 1000) > id).toBe(true);
    expect(uuid7(ms)).not.toBe(id);
  });
});

describe('schema', () => {
  test.each(Object.entries(VALID))('accepts a valid %s', (type, body) => {
    expect(GameEvent.safeParse({ ...base, event_type: type, ...body }).success).toBe(true);
  });
  test.each(Object.entries(VALID))('rejects %s with a missing required field', (type, body) => {
    const [first] = Object.keys(body);
    const { [first]: _drop, ...rest } = body as Record<string, unknown>;
    expect(GameEvent.safeParse({ ...base, event_type: type, ...rest }).success).toBe(false);
  });
  test('rejects unknown event_type, bad enum values, bad timestamps, wrong schema_version, non-uuid ids', () => {
    const ok = { ...base, event_type: 'slime_assigned', ...VALID.slime_assigned };
    expect(GameEvent.safeParse(ok).success).toBe(true);
    expect(GameEvent.safeParse({ ...ok, event_type: 'nonsense' }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, to_station: 'nowhere' }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, client: 'robot' }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, event_time: 'yesterday' }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, schema_version: 2 }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, event_id: 'abc' }).success).toBe(false);
    expect(GameEvent.safeParse({ ...ok, seq: -1 }).success).toBe(false);
  });
  test('ingested_at is optional but must be a timestamp when present', () => {
    const ok = { ...base, event_type: 'achievement_unlocked', ...VALID.achievement_unlocked };
    expect(GameEvent.safeParse({ ...ok, ingested_at: T }).success).toBe(true);
    expect(GameEvent.safeParse({ ...ok, ingested_at: 'x' }).success).toBe(false);
  });
  test('achievement_unlocked: total_unlocked must be a positive integer', () => {
    const e = { ...base, event_type: 'achievement_unlocked', achievement_id: 'a' };
    expect(GameEvent.safeParse({ ...e, total_unlocked: 0 }).success).toBe(false);
    expect(GameEvent.safeParse({ ...e, total_unlocked: 1.5 }).success).toBe(false);
  });
});

describe('emitter', () => {
  test('stamps shared fields, increments seq from 0, and every output passes the schema', () => {
    const out: GameEvent[] = [];
    const emit = makeEmitter(ctx, (e) => out.push(e));
    emit('slime_purchased', 1_000, { slime_id: 'a', cost: 20, total_purchased: 1, coins_after: 0 });
    emit('slime_assigned', 2_000, { slime_id: 'a', from_station: null, to_station: 'farm' });
    emit('achievement_unlocked', 3_000, { achievement_id: 'first_slime', total_unlocked: 1 });
    expect(out.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(out.map((e) => e.event_time)).toEqual([1_000, 2_000, 3_000].map((t) => new Date(t).toISOString()));
    for (const e of out) {
      expect(e).toMatchObject({ player_id: 'p', session_id: 's', client: 'bot', bot_persona: 'x', schema_version: 1 });
      expect(GameEvent.safeParse(e).success).toBe(true);
    }
    expect(new Set(out.map((e) => e.event_id)).size).toBe(3);
  });
  test('seq counters are per emitter', () => {
    const a: GameEvent[] = [], b: GameEvent[] = [];
    const ea = makeEmitter(ctx, (e) => a.push(e)), eb = makeEmitter(ctx, (e) => b.push(e));
    ea('session_end', 0, { session_seconds: 1, reason: 'closed' });
    ea('session_end', 0, { session_seconds: 1, reason: 'closed' });
    eb('session_end', 0, { session_seconds: 1, reason: 'closed' });
    expect([a.length, a[1].seq, b[0].seq]).toEqual([2, 1, 0]);
  });
});
