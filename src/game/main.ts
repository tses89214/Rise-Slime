import { ACHIEVEMENTS, checkAchievements } from '../core/achievements';
import { type Slime, QUEUE, applyOffline, assignOne, buySlime, newState, slimeCost, STATIONS, speedMultiplier, step, takeWindow, upgrade, upgradeCost, type State, type StationId } from '../core/sim';
import { initAudio, sfx } from './audio';
import { sale, startCustomers } from './customers';
import { emit } from './telemetry';
import { $, store } from './util';

const SAVE_KEY = 'rise-slime-save';
const NAME: Record<StationId, string> = { farm: 'FARM', mill: 'MILL', bakery: 'BAKERY' };
const OUT: Record<StationId, string> = { farm: 'wheat', mill: 'flour', bakery: 'bread' };
const IN: Record<StationId, string> = { farm: '', mill: 'wheat', bakery: 'flour' };
const SECONDS = { farm: 1, mill: 3, bakery: 5 };
const CUSTOMERS = 7;
const MAX_DRAWN = 10;
const barPct = (stock: number) => Math.min(100, (100 * Math.log10(1 + stock)) / Math.log10(1 + 2 * QUEUE.jam)); // log scale: twice the jam level fills the bar
const TICKS = [QUEUE.busy, QUEUE.backed, QUEUE.jam]; // where the queue turns busy / backing up / jammed // per zone: 5 per row, 2 rows; the rest shows as "+N"

// --- achievements ---
const toast = (text: string) => {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
};
const setAchLabel = () => { $('ach').innerHTML = `<span class="long">Achievements</span><span class="short"><span class="item sprite" style="background-position:-224px 0"></span></span> ${s.achievements.length}/${ACHIEVEMENTS.length}`; };
const renderAchievements = () => {
  $('ach-count').textContent = `${s.achievements.length}/${ACHIEVEMENTS.length}`;
  $('ach-list').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = s.achievements.includes(a.id);
    return `<li class="${got ? '' : 'locked'}"><b>${a.name}</b>${got ? '' : ' (locked)'}<small>${a.desc}</small></li>`;
  }).join('');
};
document.querySelectorAll<HTMLElement>('[data-qv]').forEach((e) => { e.textContent = String(QUEUE[e.dataset.qv as keyof typeof QUEUE]); }); // Help text reads the same thresholds
$('help').onclick = () => ($('helpdlg') as HTMLDialogElement).showModal();
$('credits-btn').onclick = () => ($('credits') as HTMLDialogElement).showModal();
$('ach').onclick = () => { renderAchievements(); ($('achievements') as HTMLDialogElement).showModal(); };

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
    s.achievements ??= []; // saves from before achievements existed
    for (const id of STATIONS) s.stations[id].made ??= 0;
    isNew = false;
    offlineSeconds = (Date.now() - save.savedAt) / 1000;
  }
} catch { /* corrupt save: start fresh */ }

// dev only (stripped from builds): ?demo=farm,mill,bakery,lounge seeds a state for screenshots, e.g. ?demo=12,3,6,2
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('demo') : null;
if (demo) {
  const [f, m, b, l] = demo.split(',').map(Number);
  s = newState({ farm: f, mill: m, bakery: b });
  s.coins = 1e6;
  for (let i = 0; i < l; i++) buySlime(s);
  s.coins = 20;
}

