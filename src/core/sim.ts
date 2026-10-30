// Pure game core: no clock, no Math.random. Time is passed in via step(dt); randomness via rng().
export type StationId = 'farm' | 'mill' | 'bakery';
export const STATIONS: StationId[] = ['farm', 'mill', 'bakery'];

const RECIPE = {
  farm: { seconds: 1, input: 0 },
  mill: { seconds: 3, input: 2 },
  bakery: { seconds: 5, input: 2 },
} as const;
const BREAD_PRICE = 10;
// Queue thresholds (items waiting at a station): the UI colours, Help text and achievements all read these.
export const QUEUE = { starved: 2, busy: 50, backed: 100, jam: 200 } as const; // below `starved` a station can't start a cycle
export const OFFLINE_CAP_SECONDS = 8 * 3600;

export type Trait = 'leaf' | 'stone' | 'flame' | 'lucky';
export const TRAITS: Trait[] = ['leaf', 'stone', 'flame', 'lucky'];
export interface Slime { id: string; station: StationId | null; tier: number; trait: Trait | null } // station null = lounge

// M3: merging, mutations, station slots. All numbers are provisional (spec: 合成與變異).
export const MERGE_SIZE = 3;
export const TIER_BASE = 2.5; // output multiplier = TIER_BASE^(tier-1): 3 -> 1 loses ~17% output but frees 2 slots
export const MUTATION_CHANCE = 0.05; // per merge; x2 if any ingredient is lucky
export const START_SLOTS = 10;
export const EXPAND_STEP = 5;
// trait -> station -> output multiplier (each trait is bad somewhere, so placement matters)
const TRAIT_FIT: Record<Trait, Partial<Record<StationId, number>>> = {
  leaf: { farm: 1.5, bakery: 0.8 }, stone: { mill: 1.5, farm: 0.8 }, flame: { bakery: 1.5, mill: 0.8 }, lucky: {},
};
export interface Station {
  level: number;
  progress: number; // fractional cycles carried between steps
  stock: number; // input waiting to be processed
  made: number; // lifetime cycles completed (the UI animates deltas of this)
  slots: number; // how many slimes may work here
  produced: number; // window counters, reset by takeWindow
  consumed: number;
}
export interface State {
  coins: number;
  bread: number;
  totalPurchased: number;
  breadSold: number; // window
  coinsEarned: number; // window
  slimes: Slime[];
  stations: Record<StationId, Station>;
  achievements: string[]; // unlocked ids, in unlock order
  features: string[]; // unlocked feature ids (tabs / mechanics), in unlock order
  totalMerged: number;
}

export function newState(assign: Record<StationId, number> = { farm: 1, mill: 1, bakery: 1 }): State {
  const slimes: Slime[] = [];
  for (const id of STATIONS) for (let i = 0; i < assign[id]; i++) slimes.push({ id: `slime-s${slimes.length}`, station: id, tier: 1, trait: null });
  const st = (): Station => ({ level: 0, progress: 0, stock: 0, made: 0, slots: START_SLOTS, produced: 0, consumed: 0 });
  return {
    coins: 20, bread: 0, totalPurchased: 0, breadSold: 0, coinsEarned: 0, slimes, achievements: [], features: [], totalMerged: 0,
    stations: { farm: st(), mill: st(), bakery: st() },
  };
}

// Saves from before M3 lack tiers, traits, slots and features.
export function migrate(s: State) {
  s.achievements ??= [];
  s.features ??= [];
  s.totalMerged ??= 0;
  for (const x of s.slimes) { x.tier ??= 1; x.trait ??= null; }
  for (const id of STATIONS) { s.stations[id].made ??= 0; s.stations[id].slots ??= START_SLOTS; }
}

