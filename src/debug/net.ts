/**
 * The debug hook's `net` part for a networked table (DESIGN "Specification: code interfaces", SpellplaneDebug.net;
 * debug/types.ts NetDebug; PLAN M1-P2 leak test and the M1 gate: messages, sequencer, reloads, closing the sequencer's
 * page). Dev and test builds only (registerDebug is a no-op in production; main.ts imports this module lazily).
 */
import type { NetSession } from '../session/types';
import type { KillableTransport } from '../session/transports';
import { registerDebug } from '../util/debug';

/** The page's clock for networked sessions (main.ts): `set(ms)` pins it, `set(null)` returns to Date.now. Added by M8-C. */
export interface PageClock {
  now(): number;
  set(now: number | null): void;
}

/** A clock that reads Date.now until a test pins it (`__spellplane.net.setClock`). Added by M8-C. */
export function pageClock(): PageClock {
  let pinned: number | null = null;
  return {
    now: () => pinned ?? Date.now(),
    set: (now) => {
      pinned = now;
    },
  };
}

/**
 * Register `window.__spellplane.net` for `session`. `transport` is the session's current transport wrapper (a new one
 * per join), so `kill()` and `revive()` act on the live connection.
 */
export function registerNetDebug(session: NetSession, transport: () => KillableTransport | null, clock?: PageClock): void {
  // The session's current engine (a new one when it gave up a table it started alone for the room's).
  const engine = () => session.engine;
  // `clearMessages` keeps the engine's log and remembers where the caller's window starts.
  let from = 0;
  let of = engine();
  const start = (): number => {
    if (of !== engine()) {
      of = engine();
      from = 0;
    }
    return from;
  };
  registerDebug({
    net: {
      messages: () => engine().messages().slice(start()),
      sequencer: () => engine().sequencerId() ?? '',
      self: () => engine().identity.peerId,
      peers: () => engine().peers(),
      status: () => engine().status(),
      seq: () => engine().seq(),
      clearMessages: () => {
        start();
        from = engine().messages().length;
      },
      kill: () => transport()?.kill(),
      revive: async () => {
        transport()?.revive();
      },
      close: () => {
        void session.leave();
      },
      // M8-C: the networked session's injected clock (product timers such as the 30 s away rule; PLAN "Waiting in tests").
      setClock: (now: number | null) => clock?.set(now),
    },
  });
}

/** Drop `window.__spellplane.net` (the page left its networked table; the solo table has no network part). */
export function clearNetDebug(): void {
  if (!__SPELLPLANE_DEBUG__ || typeof window === 'undefined' || !window.__spellplane) return;
  delete window.__spellplane.net;
}
