import { makeEmitter } from '../events/emitter';
import { store } from './util';

// null (and the whole branch is compiled out) unless VITE_TELEMETRY=true, so the itch.io build sends nothing.
export const emit = import.meta.env.VITE_TELEMETRY === 'true' ? create() : null;

function create() {
  const url = import.meta.env.VITE_COLLECTOR_URL ?? 'http://localhost:3000/events';
  const pid = store.get('rise-slime-pid') ?? `player-${crypto.randomUUID().slice(0, 8)}`;
  store.set('rise-slime-pid', pid);
  return makeEmitter(
    { game_version: '0.1.0', player_id: pid, session_id: `s-${crypto.randomUUID().slice(0, 4)}`, client: 'browser', bot_persona: null },
    (e) => void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e), keepalive: true }).catch(() => {}),
  );
}
