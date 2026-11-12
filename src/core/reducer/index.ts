/**
 * The reducer (DESIGN "Specification: code interfaces", Reducer contract).
 * `reduce` is pure and total: an action that does not apply returns the state unchanged (same object),
 * with the reason available from `explain`. It never reads the clock, randomness or the secret store.
 *
 * Later packages add their cases to HANDLERS: ask, respond and autoPass (M1-P3, confirm.ts), draft actions (M2). The
 * secret shuffle, public randomness and verified reveals are M1-P2's (secret.ts). M1-P4 extends moveTemp and settle in temp.ts.
 */
import { ACTION_FAMILIES, isUndoable, type Action, type ActionOf, type ActionType } from '../actions';
import { checkInvariants } from '../invariants';
import type { CoreGameSpec, Format, SeatColourIndex, TableState, Team, Zone } from '../types';
import { DEFAULT_TABLE_SETTINGS } from '../types';
import { seatIdOf, zoneId } from '../ids';
import * as cards from './cards';
import * as confirm from './confirm';
import { Draft } from './draft';
import { STACK_ZONE } from './place';
import * as stack from './stack';
import * as table from './table';
import * as recovery from './recovery';
import { applyRestore } from './restore';
import * as secret from './secret';
import * as temp from './temp';
import { Rejection, checkId, isObj, reject } from './util';
import * as zones from './zones';

export { STACK_ZONE, ZONE_KIND, HIDDEN_POSE } from './place';
export { cardAxes, pileMemberPose, tuckPose } from './util';

/** A seat to create at table start (DESIGN "Players, seats and formats"). */
export interface SeatInit {
  name: string;
  colour: SeatColourIndex;
  team?: string;
  peer?: string;
}

/** Options for a fresh table (DESIGN "Data model and protocol"). */
export interface CreateTableOptions {
  game: CoreGameSpec;
  format: Format;
  /** In seat-index order; seat ids become 's0'..'s3' (core/ids.ts seatIdOf). */
  seats: SeatInit[];
}

type Handler<T extends ActionType> = (d: Draft, a: ActionOf<T>) => void;

const later =
  (pkg: string) =>
  (_d: Draft, a: Action): void =>
    reject(`${a.type} is not implemented yet (${pkg})`);

/** Public record only: valid when its references exist, no change to shared state. */
const record = (): void => undefined;

const HANDLERS: { [T in ActionType]: Handler<T> } = {
  move: cards.move,
  moveTemp: temp.moveTemp,
  settle: temp.settle,
  tap: cards.tap,
  flip: secret.flip,
  transform: cards.transform,
  rotate: cards.rotate,
  counter: cards.counter,
  note: cards.note,
  attach: cards.attach,
  detach: cards.detach,
  pile: cards.pile,
  tidy: cards.tidy,
  createToken: cards.createToken,
  copy: cards.copy,
  remove: cards.remove,
  toZone: zones.toZone,
  draw: zones.draw,
  reveal: secret.reveal,
  revealTo: zones.revealTo,
  hide: zones.hide,
  shuffleCommit: secret.shuffleCommit,
  shuffleNonce: secret.shuffleNonce,
  shuffleDone: secret.shuffleDone,
  reorder: secret.reorder,
  lookAt: zones.lookAt,
  mulligan: zones.mulligan,
  stackPush: stack.stackPush,
  stackNote: stack.stackNote,
  stackResolve: stack.stackResolve,
  stackCounter: stack.stackCounter,
  stackReorder: stack.stackReorder,
  lineAdd: table.lineAdd,
  lineRemove: table.lineRemove,
  ping: table.ping,
  phaseSet: table.phaseSet,
  turnPass: table.turnPass,
  ask: confirm.ask,
  respond: confirm.respond,
  autoPass: confirm.autoPass,
  life: table.life,
  playerCounter: table.playerCounter,
  seatTake: table.seatTake,
  seatLeave: table.seatLeave,
  ready: table.ready,
  away: table.away,
  rngCommit: secret.rngCommit,
  rngReveal: secret.rngReveal,
  commitClose: secret.commitClose,
  packOpen: later('M2'),
  pick: later('M2'),
  packPass: later('M2'),
  pileLook: later('M2'),
  gridTake: later('M2'),
  chat: record,
  caption: record,
  undo: applyUndo,
  snapshotHash: record,
  sequencerClaim: record,
  settings: table.settings,
  stageSet: table.stageSet,
  recover: recovery.recover,
  recoverCommit: recovery.recoverCommit,
};

/**
 * `undo {of, inverse}`: apply the inverse. The handlers authorise on the inverse's own `by`, so it must be the undo's
 * sender (DESIGN "Specification: network protocol and secrecy", Handshake: the sequencer rejects any propose whose
 * `by` is not the sender's seat; checking only the outer `by` would let a seat act, and reveal, in another's name),
 * except a `lineAdd` that restores a removed line with its creator. An inverse never carries an identity (`isUndoable`: a flip with `ref` is a reveal, not an inverse).
 */
