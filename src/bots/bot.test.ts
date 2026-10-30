import { describe, expect, test } from 'vitest';
import type { GameEvent } from '../events/schema';
import { GameEvent as Schema } from '../events/schema';
import { runBot, type Persona } from './bot';

const START = Date.UTC(2026, 10, 2);
const play = async (persona: Persona, seconds: number, seed = 1) => {
  const events: GameEvent[] = [];
  await runBot({ id: `bot-${persona}`, persona, seed, startMs: START, seconds, sink: (e) => void events.push(e) });
  return events;
};
const of = <T extends GameEvent['event_type']>(events: GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { event_type: T }> => e.event_type === type);
// coins_balance is a bad yardstick (the optimizer spends on upgrades), so compare bread sold
const breadSold = (events: GameEvent[]) => of(events, 'production_tick').reduce((n, t) => n + t.bread_sold, 0);

describe.each<Persona>(['random_assigner', 'optimizer', 'quitter'])('%s', (persona) => {
  test('every event is schema-valid and carries the bot identity', async () => {
    const events = await play(persona, 300);
    expect(events.length).toBeGreaterThan(30);
    for (const e of events) {
      expect(Schema.safeParse(e).success).toBe(true);
      expect(e).toMatchObject({ client: 'bot', bot_persona: persona, game_version: '0.1.0', schema_version: 2 });
    }
  });
  test('seq is 0..n-1 with no gaps; event_time never goes backwards; ids are unique', async () => {
    const events = await play(persona, 300);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const times = events.map((e) => Date.parse(e.event_time));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(events.length);
  });
  test('session_start first (new player), session_end last (bot_stop) with matching length', async () => {
    const events = await play(persona, 200);
    expect(events[0]).toMatchObject({ event_type: 'session_start', is_new_player: true, offline_seconds: null });
    const last = events.at(-1)!;
    expect(last).toMatchObject({ event_type: 'session_end', reason: 'bot_stop' });
    expect((last as { session_seconds: number }).session_seconds).toBe(persona === 'quitter' ? 120 : 200);
  });
  test('production_tick every 5s; windows are contiguous and 5s long', async () => {
    const seconds = persona === 'quitter' ? 120 : 200;
    const ticks = of(await play(persona, 200), 'production_tick');
    expect(ticks).toHaveLength(seconds / 5);
    ticks.forEach((t, i) => {
      expect(Date.parse(t.window_end) - Date.parse(t.window_start)).toBe(5000);
      if (i) expect(t.window_start).toBe(ticks[i - 1].window_end);
      expect(t.stations.map((x) => x.station)).toEqual(['farm', 'mill', 'bakery']);
    });
  });
  test('purchases: total_purchased counts up by one, coins never go negative', async () => {
    const buys = of(await play(persona, 600), 'slime_purchased');
    buys.forEach((b, i) => {
      expect(b.total_purchased).toBe(i + 1);
      expect(b.coins_after).toBeGreaterThanOrEqual(0);
      expect(b.cost).toBeGreaterThanOrEqual(20);
    });
  });
  test('assignments always move a slime out of the lounge or between stations consistently', async () => {
    const where = new Map<string, string | null>();
    for (const e of await play(persona, 600)) {
      if (e.event_type === 'slime_purchased') where.set(e.slime_id, null);
      if (e.event_type === 'slime_assigned') {
        if (where.has(e.slime_id)) expect(where.get(e.slime_id)).toBe(e.from_station);
        where.set(e.slime_id, e.to_station);
      }
    }
  });
  test('achievement events are unique per id and total_unlocked counts up', async () => {
    const got = of(await play(persona, 900), 'achievement_unlocked');
    expect(new Set(got.map((a) => a.achievement_id)).size).toBe(got.length);
    got.forEach((a, i) => expect(a.total_unlocked).toBe(i + 1));
  });
  test('same seed gives the same events (ignoring random ids)', async () => {
    const strip = (es: GameEvent[]) => es.map(({ event_id: _id, ...rest }) => rest);
    expect(strip(await play(persona, 300, 5))).toEqual(strip(await play(persona, 300, 5)));
  });
});

describe('personas differ', () => {
  test('quitter stops at 120s even when asked to play longer', async () => {
    const events = await play('quitter', 3600);
    expect(Date.parse(events.at(-1)!.event_time) - START).toBe(120_000);
  });
  test('random_assigner events depend on the seed', async () => {
    const a = of(await play('random_assigner', 600, 1), 'slime_assigned').map((e) => e.to_station);
    const b = of(await play('random_assigner', 600, 2), 'slime_assigned').map((e) => e.to_station);
    expect(a).not.toEqual(b);
  });
  test('optimizer sells more bread than the random assigner over ten minutes', async () => {
    let wins = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      if (breadSold(await play('optimizer', 600, seed)) > breadSold(await play('random_assigner', 600, seed))) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });
  test('optimizer is the only persona that upgrades stations', async () => {
    expect(of(await play('optimizer', 600), 'station_upgraded').length).toBeGreaterThan(0);
    expect(of(await play('random_assigner', 600), 'station_upgraded')).toHaveLength(0);
  });
  test('optimizer keeps the station mix close to 4:6:5 ratios', async () => {
    const t = of(await play('optimizer', 900), 'production_tick').at(-1)!;
    const n = Object.fromEntries(t.stations.map((s) => [s.station, s.slimes]));
    const total = n.farm + n.mill + n.bakery;
    expect(n.farm / total).toBeGreaterThan(0.2);
    expect(n.mill / total).toBeGreaterThan(0.3);
    expect(n.bakery / total).toBeGreaterThan(0.25);
  });
});

describe('M3 events', () => {
  test('features unlock once each, before the first merge; merges eat three slimes the bot owned', async () => {
    const events = await play('optimizer', 1200);
    const unlocked = of(events, 'feature_unlocked').map((e) => e.feature_id);
    expect(new Set(unlocked).size).toBe(unlocked.length);
    expect(unlocked).toContain('merge');
    const merges = of(events, 'slime_merged');
    expect(merges.length).toBeGreaterThan(0);
    expect(events.indexOf(of(events, 'feature_unlocked')[0])).toBeLessThan(events.indexOf(merges[0]));
    const known = new Set<string>(['slime-s0', 'slime-s1', 'slime-s2']);
    for (const e of events) {
      if (e.event_type === 'slime_purchased') known.add(e.slime_id);
      if (e.event_type === 'slime_merged') {
        for (const m of e.material_ids) { expect(known.has(m)).toBe(true); known.delete(m); }
        known.add(e.slime_id);
      }
    }
  });
  test('no station ever holds more slimes than its slots', async () => {
    const events = await play('random_assigner', 1800);
    for (const t of of(events, 'production_tick')) for (const st of t.stations) expect(st.slimes).toBeLessThanOrEqual(10 + 5 * of(events, 'station_expanded').length);
  });
});

describe('pacing hook', () => {
  test('pace is awaited once per simulated second', async () => {
    let calls = 0;
    await runBot({ id: 'b', persona: 'optimizer', seed: 1, startMs: START, seconds: 30, sink: () => {}, pace: async (v) => { calls += v; } });
    expect(calls).toBe(30);
  });
});
