import { checkAchievements } from '../core/achievements';
import { assignOne, buySlime, checkFeatures, count, expand, expandCost, merge, newState, rng, slimeCost, STATIONS, step, takeWindow, upgrade, upgradeCost, type State, type StationId } from '../core/sim';
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
    for (const f of checkFeatures(s)) emit('feature_unlocked', at(t), { feature_id: f });
    for (const a of checkAchievements(s)) emit('achievement_unlocked', at(t), { achievement_id: a.id, total_unlocked: s.achievements.length });
    if (t % 5 === 0) {
      emit('production_tick', at(t), { window_start: new Date(at(windowStart)).toISOString(), window_end: new Date(at(t)).toISOString(), ...takeWindow(s) });
      windowStart = t;
    }
    await o.pace?.(1);
  }
  emit('session_end', at(seconds), { session_seconds: seconds, reason: 'bot_stop' });

  function act(t: number) {
    const now = at(t);
    // the optimizer only buys slimes while they cost no more than 1.5x the cheapest upgrade; the others buy whenever they can
    const cheapUpgrade = Math.min(...STATIONS.map((i) => upgradeCost(s, i)));
    if (o.persona !== 'optimizer' || slimeCost(s) <= cheapUpgrade * 1.5) {
      const cost = slimeCost(s);
      const slime = buySlime(s);
      if (slime) emit('slime_purchased', now, { slime_id: slime.id, cost, total_purchased: s.totalPurchased, coins_after: s.coins });
    }
    // a full station is what makes merging worth it: merge only when slimes are waiting and no station has room
    const room = () => STATIONS.filter((i) => count(s, i) < s.stations[i].slots);
    const assignLounge = () => {
      for (let open = room(); count(s, null) > 0 && open.length; open = room()) {
        const to = o.persona === 'optimizer'
          ? open.reduce((a, b) => (count(s, a) / IDEAL[a] <= count(s, b) / IDEAL[b] ? a : b))
          : open[Math.floor(rand() * open.length)];
        const r = assignOne(s, to)!;
        emit('slime_assigned', now, { slime_id: r.slime.id, from_station: r.from, to_station: r.to, tier: r.slime.tier, trait: r.slime.trait });
      }
    };
    assignLounge();
    if (count(s, null) > 0 && !room().length) {
      // expand the first full station if the optimizer finds it cheaper than a slime, else merge
      const cost = expandCost(s, STATIONS[0]);
      const e = o.persona === 'optimizer' && s.features.includes('expansion') && cost <= slimeCost(s) * 1.5 ? expand(s, STATIONS[0]) : null;
      if (e) emit('station_expanded', now, { station: e.station, new_slots: e.slots, cost, coins_after: s.coins });
      for (let m = e ? null : merge(s, rand); m; m = null) {
        emit('slime_merged', now, { slime_id: m.slime.id, material_ids: m.materials, new_tier: m.slime.tier, trait: m.slime.trait, mutated: m.mutated, mutation_chance: m.chance });
      }
      assignLounge();
    }
    if (o.persona === 'optimizer') {
      const target = STATIONS.reduce((a, b) => (upgradeCost(s, a) <= upgradeCost(s, b) ? a : b));
      const cost = upgradeCost(s, target);
      const u = upgrade(s, target);
      if (u) emit('station_upgraded', now, { station: u.station, new_level: u.level, cost, speed_multiplier: u.speedMultiplier, milestone_reached: u.milestone, coins_after: s.coins });
    }
  }
}
