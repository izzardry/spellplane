/**
 * Applying an undo's restore patch (DESIGN "Turn flow and confirmation", Undo: "reverts the player's own most recent
 * actions ... There is no table-wide rewind"; "Specification: code interfaces", Reducer contract).
 *
 * The patch is compare-and-set: every step names the value the inverse action leaves and the prior value to put
 * back, and the undo is refused when the table no longer holds the expected value (someone else changed it since).
 * It can only reach what an inverse action cannot rebuild on its own: listed fields of existing cards in public
 * zones, the draw order of public zones, lines, the stack, the turn number and auto-pass flags. Every value it puts
 * is validated like an action field; the reducer checks the table invariants afterwards.
 */
import type { RestorableCardField, RestorePatch } from '../actions';
import { canonicalJson } from '../hash';
import type { CardInstance, Line, StackItem } from '../types';
import type { Draft } from './draft';
import { isHidden } from './place';
import { checkAnchor, checkId, checkInt, checkPileRef, checkPose, checkRef, checkString, isObj, reject } from './util';

const PATCH_KEYS = new Set(['cards', 'zones', 'lines', 'stack', 'turn', 'seats']);
const LINE_KINDS: readonly string[] = ['target', 'attack', 'block', 'attach', 'mark'];
const ITEM_KINDS: readonly string[] = ['spell', 'ability', 'trigger', 'copy'];
const ITEM_KEYS = new Set(['id', 'kind', 'controller', 'card', 'source', 'copyOf', 'note']);
const LINE_KEYS = new Set(['id', 'kind', 'from', 'to', 'by', 'label']);

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

interface Step {
  expect: unknown;
  put: unknown;
}

function step(v: unknown, what: string): Step {
  if (!isObj(v) || !Object.hasOwn(v, 'expect') || !Object.hasOwn(v, 'put') || Object.keys(v).length !== 2) reject(`invalid restore step for ${what}`);
  return { expect: v.expect, put: v.put };
}

/** Compare-and-set guard: the current value (absent = null) must equal the step's `expect`. */
function expectNow(current: unknown, s: Step, what: string): void {
  if (!sameJson(current ?? null, s.expect)) reject(`undo is stale: ${what} changed since`);
}

function entries(v: unknown, what: string): [string, unknown][] {
  if (v === undefined) return [];
  if (!isObj(v)) reject(`invalid restore ${what}`);
  return Object.entries(v);
}

function nonEmpty(v: unknown, what: string, max: number): string {
  const s = checkString(v, what, max);
  if (s === '') reject(`invalid ${what}`);
  return s;
}

function counters(v: unknown): Record<string, number> {
  if (!isObj(v)) reject('invalid restore counters');
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (k === '' || k === '__proto__' || k.length > 64) reject('invalid counter kind');
    out[k] = checkInt(n, 'counter', 1, 1e9);
  }
  return out;
}

type FieldCheck = (d: Draft, c: CardInstance, v: unknown) => unknown;

/** Validators for the card fields a patch may put; `optional` fields may be put back to absent (null). */
const CARD_FIELDS: Record<RestorableCardField, { optional: boolean; check: FieldCheck }> = {
  controller: { optional: false, check: (d, _c, v) => d.seats.need(checkId(v, 'seat')).id },
  identity: { optional: true, check: (_d, _c, v) => checkRef(v) },
  face: { optional: false, check: (_d, _c, v) => (v === 'up' || v === 'down' ? v : reject('face must be up or down')) },
  faceIndex: { optional: false, check: (_d, _c, v) => (v === 0 || v === 1 ? v : reject('faceIndex must be 0 or 1')) },
  tapped: { optional: false, check: (_d, _c, v) => (typeof v === 'boolean' ? v : reject('tapped must be a boolean')) },
  pose: { optional: false, check: (_d, _c, v) => checkPose(v) },
  home: { optional: true, check: (_d, _c, v) => checkPose(v) },
  combat: { optional: true, check: (_d, _c, v) => (v === 'attack' || v === 'block' ? v : reject('combat must be attack or block')) },
  pile: { optional: true, check: (_d, _c, v) => checkPileRef(v) },
  attachedTo: { optional: true, check: (_d, _c, v) => checkId(v, 'host card') },
  counters: { optional: false, check: (_d, _c, v) => counters(v) },
  note: { optional: true, check: (_d, _c, v) => nonEmpty(v, 'note', 500) },
  tokenLabel: { optional: true, check: (_d, c, v) => (c.isToken ? nonEmpty(v, 'label', 200) : reject(`card ${c.id} is not a token`)) },
};

