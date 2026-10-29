import { expect, test } from 'vitest';
import { newState, step } from './sim';

const run = (s: ReturnType<typeof newState>, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) step(s, 0.1);
};

test('optimal 4:6:5 yields ~1 bread/s and ~10 coins/s', () => {
  const s = newState({ farm: 4, mill: 6, bakery: 5 });
  run(s, 200);
  const rate = (s.coins - 20) / 200;
  expect(rate).toBeGreaterThan(9);
  expect(rate).toBeLessThanOrEqual(10.1);
});

test('uneven split piles stock at the bottleneck', () => {
  const s = newState({ farm: 4, mill: 1, bakery: 5 });
  run(s, 60);
  expect(s.stations.mill.stock).toBeGreaterThan(20);
});
