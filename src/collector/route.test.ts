import { expect, test } from 'vitest';
import { runBot } from '../bots/bot';
import type { GameEvent } from '../events/schema';
import { route } from './route';

test('bot events validate; malformed ones go to the DLQ', async () => {
  const events: GameEvent[] = [];
  await runBot({ id: 'bot-1', persona: 'optimizer', seed: 7, startMs: Date.UTC(2026, 10, 2), seconds: 300, sink: (e) => void events.push(e) });
  expect(events.length).toBeGreaterThan(50);
  for (const e of events) expect(route(e, 0).topic).toBe('events');
  const bad = route({ ...events[0], event_type: 'nonsense' }, 0);
  expect(bad.topic).toBe('events.dlq');
  expect((bad.value as { error: string }).error).toContain('event_type');
});

test('same seed, same events (ignoring ids)', async () => {
  const run = async () => {
    const out: string[] = [];
    await runBot({ id: 'b', persona: 'random_assigner', seed: 3, startMs: 0, seconds: 120, sink: (e) => void out.push(`${e.event_type}${e.seq}`) });
    return out;
  };
  expect(await run()).toEqual(await run());
});