function checkLine(d: Draft, id: string, v: unknown): Line {
  if (!isObj(v) || Object.keys(v).some((k) => !LINE_KEYS.has(k))) reject('invalid restore line');
  if (v.id !== id) reject(`restore line ${id} has another id`);
  if (typeof v.kind !== 'string' || !LINE_KINDS.includes(v.kind)) reject('invalid line kind');
  const by = d.seats.need(checkId(v.by, 'seat')).id;
  const label = v.label === undefined ? undefined : nonEmpty(v.label, 'label', 200);
  return { id, kind: v.kind as Line['kind'], from: checkAnchor(v.from), to: checkAnchor(v.to), by, ...(label !== undefined ? { label } : {}) };
}

function checkItem(d: Draft, v: unknown): StackItem {
  if (!isObj(v) || Object.keys(v).some((k) => !ITEM_KEYS.has(k))) reject('invalid restore stack item');
  if (typeof v.kind !== 'string' || !ITEM_KINDS.includes(v.kind)) reject('invalid stack item kind');
  const it: StackItem = { id: checkId(v.id, 'stack item'), kind: v.kind as StackItem['kind'], controller: d.seats.need(checkId(v.controller, 'seat')).id };
  if (v.card !== undefined) it.card = checkId(v.card, 'card');
  if (v.source !== undefined) it.source = checkId(v.source, 'card');
  if (v.copyOf !== undefined) it.copyOf = checkId(v.copyOf, 'stack item');
  if (v.note !== undefined) it.note = nonEmpty(v.note, 'note', 500);
  return it;
}

/** Validate the whole patch against the state the inverse action left, then apply it. */
export function applyRestore(d: Draft, patch: RestorePatch): void {
  if (!isObj(patch) || Object.keys(patch).some((k) => !PATCH_KEYS.has(k))) reject('invalid restore patch');
  const writes: (() => void)[] = [];

  for (const [id, fields] of entries(patch.cards, 'cards')) {
    const c = d.cards.need(checkId(id, 'card'));
    if (isHidden(d.zones.need(c.zone))) reject(`a restore patch does not change card ${id} in the hidden zone ${c.zone}`);
    for (const [f, raw] of entries(fields, `card ${id}`)) {
      if (!Object.hasOwn(CARD_FIELDS, f)) reject(`a restore patch cannot set ${f} of card ${id}`);
      const spec = CARD_FIELDS[f as RestorableCardField];
      const s = step(raw, `card ${id} ${f}`);
      expectNow((c as unknown as Record<string, unknown>)[f], s, `card ${id} ${f}`);
      if (s.put === null && !spec.optional) reject(`card ${id} needs ${f}`);
      const put = s.put === null ? null : spec.check(d, c, s.put);
      writes.push(() => {
        const w = d.cards.w(c.id) as unknown as Record<string, unknown>;
        if (put === null) delete w[f];
        else w[f] = put;
      });
    }
  }

  for (const [id, raw] of entries(patch.zones, 'zones')) {
    const z = d.zones.need(checkId(id, 'zone'));
    if (isHidden(z)) reject(`a restore patch does not reorder the hidden zone ${id}`);
    const s = step(raw, `zone ${id}`);
    expectNow(z.ids, s, `the order of ${id}`);
    if (!Array.isArray(s.put)) reject(`invalid restore order for ${id}`);
    const ids = s.put.map((x) => checkId(x, 'card'));
    writes.push(() => {
      d.zones.w(id).ids = ids;
    });
  }

  for (const [id, raw] of entries(patch.lines, 'lines')) {
    checkId(id, 'line');
    const s = step(raw, `line ${id}`);
    expectNow(d.lines.get(id), s, `line ${id}`);
    const put = s.put === null ? null : checkLine(d, id, s.put);
    writes.push(() => {
      if (put === null) d.lines.delete(id);
      else d.lines.set(id, put);
    });
  }

  if (patch.stack !== undefined) {
    const s = step(patch.stack, 'the stack');
    expectNow(d.stack, s, 'the stack');
    if (!Array.isArray(s.put)) reject('invalid restore stack');
    const items = s.put.map((v) => checkItem(d, v));
    writes.push(() => d.setStack(items));
  }

  if (patch.turn !== undefined) {
    if (!isObj(patch.turn) || Object.keys(patch.turn).some((k) => k !== 'number')) reject('a restore patch only sets the turn number');
    const s = step(patch.turn.number, 'the turn number');
    expectNow(d.turn.number, s, 'the turn number');
    const n = checkInt(s.put, 'turn number', 1, 1e9);
    writes.push(() => {
      d.turnW().number = n;
    });
  }

  for (const [id, raw] of entries(patch.seats, 'seats')) {
    const seat = d.seats.need(checkId(id, 'seat'));
    if (!isObj(raw) || Object.keys(raw).some((k) => k !== 'autoPass')) reject('a restore patch only sets auto-pass on a seat');
    const s = step(raw.autoPass, `auto-pass of ${id}`);
    expectNow(seat.autoPass, s, `auto-pass of ${id}`);
    if (typeof s.put !== 'boolean') reject('autoPass must be a boolean');
    const on = s.put;
    writes.push(() => {
      d.seats.w(id).autoPass = on;
    });
  }

  for (const w of writes) w();
}
