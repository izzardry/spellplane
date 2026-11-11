/**
 * Confirmation rounds (DESIGN "Turn flow and confirmation", Confirmation rounds; "Specification: network protocol and
 * secrecy", Timers). Contracts: M1-C. Implementer: M1-P3.
 *
 * A round is shared state, so every peer derives the same answers, the same "all passed" and the same sequencer
 * deadline from the same sequenced actions:
 * - Who answers: every occupied seat (a seat with a name) other than the asker. An empty chair never stalls a round.
 * - Start: `ask`, or a `stackPush` that carries `round` (core/reducer/stack.ts). The round stores the pass timer of
 *   the table settings at that moment (`durationMs`, 0 when the timer is off) and the seq that started it. Seats with
 *   "pass until end of turn" on answer OK at once.
 * - OK passes. Hold gives the seat the floor and stops every timer; one seat holds at a time. Release (or OK from the
 *   holder) passes and restarts the countdown from that action (`timerSeq`). A hold also clears the seat's auto-pass.
 * - Timeout: only the sequencer's clock emits it (core/deadlines.ts), for seats that are silent `durationMs` after
 *   the countdown started; a hold by a seat that is away (or has left) does not stop the clock, and that seat times out
 *   too, so a dropped player never stalls the table.
 * - End: a round about a stack item ends when the item leaves the stack (reducer/draft.ts `finish`); a new round
 *   replaces the previous one.
 * Nothing here blocks another action, except that resolving the item of a pending round needs `force` (the second
 * press, which the log shows) — see reducer/stack.ts.
 */
import type { ActionOf } from '../actions';
import type { ConfirmResponse, ConfirmRound, Deadline, RoundId, Seat, SeatId, StackItemId, TableState } from '../types';
import type { Draft } from './draft';
import { checkId, checkString, own, reject } from './util';

/** The part of the state a round reads (a TableState, or the current values of a reducer draft). */
export interface RoundState {
  seats: Readonly<Record<SeatId, Seat>>;
  confirm: Readonly<ConfirmRound> | null;
}

/** Longest label of a manual ask ("attacks?", "end of turn?"; DESIGN "Turn flow and confirmation": a short label). */
export const ASK_LABEL_MAX = 80;

const RESPONSES: readonly RespondResponse[] = ['ok', 'hold', 'release', 'timeout'];
type RespondResponse = ConfirmResponse | 'release';

const passedResponse = (r: ConfirmResponse | undefined): boolean => r === 'ok' || r === 'timeout';

/** The seq from which a round's countdown runs: the release of the last hold, else the round's start (DESIGN "Turn flow and confirmation", Hold). */
export function timerStartSeq(round: Pick<ConfirmRound, 'startSeq' | 'timerSeq'>): number {
  return round.timerSeq ?? round.startSeq;
}

