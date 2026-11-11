/**
 * Personal undo as inverse actions (DESIGN "Turn flow and confirmation", Undo). Implementer: M0-P1.
 * `inverse(before, action)` returns an action that, applied to `reduce(before, action)`, restores a state whose hash
 * equals `stateHash(before)` (seq aside), or null when the action is not undoable (core/actions.ts isUndoable) or
 * changed nothing. The session dispatches it wrapped in `{type: 'undo', of: action.cid, inverse}`.
 *
 * The inverse is the natural opposite action (a draw is undone by putting the card back on top of the library, a
 * move by moving back), so the log can say what undo did. Effects the opposite action cannot bring back on its own
 * (a turn number, target lines removed with a resolved item, the identity a card lost in a hidden zone, a pile
 * re-laid around a new base) travel in its `restore` patch: the exact prior public records, computed by diffing.
 */
import { isUndoable, type Action, type RestorePatch, type UndoableAction } from './actions';
import { canonicalJson } from './hash';
import { explain, reduce } from './reducer';
import { STACK_ZONE } from './reducer/place';
import { q } from './reducer/util';
import type { CardInstance, TableState } from './types';

/** The inverse of `action` given the state before it, or null (DESIGN "Turn flow and confirmation", Undo). */
export function inverse(before: TableState, action: Action): UndoableAction | null {
  if (!isUndoable(action) || action.restore !== undefined) return null;
  if (explain(before, action) !== null) return null;
  const after = reduce(before, action);
  if (after === before) return null;
  const natural = opposite(before, after, action);
  if (!natural) return null;
  if (explain(after, natural) !== null) return null;
  const replayed = reduce(after, natural);
  const patch = diff(before, replayed);
  const inv = patch ? ({ ...natural, restore: patch } as UndoableAction) : natural;
  // Guard: never hand out an inverse that does not restore the previous state.
  const check = reduce(after, inv);
  if (canonicalJson({ ...check, seq: 0 }) !== canonicalJson({ ...before, seq: 0 })) return null;
  return inv;
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
    return {
      ...base,
      type: 'move',
      card: id,
      to: c.zone,
      pose: c.pose,
      index: zone.ids.indexOf(id),
      pile: c.pile ?? null,
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
        controller: c.controller,
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
    case 'moveTemp':
    case 'settle':
      // M1-P4: not applied by the reducer yet, so never reached.
      return null;
  }
}

function count(counters: Record<string, number>, kind: string): number {
  return Object.hasOwn(counters, kind) ? (counters[kind] ?? 0) : 0;
}

/** The prior records that differ between `before` and `got`, or null when they already match. */
function diff(before: TableState, got: TableState): RestorePatch | null {
  const patch: RestorePatch = {};
  const same = (x: unknown, y: unknown): boolean => x === y || (x !== undefined && y !== undefined && canonicalJson(x) === canonicalJson(y));
  const records = <T>(b: Record<string, T>, g: Record<string, T>, nullable: boolean): Record<string, T | null> | null => {
    const out: Record<string, T | null> = {};
    for (const id of new Set([...Object.keys(b), ...Object.keys(g)])) {
      const bv = Object.hasOwn(b, id) ? b[id] : undefined;
      const gv = Object.hasOwn(g, id) ? g[id] : undefined;
      if (same(bv, gv)) continue;
      if (bv === undefined && !nullable) continue;
      out[id] = bv === undefined ? null : structuredClone(bv);
    }
    return Object.keys(out).length ? out : null;
  };
  const cards = records(before.cards, got.cards, true);
  if (cards) patch.cards = cards;
  const zones = records(before.zones, got.zones, false);
  if (zones) patch.zones = zones as RestorePatch['zones'];
  const lines = records(before.lines, got.lines, true);
  if (lines) patch.lines = lines;
  const seats = records(before.seats, got.seats, false);
  if (seats) patch.seats = seats as RestorePatch['seats'];
  const teams = records(before.teams, got.teams, false);
  if (teams) patch.teams = teams as RestorePatch['teams'];
  if (!same(before.stack, got.stack)) patch.stack = structuredClone(before.stack);
  if (!same(before.turn, got.turn)) patch.turn = { ...before.turn };
  return Object.keys(patch).length ? patch : null;
}
