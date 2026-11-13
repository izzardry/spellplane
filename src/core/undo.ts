/**
 * Personal undo as inverse actions (DESIGN "Turn flow and confirmation", Undo). Implementer: M0-P1.
 * `inverse(before, action)` returns an action that, applied to `reduce(before, action)`, restores a state whose hash
 * equals `stateHash(before)` (seq aside), or null when the action is not undoable (core/actions.ts isUndoable) or
 * changed nothing. The session dispatches it wrapped in `{type: 'undo', of: action.cid, inverse}`.
 *
 * The inverse is the natural opposite action (a draw is undone by putting the card back on top of the library, a
 * move by moving back), so the log can say what undo did. Effects the opposite action cannot bring back on its own
 * (a turn number, target lines removed with a resolved item, the identity a card lost in a hidden zone, a pile
 * re-laid around a new base) travel in its `restore` patch: compare-and-set steps computed by diffing, so an undo
 * after someone else changed the same values is refused instead of silently reverting their change.
 */
import { isUndoable, type Action, type RestorableCardField, type RestorePatch, type RestoreStep, type UndoableAction } from './actions';
import { canonicalJson } from './hash';
import { explain, reduce } from './reducer';
import { STACK_ZONE } from './reducer/place';
import { q } from './reducer/util';
import type { CardInstance, CardRef, InstanceId, TableState } from './types';

/**
 * A card that an undo brings back into a public zone without the identity it had there (M1-P2). A restore patch never
 * puts the identity of a committed card back, since the reducer cannot check it against the owner's commitment
 * (DESIGN "Specification: network protocol and secrecy", Commitments); the card comes back face down, and its owner
 * re-reveals it with its salt (`flip` up with `ref`/`salt` when it was face up, else `reveal`).
 */
export interface UndoReveal {
  card: InstanceId;
  /** The identity the card had before the undone action (public then). */
  ref: CardRef;
  /** Its face before the undone action. */
  face: 'up' | 'down';
}

/** An inverse and the re-reveals the card owners send after it (`UndoReveal`). */
export interface UndoPlan {
  inverse: UndoableAction;
  reveals: UndoReveal[];
}

/** The inverse of `action` given the state before it, or null (DESIGN "Turn flow and confirmation", Undo). */
export function inverse(before: TableState, action: Action): UndoableAction | null {
  return undoPlan(before, action)?.inverse ?? null;
}

/**
 * The inverse of `action` and the re-reveals it leaves to the cards' owners, or null when the action is not undoable.
 * Applied to `reduce(before, action)`, the inverse restores `withoutReveals(before, reveals)` (seq aside); the owners'
 * verified reveals then complete `before`.
 */
export function undoPlan(before: TableState, action: Action): UndoPlan | null {
  if (!isUndoable(action) || action.restore !== undefined) return null;
  if (explain(before, action) !== null) return null;
  const after = reduce(before, action);
  if (after === before) return null;
  const natural = opposite(before, after, action);
  if (!natural) return null;
  if (explain(after, natural) !== null) return null;
  const replayed = reduce(after, natural);
  const found = diff(before, replayed);
  if (!found) return null;
  const { patch, reveals } = found;
  const inv = Object.keys(patch).length ? ({ ...natural, restore: patch } as UndoableAction) : natural;
  // Guard: never hand out an inverse that does not restore the previous state.
  const undo: Action = { type: 'undo', by: action.by, cid: `check:${action.cid}`, of: action.cid, inverse: inv };
  if (explain(after, undo) !== null || undoKey(reduce(after, undo)) !== undoKey(withoutReveals(before, reveals))) return null;
  return { inverse: inv, reveals };
}

/** `state` with the identities that `reveals` name taken off their cards, which lie face down (what an undo leaves). */
export function withoutReveals(state: TableState, reveals: readonly UndoReveal[]): TableState {
  if (!reveals.length) return state;
  const cards = { ...state.cards };
  for (const r of reveals) {
    const c = Object.hasOwn(cards, r.card) ? cards[r.card] : undefined;
    if (!c) continue;
    const { identity: _dropped, ...rest } = c;
    cards[r.card] = { ...rest, face: 'down' };
  }
  return { ...state, cards };
}

