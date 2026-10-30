import { describe, expect, test } from 'vitest';
import {
  applyOffline, assignOne, migrate, buySlime, checkFeatures, count, expand, expandCost, merge, newState, slimePower, START_SLOTS, OFFLINE_CAP_SECONDS, rng, slimeCost,
  speedMultiplier, State, STATIONS, step, takeWindow, upgrade, upgradeCost,
} from './sim';

const run = (s: State, seconds: number, dt = 0.1) => { for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt); };
const OPTIMAL = { farm: 4, mill: 6, bakery: 5 };

describe('newState', () => {
  test('default: one slime per station, 20 coins, nothing purchased', () => {
    const s = newState();
    expect(s.coins).toBe(20);
    expect(s.totalPurchased).toBe(0);
    expect(STATIONS.map((id) => count(s, id))).toEqual([1, 1, 1]);
    expect(count(s, null)).toBe(0);
    expect(STATIONS.every((id) => s.stations[id].level === 0 && s.stations[id].stock === 0)).toBe(true);
  });
  test('custom assignment; slime ids are unique', () => {
    const s = newState(OPTIMAL);
    expect(STATIONS.map((id) => count(s, id))).toEqual([4, 6, 5]);
    expect(new Set(s.slimes.map((x) => x.id)).size).toBe(15);
  });
});

describe('costs and multipliers', () => {
  test('slime cost: 20 * 1.15^totalPurchased', () => {
    const s = newState();
    expect(slimeCost(s)).toBe(20);
    for (const [n, want] of [[1, 23], [5, 40], [10, 81]] as const) {
      s.totalPurchased = n;
      expect(slimeCost(s)).toBe(want);
    }
  });
  test('slime cost counts cumulative purchases, not slimes owned (anti merge-farming)', () => {
    const s = newState();
    s.coins = 1e6;
    buySlime(s); buySlime(s);
    s.slimes.pop(); // owning fewer slimes must not lower the price
    expect(slimeCost(s)).toBe(Math.round(20 * 1.15 ** 2));
  });
  test('upgrade cost: 50 * 1.12^level, tracked per station', () => {
    const s = newState();
    s.coins = 1e6;
    expect(upgradeCost(s, 'farm')).toBe(50);
    upgrade(s, 'farm');
    expect(upgradeCost(s, 'farm')).toBe(56);
    expect(upgradeCost(s, 'mill')).toBe(50);
    expect(upgradeCost(s, 'bakery')).toBe(50);
  });
  test.each([
    [0, 1], [1, 1.1], [9, 1.9], [10, 4], [24, 3.4 * 2], [25, 3.5 * 4], [49, 5.9 * 4], [50, 6 * 8],
  ])('speedMultiplier(level %i) = %f (+10%%/level, x2 at 10/25/50)', (level, want) => {
    expect(speedMultiplier(level)).toBeCloseTo(want);
  });
});

describe('buySlime', () => {
  test('pays, increments totalPurchased, slime waits in lounge', () => {
    const s = newState();
    s.coins = 100;
    const slime = buySlime(s)!;
    expect(slime.station).toBeNull();
    expect(s.coins).toBe(80);
    expect(s.totalPurchased).toBe(1);
    expect(count(s, null)).toBe(1);
  });
  test('exact price is enough; one coin short is not (state untouched)', () => {
    const s = newState();
    s.coins = 19;
    expect(buySlime(s)).toBeNull();
    expect([s.coins, s.totalPurchased, s.slimes.length]).toEqual([19, 0, 3]);
    s.coins = 20;
    expect(buySlime(s)).not.toBeNull();
    expect(s.coins).toBe(0);
  });
  test('new slime ids are unique across purchases', () => {
    const s = newState();
    s.coins = 1e6;
    const ids = Array.from({ length: 5 }, () => buySlime(s)!.id);
    expect(new Set([...ids, ...s.slimes.map((x) => x.id)]).size).toBe(8);
  });
});

