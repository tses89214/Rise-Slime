// Single source of truth for event shape: game, bots and collector all import this.
import { z } from 'zod';

const station = z.enum(['farm', 'mill', 'bakery']);
const trait = z.enum(['leaf', 'stone', 'flame', 'lucky']);
const ts = z.iso.datetime();

const base = z.object({
  event_id: z.uuidv7(),
  schema_version: z.union([z.literal(1), z.literal(2)]), // v2 (M3) adds events and optional fields only, so v1 events stay valid
  game_version: z.string(),
  player_id: z.string(),
  session_id: z.string(),
  client: z.enum(['browser', 'bot']),
  bot_persona: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  event_time: ts,
  sent_at: ts,
  ingested_at: ts.optional(), // filled by collector
});

export const GameEvent = z.discriminatedUnion('event_type', [
  base.extend({ event_type: z.literal('session_start'), offline_seconds: z.number().nullable(), is_new_player: z.boolean() }),
  base.extend({ event_type: z.literal('session_end'), session_seconds: z.number(), reason: z.enum(['closed', 'idle_timeout', 'bot_stop']) }),
  base.extend({
    event_type: z.literal('offline_progress_applied'),
    offline_seconds: z.number(), credited_seconds: z.number(),
    produced: z.record(z.string(), z.number()), bread_sold: z.number(), coins_earned: z.number(),
  }),
  base.extend({ event_type: z.literal('slime_purchased'), slime_id: z.string(), cost: z.number(), total_purchased: z.number(), coins_after: z.number() }),
  base.extend({
    event_type: z.literal('slime_assigned'), slime_id: z.string(), from_station: station.nullable(), to_station: station.nullable(),
    tier: z.number().int().positive().optional(), trait: trait.nullable().optional(), // v2
  }),
  // v2 events
  base.extend({
    event_type: z.literal('slime_merged'), schema_version: z.literal(2), slime_id: z.string(), material_ids: z.array(z.string()).length(3),
    new_tier: z.number().int().min(2), trait: trait.nullable(), mutated: z.boolean(), mutation_chance: z.number(), // chance is logged: lucky slimes double it
  }),
  base.extend({ event_type: z.literal('station_expanded'), schema_version: z.literal(2), station, new_slots: z.number().int(), cost: z.number(), coins_after: z.number() }),
  base.extend({ event_type: z.literal('feature_unlocked'), schema_version: z.literal(2), feature_id: z.string() }),
  base.extend({
    event_type: z.literal('station_upgraded'), station, new_level: z.number(), cost: z.number(),
    speed_multiplier: z.number(), milestone_reached: z.boolean(), coins_after: z.number(),
  }),
  base.extend({ event_type: z.literal('achievement_unlocked'), achievement_id: z.string(), total_unlocked: z.number().int().positive() }),
  base.extend({
    event_type: z.literal('production_tick'), window_start: ts, window_end: ts,
    stations: z.array(z.object({ station, slimes: z.number(), level: z.number(), produced: z.number(), consumed: z.number(), input_stock: z.number() })),
    bread_sold: z.number(), coins_earned: z.number(), coins_balance: z.number(), slimes_owned: z.number(), achievements_unlocked: z.number(),
  }),
]);
export type GameEvent = z.infer<typeof GameEvent>;