/**
 * Comparison key of a state for undo: `seq` set aside, and identities of cards in hidden zones dropped. A card that
 * an undo returns to a hidden zone loses its identity there, as every public card returning to a hidden zone does
 * (DESIGN "Table model", Hidden cards), even when it had been revealed in that zone before.
 * The confirmation round is set aside too (M1-P3): answers are not undoable, and a round is not part of what an
 * action did to the table. Undoing a resolve or a counter brings the item back without the round that ended with it;
 * undoing a push ends the round about the item it took away (reducer/draft.ts `finish`), and a round it replaced
 * stays replaced.
 */
export function undoKey(state: TableState): string {
  const cards: Record<string, CardInstance> = {};
  for (const [id, c] of Object.entries(state.cards)) {
    if (c.identity !== undefined && state.zones[c.zone]?.visibility !== 'public') {
      const { identity: _dropped, ...rest } = c;
      cards[id] = rest;
    } else {
      cards[id] = c;
    }
  }
  return canonicalJson({ ...state, seq: 0, confirm: null, cards });
}

/** The natural opposite action, with `by` of the undoing seat and a derived cid. */
function opposite(before: TableState, after: TableState, a: UndoableAction): UndoableAction | null {
  const base = { by: a.by, cid: `undo:${a.cid}`, ...(a.group !== undefined ? { group: a.group } : {}) };
  const was = (id: string): CardInstance | undefined => (Object.hasOwn(before.cards, id) ? before.cards[id] : undefined);
  const now = (id: string): CardInstance | undefined => (Object.hasOwn(after.cards, id) ? after.cards[id] : undefined);

  /** Put card `id` back where it was before (zone, place, pose, pile, controller). */
  const putBack = (id: string): UndoableAction | null => {
    const c = was(id);
    if (!c) return null;
    const zone = before.zones[c.zone]!;
    if (zone.visibility !== 'public') return { ...base, type: 'toZone', card: id, to: c.zone, position: 'top' };
    if (c.zone === STACK_ZONE) {
      const it = before.stack.find((i) => i.card === id);
      if (!it) return null;
      return {
        ...base,
        type: 'stackPush',
        item: it.id,
        kind: it.kind,
        card: id,
        controller: it.controller,
        ...(it.source !== undefined ? { source: it.source } : {}),
        ...(it.note !== undefined ? { note: it.note } : {}),
      };
    }
    // A pile base that took its pile along (same zone, or battlefield to battlefield) takes it back the same way.
    const n = now(id);
    const wholePile = c.pile?.index === 0 && n?.pile?.id === c.pile.id && n.pile.index === 0;
    return {
      ...base,
      type: 'move',
      card: id,
      to: c.zone,
      pose: c.pose,
      index: zone.ids.indexOf(id),
      ...(wholePile ? {} : { pile: c.pile ?? null }),
      controller: c.controller,
    };
  };

  switch (a.type) {
    case 'move':
    case 'toZone':
      return putBack(a.card);
    case 'draw':
      return putBack(a.instanceId);
    case 'tap':
      return { ...base, type: 'tap', card: a.card, tapped: was(a.card)!.tapped };
    case 'flip':
      return { ...base, type: 'flip', card: a.card, face: was(a.card)!.face };
    case 'transform':
      return { ...base, type: 'transform', card: a.card, faceIndex: was(a.card)!.faceIndex };
    case 'rotate': {
      const c = was(a.card)!;
      const b = c.pile ? Object.values(before.cards).find((x) => x.pile?.id === c.pile!.id && x.pile.index === 0)! : c;
      const delta = q(b.pose.rot - after.cards[b.id]!.pose.rot);
      return { ...base, type: 'rotate', card: b.id, delta };
    }
    case 'counter': {
      const prev = count(was(a.card)!.counters, a.kind);
      const next = count(now(a.card)!.counters, a.kind);
      return { ...base, type: 'counter', card: a.card, kind: a.kind, delta: prev - next };
    }
    case 'note':
      return { ...base, type: 'note', card: a.card, text: was(a.card)!.note ?? '' };
    case 'attach':
    case 'detach': {
      const c = was(a.card)!;
      if (c.attachedTo !== undefined) return { ...base, type: 'attach', card: a.card, to: c.attachedTo, pose: c.pose };
      if (c.pile) return { ...base, type: 'pile', card: a.card, pile: c.pile, pose: c.pose };
      return { ...base, type: 'detach', card: a.card, pose: c.pose };
    }
    case 'pile': {
      const c = was(a.card)!;
      if (c.pile) return { ...base, type: 'pile', card: a.card, pile: c.pile, ...(c.pile.index === 0 ? { pose: c.pose } : {}) };
      return { ...base, type: 'pile', card: a.card, pile: null, pose: c.pose };
    }
    case 'tidy': {
      const poses: Record<string, CardInstance['pose']> = {};
      for (const id of Object.keys(after.cards).sort()) {
        const p = was(id);
        if (p && canonicalJson(p.pose) !== canonicalJson(after.cards[id]!.pose)) poses[id] = p.pose;
      }
      return { ...base, type: 'tidy', seat: a.seat, poses };
    }
    case 'createToken':
    case 'copy':
      return { ...base, type: 'remove', card: a.card };
    case 'remove': {
      const c = was(a.card)!;
      return {
        ...base,
        type: 'createToken',
        card: c.id,
        zone: c.zone,
        pose: c.pose,
        // createToken makes owner = controller; the restore patch puts back a different controller.
        controller: c.owner,
        ...(c.identity ? { ref: c.identity } : {}),
        // A face-down token whose identity was hidden has neither; the restore patch brings back its exact record.
        ...(c.tokenLabel !== undefined || !c.identity ? { label: c.tokenLabel ?? 'token' } : {}),
      };
    }
    case 'stackPush':
      if (a.kind === 'spell' && a.card !== undefined) return putBack(a.card);
      return { ...base, type: 'stackCounter', item: a.item };
    case 'stackNote':
      return { ...base, type: 'stackNote', item: a.item, note: before.stack.find((i) => i.id === a.item)?.note ?? '' };
    case 'stackResolve':
    case 'stackCounter': {
      const it = before.stack.find((i) => i.id === a.item)!;
      return {
        ...base,
        type: 'stackPush',
        item: it.id,
        kind: it.kind,
        controller: it.controller,
        ...(it.card !== undefined ? { card: it.card } : {}),
        ...(it.source !== undefined ? { source: it.source } : {}),
        ...(it.copyOf !== undefined ? { copyOf: it.copyOf } : {}),
        ...(it.note !== undefined ? { note: it.note } : {}),
      };
    }
    case 'stackReorder':
      return { ...base, type: 'stackReorder', item: a.item, index: before.stack.findIndex((i) => i.id === a.item) };
    case 'lineAdd':
      return { ...base, type: 'lineRemove', line: a.line };
    case 'lineRemove': {
      const l = before.lines[a.line]!;
      return { ...base, by: l.by, type: 'lineAdd', line: l.id, kind: l.kind, from: l.from, to: l.to, ...(l.label !== undefined ? { label: l.label } : {}) };
    }
    case 'phaseSet':
      return { ...base, type: 'phaseSet', phase: before.turn.phase };
    case 'turnPass':
      return { ...base, type: 'turnPass', to: before.turn.active };
    case 'life': {
      const seat = before.seats[a.seat]!;
      const team = seat.team !== undefined ? before.teams[seat.team] : undefined;
      const delta = team ? team.life - after.teams[team.id]!.life : seat.life - after.seats[a.seat]!.life;
      return { ...base, type: 'life', seat: a.seat, delta };
    }
    case 'playerCounter': {
      const prev = count(before.seats[a.seat]!.counters, a.kind);
      const next = count(after.seats[a.seat]!.counters, a.kind);
      return { ...base, type: 'playerCounter', seat: a.seat, kind: a.kind, delta: prev - next };
    }
    case 'moveTemp': {
      // Back to the previous pose; the patch drops the home slot and combat role and restores tap and pile.
      const c = was(a.card)!;
      return { ...base, type: 'moveTemp', card: a.card, pose: c.pose, ...(c.combat !== undefined ? { combat: c.combat } : {}) };
    }
    case 'settle':
      // Settling nothing changes nothing; the patch puts every settled card back where it was displaced to,
      // with its home slot and combat role, and brings back the attack and block lines.
      return { ...base, type: 'settle', cards: [] };
  }
}