/** Seats that answer `round`: every occupied seat other than the asker, in seat order (an empty chair has no name). */
export function participants(state: Pick<RoundState, 'seats'>, round: Pick<ConfirmRound, 'askedBy'>): SeatId[] {
  return Object.values(state.seats)
    .filter((s) => s.id !== round.askedBy && s.name !== '')
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/** Whether `seat` has passed the current round (OK or timeout). */
export function hasPassed(state: RoundState, seat: SeatId): boolean {
  const r = state.confirm;
  return !!r && passedResponse(own(r.responses, seat));
}

/**
 * The seat whose hold stops the timers: the holder while it is a participant that is not away (DESIGN "Turn flow and
 * confirmation", Connection loss during a round), else null.
 */
export function blockingHolder(state: RoundState): SeatId | null {
  const r = state.confirm;
  if (!r || r.holder === undefined) return null;
  const seat = own(state.seats, r.holder);
  if (!seat || seat.away === true || !participants(state, r).includes(seat.id)) return null;
  return seat.id;
}

/**
 * Seats that have not answered the current round and are not holding (DESIGN "Turn flow and confirmation": silence
 * counts as OK when the timer runs out; an away player is treated as passing after the timer), in seat order.
 */
export function silentSeats(state: RoundState): SeatId[] {
  const r = state.confirm;
  if (!r) return [];
  return participants(state, r).filter((s) => own(r.responses, s) === undefined);
}

/** Seats the current round still waits for (silent or holding), in seat order; [] once everyone passed. */
export function waitingOn(state: RoundState): SeatId[] {
  const r = state.confirm;
  if (!r) return [];
  return participants(state, r).filter((s) => !passedResponse(own(r.responses, s)));
}

/** Whether everyone has passed the current round, or there is none (DESIGN "Turn flow and confirmation", All passed). */
export function roundPassed(state: RoundState): boolean {
  return waitingOn(state).length === 0;
}

/** Whether the current round is about `item` and still waits for someone: resolving it then needs the second press. */
export function pendingAbout(state: RoundState, item: StackItemId): boolean {
  return state.confirm?.about === item && !roundPassed(state);
}

/**
 * The pass timer of the current round as a sequencer deadline: `durationMs` after `timerStartSeq`, emitting
 * `respond {seat, response: 'timeout'}` for every silent seat (and for a holder that is away); none while nobody is
 * silent, a present seat holds, or the timer is off (DESIGN "Specification: network protocol and secrecy", Timers).
 */
export function confirmDeadlines(state: TableState): Deadline[] {
  const r = state.confirm;
  if (!r || !(r.durationMs > 0)) return [];
  if (blockingHolder(state) !== null) return [];
  const seats = waitingOn(state);
  if (seats.length === 0) return [];
  const from = timerStartSeq(r);
  return [
    {
      key: `confirm:${r.id}:${from}`,
      fromSeq: from,
      afterMs: r.durationMs,
      emit: seats.map((seat) => ({ type: 'respond', round: r.id, seat, response: 'timeout' })),
    },
  ];
}

// ---- reducer handlers ----------------------------------------------------------------------------------------------

/** The current round values of a draft. */
function view(d: Draft): RoundState {
  return { seats: d.seats.result(), confirm: d.confirm };
}

/** The seq an action gets: its own once sequenced, else the next one (an optimistic apply). */
function seqOf(d: Draft, a: { seq?: number }): number {
  return a.seq ?? d.base.seq + 1;
}

function copyRound(r: Readonly<ConfirmRound>): ConfirmRound {
  return structuredClone(r) as ConfirmRound;
}

/**
 * Open a round `id` asked by the actor (DESIGN "Turn flow and confirmation", Start). Used by `ask` and by a
 * `stackPush` that carries `round`. Replaces any open round.
 */
export function startRound(d: Draft, a: { by: SeatId; seq?: number }, id: RoundId, about?: StackItemId, label?: string): void {
  const askedBy = d.seats.need(checkId(a.by, 'seat')).id;
  if (d.confirm?.id === id) reject(`round ${id} is already open`);
  const round: ConfirmRound = {
    id,
    askedBy,
    ...(about !== undefined ? { about } : {}),
    ...(label !== undefined && label !== '' ? { label } : {}),
    durationMs: d.settings.passTimerMs ?? 0,
    startSeq: seqOf(d, a),
    responses: {},
  };
  // Auto-pass: "pass until end of turn" answers OK as the round opens (DESIGN "Turn flow and confirmation", Auto-pass).
  for (const s of participants(view(d), round)) if (d.seats.need(s).autoPass) round.responses[s] = 'ok';
  d.setConfirm(round);
}

/** Start a round manually, optionally about a stack item and with a short label (DESIGN "Turn flow and confirmation", Start). */
export function ask(d: Draft, a: ActionOf<'ask'>): void {
  const id = checkId(a.round, 'round');
  let about: StackItemId | undefined;
  if (a.about !== undefined) {
    const sid = checkId(a.about, 'stack item');
    if (!d.stack.some((i) => i.id === sid)) reject(`unknown stack item ${sid}`);
    about = sid;
  }
  const label = a.label === undefined ? '' : checkString(a.label, 'label', ASK_LABEL_MAX).trim();
  startRound(d, a, id, about, label);
}

/** Answer the open round for `seat` (DESIGN "Turn flow and confirmation", Prompt, Hold, Implicit pass). */
export function respond(d: Draft, a: ActionOf<'respond'>): void {
  const id = checkId(a.round, 'round');
  const r = d.confirm;
  if (!r || r.id !== id) reject(`round ${id} is not open`);
  const response = a.response as unknown;
  if (typeof response !== 'string' || !(RESPONSES as readonly string[]).includes(response)) reject('invalid response');
  const resp = response as RespondResponse;
  const seat = d.seats.need(checkId(a.seat, 'seat')).id;
  if (resp !== 'timeout' && checkId(a.by, 'seat') !== seat) reject('a seat answers only for itself; only the sequencer times out a silent seat');
  const st = view(d);
  if (!participants(st, r).includes(seat)) reject(seat === r.askedBy ? 'the asker does not answer its own round' : `seat ${seat} is empty`);
  const current = own(r.responses, seat);
  const next = copyRound(r);
  switch (resp) {
    case 'ok':
      if (passedResponse(current)) return;
      next.responses[seat] = 'ok';
      if (r.holder === seat) {
        // OK from the holder releases the floor.
        delete next.holder;
        next.timerSeq = seqOf(d, a);
      }
      break;
    case 'hold': {
      if (r.holder === seat) return;
      const holder = blockingHolder(st);
      if (holder !== null) reject(`${holder} already holds the floor`);
      // A lapsed hold (its seat is away or left) is silent again: that seat times out with the others.
      if (r.holder !== undefined) delete next.responses[r.holder];
      next.responses[seat] = 'hold';
      next.holder = seat;
      // Hold clears "pass until end of turn" (DESIGN "Turn flow and confirmation", Auto-pass).
      if (d.seats.need(seat).autoPass) d.seats.w(seat).autoPass = false;
      break;
    }
    case 'release':
      if (r.holder !== seat) reject(`seat ${seat} does not hold the floor`);
      delete next.holder;
      next.responses[seat] = 'ok';
      next.timerSeq = seqOf(d, a);
      break;
    case 'timeout': {
      if (passedResponse(current)) reject(`seat ${seat} has already passed`);
      if (!(r.durationMs > 0)) reject('the pass timer is off for this round');
      const holder = blockingHolder(st);
      if (holder !== null) reject(`the timers are stopped while ${holder} holds the floor`);
      next.responses[seat] = 'timeout';
      if (r.holder === seat) delete next.holder;
      break;
    }
  }
  d.setConfirm(next);
}

/**
 * Toggle the actor's "pass until end of turn" (DESIGN "Turn flow and confirmation", Auto-pass). Turning it on also
 * passes the open round if the seat has not answered it yet. `turnPass` and a hold clear it.
 */
export function autoPass(d: Draft, a: ActionOf<'autoPass'>): void {
  if (typeof a.on !== 'boolean') reject('on must be a boolean');
  const seat = d.seats.need(checkId(a.by, 'seat'));
  if (seat.autoPass !== a.on) d.seats.w(seat.id).autoPass = a.on;
  const r = d.confirm;
  if (!a.on || !r || own(r.responses, seat.id) !== undefined || !participants(view(d), r).includes(seat.id)) return;
  const next = copyRound(r);
  next.responses[seat.id] = 'ok';
  d.setConfirm(next);
}
