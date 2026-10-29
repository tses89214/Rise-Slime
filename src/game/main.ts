import { applyOffline, assignOne, buySlime, count, newState, slimeCost, STATIONS, speedMultiplier, step, takeWindow, upgrade, upgradeCost, type State, type StationId } from '../core/sim';
import { makeEmitter } from '../events/emitter';

const SAVE_KEY = 'rise-slime-save';
const NAME: Record<StationId, string> = { farm: 'Farm', mill: 'Mill', bakery: 'Bakery' };
const SECONDS = { farm: 1, mill: 3, bakery: 5 };
const $ = (id: string) => document.getElementById(id)!;

// --- telemetry: compiled out entirely when VITE_TELEMETRY !== 'true' (itch.io build) ---
let emit: ReturnType<typeof makeEmitter> | null = null;
if (import.meta.env.VITE_TELEMETRY === 'true') {
  const url = import.meta.env.VITE_COLLECTOR_URL ?? 'http://localhost:3000/events';
  const pid = localStorage.getItem('rise-slime-pid') ?? `player-${crypto.randomUUID().slice(0, 8)}`;
  localStorage.setItem('rise-slime-pid', pid);
  emit = makeEmitter(
    { game_version: '0.1.0', player_id: pid, session_id: `s-${crypto.randomUUID().slice(0, 4)}`, client: 'browser', bot_persona: null },
    (e) => void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e), keepalive: true }).catch(() => {}),
  );
}

// --- audio: browsers block autoplay, so music starts on first click ---
const sfx = (f: string) => { if (muted.sfx) return; const a = new Audio(`/assets/audio/sfx/${f}`); a.volume = 0.4; void a.play().catch(() => {}); };
const muted = { music: localStorage.getItem('rise-slime-music') !== 'on', sfx: false };
const tracks = ['8-bit-concentration-loop.mp3', 'sometimes.ogg', 'cunning-plan.ogg'].map((f) => `/assets/audio/music/${f}`);
let track = 0;
const music = new Audio(tracks[0]);
music.volume = 0.25;
music.onended = () => { music.src = tracks[++track % tracks.length]; void music.play(); }; // rotate so one loop doesn't wear out
const syncMusic = () => {
  $('mute').textContent = `Music: ${muted.music ? 'off' : 'on'}`;
  try { localStorage.setItem('rise-slime-music', muted.music ? 'off' : 'on'); } catch { /* ignore */ }
  if (muted.music) music.pause(); else void music.play().catch(() => {});
};
$('mute').onclick = () => { muted.music = !muted.music; syncMusic(); };
addEventListener('click', () => { if (!muted.music && music.paused) void music.play().catch(() => {}); }, { once: true });

// --- state ---
interface Save { state: State; savedAt: number }
let s: State = newState();
let isNew = true;
let offlineSeconds: number | null = null;
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    const save: Save = JSON.parse(raw);
    s = save.state;
    isNew = false;
    offlineSeconds = (Date.now() - save.savedAt) / 1000;
  }
} catch { /* corrupt save: start fresh */ }

const t0 = Date.now();
emit?.('session_start', t0, { offline_seconds: offlineSeconds, is_new_player: isNew });
if (offlineSeconds && offlineSeconds > 5) {
  const r = applyOffline(s, offlineSeconds);
  emit?.('offline_progress_applied', t0, { offline_seconds: r.offlineSeconds, credited_seconds: r.creditedSeconds, produced: r.produced, bread_sold: r.breadSold, coins_earned: r.coinsEarned });
}

const fmt = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.floor(n)));
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state: s, savedAt: Date.now() } satisfies Save)); } catch { /* storage unavailable */ } };

// --- UI ---
$('cards').innerHTML = STATIONS.map((id) => `
  <div class="card"><h2>${NAME[id]}</h2>
    <div>Slimes <b id="${id}-n"></b> · <span id="${id}-rate"></span>/sec</div>
    <div>Lv <b id="${id}-lv"></b> · Queue <b id="${id}-q"></b></div>
    <div class="bar" id="${id}-bar"><i></i></div>
    <div class="row"><button data-minus="${id}">−</button><button data-plus="${id}">+</button><button data-up="${id}"></button></div>
  </div>`).join('');