function applyUndo(d: Draft, a: ActionOf<'undo'>): void {
  checkString(a.of);
  const inv: unknown = a.inverse;
  if (!isObj(inv) || typeof inv.type !== 'string' || !isUndoable(inv as unknown as Action)) reject('undo carries an action that is not undoable');
  // The one exception is a removed line coming back: its `by` names the line's creator and authorises nothing.
  if (inv.by !== a.by && inv.type !== 'lineAdd') reject('an undo carries an inverse in its own sender\'s name only');
  const inverse = inv as unknown as Action;
  handle(d, inverse);
  if (inverse.restore !== undefined) applyRestore(d, inverse.restore);
}

function checkString(v: unknown): void {
  if (typeof v !== 'string') reject('undo needs the cid it reverts');
}

function handle(d: Draft, a: Action): void {
  const handler = HANDLERS[a.type] as Handler<ActionType>;
  handler(d, a as ActionOf<ActionType>);
}

interface Step {
  state: TableState;
  reason: string | null;
}

function step(state: TableState, action: Action): Step {
  try {
    if (!isObj(action)) reject('an action must be an object');
    if (typeof action.type !== 'string' || !Object.hasOwn(ACTION_FAMILIES, action.type)) reject(`unknown action type ${String(action.type)}`);
    checkId(action.by, 'actor');
    if (typeof action.cid !== 'string') reject('an action needs a cid');
    if (action.seq !== undefined && (typeof action.seq !== 'number' || !Number.isInteger(action.seq) || action.seq < 0)) reject('invalid seq');
    // A restore patch only travels on the inverse inside an `undo` (applyUndo).
    if (action.restore !== undefined) reject('only the inverse inside an undo carries a restore patch');
    // Only a seat itself, or anyone once the sequencer marked it away, empties its chair (M1-P2, secret.ts).
    secret.checkSeatLeave(state, action);
    const d = new Draft(state);
    handle(d, action);
    const changed = d.finish(action.seq);
    // A round completed by this step (whatever the action) is sealed in it (M1-P2, secret.ts).
    const next = changed === state ? changed : secret.sealCompleteRounds(changed, action.seq ?? state.seq + 1);
    // A zone being shuffled with a fixed seed keeps its cards until the shuffle is done (M1-P2, secret.ts).
    if (next !== state) secret.checkFrozenZones(state, next, action);
    // A round's own owner or initiator cannot stop it waiting for a peer (M1-P2, secret.ts).
    if (next !== state) secret.checkRoundParticipants(state, next, action);
    if (hasRestore(action) && next !== state) {
      const broken = checkInvariants(next);
      if (broken.length) reject(`the restore patch would break the table: ${broken[0]}`);
    }
    return { state: next, reason: null };
  } catch (e) {
    if (e instanceof Rejection) return { state, reason: e.message };
    // Totality: a malformed action must never take the table down. Tests assert this path is never hit.
    return { state, reason: `internal error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function hasRestore(a: Action): boolean {
  return a.type === 'undo' && isObj(a.inverse) && a.inverse.restore !== undefined;
}

/** Apply one action; pure and total (DESIGN "Specification: code interfaces", Reducer contract). */
export function reduce(state: TableState, action: Action): TableState {
  return step(state, action).state;
}

/** Why `action` does not apply to `state`, or null if it applies (DESIGN "Specification: code interfaces", Reducer contract). */
export function explain(state: TableState, action: Action): string | null {
  return step(state, action).reason;
}

/** A fresh table at seq 0 with seats, teams, every zone of the game definition and the first phase (DESIGN "Data model and protocol"). */
export function createTable(opts: CreateTableOptions): TableState {
  if (opts.seats.length < 1 || opts.seats.length > 4) throw new RangeError('a table has one to four seats');
  const life = opts.game.startingLife(opts.format);
  const seats: TableState['seats'] = {};
  const teams: Record<string, Team> = {};
  opts.seats.forEach((init, index) => {
    const id = seatIdOf(index);
    seats[id] = {
      id,
      index,
      name: init.name,
      colour: init.colour,
      ...(init.team !== undefined ? { team: init.team } : {}),
      life,
      counters: {},
      ready: false,
      autoPass: false,
      ...(init.peer !== undefined ? { peer: init.peer } : {}),
    };
    if (init.team !== undefined) {
      const t = teams[init.team] ?? (teams[init.team] = { id: init.team, seats: [], life, counters: {} });
      t.seats.push(id);
    }
  });
  const zones: Record<string, Zone> = {};
  const add = (kind: string, owner: string | null, visibility: 'public' | 'owner' | 'nobody'): void => {
    const id = zoneId(kind, owner);
    zones[id] = visibility === 'public' ? { id, kind, owner, visibility, ids: [] } : { id, kind, owner, visibility, count: 0, ids: [] };
  };
  for (const spec of opts.game.zones) {
    if (spec.scope === 'table') add(spec.id, null, spec.visibility);
    else for (const s of Object.keys(seats)) add(spec.id, s, spec.visibility);
  }
  if (!zones[STACK_ZONE]) add(STACK_ZONE, null, 'public');
  const first = seats.s0!;
  return {
    seq: 0,
    game: opts.game.id,
    format: opts.format,
    stage: 'lobby',
    seats,
    teams,
    cards: {},
    zones,
    stack: [],
    lines: {},
    turn: { number: 1, active: first.team ?? first.id, phase: opts.game.phases[0]?.id ?? '' },
    confirm: null,
    commitments: {},
    rng: {},
    shuffles: {},
    settings: { ...DEFAULT_TABLE_SETTINGS },
  };
}