describe('assignOne', () => {
  test('"+" moves a lounge slime into the station and reports from/to', () => {
    const s = newState();
    s.coins = 100; buySlime(s);
    const r = assignOne(s, 'mill')!;
    expect([r.from, r.to]).toEqual([null, 'mill']);
    expect(count(s, 'mill')).toBe(2);
    expect(count(s, null)).toBe(0);
  });
  test('"-" moves a station slime back to the lounge', () => {
    const s = newState();
    const r = assignOne(s, null, 'bakery')!;
    expect([r.from, r.to]).toEqual(['bakery', null]);
    expect(count(s, 'bakery')).toBe(0);
    expect(count(s, null)).toBe(1);
  });
  test('"+" with empty lounge, "-" on empty station, and no-op args all return null', () => {
    const s = newState();
    expect(assignOne(s, 'farm')).toBeNull();
    expect(assignOne(s, null, null)).toBeNull();
    assignOne(s, null, 'farm');
    expect(assignOne(s, null, 'farm')).toBeNull();
  });
  test('slime count is conserved', () => {
    const s = newState(OPTIMAL);
    for (let i = 0; i < 20; i++) assignOne(s, i % 2 ? 'farm' : null, i % 2 ? null : STATIONS[i % 3]);
    expect(s.slimes.length).toBe(15);
  });
});

describe('upgrade', () => {
  test('pays, levels up, reports multiplier', () => {
    const s = newState();
    s.coins = 100;
    const u = upgrade(s, 'bakery')!;
    expect(u).toMatchObject({ station: 'bakery', cost: 50, level: 1, speedMultiplier: 1.1, milestone: false });
    expect(s.coins).toBe(50);
    expect(s.stations.bakery.level).toBe(1);
  });
  test('refuses without coins and changes nothing', () => {
    const s = newState();
    s.coins = 49;
    expect(upgrade(s, 'farm')).toBeNull();
    expect([s.coins, s.stations.farm.level]).toEqual([49, 0]);
  });
  test('milestone flag is true exactly at levels 10, 25, 50', () => {
    const s = newState();
    s.coins = 1e12;
    const flagged: number[] = [];
    for (let i = 0; i < 50; i++) { const u = upgrade(s, 'farm')!; if (u.milestone) flagged.push(u.level); }
    expect(flagged).toEqual([10, 25, 50]);
  });
  test('upgrading makes a station faster', () => {
    const a = newState({ farm: 5, mill: 1, bakery: 1 }), b = newState({ farm: 5, mill: 1, bakery: 1 });
    b.coins = 500; upgrade(b, 'farm');
    run(a, 10); run(b, 10);
    expect(b.stations.farm.produced).toBeGreaterThan(a.stations.farm.produced);
  });
});