function count(counters: Record<string, number>, kind: string): number {
  return Object.hasOwn(counters, kind) ? (counters[kind] ?? 0) : 0;
}

const RESTORABLE: ReadonlySet<string> = new Set<RestorableCardField>([
  'controller',
  'identity',
  'face',
  'faceIndex',
  'tapped',
  'pose',
  'home',
  'combat',
  'pile',
  'attachedTo',
  'counters',
  'note',
  'tokenLabel',
]);

function same(x: unknown, y: unknown): boolean {
  return x === y || (x !== undefined && y !== undefined && canonicalJson(x) === canonicalJson(y));
}

function stepOf<T>(expect: T | undefined, put: T | undefined): RestoreStep<T> {
  return { expect: expect === undefined ? null : structuredClone(expect), put: put === undefined ? null : structuredClone(put) };
}

/**
 * The compare-and-set steps that take `got` (the state the natural opposite leaves) back to `before`: an empty patch
 * when nothing is left to do, or null when the difference is outside what a restore patch may touch.
 */
function diff(before: TableState, got: TableState): { patch: RestorePatch; reveals: UndoReveal[] } | null {
  const patch: RestorePatch = {};
  const reveals: UndoReveal[] = [];
  const ids = (a: object, b: object): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  const cards: NonNullable<RestorePatch['cards']> = {};
  for (const id of ids(before.cards, got.cards)) {
    const b = Object.hasOwn(before.cards, id) ? before.cards[id] : undefined;
    const g = Object.hasOwn(got.cards, id) ? got.cards[id] : undefined;
    if (same(b, g)) continue;
    if (!b || !g) return null;
    const hidden = got.zones[g.zone]?.visibility !== 'public';
    // A committed card's identity is never put back by a patch (the reducer could not verify it): the card stays face
    // down and its owner re-reveals it (UndoReveal).
    const reveal = !hidden && g.isToken !== true && b.identity !== undefined && g.identity === undefined;
    if (reveal) reveals.push({ card: id, ref: structuredClone(b.identity!), face: b.face });
    const fields: Record<string, RestoreStep<unknown>> = {};
    const br = b as unknown as Record<string, unknown>;
    const gr = g as unknown as Record<string, unknown>;
    for (const f of ids(b, g)) {
      if (same(br[f], gr[f])) continue;
      if (hidden && f === 'identity') continue; // dropped in a hidden zone (see undoKey)
      if (reveal && (f === 'identity' || f === 'face')) continue; // left to the owner's verified reveal
      if (hidden || !RESTORABLE.has(f)) return null;
      fields[f] = stepOf(gr[f], br[f]);
    }
    if (Object.keys(fields).length) cards[id] = fields as NonNullable<RestorePatch['cards']>[string];
  }
  if (Object.keys(cards).length) patch.cards = cards;

  const zones: NonNullable<RestorePatch['zones']> = {};
  for (const id of ids(before.zones, got.zones)) {
    const b = before.zones[id];
    const g = got.zones[id];
    if (same(b, g)) continue;
    if (!b || !g || b.visibility !== 'public' || !same({ ...b, ids: [] }, { ...g, ids: [] })) return null;
    zones[id] = stepOf(g.ids, b.ids);
  }
  if (Object.keys(zones).length) patch.zones = zones;

  const lines: NonNullable<RestorePatch['lines']> = {};
  for (const id of ids(before.lines, got.lines)) {
    const b = Object.hasOwn(before.lines, id) ? before.lines[id] : undefined;
    const g = Object.hasOwn(got.lines, id) ? got.lines[id] : undefined;
    if (!same(b, g)) lines[id] = stepOf(g, b);
  }
  if (Object.keys(lines).length) patch.lines = lines;

  if (!same(before.stack, got.stack)) patch.stack = stepOf(got.stack, before.stack);

  if (before.turn.active !== got.turn.active || before.turn.phase !== got.turn.phase) return null;
  if (before.turn.number !== got.turn.number) patch.turn = { number: stepOf(got.turn.number, before.turn.number) };

  const seats: NonNullable<RestorePatch['seats']> = {};
  for (const id of ids(before.seats, got.seats)) {
    const b = before.seats[id];
    const g = got.seats[id];
    if (same(b, g)) continue;
    if (!b || !g || !same({ ...b, autoPass: false }, { ...g, autoPass: false })) return null;
    seats[id] = { autoPass: stepOf(g.autoPass, b.autoPass) };
  }
  if (Object.keys(seats).length) patch.seats = seats;

  if (!same(before.teams, got.teams)) return null;
  return { patch, reveals };
}

