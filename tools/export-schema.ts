// usage: npm run schema — writes the JSON Schema the Python collector validates against (zod stays the single source of truth)
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { GameEvent } from '../src/events/schema';

writeFileSync('src/events/event.schema.json', JSON.stringify(z.toJSONSchema(GameEvent, { io: 'input' }), null, 1) + '\n');
