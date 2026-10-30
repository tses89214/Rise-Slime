# Collector moves to Python (FastAPI)

Decision: the collector (POST /events, DLQ routing, dashboard API) is Python; the owner reads Python more easily.
Game core, event schema (zod) and bots stay TypeScript: the browser game needs them, and bots import the same sim, so porting would duplicate game rules.

Single source of truth is kept: `npm run schema` exports zod to `src/events/event.schema.json`; the collector validates with it; `src/events/jsonschema.test.ts` fails if the file is stale.
Tests: `npm run test:collector` (pytest, also runs the TS bots and checks every event they emit is accepted).