// mulberry32: same seed, same sequence
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const count = (s: State, where: StationId | null) => s.slimes.filter((x) => x.station === where).length;
// Effective workforce at a station: tier and trait scale each slime's share of the work.
export const slimePower = (x: Slime, at: StationId) => TIER_BASE ** (x.tier - 1) * (x.trait ? TRAIT_FIT[x.trait][at] ?? 1 : 1);
export const slimeCost = (s: State) => Math.round(20 * 1.15 ** s.totalPurchased);
export const upgradeCost = (s: State, id: StationId) => Math.round(50 * 1.12 ** s.stations[id].level);
export const speedMultiplier = (level: number) => (1 + 0.1 * level) * 2 ** [10, 25, 50].filter((m) => level >= m).length;

export function buySlime(s: State): Slime | null {
  const cost = slimeCost(s);
  if (s.coins < cost) return null;
  s.coins -= cost;
  s.totalPurchased++;
  const slime: Slime = { id: `slime-${s.totalPurchased}`, station: null, tier: 1, trait: null };
  s.slimes.push(slime);
  return slime;
}

// "+" pulls one from the lounge into `to`; "-" (to=null) sends one back from `from`.
export function assignOne(s: State, to: StationId | null, from: StationId | null = null) {
  const slime = s.slimes.find((x) => (to ? x.station === null : x.station === from));
  if (!slime || (to === null && from === null)) return null;
  if (to && count(s, to) >= s.stations[to].slots) return null; // station full
  const prev = slime.station;
  slime.station = to;
  return { slime, from: prev, to };
}

export function upgrade(s: State, id: StationId) {
  const cost = upgradeCost(s, id);
  if (s.coins < cost) return null;
  s.coins -= cost;
  const level = ++s.stations[id].level;
  return { station: id, cost, level, speedMultiplier: speedMultiplier(level), milestone: [10, 25, 50].includes(level) };
}

export const expandCost = (s: State, id: StationId) => Math.round(100 * 2 ** ((s.stations[id].slots - START_SLOTS) / EXPAND_STEP));
export function expand(s: State, id: StationId) {
  const cost = expandCost(s, id);
  if (s.coins < cost) return null;
  s.coins -= cost;
  return { station: id, cost, slots: (s.stations[id].slots += EXPAND_STEP) };
}

// Feature unlocks are pure conditions on State, like achievements; idempotent, returns the newly unlocked ids.
const FEATURES: Record<string, (s: State) => boolean> = {
  merge: (s) => s.totalPurchased >= 6,
  expansion: (s) => STATIONS.some((i) => count(s, i) >= 8),
};
export function checkFeatures(s: State): string[] {
  const fresh = Object.keys(FEATURES).filter((f) => !s.features.includes(f) && FEATURES[f](s));
  s.features.push(...fresh);
  return fresh;
}

// Merge the first MERGE_SIZE slimes of the lowest tier that has enough (lounge first, so working slimes stay put).
// The result waits in the lounge. Trait: inherited from a random ingredient that has one; otherwise the mutation roll
// (chance doubles with a lucky ingredient) may give a random trait. `mutated` = a brand-new trait appeared.
const mergeTier = (pool: Slime[]) => pool.find((x) => pool.filter((y) => y.tier === x.tier).length >= MERGE_SIZE)?.tier;
export const canMerge = (s: State) => s.features.includes('merge') && mergeTier([...s.slimes].sort((a, b) => a.tier - b.tier)) !== undefined;
export function merge(s: State, rand: () => number) {
  if (!s.features.includes('merge')) return null;
  const order = (x: Slime) => (x.station === null ? 0 : 1);
  const pool = [...s.slimes].sort((a, b) => a.tier - b.tier || order(a) - order(b));
  const tier = mergeTier(pool);
  if (tier === undefined) return null;
  const mats = pool.filter((x) => x.tier === tier).slice(0, MERGE_SIZE);
  const chance = MUTATION_CHANCE * (mats.some((x) => x.trait === 'lucky') ? 2 : 1);
  const roll = rand() < chance;
  const held = mats.map((x) => x.trait).filter((t): t is Trait => t !== null);
  const trait = held.length ? held[Math.floor(rand() * held.length)] : roll ? TRAITS[Math.floor(rand() * TRAITS.length)] : null;
  s.slimes = s.slimes.filter((x) => !mats.includes(x));
  const slime: Slime = { id: `slime-m${++s.totalMerged}`, station: null, tier: tier + 1, trait };
  s.slimes.push(slime);
  return { slime, materials: mats.map((x) => x.id), chance, mutated: roll && held.length === 0 };
}

