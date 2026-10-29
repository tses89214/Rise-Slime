export const $ = (id: string) => document.getElementById(id)!;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rnd = (a: number, b: number) => a + Math.random() * (b - a); // UI-only randomness; the core stays seeded
export const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
