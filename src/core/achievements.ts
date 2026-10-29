import { count, STATIONS, type State } from './sim';

export interface Achievement { id: string; name: string; desc: string; test: (s: State) => boolean }

const maxLevel = (s: State) => Math.max(...STATIONS.map((i) => s.stations[i].level));
const split = (s: State) => STATIONS.map((i) => count(s, i)).join(':');

// Pure conditions on State; `bread` is lifetime bread sold, `totalPurchased` lifetime slimes bought.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_bread', name: 'First Batch', desc: 'Sell your first bread', test: (s) => s.bread >= 1 },
  { id: 'bread_100', name: 'Baker', desc: 'Sell 100 bread', test: (s) => s.bread >= 100 },
  { id: 'bread_1000', name: 'Bread Baron', desc: 'Sell 1,000 bread', test: (s) => s.bread >= 1000 },
  { id: 'first_slime', name: 'New Friend', desc: 'Buy your first slime', test: (s) => s.totalPurchased >= 1 },
  { id: 'slimes_10', name: 'Slime Pit', desc: 'Buy 10 slimes', test: (s) => s.totalPurchased >= 10 },
  { id: 'slimes_25', name: 'Slime Army', desc: 'Buy 25 slimes', test: (s) => s.totalPurchased >= 25 },
  { id: 'first_upgrade', name: 'Better Tools', desc: 'Upgrade a station', test: (s) => maxLevel(s) >= 1 },
  { id: 'level_10', name: 'Double Speed', desc: 'Reach level 10 on a station (x2 milestone)', test: (s) => maxLevel(s) >= 10 },
  { id: 'backed_up', name: 'Traffic Jam', desc: 'Let a queue back up to 50', test: (s) => s.stations.mill.stock >= 50 || s.stations.bakery.stock >= 50 },
  { id: 'crowded', name: 'Crowded Room', desc: 'Have 10 slimes on one station', test: (s) => STATIONS.some((i) => count(s, i) >= 10) },
  { id: 'perfect_split', name: 'Perfect Split', desc: 'Run the 4 : 6 : 5 assignment', test: (s) => split(s) === '4:6:5' },
  { id: 'coins_1000', name: 'Thousandaire', desc: 'Hold 1,000 coins at once', test: (s) => s.coins >= 1000 },
];

// Unlocks everything newly satisfied, records it on the state, returns the new ones. Idempotent.
export function checkAchievements(s: State): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !s.achievements.includes(a.id) && a.test(s));
  for (const a of fresh) s.achievements.push(a.id);
  return fresh;
}