const openDlg = import.meta.env.DEV ? new URLSearchParams(location.search).get('open') : null; // dev only: ?open=helpdlg for screenshots
if (openDlg) ($(openDlg) as HTMLDialogElement).showModal();

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
  '<div class="cloud" style="top:18px"></div><div class="cloud" style="top:56px;animation-delay:-30s"></div>' +
  zone('farm', `<div class="field">${Array.from({ length: 14 }, (_, i) => item(0, 'wheat').replace('class="', `style="animation-delay:-${((i * 7) % 12) * 0.1}s" class="`)).join('')}</div>`) +
  zone('mill', '<div class="windmill" id="windmill"><span class="prop sprite p-windmill"></span><span class="prop sprite blades"></span></div>') +
  zone('bakery', '<span class="prop sprite p-oven" id="oven"></span>') +
  `<div class="zone"><div class="label">SHOP</div><div class="shop-img sprite"></div>${Array.from({ length: CUSTOMERS }, (_, i) => `<div class="cust" data-s="hidden" style="--row:${i % 4}"><span class="cs walk"></span><span class="cs carry"></span></div>`).join('')}<div id="shop-fx"></div></div>`;
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

startCustomers(document.querySelectorAll<HTMLElement>('#scene .zone')[3]);

// --- cards ---
$('stations').innerHTML = STATIONS.map((id) => `
  <div class="card box" id="card-${id}">
    <div class="top"><h2>${NAME[id]}</h2><span><b class="num" id="${id}-n"></b> slimes · Lv <b class="num" id="${id}-lv"></b></span></div>
    <div id="${id}-rate"></div>
    <div class="row"><span id="${id}-ql"></span><b id="${id}-qn"></b></div>
    <div class="bar"><i id="${id}-bar"></i>${id === 'farm' ? '' : TICKS.map((n) => `<b style="left:${barPct(n)}%"></b>`).join('')}</div>
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
// Elements are looked up once; text/classes are only written when the value changed (writes cost layout even when identical).
const el = (id: string) => document.getElementById(id)!;
const ui = {
  coins: el('coins'), income: el('income'), buy: el('buy') as HTMLButtonElement, buyCost: el('buy-cost'), windmill: el('windmill'), oven: el('oven'), shopFx: el('shop-fx'),
  st: Object.fromEntries(STATIONS.map((id) => [id, {
    n: el(`${id}-n`), lv: el(`${id}-lv`), rate: el(`${id}-rate`), ql: el(`${id}-ql`), qn: el(`${id}-qn`), bar: el(`${id}-bar`), card: el(`card-${id}`),
    up: document.querySelector<HTMLButtonElement>(`[data-up="${id}"]`)!, plus: document.querySelector<HTMLButtonElement>(`[data-plus="${id}"]`)!, minus: document.querySelector<HTMLButtonElement>(`[data-minus="${id}"]`)!,
  }])) as Record<StationId, { n: HTMLElement; lv: HTMLElement; rate: HTMLElement; ql: HTMLElement; qn: HTMLElement; bar: HTMLElement; card: HTMLElement; up: HTMLButtonElement; plus: HTMLButtonElement; minus: HTMLButtonElement }>,
};
const shown = new Map<object, string>();
const setText = (e: HTMLElement, v: string) => { if (shown.get(e) !== v) { shown.set(e, v); e.textContent = v; } };
const keys = new Map<string, string>();
const setHtml = (id: string, key: string, html: string) => { if (keys.get(id) !== key) { keys.set(id, key); el(id).innerHTML = html; } };
// colour follows the job: lounge blue, farm green (leafy), mill brown (rocky), bakery red (fiery); cosmetic in M1
const ROW: Record<string, number> = { lounge: 0, farm: 1, mill: 2, bakery: 3 };
const slimeEl = (sl: Slime, anim: string, i: number, zzz = false) =>
  `<span class="${zzz ? 'sleeper' : ''}"><span class="slime sprite a-${anim}" style="--row:${ROW[sl.station ?? 'lounge']};animation-delay:-${(i * 0.17).toFixed(2)}s"></span>${zzz ? `<span class="zzz">${item(4)}</span>` : ''}</span>`;
const crowd = (list: Slime[], anim: string, zzz = false) =>
  list.slice(0, MAX_DRAWN).map((sl, i) => slimeEl(sl, anim, i, zzz)).join('') + (list.length > MAX_DRAWN ? `<span class="more">+${list.length - MAX_DRAWN}</span>` : '');
const keyOf = (list: Slime[], anim: string) => `${anim}:${list.slice(0, MAX_DRAWN).map((x) => x.id).join()}:${list.length}`;

const lastMade = Object.fromEntries(STATIONS.map((id) => [id, s.stations[id].made ?? 0])) as Record<StationId, number>;
const ITEM_OF: Record<StationId, number> = { farm: 0, mill: 1, bakery: 2 }; // wheat, flour, bread sprites in items.png
// Each finished cycle pops "+N <item>" above the field / windmill / oven. Bursts are merged every 400ms so fast stations don't pile up popups.
const pending: Record<StationId, number> = { farm: 0, mill: 0, bakery: 0 };
const lastPop: Record<StationId, number> = { farm: 0, mill: 0, bakery: 0 };
const sceneZones = [...el('scene').querySelectorAll<HTMLElement>('.zone')];
function gain(id: StationId, n: number) {
  const zone = sceneZones[STATIONS.indexOf(id)];
  if (zone.querySelectorAll('.gain').length >= 4) return; // popups die on animationend; never let them pile up
  const e = document.createElement('div');
  e.className = 'gain';
  e.innerHTML = `${item(ITEM_OF[id])}+${n}`;
  e.addEventListener('animationend', () => e.remove());
  zone.appendChild(e);
}
let rate = 0, lastEarned = s.bread * 10, lastRateAt = performance.now(), lastBread = s.bread, lastCoinSfx = 0;
function render() {
  setText(ui.coins, fmt(s.coins));
  setText(ui.income, `+${rate >= 1000 ? fmt(rate) : rate.toFixed(1)}/s`);
  const cost = slimeCost(s);
  ui.buy.disabled = s.coins < cost;
  setText(ui.buyCost, `${fmt(cost)} coins`);
  const by: Record<string, Slime[]> = { lounge: [], farm: [], mill: [], bakery: [] }; // group once
  for (const sl of s.slimes) by[sl.station ?? 'lounge'].push(sl);
  setHtml('lounge-slimes', keyOf(by.lounge, 'idle'), crowd(by.lounge, 'idle'));

  for (const id of STATIONS) {
    const list = by[id], n = list.length, st = s.stations[id], u = ui.st[id], stock = Math.floor(st.stock);
    const starved = id !== 'farm' && n > 0 && st.stock < QUEUE.starved;
    const q = id === 'farm' ? 'none' : starved ? 'starved' : st.stock >= QUEUE.jam ? 'jam' : st.stock >= QUEUE.backed ? 'warn' : st.stock >= QUEUE.busy ? 'busy' : n === 0 && st.stock >= QUEUE.starved ? 'warn' : 'ok';
    const note = { none: '—', starved: 'Starved', ok: '', busy: 'Getting busy', warn: n === 0 ? 'No workers!' : 'Backing up!', jam: 'Jammed!' }[q]!;
    setText(u.n, String(n));
    setText(u.lv, String(st.level));
    setText(u.rate, `${((n * speedMultiplier(st.level)) / SECONDS[id]).toFixed(1)} ${OUT[id]}/s`);
    setText(u.ql, id === 'farm' ? 'Queue' : `Queue: ${stock} ${IN[id]}`);
    setText(u.qn, note);
    const w = id === 'farm' ? '0%' : `${barPct(st.stock).toFixed(0)}%`;
    if (u.bar.style.width !== w) u.bar.style.width = w;
    if (u.card.dataset.q !== q) u.card.dataset.q = q;
    const upCost = upgradeCost(s, id);
    setText(u.up, `Upgrade · ${fmt(upCost)}`);
    u.up.disabled = s.coins < upCost;
    u.plus.disabled = by.lounge.length === 0;
    u.minus.disabled = n === 0;
    const anim = starved ? 'sleep' : id === 'mill' ? 'spin' : 'hop';
    setHtml(`actors-${id}`, keyOf(list, anim), crowd(list, anim, starved));
  }
  // blades turn and the oven glows only while the station has input to work on
  ui.windmill.classList.toggle('working', s.stations.mill.stock >= QUEUE.starved && by.mill.length > 0);
  ui.oven.classList.toggle('baking', s.stations.bakery.stock >= QUEUE.starved && by.bakery.length > 0);

  for (const id of STATIONS) { // popups for finished cycles
    const made = s.stations[id].made ?? 0;
    pending[id] += made - lastMade[id];
    lastMade[id] = made;
    if (pending[id] > 0 && performance.now() - lastPop[id] > 400) { gain(id, pending[id]); pending[id] = 0; lastPop[id] = performance.now(); }
  }
  if (s.bread > lastBread) sale(s.bread - lastBread); // each sale sends a customer to pick up a loaf
  if (s.bread > lastBread && ui.shopFx.childElementCount < 6) { // sale feedback at the shop: floating "+10" and a coin sound
    const fx = document.createElement('div');
    fx.className = 'float';
    fx.style.cssText = `right:${40 + Math.random() * 120}px;bottom:${150 + Math.random() * 40}px`;
    fx.innerHTML = `${item(3)}+${(s.bread - lastBread) * 10}`;
    fx.addEventListener('animationend', () => fx.remove());
    ui.shopFx.appendChild(fx);
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
  for (const a of checkAchievements(s)) {
    sfx('confirmation_002.ogg');
    toast(`Achievement unlocked: ${a.name}`);
    emit?.('achievement_unlocked', Date.now(), { achievement_id: a.id, total_unlocked: s.achievements.length });
    setAchLabel();
  }
  if (tickAcc >= 5) {
    tickAcc = 0;
    emit?.('production_tick', Date.now(), { window_start: new Date(windowStart).toISOString(), window_end: new Date().toISOString(), ...takeWindow(s) });
    windowStart = Date.now();
    save();
  }
  if (now - lastRateAt >= 1000) { rate = (s.bread * 10 - lastEarned) / ((now - lastRateAt) / 1000); lastEarned = s.bread * 10; lastRateAt = now; }
  if (!document.hidden) render(); // nothing to draw in a background tab; the sim above keeps running
}, 100);
setAchLabel();
initAudio();
addEventListener('pagehide', () => { emit?.('session_end', Date.now(), { session_seconds: (Date.now() - t0) / 1000, reason: 'closed' }); save(); });
