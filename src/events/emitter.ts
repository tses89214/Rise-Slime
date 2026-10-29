import type { GameEvent } from './schema';

// UUID v7: 48-bit ms timestamp + random. Works in Node and (via crypto.getRandomValues) browsers.
export function uuid7(ms: number): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Ctx { game_version: string; player_id: string; session_id: string; client: 'browser' | 'bot'; bot_persona: string | null }
type Common = 'event_id' | 'schema_version' | 'game_version' | 'player_id' | 'session_id' | 'client' | 'bot_persona' | 'seq' | 'event_time' | 'sent_at' | 'ingested_at';
type Body<T extends GameEvent['event_type']> = Omit<Extract<GameEvent, { event_type: T }>, Common | 'event_type'>;

// Stamps shared fields; `now` (ms since epoch) is supplied by the caller, never read here.
export function makeEmitter(ctx: Ctx, sink: (e: GameEvent) => void) {
  let seq = 0;
  return function emit<T extends GameEvent['event_type']>(type: T, now: number, body: Body<T>) {
    const iso = new Date(now).toISOString();
    sink({ event_id: uuid7(now), event_type: type, schema_version: 1, ...ctx, seq: seq++, event_time: iso, sent_at: iso, ...body } as unknown as GameEvent);
  };
}
