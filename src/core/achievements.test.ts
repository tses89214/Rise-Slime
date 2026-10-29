import { describe, expect, test } from 'vitest';
import { ACHIEVEMENTS, checkAchievements } from './achievements';
import { buySlime, newState, step, upgrade } from './sim';

const get = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

describe('catalogue', () => {
  test('ids are unique, snake_case, with a name and description', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z0-9_]+$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });
  test('a fresh game unlocks nothing', () => {
    const s = newState();
    expect(checkAchievements(s)).toEqual([]);
    expect(s.achievements).toEqual([]);
  });
});

describe('conditions', () => {
  test('first_bread / bread_100 / bread_1000 follow lifetime bread sold', () => {
    const s = newState();
    for (const [bread, ids] of [[1, ['first_bread']], [99, ['first_bread']], [100, ['first_bread', 'bread_100']], [1000, ['first_bread', 'bread_100', 'bread_1000']]] as const) {
      s.bread = bread;
      expect(ACHIEVEMENTS.filter((a) => a.id.startsWith('bread') || a.id === 'first_bread').filter((a) => a.test(s)).map((a) => a.id)).toEqual(ids);
    }
  });
  test('slime purchase tiers use lifetime purchases (1, 10, 25)', () => {
    const s = newState();
    s.coins = 1e9;
    buySlime(s);
    expect(get('first_slime').test(s)).toBe(true);
    expect(get('slimes_10').test(s)).toBe(false);
    s.totalPurchased = 10;
    expect(get('slimes_10').test(s)).toBe(true);
    expect(get('slimes_25').test(s)).toBe(false);
    s.totalPurchased = 25;
    expect(get('slimes_25').test(s)).toBe(true);
  });
  test('upgrade achievements: any station level 1 and level 10', () => {
    const s = newState();
    s.coins = 1e9;
    upgrade(s, 'bakery');
    expect(get('first_upgrade').test(s)).toBe(true);
    expect(get('level_10').test(s)).toBe(false);
    s.stations.farm.level = 10;
    expect(get('level_10').test(s)).toBe(true);
  });
  test('backed_up when mill or bakery queue reaches 50 (farm has no queue)', () => {
    const s = newState();
    s.stations.mill.stock = 49;
    expect(get('backed_up').test(s)).toBe(false);
    s.stations.mill.stock = 50;
    expect(get('backed_up').test(s)).toBe(true);
    s.stations.mill.stock = 0;
    s.stations.bakery.stock = 50;
    expect(get('backed_up').test(s)).toBe(true);
  });
  test('crowded needs 10 slimes on a single station', () => {
    expect(get('crowded').test(newState({ farm: 9, mill: 9, bakery: 9 }))).toBe(false);
    expect(get('crowded').test(newState({ farm: 1, mill: 10, bakery: 1 }))).toBe(true);
  });
  test('perfect_split only for exactly 4:6:5', () => {
    expect(get('perfect_split').test(newState({ farm: 4, mill: 6, bakery: 5 }))).toBe(true);
    expect(get('perfect_split').test(newState({ farm: 5, mill: 6, bakery: 4 }))).toBe(false);
    expect(get('perfect_split').test(newState({ farm: 8, mill: 12, bakery: 10 }))).toBe(false);
  });
  test('coins_1000 checks the current balance', () => {
    const s = newState();
    s.coins = 999;
    expect(get('coins_1000').test(s)).toBe(false);
    s.coins = 1000;
    expect(get('coins_1000').test(s)).toBe(true);
  });
});

describe('checkAchievements', () => {
  test('returns only newly unlocked ones, records them in order, and is idempotent', () => {
    const s = newState();
    s.bread = 1; s.totalPurchased = 1;
    const first = checkAchievements(s).map((a) => a.id);
    expect(first).toEqual(['first_bread', 'first_slime']);
    expect(s.achievements).toEqual(first);
    expect(checkAchievements(s)).toEqual([]);
    expect(s.achievements).toHaveLength(2);
    s.bread = 100;
    expect(checkAchievements(s).map((a) => a.id)).toEqual(['bread_100']);
    expect(s.achievements).toEqual(['first_bread', 'first_slime', 'bread_100']);
  });
  test('unlocks survive the condition going false again (e.g. coins spent)', () => {
    const s = newState();
    s.coins = 5000;
    checkAchievements(s);
    s.coins = 0;
    expect(checkAchievements(s)).toEqual([]);
    expect(s.achievements).toContain('coins_1000');
  });
  test('works through a real simulation: optimal split earns bread and the split achievement', () => {
    const s = newState({ farm: 4, mill: 6, bakery: 5 });
    for (let i = 0; i < 600; i++) step(s, 0.1);
    const ids = checkAchievements(s).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['first_bread', 'perfect_split']));
  });
  test('state from an old save (no achievements field) can be repaired like the game does', () => {
    const old = JSON.parse(JSON.stringify(newState()));
    delete old.achievements;
    old.achievements ??= [];
    old.bread = 1;
    expect(checkAchievements(old).map((a) => a.id)).toEqual(['first_bread']);
  });
});