// --- M5-P6: undo hardening ----------------------------------------------------------------------------------------

/**
 * What an action changed on the table, as object keys: `card:<id>` for every card whose record changed, `line:<id>`
 * for every line added, removed or changed (and `card:<id>` for the cards it is anchored on), `item:<id>` for every
 * stack item pushed, removed or changed (and its card and source), and `turn` when the turn marker moved. Zone orders,
 * life totals, player counters and the confirmation round are left out: a change of their order or a delta on them
 * composes with an undo and builds on nothing (M5-P6). Pure.
 */
export function changedObjects(before: TableState, after: TableState): string[] {
  if (before === after) return [];
  const out = new Set<string>();
  const keys = (a: object, b: object): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const anchored = (x: { from: { kind: string; id: string }; to: { kind: string; id: string } } | undefined): void => {
    if (!x) return;
    for (const end of [x.from, x.to]) if (end.kind === 'card') out.add(`card:${end.id}`);
  };
  if (before.cards !== after.cards) {
    for (const id of keys(before.cards, after.cards)) {
      const b = Object.hasOwn(before.cards, id) ? before.cards[id] : undefined;
      const a = Object.hasOwn(after.cards, id) ? after.cards[id] : undefined;
      if (b !== a && !same(b, a)) out.add(`card:${id}`);
    }
  }
  if (before.lines !== after.lines) {
    for (const id of keys(before.lines, after.lines)) {
      const b = Object.hasOwn(before.lines, id) ? before.lines[id] : undefined;
      const a = Object.hasOwn(after.lines, id) ? after.lines[id] : undefined;
      if (b === a || same(b, a)) continue;
      out.add(`line:${id}`);
      anchored(b);
      anchored(a);
    }
  }
  if (before.stack !== after.stack) {
    const was = new Map(before.stack.map((i) => [i.id, i] as const));
    const now = new Map(after.stack.map((i) => [i.id, i] as const));
    for (const id of new Set([...was.keys(), ...now.keys()])) {
      const b = was.get(id);
      const a = now.get(id);
      if (same(b, a) && before.stack.indexOf(b!) === after.stack.indexOf(a!)) continue;
      out.add(`item:${id}`);
      for (const it of [b, a]) {
        if (it?.card !== undefined) out.add(`card:${it.card}`);
        if (it?.source !== undefined) out.add(`card:${it.source}`);
      }
    }
  }
  if (before.turn.active !== after.turn.active || before.turn.phase !== after.turn.phase || before.turn.number !== after.turn.number) out.add('turn');
  return [...out].sort();
}