$('buy').onclick = () => {
  const cost = slimeCost(s);
  const slime = buySlime(s);
  if (slime) sfx('coin1.wav');
  if (slime) emit?.('slime_purchased', Date.now(), { slime_id: slime.id, cost, total_purchased: s.totalPurchased, coins_after: s.coins });
  render();
};
document.querySelectorAll<HTMLButtonElement>('[data-plus],[data-minus],[data-up]').forEach((b) => {
  b.onclick = () => {
    const d = b.dataset;
    if (d.up) {
      const id = d.up as StationId, cost = upgradeCost(s, id), u = upgrade(s, id);
      if (u) sfx('confirmation_002.ogg');
      if (u) emit?.('station_upgraded', Date.now(), { station: id, new_level: u.level, cost, speed_multiplier: u.speedMultiplier, milestone_reached: u.milestone, coins_after: s.coins });
    } else {
      const r = d.plus ? assignOne(s, d.plus as StationId) : assignOne(s, null, d.minus as StationId);
      if (r) sfx('mud_01.ogg');
      if (r) emit?.('slime_assigned', Date.now(), { slime_id: r.slime.id, from_station: r.from, to_station: r.to });
    }
    render();
  };
});

syncMusic();
let lastScene = '';
let rate = 0, lastCoins = s.bread * 10, lastRateAt = performance.now();
function render() {
  $('coins').textContent = fmt(s.coins);
  $('income').textContent = rate.toFixed(1);
  $('lounge').textContent = String(count(s, null));
  ($('buy') as HTMLButtonElement).textContent = `Buy Slime (${fmt(slimeCost(s))})`;
  ($('buy') as HTMLButtonElement).disabled = s.coins < slimeCost(s);
  for (const id of STATIONS) {
    const n = count(s, id), st = s.stations[id];
    $(`${id}-n`).textContent = String(n);
    $(`${id}-rate`).textContent = ((n * speedMultiplier(st.level)) / SECONDS[id]).toFixed(1);
    $(`${id}-lv`).textContent = String(st.level);
    $(`${id}-q`).textContent = id === 'farm' ? '–' : String(Math.floor(st.stock));
    $(`${id}-bar`).classList.toggle('warn', st.stock > 20);
    ($(`${id}-bar`).firstElementChild as HTMLElement).style.width = `${Math.min(100, st.stock * 2)}%`;
    const up = document.querySelector<HTMLButtonElement>(`[data-up="${id}"]`)!;
    up.textContent = `Upgrade (${fmt(upgradeCost(s, id))})`;
    up.disabled = s.coins < upgradeCost(s, id);
    (document.querySelector(`[data-plus="${id}"]`) as HTMLButtonElement).disabled = count(s, null) === 0;
    (document.querySelector(`[data-minus="${id}"]`) as HTMLButtonElement).disabled = n === 0;
  }
  const zone = (label: string, id: StationId) => {
    const asleep = id !== 'farm' && s.stations[id].stock < (id === 'mill' ? 2 : 2);
    return `<div class="zone"><small>${label}</small>${Array.from({ length: Math.min(8, count(s, id)) }, () => `<span class="slime${asleep ? ' asleep' : ''}"></span>`).join('')}${count(s, id) > 8 ? ` +${count(s, id) - 8}` : ''}${asleep && count(s, id) ? '<small class="zzz">Zzz</small>' : ''}</div>`;
  };
  const html = zone('Farm', 'farm') + zone('Mill', 'mill') + zone('Bakery', 'bakery') + `<div class="zone shop"><small>Shop</small><img class="icon" src="/assets/food/bread_loaf_brown.png" alt=""> <b id="bread"></b>${[1, 3, 5].map((n, i) => `<img class="customer" style="animation-delay:-${i * 3}s" src="/assets/creatures/tile_000${n}.png" alt="">`).join('')}</div>`;
  if (html !== lastScene) { lastScene = html; $('scene').innerHTML = html; }
  $('bread').textContent = fmt(s.bread); // only touch the DOM on change, or animations restart
}

// --- loop: fixed 0.1s steps, 5s production_tick, autosave ---
let last = performance.now(), acc = 0, tickAcc = 0, windowStart = Date.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min((now - last) / 1000, 1); // tab throttling: later gaps are covered by offline logic on reload
  last = now;
  while (acc >= 0.1) { step(s, 0.1); acc -= 0.1; tickAcc += 0.1; }
  if (tickAcc >= 5) {
    tickAcc = 0;
    emit?.('production_tick', Date.now(), { window_start: new Date(windowStart).toISOString(), window_end: new Date().toISOString(), ...takeWindow(s) });
    windowStart = Date.now();
    save();
  }
  if (now - lastRateAt >= 1000) { rate = (s.bread * 10 - lastCoins) / ((now - lastRateAt) / 1000); lastCoins = s.bread * 10; lastRateAt = now; }
  render();
}, 100);
addEventListener('pagehide', () => { emit?.('session_end', Date.now(), { session_seconds: (Date.now() - t0) / 1000, reason: 'closed' }); save(); });
