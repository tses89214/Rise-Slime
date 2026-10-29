import { $, store } from './util';

// Browsers block autoplay, so music starts on the first click. Music and sfx toggles are remembered.
const on = { music: store.get('rise-slime-music') === 'on', sfx: store.get('rise-slime-sfx') !== 'off' };
const tracks = ['8-bit-concentration-loop.mp3', 'sometimes.ogg', 'cunning-plan.ogg'].map((f) => `/audio/music/${f}`);
const music = new Audio(tracks[0]);
music.volume = 0.25;
let track = 0;
music.onended = () => { music.src = tracks[++track % tracks.length]; void music.play().catch(() => {}); }; // rotate so one loop doesn't wear out

export const sfx = (f: string) => {
  if (!on.sfx) return;
  const a = new Audio(`/audio/sfx/${f}`);
  a.volume = 0.4;
  void a.play().catch(() => {});
};

const show = (id: string, name: string, v: boolean) => { // icon button: dimmed and struck through when off
  const b = $(id);
  b.classList.toggle('off', !v);
  b.setAttribute('aria-pressed', String(v));
  b.title = `${name}: ${v ? 'on' : 'off'}`;
};
const sync = () => {
  show('music', 'Music', on.music);
  show('sfx', 'Sound effects', on.sfx);
  store.set('rise-slime-music', on.music ? 'on' : 'off');
  store.set('rise-slime-sfx', on.sfx ? 'on' : 'off');
  if (on.music) void music.play().catch(() => {}); else music.pause();
};

export function initAudio() {
  $('music').onclick = () => { on.music = !on.music; sync(); };
  $('sfx').onclick = () => { on.sfx = !on.sfx; sync(); };
  addEventListener('click', () => { if (on.music && music.paused) void music.play().catch(() => {}); }, { once: true });
  document.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) sfx('click_001.ogg'); });
  sync();
}
