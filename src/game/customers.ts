import { rnd, sleep } from './util';

// Customers wander the open ground by the shop. Every bread actually sold sends one to the display window:
// the loaf hops into their hands, they hug it and leave right, and a new one (new colour) arrives from the right.
let buyers = 0; // sales no customer has walked over for yet; capped, so at high sales rates customers simply cycle
export const sale = (n: number) => { buyers = Math.min(6, buyers + n); };

export function startCustomers(zone: HTMLElement) {
  zone.querySelectorAll<HTMLElement>('.cust').forEach((c) => void life(zone, c));
}

async function life(zone: HTMLElement, c: HTMLElement) {
  const u = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 3; // px per art pixel
  const W = () => zone.clientWidth;
  let x = 0;
  const go = async (to: number, depth: number) => {
    const dur = Math.max(0.2, Math.abs(to - x) / (12 * u())); // ~12 art px per second: a stroll
    c.style.transitionDuration = `${dur}s`;
    c.style.transform = `translate(${to}px,${-depth * u()}px)`;
    x = to;
    await sleep(dur * 1000);
  };
  const jump = (to: number) => { c.style.transitionDuration = '0s'; c.style.transform = `translate(${to}px,0)`; x = to; };
  const pickUpBread = async () => { // a loaf leaves the shelf and lands in the customer's arms
    const shelf = W() - 64 * u() + 19 * u(), unit = u();
    const b = document.createElement('span');
    b.className = 'item sprite take';
    b.style.cssText = `left:${shelf - 16}px;bottom:${43 * unit}px;background-position:-64px 0;transition:transform .45s ease-in`;
    zone.appendChild(b);
    await sleep(30);
    b.style.transform = `translate(${x + 8 * unit - shelf}px,${30 * unit}px)`;
    await sleep(450);
    b.remove();
  };

  await sleep(rnd(0, 4000)); // desynchronise
  for (;;) {
    jump(W() + 2 * u());
    c.style.setProperty('--row', String(Math.floor(Math.random() * 4)));
    await sleep(50);
    let bought = false;
    for (let stops = 0; stops < 6 && !bought; stops++) { // wander until a sale happens
      c.dataset.s = 'walk';
      await go(rnd(4 * u(), W() - 40 * u()), rnd(0, 14));
      c.dataset.s = 'idle';
      await sleep(rnd(700, 2200));
      if (buyers > 0) { buyers--; bought = true; }
    }
    if (bought) {
      c.dataset.s = 'walk';
      await go(W() - 64 * u() + 11 * u(), 0); // in front of the display window
      c.dataset.s = 'idle';
      await sleep(500);
      await pickUpBread();
      c.dataset.s = 'carry';
    } else {
      c.dataset.s = 'walk'; // nothing sold lately: stroll off empty-handed
    }
    await go(W() + 2 * u(), rnd(0, 6));
    c.dataset.s = 'hidden';
    await sleep(rnd(1000, 4000));
  }
}
