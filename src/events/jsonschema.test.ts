import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { GameEvent } from './schema';

// The Python collector validates with this file; if schema.ts changes and the file doesn't, events would be judged by an old shape.
test('event.schema.json matches schema.ts (run `npm run schema` to refresh)', () => {
  const committed = JSON.parse(readFileSync('src/events/event.schema.json', 'utf8'));
  expect(committed).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(GameEvent, { io: 'input' }))));
});
