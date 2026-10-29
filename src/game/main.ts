import { type Slime, applyOffline, assignOne, buySlime, count, newState, slimeCost, STATIONS, speedMultiplier, step, takeWindow, upgrade, upgradeCost, type State, type StationId } from '../core/sim';
import { makeEmitter } from '../events/emitter';

const SAVE_KEY = 'rise-slime-save';
const NAME: Record<StationId, string> = { farm: 'FARM', mill: 'MILL', bakery: 'BAKERY' };
const OUT: Record<StationId, string> = { farm: 'wheat', mill: 'flour', bakery: 'bread' };
const IN: Record<StationId, string> = { farm: '', mill: 'wheat', bakery: 'flour' };
const SECONDS = { farm: 1, mill: 3, bakery: 5 };
const MAX_DRAWN = 8; // per zone; the rest shows as "+N"
const $ = (id: string) => document.getElementById(id)!;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// --- telemetry: compiled out entirely when VITE_TELEMETRY !== 'true' (itch.io build) ---
let emit: ReturnType<typeof makeEmitter> | null = null;
if (import.meta.env.VITE_TELEMETRY === 'true') {
  const url = import.meta.env.VITE_COLLECTOR_URL ?? 'http://localhost:3000/events';
  const pid = store.get('rise-slime-pid') ?? `player-${crypto.randomUUID().slice(0, 8)}`;
  store.set('rise-slime-pid', pid);
  emit = makeEmitter(
    { game_version: '0.1.0', player_id: pid, session_id: `s-${crypto.randomUUID().slice(0, 4)}`, client: 'browser', bot_persona: null },
    (e) => void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e), keepalive: true }).catch(() => {}),
  );
}

// --- audio: browsers block autoplay, so music starts on first click; music and sfx toggles are remembered ---
const on = { music: store.get('rise-slime-music') === 'on', sfx: store.get('rise-slime-sfx') !== 'off' };
const sfx = (f: string) => { if (!on.sfx) return; const a = new Audio(`/audio/sfx/${f}`); a.volume = 0.4; void a.play().catch(() => {}); };
const tracks = ['8-bit-concentration-loop.mp3', 'sometimes.ogg', 'cunning-plan.ogg'].map((f) => `/audio/music/${f}`);
let track = 0;
const music = new Audio(tracks[0]);
music.volume = 0.25;
music.onended = () => { music.src = tracks[++track % tracks.length]; void music.play().catch(() => {}); };
const syncAudio = () => {
  $('music').textContent = `Music: ${on.music ? 'on' : 'off'}`;
  $('sfx').textContent = `SFX: ${on.sfx ? 'on' : 'off'}`;
  store.set('rise-slime-music', on.music ? 'on' : 'off');
  store.set('rise-slime-sfx', on.sfx ? 'on' : 'off');
  if (on.music) void music.play().catch(() => {}); else music.pause();
};
$('music').onclick = () => { on.music = !on.music; syncAudio(); };
$('sfx').onclick = () => { on.sfx = !on.sfx; syncAudio(); };
$('settings').onclick = () => ($('credits') as HTMLDialogElement).showModal();
addEventListener('click', () => { if (on.music && music.paused) void music.play().catch(() => {}); }, { once: true });
document.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) sfx('click_001.ogg'); });

