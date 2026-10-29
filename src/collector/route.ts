import { GameEvent } from '../events/schema';

// Valid events go to `events`; anything else goes to the dead-letter topic with raw payload and reason.
export function route(raw: unknown, now: number) {
  const r = GameEvent.safeParse(raw);
  if (r.success) return { topic: 'events', key: r.data.player_id, value: { ...r.data, ingested_at: new Date(now).toISOString() } };
  return { topic: 'events.dlq', key: null, value: { raw, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), ingested_at: new Date(now).toISOString() } };
}