/** Another seat's sequenced action and what it changed (`changedObjects`), for `builtOn`. */
export interface OthersChange {
  seq: number;
  by: string;
  changed: readonly string[];
}

/**
 * The first action of another seat, sequenced after `entry` (at `entry.seq`), that changed something `entry` changed:
 * it built on the action, and undoing it would silently take that player's change back too (DESIGN "Turn flow and
 * confirmation": personal undo, no table-wide rewind). Null when nothing did, or when `entry` is not sequenced yet
 * (nobody can have built on it then). Pure.
 */
export function builtOn(entry: { seq?: number | undefined; changed: readonly string[] }, others: readonly OthersChange[]): (OthersChange & { object: string }) | null {
  if (entry.seq === undefined || entry.changed.length === 0) return null;
  const mine = new Set(entry.changed);
  for (const o of others) {
    if (o.seq <= entry.seq) continue;
    const object = o.changed.find((k) => mine.has(k));
    if (object !== undefined) return { ...o, object };
  }
  return null;
}

/** One undo step rebuilt from a stored log (`undoStackFromLog`). */
export interface LoggedUndo {
  cid: string;
  group?: string;
  seq: number;
  inverse: UndoableAction;
  reveals: UndoReveal[];
  /** What the action changed (`changedObjects`). */
  changed: string[];
  /** A draw: the card drawn, which its undo puts back on top of the library. */
  drew?: InstanceId;
}

/**
 * Own actions after which nothing before them can be undone (DESIGN "Turn flow and confirmation", Undo: shuffles cannot
 * be undone; session/net.ts and session/solo.ts clear their undo stack at the same points): Ready, a shuffle, a
 * mulligan (it contains a shuffle) and a lost-save recovery. On the solo table a private reorder of a whole zone (its
 * shuffle) is one too (`undoStackFromLog` with `soloShuffles`).
 */
const UNDO_BARRIERS: ReadonlySet<string> = new Set(['ready', 'shuffleCommit', 'mulligan', 'recover', 'recoverCommit']);

