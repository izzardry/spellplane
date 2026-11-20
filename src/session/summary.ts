/**
 * A table as a History summary (persistence.md section 3: `summarise(state, secrets, prior, heads)`, pure; the ruling
 * "GameSummary gains" thumb, opponent, result). M8-P2.
 *
 * Hidden information: a summary holds public state only. The thumb is the outline of each public battlefield card
 * (position, tapped, the controller's seat index); never an identity, a hand, a library or a pile's content.
 */
import { isPlayAction } from '../core/log';
import type { LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import type { GameSummary, GameThumb } from '../store/types';
import type { KnownHead } from './types';

/** At most this many cards in a thumb (persistence.md ruling: at most 80). */
export const THUMB_MAX = 80;
/** Margin around the cards in a thumb, mm. */
const THUMB_PAD = 40;

/** What the caller knows beyond the state (all optional; the prior summary's values stay otherwise). */
export interface SummaryExtra {
  /** State hash at `state.seq` (async to compute, so passed in). */
  hash?: string;
  /** Own play actions so far (ownActions). */
  actions?: number;
  /** The clock, for endedAt and savedAt. */
  now?: number;
  /** An own action was applied since the last summary: History reorders (persistence.md section 3). */
  played?: boolean;
}

/**
 * The own play actions in a log (contracts.md Part E `actions`: the purge rule counts these). The automatic setup is
 * not the player's doing: where the seat's opening hand was dealt (`dealt`), only what came after the first deal counts
 * (the import, the shuffle and the seven draws before it are the launcher's).
 */
export function ownActions(log: readonly LogEntry[], seat: SeatId): number {
  const own = (e: LogEntry): boolean => e.kind === 'action' && e.action.by === seat;
  const firstDeal = log.findIndex((e) => own(e) && e.kind === 'action' && e.action.type === 'dealt');
  let n = 0;
  for (const e of firstDeal < 0 ? log : log.slice(firstDeal + 1)) if (e.kind === 'action' && own(e) && e.action.type !== 'dealt' && isPlayAction(e.action)) n++;
  return n;
}

/** Whether `e` is an own play action that the purge rule counts (the automatic deal is the launcher's). */
function ownPlay(e: LogEntry, seat: SeatId): boolean {
  return e.kind === 'action' && e.action.by === seat && e.action.type !== 'dealt' && isPlayAction(e.action);
}

/** Own play actions in a game, and whether that number is known exactly (`countOwnActions`). */
export interface ActionCount {
  n: number;
  /** False when the log does not reach back to the game's first action: `n` is then a lower bound (a purge needs an exact count). */
  exact: boolean;
}

/**
 * The own play actions of a whole game from a session's log, which may hold only the tail after a stored snapshot (a
 * restored solo session replays from its snapshot, which moves every 200 actions), and the stored summary (`prior`:
 * its `actions` counted everything up to its `seq`). Never less than `prior.actions`, so a summary's count only grows.
 */
export function countOwnActions(log: readonly LogEntry[], seat: SeatId, stateSeq: number, prior: Pick<GameSummary, 'seq' | 'actions'> | null): ActionCount {
  const floor = prior?.actions ?? 0;
  const firstAction = log.find((e) => e.kind === 'action');
  // The first seq the log holds; an empty log holds nothing up to the state's seq.
  const start = firstAction ? firstAction.seq : stateSeq + 1;
  if (start <= 1) return { n: Math.max(ownActions(log, seat), floor), exact: true };
  if (prior && prior.seq >= start - 1) {
    const tail = log.filter((e) => e.seq > prior.seq);
    const more = prior.actions > 0 ? tail.filter((e) => ownPlay(e, seat)).length : ownActions(tail, seat);
    // The summary may itself have been counted from a tail, so the sum is a lower bound too.
    return { n: Math.max(prior.actions + more, floor), exact: false };
  }
  const after = prior?.seq ?? 0;
  return { n: floor + log.filter((e) => e.seq > after && ownPlay(e, seat)).length, exact: false };
}

/** Whether the log entries after `seq` hold an own play action (History reorders only on these; persistence.md section 3). */
export function playedSince(log: readonly LogEntry[], seat: SeatId, seq: number): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.seq <= seq) break;
    if (ownPlay(e, seat)) return true;
  }
  return false;
}

/** Public battlefield outlines (persistence.md ruling "GameSummary gains"). */
export function thumbOf(state: TableState): GameThumb | null {
  const cards: [number, number, 0 | 1, number][] = [];
  const zones = Object.values(state.zones)
    .filter((z) => z.kind === 'battlefield' && z.visibility === 'public')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const z of zones) {
    for (const id of z.ids) {
      const c = state.cards[id];
      if (!c || c.object !== undefined) continue;
      const seatIndex = state.seats[c.controller]?.index ?? 0;
      cards.push([c.pose.x, c.pose.y, c.tapped ? 1 : 0, seatIndex]);
      if (cards.length >= THUMB_MAX) break;
    }
    if (cards.length >= THUMB_MAX) break;
  }
  if (cards.length === 0) return null;
  const xs = cards.map((c) => c[0]);
  const ys = cards.map((c) => c[1]);
  const minX = Math.min(...xs) - THUMB_PAD;
  const minY = Math.min(...ys) - THUMB_PAD;
  const w = Math.round(Math.max(...xs) + THUMB_PAD - minX);
  const h = Math.round(Math.max(...ys) + THUMB_PAD - minY);
  return { w, h, cards: cards.map(([x, y, t, s]) => [Math.round(x - minX), Math.round(y - minY), t, s]) };
}

/** The summary of `state` for History (persistence.md section 3). Pure. */
export function summarise(state: TableState, secrets: SecretStore | null, prior: GameSummary, heads: KnownHead | null, extra: SummaryExtra = {}): GameSummary {
  const own = secrets?.seat ?? prior.seat;
  const players = Object.values(state.seats)
    .filter((s) => s.name !== '' || s.peer !== undefined)
    .sort((a, b) => a.index - b.index)
    .map((s) => ({
      seat: s.id,
      name: s.name,
      colour: s.colour,
      ...(s.team !== undefined ? { team: s.team } : {}),
      life: s.team !== undefined ? (state.teams[s.team]?.life ?? s.life) : s.life,
      away: s.away === true,
      me: s.id === own,
    }));
  const takeovers = Object.values(state.seats).reduce((n, s) => n + (s.takeovers ?? 0), 0);
  const now = extra.now ?? prior.savedAt;
  const known = heads ? { play: heads.play, seq: heads.seq, name: (heads.seat !== null ? state.seats[heads.seat]?.name : undefined) ?? '' } : prior.knownHead;
  const next: GameSummary = {
    ...prior,
    seat: own,
    format: state.format,
    players,
    stage: state.stage,
    game: state.games ?? 0,
    turn: state.turn.number,
    active: state.turn.active,
    seq: state.seq,
    hash: extra.hash ?? prior.hash,
    knownHead: known,
    takeovers,
    actions: extra.actions ?? prior.actions,
    savedAt: now,
    lastPlayedAt: extra.played === true ? now : prior.lastPlayedAt,
    thumb: thumbOf(state),
  };
  if (state.result) {
    next.result = state.result;
    next.ended = 'result';
    next.endedAt = prior.endedAt ?? now;
  } else {
    // A new game at the table (a rematch, a stage change) cleared the result: the summary is running again. A solo
    // game replaced by a newer one stays ended.
    delete next.result;
    if (prior.ended === 'result') {
      delete next.ended;
      delete next.endedAt;
    }
  }
  return next;
}
