// Read-only dashboard API + static page. The browser never talks to ClickHouse: it gets this fixed set of queries.
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

const CH = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';

async function q(sql: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${CH}/?default_format=JSON`, { method: 'POST', body: sql });
  if (!res.ok) throw new Error(`clickhouse: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { data: Record<string, unknown>[] }).data;
}

export type ClientFilter = 'all' | 'browser' | 'bot';

export function dashboardSql(minutes: number, client: ClientFilter) {
  // client is validated against the union before it gets here; dead letters keep the original JSON as text, so read client out of it
  const c = client === 'all' ? '1' : `client = '${client}'`;
  const dead = client === 'all' ? '1' : `JSONExtractString(raw, 'client') = '${client}'`;
  const since = `window_start > now() - INTERVAL ${minutes} MINUTE AND ${c}`;
  return {
    production: `SELECT toUnixTimestamp(window_start) t, station, sum(produced) produced, round(sum(input_stock * players)) queue FROM slime.production_1m WHERE ${since} GROUP BY t, station ORDER BY t`,
    ops: `SELECT toUnixTimestamp(window_start) t, sum(active_players) active, sum(slimes_purchased) purchases, sum(station_upgrades) upgrades, sum(coins_earned) coins FROM slime.ops_1m WHERE ${since} GROUP BY t ORDER BY t`,
    pipeline: `SELECT toUnixTimestamp(window_start) t, sum(p.events) events, round(sum(p.avg_latency_ms * p.events) / sum(p.events)) latency_ms, sum(p.duplicates) duplicates, sum(p.late) late FROM slime.pipeline_1m AS p WHERE ${since} GROUP BY t ORDER BY t`,
    richest: `SELECT player_id, bot_persona persona, round(coins_now) coins, slimes_owned slimes, achievements_unlocked achievements, station_levels levels, online FROM slime.leaderboard WHERE ${c} LIMIT 10`,
    efficiency: `SELECT player_id, bot_persona persona, round(earned) coins_earned, round(coins_per_min, 1) per_min, round(coins_per_min_per_slime, 2) per_slime FROM slime.efficiency WHERE coins_per_min IS NOT NULL AND ${c} LIMIT 10`,
    dead: `SELECT formatDateTime(received_at, '%H:%i:%S') at, error, substring(raw, 1, 120) raw FROM slime.dead_letters WHERE ${dead} ORDER BY received_at DESC LIMIT 8`,
    kpi: `SELECT (SELECT countIf(online) FROM slime.leaderboard WHERE ${c}) online, (SELECT count() FROM slime.events WHERE ${c}) events,
      (SELECT count() FROM slime.dead_letters WHERE ${dead}) dead,
      uniqIf(player_id, event_time > now() - INTERVAL 1 DAY) dau, uniqIf(player_id, event_time > now() - INTERVAL 7 DAY) wau, uniqIf(player_id, event_time > now() - INTERVAL 30 DAY) mau
      FROM slime.events WHERE ${c}`,
  };
}

const files: Record<string, [string, string]> = {
  '/dashboard': ['dashboard/index.html', 'text/html'],
  '/dashboard/uplot.js': ['node_modules/uplot/dist/uPlot.iife.min.js', 'text/javascript'],
  '/dashboard/uplot.css': ['node_modules/uplot/dist/uPlot.min.css', 'text/css'],
  '/dashboard/font.ttf': ['assets/fonts/monogram.ttf', 'font/ttf'],
};

export function dashboardRoutes(app: FastifyInstance) {
  for (const [url, [path, type]] of Object.entries(files)) {
    app.get(url, async (_req, reply) => reply.type(type).send(await readFile(path)));
  }
  app.get('/api/dashboard', async (req, reply) => {
    const query = req.query as { minutes?: string; client?: string };
    const m = Math.min(Math.max(+(query.minutes ?? 60) || 60, 5), 1440);
    const client: ClientFilter = query.client === 'browser' || query.client === 'bot' ? query.client : 'all';
    try {
      const entries = await Promise.all(Object.entries(dashboardSql(m, client)).map(async ([k, sql]) => [k, await q(sql)] as const));
      return Object.fromEntries(entries);
    } catch (e) {
      return reply.code(502).send({ error: String(e) });
    }
  });
}