/**
 * The undo stack of `seat` as the stored log leaves it (M5-P6: undo after a reload), and every other seat's change
 * since `start` (for `builtOn`). `start` is the stored snapshot and `log` the sequenced actions after it, in order
 * (gap-free; replay stops at the first that does not follow). The stack holds the seat's undoable actions since its
 * last barrier, minus those it already undid, each with the inverse planned on the state right before it; the draws of
 * a mulligan or a recovery are part of it and stay off the stack, and steps that name ids a re-issue retired are
 * dropped, as the live session does. `soloShuffles`: the log is a solo table's, whose shuffle is a private reorder of
 * the whole zone (session/solo.ts shuffleNow); in a networked log the same shape is a scry or a reorder of a whole
 * small zone, which the live session does not clear its stack for. Pure.
 */
export function undoStackFromLog(start: TableState, log: readonly Action[], seat: string, opts: { soloShuffles?: boolean } = {}): { stack: LoggedUndo[]; others: OthersChange[] } {
  let stack: LoggedUndo[] = [];
  const others: OthersChange[] = [];
  let s = start;
  /**
   * The draws a mulligan makes belong to it (the sessions clear the stack after them): undefined when none are owed,
   * null while owed and not started, else the group of those draws ('' for a single draw).
   */
  let owed: string | null | undefined;
  /** The hand count of the own `recover` last seen (its `recoverCommit` owes that many draws). */
  let recoverHand = 0;
  /**
   * The draws a recovery still owes (session/net.ts finishNow draws until the agreed hand, in as many groups as its
   * retries take, and clears the stack once the hand is full): undefined when none are owed.
   */
  let recoveryLeft: number | undefined;
  for (const a of log) {
    if (a.seq !== s.seq + 1) break;
    const before = s;
    const next = reduce(before, a);
    s = next.seq === a.seq ? next : { ...next, seq: a.seq };
    if (a.by !== seat) {
      if (s !== before) others.push({ seq: a.seq, by: a.by, changed: changedObjects(before, s) });
      continue;
    }
    if (a.type === 'recover') recoverHand = a.hand;
    if (UNDO_BARRIERS.has(a.type)) {
      stack = [];
      if (a.type === 'mulligan') owed = null;
      if (a.type === 'recoverCommit') {
        owed = undefined;
        recoveryLeft = recoverHand > 0 ? recoverHand : undefined;
      }
      continue;
    }
    if (recoveryLeft !== undefined) {
      if (a.type === 'draw') {
        recoveryLeft--;
        if (recoveryLeft <= 0) {
          // The hand is full: the recovery is over, and the live session clears its stack (none of its draws, nor
          // anything made meanwhile, can be undone).
          recoveryLeft = undefined;
          stack = [];
        }
        continue;
      }
      // Any other own step but the recovery's shuffle ends it (a recovery that fell short, finished by hand).
      if (a.type !== 'shuffleDone' && a.type !== 'shuffleNonce' && a.type !== 'reorder') recoveryLeft = undefined;
    }
    if (a.type === 'draw' && owed !== undefined) {
      // The first draw after it starts them: a group of draws, or one draw alone.
      if (owed === null) {
        owed = a.group ?? '';
        if (owed === '') owed = undefined;
        continue;
      }
      if (a.group === owed) continue;
      owed = undefined;
    } else if (a.type !== 'shuffleDone' && a.type !== 'reorder') {
      owed = undefined;
    }
    if (a.type === 'undo') {
      stack = stack.filter((e) => e.cid !== a.of);
      continue;
    }
    // The solo table's shuffle is a private reorder of the whole zone (session/solo.ts shuffleNow): a barrier too.
    if (opts.soloShuffles === true && a.type === 'reorder' && a.reissue === undefined && a.count > 1 && a.count === (before.zones[a.zone]?.ids.length ?? -1)) {
      stack = [];
      continue;
    }
    if (a.type === 'reorder' && a.reissue !== undefined) {
      const retired = before.zones[a.zone]?.ids ?? [];
      stack = stack.filter((e) => {
        const text = canonicalJson(e.inverse);
        return !retired.some((id) => text.includes(id));
      });
      continue;
    }
    if (!isUndoable(a)) continue;
    const { seq: _seq, ...unsequenced } = a;
    const plan = undoPlan(before, unsequenced as Action);
    if (!plan) continue;
    stack.push({
      cid: a.cid,
      ...(a.group !== undefined ? { group: a.group } : {}),
      seq: a.seq,
      inverse: plan.inverse,
      reveals: plan.reveals,
      changed: changedObjects(before, s),
      ...(a.type === 'draw' ? { drew: a.instanceId } : {}),
    });
  }
  return { stack, others };
}
