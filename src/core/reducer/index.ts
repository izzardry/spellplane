/**
 * The reducer (DESIGN "Specification: code interfaces", Reducer contract).
 * `reduce` is pure and total: an action that does not apply returns the state unchanged (same object),
 * with the reason available from `explain`. It never reads the clock, randomness or the secret store.
 *
 * Later packages add their cases to HANDLERS: moveTemp and settle (M1-P4, temp.ts), ask, respond and autoPass
 * (M1-P3, confirm.ts), the secret shuffle and public randomness (M1-P2), draft actions (M2).
 */
import { ACTION_FAMILIES, UNDOABLE_TYPES, type Action, type ActionOf, type ActionType, type RestorePatch } from '../actions';
import { checkInvariants } from '../invariants';
import type { CoreGameSpec, Format, SeatColourIndex, TableState, Team, Zone } from '../types';
import { DEFAULT_TABLE_SETTINGS } from '../types';
import { seatIdOf, zoneId } from '../ids';
import * as cards from './cards';
import { Draft } from './draft';
import { STACK_ZONE } from './place';
import * as stack from './stack';
import * as table from './table';
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
  moveTemp: later('M1-P4'),
  settle: later('M1-P4'),
  tap: cards.tap,
  flip: cards.flip,
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
  reveal: zones.reveal,
  revealTo: zones.revealTo,
  hide: zones.hide,
  shuffleCommit: later('M1-P2'),
  shuffleNonce: later('M1-P2'),
  shuffleDone: later('M1-P2'),
  reorder: zones.reorder,
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
  ask: later('M1-P3'),
  respond: later('M1-P3'),
  autoPass: later('M1-P3'),
  life: table.life,
  playerCounter: table.playerCounter,
  seatTake: table.seatTake,
  seatLeave: table.seatLeave,
  ready: table.ready,
  rngCommit: later('M1-P2'),
  rngReveal: later('M1-P2'),
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
};

const UNDOABLE = new Set<string>(UNDOABLE_TYPES);

function applyUndo(d: Draft, a: ActionOf<'undo'>): void {
  checkString(a.of);
  const inv: unknown = a.inverse;
  if (!isObj(inv) || typeof inv.type !== 'string' || !UNDOABLE.has(inv.type)) reject('undo carries an action that is not undoable');
  apply(d, inv as unknown as Action);
}

function checkString(v: unknown): void {
  if (typeof v !== 'string') reject('undo needs the cid it reverts');
}

/** Run one action's handler, then its restore patch when it is an inverse. */
function apply(d: Draft, a: Action): void {
  const handler = HANDLERS[a.type] as Handler<ActionType>;
  handler(d, a as ActionOf<ActionType>);
  if (a.restore !== undefined) {
    if (!UNDOABLE.has(a.type)) reject('only undoable actions carry a restore patch');
    applyRestore(d, a.restore);
  }
}

function applyRestore(d: Draft, patch: RestorePatch): void {
  if (!isObj(patch)) reject('invalid restore patch');
  const rec = (v: unknown, what: string): Record<string, unknown> => {
    if (v === undefined) return {};
    if (!isObj(v)) reject(`invalid restore ${what}`);
    return v;
  };
  for (const [id, v] of Object.entries(rec(patch.cards, 'cards'))) {
    checkId(id, 'card');
    if (v === null) d.cards.delete(id);
    else if (isObj(v)) d.cards.set(id, structuredClone(v) as never);
    else reject('invalid restore card');
  }
  for (const [id, v] of Object.entries(rec(patch.zones, 'zones'))) {
    checkId(id, 'zone');
    if (!d.zones.has(id) || !isObj(v)) reject('a restore patch only replaces existing zones');
    d.zones.set(id, structuredClone(v) as never);
  }
  for (const [id, v] of Object.entries(rec(patch.lines, 'lines'))) {
    checkId(id, 'line');
    if (v === null) d.lines.delete(id);
    else if (isObj(v)) d.lines.set(id, structuredClone(v) as never);
    else reject('invalid restore line');
  }
  for (const [id, v] of Object.entries(rec(patch.seats, 'seats'))) {
    if (!d.seats.has(checkId(id, 'seat')) || !isObj(v)) reject('a restore patch only replaces existing seats');
    d.seats.set(id, structuredClone(v) as never);
  }
  for (const [id, v] of Object.entries(rec(patch.teams, 'teams'))) {
    if (!d.teams.has(checkId(id, 'team')) || !isObj(v)) reject('a restore patch only replaces existing teams');
    d.teams.set(id, structuredClone(v) as never);
  }
  if (patch.stack !== undefined) {
    if (!Array.isArray(patch.stack)) reject('invalid restore stack');
    d.setStack(structuredClone(patch.stack));
  }
  if (patch.turn !== undefined) {
    if (!isObj(patch.turn)) reject('invalid restore turn');
    Object.assign(d.turnW(), structuredClone(patch.turn));
  }
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
    const d = new Draft(state);
    apply(d, action);
    const next = d.finish(action.seq);
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
  return a.restore !== undefined || (a.type === 'undo' && isObj(a.inverse) && a.inverse.restore !== undefined);
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