// --- state ---
interface Save { state: State; savedAt: number }
let s: State = newState();
let isNew = true;
let offlineSeconds: number | null = null;
try {
  const raw = store.get(SAVE_KEY);
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
const save = () => store.set(SAVE_KEY, JSON.stringify({ state: s, savedAt: Date.now() } satisfies Save));
const item = (i: number, extra = '') => `<span class="item sprite ${extra}" style="background-position:${-i * 32}px 0"></span>`; // wheat 0, flour 1, bread 2, coin 3, zzz 4

// --- scene: built once; later renders only touch what changed, so CSS animations keep running ---
const zone = (id: StationId, props: string, extra = '') =>
  `<div class="zone"><div class="label">${NAME[id]}</div><div class="props">${props}</div>${extra}<div class="actors" id="actors-${id}"></div></div>`;
$('scene').innerHTML =
  '<div class="ground"></div>' +
  '<div class="cloud" style="top:18px"></div><div class="cloud" style="top:56px;animation-delay:-30s"></div>' +
  zone('farm', Array.from({ length: 5 }, (_, i) => item(0, 'wheat').replace('class="', `style="animation-delay:-${i * 0.25}s" class="`)).join('')) +
  zone('mill', '<div id="sacks" style="display:flex"></div><div class="prop sprite millstone" style="background-position:0 0"></div>') +
  zone('bakery', '<div class="prop sprite" id="oven"></div>') +
  `<div class="zone"><div class="label">SHOP</div><div class="shop-img sprite"></div>${[0, 1, 2].map((i) => `<div class="cust sprite" style="--row:${i};animation-delay:0s,-${i * 3}s"></div>`).join('')}<div id="shop-fx"></div></div>`;
for (const c of document.querySelectorAll<HTMLElement>('.cust')) {
  c.addEventListener('animationiteration', (e) => { if ((e as AnimationEvent).animationName === 'approach') c.style.setProperty('--row', String(Math.floor(Math.random() * 4))); }); // random colour per visit; UI-only randomness
}
// sky/grass tiles live in one sheet; slice them so CSS can repeat them
const tiles = new Image();
tiles.src = '/original/tiles.png';
void tiles.decode().then(() => {
  ['sky', 'grass-top', 'grass', 'fence'].forEach((name, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d')!.drawImage(tiles, i * 16, 0, 16, 16, 0, 0, 16, 16);
    $('scene').style.setProperty(`--${name}-tile`, `url(${c.toDataURL()})`);
  });
}).catch(() => {});

// --- cards ---
$('stations').innerHTML = STATIONS.map((id) => `
  <div class="card box" id="card-${id}">
    <div class="top"><h2>${NAME[id]}</h2><span><b class="num" id="${id}-n"></b> slimes · Lv <b class="num" id="${id}-lv"></b></span></div>
    <div id="${id}-rate"></div>
    <div class="row"><span id="${id}-ql"></span><b id="${id}-qn"></b></div>
    <div class="bar"><i id="${id}-bar"></i></div>
    <div class="btns">
      <button data-minus="${id}" aria-label="Move one slime back to the lounge">−</button>
      <button data-plus="${id}" aria-label="Assign one slime from the lounge">+</button>
      <button class="primary" data-up="${id}"></button>
    </div>
  </div>`).join('');

$('buy').onclick = () => {
  const cost = slimeCost(s), slime = buySlime(s);
  if (!slime) return;
  sfx('mud_01.ogg');
  emit?.('slime_purchased', Date.now(), { slime_id: slime.id, cost, total_purchased: s.totalPurchased, coins_after: s.coins });
  render();
};
document.querySelectorAll<HTMLButtonElement>('[data-plus],[data-minus],[data-up]').forEach((b) => {
  b.onclick = () => {
    const d = b.dataset;
    if (d.up) {
      const id = d.up as StationId, cost = upgradeCost(s, id), u = upgrade(s, id);
      if (u) { sfx('confirmation_002.ogg'); emit?.('station_upgraded', Date.now(), { station: id, new_level: u.level, cost, speed_multiplier: u.speedMultiplier, milestone_reached: u.milestone, coins_after: s.coins }); }
    } else {
      const r = d.plus ? assignOne(s, d.plus as StationId) : assignOne(s, null, d.minus as StationId);
      if (r) { sfx('mud_01.ogg'); emit?.('slime_assigned', Date.now(), { slime_id: r.slime.id, from_station: r.from, to_station: r.to }); }
    }
    render();
  };
});

// --- render ---
const keys = new Map<string, string>();
const setHtml = (id: string, key: string, html: string) => { if (keys.get(id) !== key) { keys.set(id, key); $(id).innerHTML = html; } };
const colourRow = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 5; // stable per slime
const slimeEl = (sl: Slime, anim: string, i: number, zzz = false) =>
  `<span class="${zzz ? 'sleeper' : ''}"><span class="slime sprite a-${anim}" style="--row:${colourRow(sl.id)};animation-delay:-${(i * 0.17).toFixed(2)}s"></span>${zzz ? `<span class="zzz">${item(4)}</span>` : ''}</span>`;
const crowd = (list: Slime[], anim: string, zzz = false) =>
  list.slice(0, MAX_DRAWN).map((sl, i) => slimeEl(sl, anim, i, zzz)).join('') + (list.length > MAX_DRAWN ? `<span class="more">+${list.length - MAX_DRAWN}</span>` : '');
const here = (where: StationId | null) => s.slimes.filter((x) => x.station === where);
const keyOf = (list: Slime[], anim: string) => `${anim}:${list.slice(0, MAX_DRAWN).map((x) => x.id).join()}:${list.length}`;

let rate = 0, lastEarned = s.bread * 10, lastRateAt = performance.now(), lastBread = s.bread, lastCoinSfx = 0;
function render() {
  $('coins').textContent = fmt(s.coins);
  $('income').textContent = `+${rate.toFixed(1)} / sec`;
  ($('buy') as HTMLButtonElement).disabled = s.coins < slimeCost(s);
  $('buy-cost').textContent = `${fmt(slimeCost(s))} coins`;
  const lounge = count(s, null);
  const waiting = here(null);
  setHtml('lounge-slimes', keyOf(waiting, 'idle'), crowd(waiting, 'idle'));

  for (const id of STATIONS) {
    const n = count(s, id), st = s.stations[id], stock = Math.floor(st.stock);
    const starved = id !== 'farm' && n > 0 && st.stock < 2;
    const backed = id !== 'farm' && st.stock > 20;
    $(`${id}-n`).textContent = String(n);
    $(`${id}-lv`).textContent = String(st.level);
    $(`${id}-rate`).textContent = `${((n * speedMultiplier(st.level)) / SECONDS[id]).toFixed(1)} ${OUT[id]} / sec`;
    $(`${id}-ql`).textContent = id === 'farm' ? 'Queue' : `Queue: ${stock} ${IN[id]}`;
    $(`${id}-qn`).textContent = id === 'farm' ? '—' : backed ? 'Backing up!' : starved ? 'Starved' : '';
    $(`${id}-bar`).style.width = id === 'farm' ? '0%' : `${Math.min(100, st.stock * 2)}%`;
    $(`card-${id}`).classList.toggle('warn', backed);
    const up = document.querySelector<HTMLButtonElement>(`[data-up="${id}"]`)!;
    up.textContent = `Upgrade · ${fmt(upgradeCost(s, id))}`;
    up.disabled = s.coins < upgradeCost(s, id);
    (document.querySelector(`[data-plus="${id}"]`) as HTMLButtonElement).disabled = lounge === 0;
    (document.querySelector(`[data-minus="${id}"]`) as HTMLButtonElement).disabled = n === 0;
    const anim = starved ? 'sleep' : id === 'mill' ? 'spin' : 'hop';
    const list = here(id);
    setHtml(`actors-${id}`, keyOf(list, anim), crowd(list, anim, starved));
  }
  // props that reflect production state
  const mill = s.stations.mill.stock;
  const sacks = mill < 10 ? 1 : mill < 30 ? 2 : 3; // never 0: a vanishing prop flickers
  setHtml('sacks', `${sacks}`, '<span class="prop sprite" style="background-position:-288px 0"></span>'.repeat(sacks));
  $('oven').className = `prop sprite${s.stations.bakery.stock >= 2 && count(s, 'bakery') > 0 ? ' oven-baking' : ''}`;
  $('oven').style.backgroundPositionX = '-96px';

  if (s.bread > lastBread) { // sale feedback: floating "+10" and a coin sound
    const fx = document.createElement('div');
    fx.className = 'float';
    fx.style.cssText = `right:${40 + Math.random() * 120}px;bottom:${150 + Math.random() * 40}px`;
    fx.innerHTML = `${item(3)}+${(s.bread - lastBread) * 10}`;
    $('shop-fx').appendChild(fx);
    setTimeout(() => fx.remove(), 1100);
    if (performance.now() - lastCoinSfx > 400) { sfx('coin1.wav'); lastCoinSfx = performance.now(); }
  }
  lastBread = s.bread;
}

// --- loop: fixed 0.1s steps, 5s production_tick, autosave ---
let last = performance.now(), acc = 0, tickAcc = 0, windowStart = Date.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min((now - last) / 1000, 1); // tab throttling: longer gaps are covered by offline logic on reload
  last = now;
  while (acc >= 0.1) { step(s, 0.1); acc -= 0.1; tickAcc += 0.1; }
  if (tickAcc >= 5) {
    tickAcc = 0;
    emit?.('production_tick', Date.now(), { window_start: new Date(windowStart).toISOString(), window_end: new Date().toISOString(), ...takeWindow(s) });
    windowStart = Date.now();
    save();
  }
  if (now - lastRateAt >= 1000) { rate = (s.bread * 10 - lastEarned) / ((now - lastRateAt) / 1000); lastEarned = s.bread * 10; lastRateAt = now; }
  render();
}, 100);
syncAudio();
addEventListener('pagehide', () => { emit?.('session_end', Date.now(), { session_seconds: (Date.now() - t0) / 1000, reason: 'closed' }); save(); });
