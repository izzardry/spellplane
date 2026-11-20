/**
 * The muster rule and the rejoin controls (persistence.md sections 5 to 7; contracts.md Part G "Rejoin"). Stub by
 * M8-C: always live, nothing to wait for; `playOn` resolves, `invite` rejects. M8-P5 owns the file.
 */
import type { TableState } from '../core/types';
import type { MusterStatus, SessionMuster, TableSession } from './types';

/** The muster verdict of a state seen from `me` (persistence.md section 5). Stub: live by rule 1, every seat here. */
export function musterStatus(state: TableState, me: string | null): MusterStatus {
  return {
    live: true,
    rule: 1,
    waitingFor: [],
    seats: Object.values(state.seats)
      .filter((s) => s.peer !== undefined || s.name !== '')
      .sort((a, b) => a.index - b.index)
      .map((s) => ({ seat: s.id, name: s.name, me: s.id === me, state: s.away ? 'away' : 'here' })),
    knownHead: null,
    playOnHere: false,
  };
}

/** The rejoin controls of a session (persistence.md PS-C). Stub: always live. */
export function createSessionMuster(session: TableSession): SessionMuster {
  return {
    muster: () => musterStatus(session.getState(), session.seat),
    subscribe: (listener) => session.subscribe(() => listener(musterStatus(session.getState(), session.seat))),
    playOn: () => Promise.resolve(),
    invite: () => Promise.reject(new Error('not implemented: M8-P5')),
    takeInviteBack: () => Promise.resolve(),
    saveState: () => 'saved',
  };
}
