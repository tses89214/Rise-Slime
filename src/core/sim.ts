// Pure game core: no clock, no Math.random. Time is passed in via step(dt).
export type StationId = 'farm' | 'mill' | 'bakery';

const RECIPE = {
  farm: { seconds: 1, input: 0 },
  mill: { seconds: 3, input: 2 },
  bakery: { seconds: 5, input: 2 },
} as const;
const ORDER: StationId[] = ['farm', 'mill', 'bakery'];
const BREAD_PRICE = 10;

export interface Station {
  slimes: number;
  level: number;
  progress: number; // fractional cycles carried between steps
  stock: number; // input stock waiting to be processed
}
export interface State {
  coins: number;
  bread: number;
  stations: Record<StationId, Station>;
}

export function newState(assign: Record<StationId, number> = { farm: 1, mill: 1, bakery: 1 }): State {
  const st = (n: number): Station => ({ slimes: n, level: 0, progress: 0, stock: 0 });
  return { coins: 20, bread: 0, stations: { farm: st(assign.farm), mill: st(assign.mill), bakery: st(assign.bakery) } };
}

// ponytail: fixed small dt, cycles resolved in order farm->mill->bakery; no sub-step ordering inside dt.
export function step(s: State, dt: number): void {
  let output = 0;
  for (const id of ORDER) {
    const st = s.stations[id];
    const r = RECIPE[id];
    st.progress += (st.slimes * (1 + 0.1 * st.level) * dt) / r.seconds;
    const whole = Math.floor(st.progress);
    const cycles = r.input ? Math.min(whole, Math.floor(st.stock / r.input)) : whole;
    st.progress -= whole; // starved slimes don't bank work
    st.stock -= cycles * r.input;
    output = cycles;
    const next = ORDER[ORDER.indexOf(id) + 1];
    if (next) s.stations[next].stock += output;
    else {
      s.bread += output;
      s.coins += output * BREAD_PRICE;
    }
  }
}
