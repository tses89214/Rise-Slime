import { assignOne, buySlime, count, newState, rng, slimeCost, STATIONS, step, takeWindow, upgrade, upgradeCost, type State, type StationId } from '../core/sim';
import { makeEmitter } from '../events/emitter';
import type { GameEvent } from '../events/schema';

export type Persona = 'random_assigner' | 'optimizer' | 'quitter';
const IDEAL: Record<StationId, number> = { farm: 4, mill: 6, bakery: 5 };

export interface BotOpts { id: string; persona: Persona; seed: number; startMs: number; seconds: number; sink: (e: GameEvent) => void | Promise<void>; pace?: (virtualSeconds: number) => Promise<void> }

export async function runBot(o: BotOpts) {
  const rand = rng(o.seed);
  const s: State = newState();
  const emit = makeEmitter({ game_version: '0.1.0', player_id: o.id, session_id: `s-${o.seed.toString(16)}`, client: 'bot', bot_persona: o.persona }, (e) => void o.sink(e));
  const at = (t: number) => o.startMs + t * 1000;
  const seconds = o.persona === 'quitter' ? Math.min(o.seconds, 120) : o.seconds;

  emit('session_start', at(0), { offline_seconds: null, is_new_player: true });
  let windowStart = 0;
  for (let t = 1; t <= seconds; t++) {
    for (let i = 0; i < 10; i++) step(s, 0.1);
    act(t);
    if (t % 5 === 0) {
      emit('production_tick', at(t), { window_start: new Date(at(windowStart)).toISOString(), window_end: new Date(at(t)).toISOString(), ...takeWindow(s) });
      windowStart = t;
    }
    await o.pace?.(1);
  }
  emit('session_end', at(seconds), { session_seconds: seconds, reason: 'bot_stop' });

  function act(t: number) {
    const now = at(t);
    // buy
    if (o.persona !== 'optimizer' || slimeCost(s) <= Math.min(...STATIONS.map((i) => upgradeCost(s, i))) * 1.5) {
      const cost = slimeCost(s);
      const slime = buySlime(s);
      if (slime) emit('slime_purchased', now, { slime_id: slime.id, cost, total_purchased: s.totalPurchased, coins_after: s.coins });
    }
    // assign everything waiting in the lounge
    while (count(s, null) > 0) {
      const to = o.persona === 'optimizer'
        ? STATIONS.reduce((a, b) => (count(s, a) / IDEAL[a] <= count(s, b) / IDEAL[b] ? a : b))
        : STATIONS[Math.floor(rand() * 3)];
      const r = assignOne(s, to)!;
      emit('slime_assigned', now, { slime_id: r.slime.id, from_station: r.from, to_station: r.to });
    }
    if (o.persona === 'optimizer') {
      const target = STATIONS.reduce((a, b) => (upgradeCost(s, a) <= upgradeCost(s, b) ? a : b));
      const cost = upgradeCost(s, target);
      const u = upgrade(s, target);
      if (u) emit('station_upgraded', now, { station: u.station, new_level: u.level, cost, speed_multiplier: u.speedMultiplier, milestone_reached: u.milestone, coins_after: s.coins });
    }
  }
}