describe('step: production chain', () => {
  test('farm: n slimes make n wheat per second', () => {
    const s = newState({ farm: 3, mill: 0, bakery: 0 });
    run(s, 10);
    expect(s.stations.farm.produced).toBe(30);
    expect(s.stations.mill.stock).toBe(30);
  });
  test('mill: 2 wheat -> 1 flour every 3s per slime', () => {
    const s = newState({ farm: 0, mill: 1, bakery: 0 });
    s.stations.mill.stock = 100;
    run(s, 30);
    expect(s.stations.mill.produced).toBe(10);
    expect(s.stations.mill.consumed).toBe(20);
    expect(s.stations.bakery.stock).toBe(10);
  });
  test('bakery: 2 flour -> 1 bread every 5s per slime, sold for 10 coins', () => {
    const s = newState({ farm: 0, mill: 0, bakery: 1 });
    s.stations.bakery.stock = 100;
    run(s, 50);
    expect(s.bread).toBe(10);
    expect(s.coins).toBe(20 + 100);
    expect(s.breadSold).toBe(10);
    expect(s.coinsEarned).toBe(100);
    expect(s.stations.bakery.consumed).toBe(20);
  });
  test('optimal 4:6:5 settles at ~1 bread/s and ~10 coins/s with no pile-up', () => {
    const s = newState(OPTIMAL);
    run(s, 300);
    expect((s.coins - 20) / 300).toBeGreaterThan(9.5);
    expect((s.coins - 20) / 300).toBeLessThanOrEqual(10.01);
    expect(s.stations.mill.stock).toBeLessThan(10);
    expect(s.stations.bakery.stock).toBeLessThan(10);
  });
  test('uneven split piles stock in front of the bottleneck', () => {
    const s = newState({ farm: 4, mill: 1, bakery: 5 });
    run(s, 60);
    expect(s.stations.mill.stock).toBeGreaterThan(100);
    expect(s.stations.bakery.stock).toBeLessThan(5);
  });
  test('starting setup (1/1/1): first bread at ~13s (spec check)', () => {
    const s = newState();
    run(s, 12); expect(s.bread).toBe(0);
    run(s, 2); expect(s.bread).toBe(1);
  });
  test('conservation: stock + consumed equals what upstream produced; bread == coins/10', () => {
    const s = newState({ farm: 7, mill: 3, bakery: 4 });
    run(s, 123);
    const st = s.stations;
    expect(st.mill.stock + st.mill.consumed).toBeCloseTo(st.farm.produced, 6);
    expect(st.bakery.stock + st.bakery.consumed).toBeCloseTo(st.mill.produced, 6);
    expect(st.mill.consumed).toBe(2 * st.mill.produced);
    expect(st.bakery.consumed).toBe(2 * st.bakery.produced);
    expect(s.bread).toBe(st.bakery.produced);
    expect(s.coins - 20).toBe(s.bread * 10);
  });
  test('no slime anywhere upstream means nothing is produced', () => {
    const s = newState({ farm: 0, mill: 5, bakery: 5 });
    run(s, 60);
    expect([s.bread, s.stations.farm.produced, s.stations.mill.produced]).toEqual([0, 0, 0]);
    expect(s.coins).toBe(20);
  });
  test('idle slimes do not bank work while starved', () => {
    const s = newState({ farm: 0, mill: 10, bakery: 0 });
    run(s, 60); // starved for a minute
    s.stations.mill.stock = 100;
    run(s, 0.1); // a banked minute of work would release many cycles right now
    expect(s.stations.mill.produced).toBe(0);
  });
  test('result is nearly independent of dt', () => {
    const a = newState(OPTIMAL), b = newState(OPTIMAL);
    run(a, 120, 0.1); run(b, 120, 0.05);
    expect(Math.abs(a.bread - b.bread)).toBeLessThanOrEqual(5);
  });
  test('a zero-length step changes nothing', () => {
    const s = newState(OPTIMAL);
    run(s, 5);
    const before = JSON.stringify(s);
    step(s, 0);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('made counter', () => {
  test('counts lifetime cycles per station and survives takeWindow', () => {
    const s = newState(OPTIMAL);
    run(s, 30);
    const before = STATIONS.map((i) => s.stations[i].made);
    expect(before[0]).toBe(s.stations.farm.produced);
    takeWindow(s);
    expect(STATIONS.map((i) => s.stations[i].made)).toEqual(before);
    run(s, 30);
    expect(s.stations.bakery.made).toBe(s.bread);
    expect(STATIONS.every((i, k) => s.stations[i].made > before[k])).toBe(true);
  });
});

describe('takeWindow', () => {
  test('snapshot counts every slime (lounge included) and unlocked achievements, which the per-station numbers cannot show', () => {
    const s = newState({ farm: 2, mill: 1, bakery: 1 });
    s.coins = 1000;
    buySlime(s); // waits in the lounge: on no station
    s.achievements = ['first_slime', 'first_bread'];
    const w = takeWindow(s);
    expect(w.stations.reduce((n, x) => n + x.slimes, 0)).toBe(4);
    expect(w.slimes_owned).toBe(5);
    expect(w.achievements_unlocked).toBe(2);
  });
  test('reports per-station counters and resets them, keeping stock/coins', () => {
    const s = newState({ farm: 4, mill: 1, bakery: 5 });
    run(s, 30);
    const w = takeWindow(s);
    const by = Object.fromEntries(w.stations.map((x) => [x.station, x]));
    expect(by.farm).toMatchObject({ slimes: 4, level: 0, produced: 120, consumed: 0, input_stock: 0 });
    expect(by.mill.produced).toBe(9); // first cycle waits for 2 wheat
    expect(by.mill.input_stock).toBe(120 - by.mill.consumed);
    expect(w.coins_balance).toBe(s.coins);
    const again = takeWindow(s);
    expect(again.stations.every((x) => x.produced === 0 && x.consumed === 0)).toBe(true);
    expect(again.bread_sold).toBe(0);
    expect(again.coins_earned).toBe(0);
    expect(again.stations.find((x) => x.station === 'mill')!.input_stock).toBe(by.mill.input_stock);
  });
  test('bread_sold and coins_earned are per-window; sum over windows equals total', () => {
    const s = newState(OPTIMAL);
    let sold = 0, earned = 0;
    for (let w = 0; w < 6; w++) { run(s, 5); const r = takeWindow(s); sold += r.bread_sold; earned += r.coins_earned; }
    expect(sold).toBe(s.bread);
    expect(earned).toBe(s.coins - 20);
  });
  test('reflects slimes and levels at the time of the window', () => {
    const s = newState();
    s.coins = 500; upgrade(s, 'mill');
    const m = takeWindow(s).stations.find((x) => x.station === 'mill')!;
    expect([m.slimes, m.level]).toEqual([1, 1]);
  });
});

describe('applyOffline', () => {
  test('below the cap it matches a plain 1s-step simulation', () => {
    const a = newState(OPTIMAL), b = newState(OPTIMAL);
    const r = applyOffline(a, 600);
    for (let i = 0; i < 600; i++) step(b, 1);
    expect(r.creditedSeconds).toBe(600);
    expect(a.coins).toBe(b.coins);
    expect(r.coinsEarned).toBe(b.coins - 20);
    expect(r.breadSold).toBe(b.bread);
  });
  test('offline output does not leak into the next production window (it is reported once, by offline_progress_applied)', () => {
    const s = newState(OPTIMAL);
    run(s, 12); // a little online play first: that part of the window must survive
    const online = takeWindow(structuredClone(s));
    const r = applyOffline(s, 3600);
    expect(r.coinsEarned).toBeGreaterThan(0);
    const w = takeWindow(s);
    expect(w.stations.map((x) => x.produced)).toEqual(online.stations.map((x) => x.produced));
    expect(w.coins_earned).toBe(online.coins_earned);
    expect(w.bread_sold).toBe(online.bread_sold);
  });
  test('caps credited time at 8 hours and still reports the real offline time', () => {
    const s = newState(OPTIMAL);
    const r = applyOffline(s, 24 * 3600);
    expect(r.offlineSeconds).toBe(24 * 3600);
    expect(r.creditedSeconds).toBe(OFFLINE_CAP_SECONDS);
    expect(r.coinsEarned).toBeGreaterThan(OFFLINE_CAP_SECONDS * 9);
    expect(r.coinsEarned).toBeLessThanOrEqual(OFFLINE_CAP_SECONDS * 10.1);
  });
  test('per-station produced counts are reported for every station', () => {
    const r = applyOffline(newState(OPTIMAL), 100);
    expect(Object.keys(r.produced).sort()).toEqual(['bakery', 'farm', 'mill']);
    expect(r.produced.farm).toBeGreaterThan(r.produced.bakery);
  });
  test('zero seconds changes nothing', () => {
    const s = newState(OPTIMAL);
    const r = applyOffline(s, 0);
    expect([r.coinsEarned, r.breadSold, s.coins]).toEqual([0, 0, 20]);
  });
});

describe('rng', () => {
  test('same seed -> same sequence; different seed -> different', () => {
    const take = (seed: number) => { const r = rng(seed); return Array.from({ length: 8 }, r); };
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });
  test('values are in [0,1) and roughly uniform', () => {
    const r = rng(1);
    const xs = Array.from({ length: 20000 }, r);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((a, b) => a + b) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('M3: merging', () => {
  // 3 slimes of tier 1 in the lounge, merge unlocked
  const lounge = (n: number, tier = 1, trait: 'leaf' | 'lucky' | null = null) => {
    const s = newState({ farm: 0, mill: 0, bakery: 0 });
    s.features.push('merge');
    for (let i = 0; i < n; i++) s.slimes.push({ id: `t${tier}-${i}`, station: null, tier, trait });
    return s;
  };
  const never = () => 0.99; // rolls above any mutation chance

  test('locked until the merge feature is unlocked (the Slimes tab does not exist yet)', () => {
    const s = lounge(3);
    s.features = [];
    expect(merge(s, never)).toBeNull();
    s.totalPurchased = 6;
    expect(checkFeatures(s)).toContain('merge');
    expect(checkFeatures(s)).toEqual([]); // idempotent: the unlock event is sent once
  });
  test('three of a tier become one of the next tier; two or fewer do nothing', () => {
    expect(merge(lounge(2), never)).toBeNull();
    const s = lounge(4);
    const r = merge(s, never)!;
    expect(r.slime.tier).toBe(2);
    expect(r.materials).toHaveLength(3);
    expect(s.slimes).toHaveLength(2); // 4 - 3 + 1
    expect(s.totalMerged).toBe(1);
  });
  test('merges the lowest tier first and takes lounge slimes before working ones', () => {
    const s = lounge(3, 2);
    s.slimes.push({ id: 'w1', station: 'farm', tier: 1, trait: null }, { id: 'w2', station: 'farm', tier: 1, trait: null }, { id: 'l1', station: null, tier: 1, trait: null }, { id: 'w3', station: 'mill', tier: 1, trait: null });
    expect(merge(s, never)!.materials).toEqual(['l1', 'w1', 'w2']);
  });
  test('output: 3 -> 1 loses about 17% but frees two slots (why merging is a decision)', () => {
    expect(slimePower({ id: 'x', station: 'farm', tier: 2, trait: null }, 'farm') / 3).toBeCloseTo(2.5 / 3, 5);
  });
  test('mutation chance is 5%, doubled by a lucky ingredient, and is logged', () => {
    expect(merge(lounge(3), never)!.chance).toBe(0.05);
    expect(merge(lounge(3, 1, 'lucky'), never)!.chance).toBe(0.1);
  });
  test('mutation is the seeded roll: a rare roll adds a trait, a high roll does not', () => {
    const hit = merge(lounge(3), () => 0.01)!;
    expect(hit.mutated).toBe(true);
    expect(hit.slime.trait).not.toBeNull();
    expect(merge(lounge(3), never)!.slime.trait).toBeNull();
    // same seed, same mutation outcomes
    const run = (seed: number) => { const r = rng(seed); return Array.from({ length: 50 }, () => merge(lounge(3), r)!.mutated); };
    expect(run(7)).toEqual(run(7));
  });
  test('about 5% of merges mutate over many seeded rolls', () => {
    const r = rng(3);
    const hits = Array.from({ length: 4000 }, () => merge(lounge(3), r)!.mutated).filter(Boolean).length;
    expect(hits / 4000).toBeGreaterThan(0.04);
    expect(hits / 4000).toBeLessThan(0.06);
  });
  test('a trait is inherited from an ingredient that has one, even with no mutation roll', () => {
    const s = lounge(2);
    s.slimes.push({ id: 'g', station: null, tier: 1, trait: 'leaf' });
    expect(merge(s, never)!.slime.trait).toBe('leaf');
  });
  test('price counts lifetime purchases, so merging cannot be used to buy cheaper (anti-exploit)', () => {
    const s = newState();
    s.coins = 1e6;
    for (let i = 0; i < 6; i++) buySlime(s);
    const before = slimeCost(s);
    s.features.push('merge');
    for (const x of s.slimes) x.station = null;
    merge(s, never);
    expect(slimeCost(s)).toBe(before);
  });
});

describe('M3: traits and slots', () => {
  test('a trait helps at its station and hurts elsewhere (placement matters)', () => {
    const leaf = { id: 'a', station: null, tier: 1, trait: 'leaf' as const };
    expect(slimePower(leaf, 'farm')).toBe(1.5);
    expect(slimePower(leaf, 'bakery')).toBe(0.8);
    expect(slimePower(leaf, 'mill')).toBe(1);
  });
  test('a leaf slime makes the farm faster than a plain one', () => {
    const plain = newState({ farm: 1, mill: 0, bakery: 0 }), leaf = newState({ farm: 1, mill: 0, bakery: 0 });
    leaf.slimes[0].trait = 'leaf';
    run(plain, 10); run(leaf, 10);
    expect(leaf.stations.farm.produced).toBeGreaterThan(plain.stations.farm.produced);
  });
  test('a full station refuses another slime until it is expanded', () => {
    const s = newState({ farm: START_SLOTS, mill: 0, bakery: 0 });
    s.slimes.push({ id: 'extra', station: null, tier: 1, trait: null });
    expect(assignOne(s, 'farm')).toBeNull();
    s.coins = 1000;
    const e = expand(s, 'farm')!;
    expect(e.slots).toBe(START_SLOTS + 5);
    expect(assignOne(s, 'farm')).not.toBeNull();
  });
  test('expansion gets more expensive each time and needs the coins', () => {
    const s = newState();
    const first = expandCost(s, 'mill');
    s.coins = 0;
    expect(expand(s, 'mill')).toBeNull();
    s.coins = 1e6;
    expand(s, 'mill');
    expect(expandCost(s, 'mill')).toBeGreaterThan(first);
  });
});

describe('M3: old saves', () => {
  test('a save from before M3 loads with tier 1, no trait, 10 slots, no features (players keep their progress)', () => {
    const old = JSON.parse(JSON.stringify(newState())) as any;
    delete old.features; delete old.totalMerged;
    for (const x of old.slimes) { delete x.tier; delete x.trait; }
    for (const id of STATIONS) delete old.stations[id].slots;
    migrate(old);
    expect(old.slimes.every((x: any) => x.tier === 1 && x.trait === null)).toBe(true);
    expect(STATIONS.every((id) => old.stations[id].slots === START_SLOTS)).toBe(true);
    expect(old.features).toEqual([]);
  });
});
