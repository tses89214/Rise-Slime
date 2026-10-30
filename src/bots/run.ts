// usage: tsx src/bots/run.ts --bots 20 --seconds 600 [--url http://localhost:3000/events | --out events.jsonl]
//        [--speed 60] [--duplicate-rate 0.01] [--malformed-rate 0.005] [--disconnect-rate 0.02] [--max-buffer 1000]
import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { rng } from '../core/sim';
import type { GameEvent } from '../events/schema';
import { runBot, type Persona } from './bot';

const { values: a } = parseArgs({ options: {
  bots: { type: 'string', default: '10' }, seconds: { type: 'string', default: '600' },
  url: { type: 'string' }, out: { type: 'string' }, speed: { type: 'string', default: '0' },
  'duplicate-rate': { type: 'string', default: '0.01' }, 'malformed-rate': { type: 'string', default: '0.005' }, seed: { type: 'string', default: '1' },
  'disconnect-rate': { type: 'string', default: '0.02' }, 'max-buffer': { type: 'string', default: '1000' },
} });
const PERSONAS: Persona[] = ['random_assigner', 'optimizer', 'optimizer', 'quitter'];
const dup = +a['duplicate-rate']!, bad = +a['malformed-rate']!, speed = +a.speed!;
const noise = rng(+a.seed!);
const file = a.out ? createWriteStream(a.out) : null; // buffered, not one sync write per event
const queue: string[] = [];
let inflight = 0;
const MAX_INFLIGHT = 50; // fast-forward mode can produce events far faster than a collector accepts them
function pump() {
  while (inflight < MAX_INFLIGHT && queue.length) {
    inflight++;
    void fetch(a.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: queue.shift()! }).catch(() => {}).finally(() => { inflight--; pump(); });
  }
}

// Fault injection: once per bot-minute a bot may drop offline for 30 s to 10 min. Its events pile up in a local buffer
// (oldest dropped past max_buffer, which leaves a seq gap) and go out on reconnect, so they arrive late with event_time
// well before sent_at.
const disc = +a['disconnect-rate']!, maxBuffer = +a['max-buffer']!;
const link = new Map<string, { minute: number; until: number; buf: GameEvent[] }>();
function flush(l: { until: number; buf: GameEvent[] }) {
  for (const e of l.buf.splice(0)) deliver({ ...e, sent_at: new Date(l.until).toISOString() });
}
function send(e: GameEvent) {
  const l = link.get(e.player_id) ?? { minute: -1, until: 0, buf: [] };
  link.set(e.player_id, l);
  const t = Date.parse(e.event_time);
  if (l.buf.length && t >= l.until) flush(l);
  const minute = Math.floor(t / 60_000);
  if (t >= l.until && minute !== l.minute && noise() < disc) l.until = t + (30 + noise() * 570) * 1000;
  l.minute = minute;
  if (t < l.until) { l.buf.push(e); if (l.buf.length > maxBuffer) l.buf.shift(); } else deliver(e);
}

function deliver(e: GameEvent) {
  const copies = noise() < dup ? 2 : 1; // resend keeps the same event_id
  const body = noise() < bad ? { ...e, event_type: 'nonsense' } : e;
  for (let i = 0; i < copies; i++) {
    const line = JSON.stringify(body);
    if (file) file.write(line + '\n');
    else if (a.url) { queue.push(line); pump(); }
    else console.log(line);
  }
}

const startMs = Date.now();
await Promise.all(Array.from({ length: +a.bots! }, (_, i) =>
  runBot({
    id: `bot-${String(i).padStart(4, '0')}`, persona: PERSONAS[i % PERSONAS.length], seed: +a.seed! * 1000 + i,
    startMs, seconds: +a.seconds!, sink: send,
    pace: speed > 0 ? (v) => new Promise((r) => setTimeout(r, (v / speed) * 1000)) : undefined,
  })));

for (const l of link.values()) flush(l); // bots that ended mid-outage reconnect at the end
while (queue.length || inflight) await new Promise((r) => setTimeout(r, 20)); // drain before exiting
file?.end();
