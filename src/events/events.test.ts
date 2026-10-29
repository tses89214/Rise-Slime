import { expect, test } from 'vitest';
import { makeEmitter, uuid7 } from './emitter';
import { GameEvent } from './schema';

const ctx = { game_version: '0.1.0', player_id: 'p', session_id: 's', client: 'bot' as const, bot_persona: 'x' };

test('uuid7 is valid, embeds the timestamp, and sorts by time', () => {
  const ms = Date.UTC(2026, 10, 2);
  const id = uuid7(ms);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
  expect(uuid7(ms + 1000) > id).toBe(true);
});

test('emitter increments seq and passes schema; missing field is rejected', () => {
  const out: GameEvent[] = [];
  const emit = makeEmitter(ctx, (e) => out.push(e));
  emit('slime_purchased', 1_000, { slime_id: 'a', cost: 20, total_purchased: 1, coins_after: 0 });
  emit('slime_assigned', 2_000, { slime_id: 'a', from_station: null, to_station: 'farm' });
  expect(out.map((e) => e.seq)).toEqual([0, 1]);
  for (const e of out) expect(GameEvent.safeParse(e).success).toBe(true);
  const { cost: _cost, ...broken } = out[0] as Record<string, unknown>;
  expect(GameEvent.safeParse(broken).success).toBe(false);
  expect(GameEvent.safeParse({ ...out[1], to_station: 'nowhere' }).success).toBe(false);
});
