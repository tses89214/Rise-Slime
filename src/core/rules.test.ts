import { describe, expect, test } from 'vitest';
import { applyOffline, assignOne, buySlime, count, newState, OFFLINE_CAP_SECONDS, rng, slimeCost, speedMultiplier, step, takeWindow, upgrade, upgradeCost } from './sim';

describe('costs', () => {
  test('slime cost is 20 * 1.15^purchased, based on cumulative purchases', () => {
    const s = newState();
    expect(slimeCost(s)).toBe(20);
    s.coins = 1000;
    buySlime(s);
    expect(slimeCost(s)).toBe(23);
    s.totalPurchased = 10;
    expect(slimeCost(s)).toBe(Math.round(20 * 1.15 ** 10));
  });
  test('upgrade cost grows 12% per level, per station', () => {
    const s = newState();
    s.coins = 1000;
    expect(upgradeCost(s, 'farm')).toBe(50);
    upgrade(s, 'farm');
    expect(upgradeCost(s, 'farm')).toBe(56);
    expect(upgradeCost(s, 'mill')).toBe(50);
  });
  test('milestones double speed at levels 10, 25, 50', () => {
    expect(speedMultiplier(9)).toBeCloseTo(1.9);
    expect(speedMultiplier(10)).toBeCloseTo(4);
    expect(speedMultiplier(25)).toBeCloseTo(3.5 * 4);
    expect(speedMultiplier(50)).toBeCloseTo(6 * 8);
  });
});

describe('actions', () => {
  test('cannot buy or upgrade without enough coins; coins unchanged', () => {
    const s = newState();
    s.coins = 10;
    expect(buySlime(s)).toBeNull();
    expect(upgrade(s, 'mill')).toBeNull();
    expect(s.coins).toBe(10);
  });
  test('bought slime waits in lounge until assigned; assign and unassign round-trip', () => {
    const s = newState();
    buySlime(s);
    expect(count(s, null)).toBe(1);
    const r = assignOne(s, 'mill')!;
    expect([r.from, r.to]).toEqual([null, 'mill']);
    expect(count(s, 'mill')).toBe(2);
    const back = assignOne(s, null, 'mill')!;
    expect([back.from, back.to]).toEqual(['mill', null]);
    expect(count(s, null)).toBe(1);
  });
  test('assign with empty lounge / empty station does nothing', () => {
    const s = newState();
    expect(assignOne(s, 'farm')).toBeNull();
    expect(assignOne(s, null, 'farm')).not.toBeNull();
    expect(assignOne(s, null, 'farm')).toBeNull();
  });
});

describe('simulation', () => {
  test('starved station banks no work: no stock, no output', () => {
    const s = newState({ farm: 0, mill: 5, bakery: 5 });
    for (let i = 0; i < 600; i++) step(s, 0.1);
    expect(s.bread).toBe(0);
    s.stations.mill.stock = 2; // one cycle available; must not release a backlog of banked work
    step(s, 0.1);
    expect(s.stations.mill.produced).toBeLessThanOrEqual(1);
  });
  test('takeWindow reports and resets counters but keeps stock', () => {
    const s = newState({ farm: 4, mill: 1, bakery: 5 });
    for (let i = 0; i < 300; i++) step(s, 0.1);
    const w = takeWindow(s);
    expect(w.stations.find((x) => x.station === 'farm')!.produced).toBeGreaterThan(100);
    expect(w.stations.find((x) => x.station === 'mill')!.input_stock).toBeGreaterThan(0);
    const w2 = takeWindow(s);
    expect(w2.stations.every((x) => x.produced === 0 && x.consumed === 0)).toBe(true);
    expect(w2.stations.find((x) => x.station === 'mill')!.input_stock).toBe(w.stations.find((x) => x.station === 'mill')!.input_stock);
  });
  test('offline progress is capped at 8 hours', () => {
    const s = newState({ farm: 4, mill: 6, bakery: 5 });
    const r = applyOffline(s, 24 * 3600);
    expect(r.creditedSeconds).toBe(OFFLINE_CAP_SECONDS);
    expect(r.coinsEarned).toBeGreaterThan(OFFLINE_CAP_SECONDS * 8);
    expect(r.coinsEarned).toBeLessThanOrEqual(OFFLINE_CAP_SECONDS * 10.5);
  });
  test('upgrades speed a station up', () => {
    const a = newState({ farm: 5, mill: 1, bakery: 1 });
    const b = newState({ farm: 5, mill: 1, bakery: 1 });
    b.coins = 500;
    upgrade(b, 'farm');
    for (let i = 0; i < 100; i++) { step(a, 0.1); step(b, 0.1); }
    expect(b.stations.farm.produced).toBeGreaterThan(a.stations.farm.produced);
  });
});

test('rng: same seed same sequence, values in [0,1)', () => {
  const a = rng(42), b = rng(42), c = rng(43);
  const xs = Array.from({ length: 5 }, a);
  expect(xs).toEqual(Array.from({ length: 5 }, b));
  expect(xs).not.toEqual(Array.from({ length: 5 }, c));
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
});
