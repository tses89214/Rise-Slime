import { count, QUEUE, STATIONS, speedMultiplier, type State, type StationId } from './sim';

export interface Achievement { id: string; name: string; desc: string; test: (s: State) => boolean }

const levels = (s: State) => STATIONS.map((i) => s.stations[i].level);
const crew = (s: State) => STATIONS.map((i) => count(s, i));
const queue = (s: State) => Math.max(s.stations.mill.stock, s.stations.bakery.stock); // the farm has no input queue
const sold = (n: number, id: string, name: string): Achievement => ({ id, name, desc: `Sell ${n.toLocaleString('en')} bread in total`, test: (s) => s.bread >= n });
const bought = (n: number, id: string, name: string): Achievement => ({ id, name, desc: `Buy ${n} slimes in total`, test: (s) => s.totalPurchased >= n });
const held = (n: number, id: string, name: string): Achievement => ({ id, name, desc: `Hold ${n.toLocaleString('en')} coins at once`, test: (s) => s.coins >= n });

// Pure conditions on State: `bread` is lifetime bread sold, `totalPurchased` lifetime slimes bought.
export const ACHIEVEMENTS: Achievement[] = [
  sold(1, 'first_bread', 'First Batch'), sold(10, 'bread_10', 'Warming Up'), sold(100, 'bread_100', 'Baker'),
  sold(500, 'bread_500', 'Local Favourite'), sold(1000, 'bread_1000', 'Bread Baron'), sold(5000, 'bread_5000', 'Bread Tycoon'),
  bought(1, 'first_slime', 'New Friend'), bought(10, 'slimes_10', 'Slime Pit'), bought(25, 'slimes_25', 'Slime Army'),
  bought(50, 'slimes_50', 'Slime Metropolis'), bought(100, 'slimes_100', 'Slime Nation'),
  { id: 'pop_20', name: 'Full House', desc: 'Own 20 slimes at the same time', test: (s) => s.slimes.length >= 20 },
  { id: 'lounge_party', name: 'Lounge Party', desc: 'Have 5 slimes waiting in the Lounge', test: (s) => count(s, null) >= 5 },
  { id: 'crowded', name: 'Crowded Room', desc: 'Put 10 slimes on a single station', test: (s) => crew(s).some((n) => n >= 10) },
  { id: 'day_off', name: 'Day Off', desc: 'Send every slime home from one station (0 left there)', test: (s) => s.slimes.length > 0 && crew(s).includes(0) },
  { id: 'even_steven', name: 'Even Steven', desc: 'Put the same number of slimes (at least 3) on all three stations', test: (s) => crew(s)[0] >= 3 && new Set(crew(s)).size === 1 },
  { id: 'perfect_split', name: 'Perfect Split', desc: 'Have exactly 4 slimes on Farm, 6 on Mill and 5 on Bakery', test: (s) => crew(s).join(':') === '4:6:5' },
  { id: 'first_upgrade', name: 'Better Tools', desc: 'Upgrade any station once', test: (s) => Math.max(...levels(s)) >= 1 },
  { id: 'well_equipped', name: 'Well Equipped', desc: 'Upgrade all three stations at least once', test: (s) => Math.min(...levels(s)) >= 1 },
  { id: 'level_10', name: 'Double Speed', desc: 'Get a station to level 10 (speed x2 bonus)', test: (s) => Math.max(...levels(s)) >= 10 },
  { id: 'level_25', name: 'Quadruple Speed', desc: 'Get a station to level 25 (another x2)', test: (s) => Math.max(...levels(s)) >= 25 },
  { id: 'level_50', name: 'Master Craftsman', desc: 'Get a station to level 50 (another x2)', test: (s) => Math.max(...levels(s)) >= 50 },
  { id: 'all_level_10', name: 'Fully Upgraded', desc: 'Get all three stations to level 10', test: (s) => Math.min(...levels(s)) >= 10 },
  { id: 'turbo', name: 'Turbo', desc: 'Run any station at 5x speed or more (level 15)', test: (s) => STATIONS.some((i: StationId) => speedMultiplier(s.stations[i].level) >= 5) },
  { id: 'backed_up', name: 'Traffic Jam', desc: `Let the Mill or Bakery queue back up to ${QUEUE.backed}`, test: (s) => queue(s) >= QUEUE.backed },
  { id: 'gridlock', name: 'Gridlock', desc: `Let the Mill or Bakery queue jam at ${QUEUE.jam}`, test: (s) => queue(s) >= QUEUE.jam },
  held(1000, 'coins_1000', 'Thousandaire'), held(10000, 'coins_10000', 'Ten Grand'), held(100000, 'coins_100000', 'Fat Cat'),
];

// Unlocks everything newly satisfied, records it on the state, returns the new ones. Idempotent.
export function checkAchievements(s: State): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !s.achievements.includes(a.id) && a.test(s));
  for (const a of fresh) s.achievements.push(a.id);
  return fresh;
}