// ponytail: cycles resolve in chain order within one dt; keep dt small (<=0.1s) for accuracy.
export function step(s: State, dt: number): void {
  const n = { farm: 0, mill: 0, bakery: 0 }; // one pass over the slimes instead of one per station
  for (const x of s.slimes) if (x.station) n[x.station] += slimePower(x, x.station);
  let output = 0;
  for (const id of STATIONS) {
    const st = s.stations[id];
    const r = RECIPE[id];
    // A cycle only starts when its input is on hand; starved slimes bank no work.
    if (r.input && st.stock < r.input) st.progress = 0;
    else st.progress += (n[id] * speedMultiplier(st.level) * dt) / r.seconds;
    const whole = Math.floor(st.progress + 1e-9); // epsilon: 0.1s steps sum to 2.9999999..
    const cycles = r.input ? Math.min(whole, Math.floor(st.stock / r.input)) : whole;
    st.progress = Math.max(0, st.progress - whole);
    st.stock -= cycles * r.input;
    st.consumed += cycles * r.input;
    st.produced += cycles;
    st.made += cycles;
    output = cycles;
    const next = STATIONS[STATIONS.indexOf(id) + 1];
    if (next) s.stations[next].stock += output;
    else {
      s.bread += output;
      s.breadSold += output;
      s.coinsEarned += output * BREAD_PRICE;
      s.coins += output * BREAD_PRICE;
    }
  }
}

// Offline progress is just the same simulation run over the (capped) away time.
export function applyOffline(s: State, seconds: number) {
  const credited = Math.min(seconds, OFFLINE_CAP_SECONDS);
  const before = { coins: s.coins, bread: s.bread, produced: STATIONS.map((i) => s.stations[i].produced) };
  const window = { consumed: STATIONS.map((i) => s.stations[i].consumed), breadSold: s.breadSold, coinsEarned: s.coinsEarned };
  for (let t = 0; t < credited; t += 1) step(s, 1);
  const result = {
    offlineSeconds: seconds, creditedSeconds: credited,
    breadSold: s.bread - before.bread, coinsEarned: s.coins - before.coins,
    produced: Object.fromEntries(STATIONS.map((i, k) => [i, s.stations[i].produced - before.produced[k]])),
  };
  // The window counters feed production_tick; offline output is reported once, by offline_progress_applied, so it must not
  // also land in the next tick as if it happened in a few seconds.
  STATIONS.forEach((i, k) => { s.stations[i].produced = before.produced[k]; s.stations[i].consumed = window.consumed[k]; });
  s.breadSold = window.breadSold;
  s.coinsEarned = window.coinsEarned;
  return result;
}

export function takeWindow(s: State) {
  const out = {
    stations: STATIONS.map((id) => ({
      station: id, slimes: count(s, id), level: s.stations[id].level,
      produced: s.stations[id].produced, consumed: s.stations[id].consumed, input_stock: s.stations[id].stock,
    })),
    bread_sold: s.breadSold, coins_earned: s.coinsEarned, coins_balance: s.coins,
    slimes_owned: s.slimes.length, achievements_unlocked: s.achievements.length, // state snapshot: lets a dashboard rank players whose progress predates telemetry
  };
  for (const id of STATIONS) s.stations[id].produced = s.stations[id].consumed = 0;
  s.breadSold = s.coinsEarned = 0;
  return out;
}
