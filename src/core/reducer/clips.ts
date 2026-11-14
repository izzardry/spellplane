/**
 * Paperclips (DESIGN "Card manipulation", Clip; PLAN Milestone 6, owner decisions, Paperclips). Implementer: M6-P1.
 *
 * - clipAdd: two or more distinct battlefield cards (face-down included) under one point, stored sorted; the anchor
 *   lies on one of them (mm from its centre in its stored frame). Any seat may clip any battlefield card; spectators may
 *   not. A clip holding exactly the cards of an existing clip adds nothing and is refused.
 * - clipRemove: any seat may take any clip off.
 * - pruneClips runs after every step (core/reducer/index.ts): a card that left the battlefield (or the game) leaves
 *   every clip it was in; a clip whose anchor card left keeps lying at the same table point, anchored on the first
 *   remaining card; a clip left with fewer than CLIP.minCards cards disappears.
 *
 * Clips carry only public data (no hidden information). Every number stored is quantised (util.ts `q`), and the
 * anchor's frame uses the reducer's own sine and cosine (util.ts `cardAxes`), so every peer computes the same hash.
 */
import type { ActionOf } from '../actions';
import { CLIP } from '../geometry';
import type { Clip, ClipAnchor, InstanceId, TableState } from '../types';
import type { Draft } from './draft';
import { ZONE_KIND, isHidden } from './place';
import { byId, cardAxes, checkFinite, checkId, isObj, q, reject } from './util';

/** Most cards one clip holds (a guard against malformed actions; a real overlap holds a handful). */
export const MAX_CLIP_CARDS = 64;
/** How far from its card's centre a clip anchor may lie, mm (a card is 63 × 88; a clip lies over an overlap). */
export const MAX_ANCHOR_MM = 100;

/** Whether a card is on a battlefield (a public zone of kind battlefield). */
function onBattlefield(d: Draft, id: InstanceId): boolean {
  const c = d.cards.get(id);
  if (!c) return false;
  const z = d.zones.get(c.zone);
  return !!z && !isHidden(z) && z.kind === ZONE_KIND.battlefield;
}

function checkAnchor(v: unknown, cards: readonly InstanceId[]): ClipAnchor {
  if (!isObj(v)) reject('invalid clip anchor');
  const card = checkId(v.card, 'anchor card');
  if (!cards.includes(card)) reject(`the clip's anchor card ${card} is not one of its cards`);
  const x = checkFinite(v.x, 'anchor x', MAX_ANCHOR_MM);
  const y = checkFinite(v.y, 'anchor y', MAX_ANCHOR_MM);
  return { card, x: q(x), y: q(y) };
}

/** Validated, sorted, distinct card list of a clip, every card on a battlefield. */
function checkCards(d: Draft, v: unknown): InstanceId[] {
  if (!Array.isArray(v) || v.length < CLIP.minCards || v.length > MAX_CLIP_CARDS) reject(`a clip holds ${CLIP.minCards} to ${MAX_CLIP_CARDS} cards`);
  const ids = (v as unknown[]).map((x) => checkId(x, 'card'));
  if (new Set(ids).size !== ids.length) reject('a clip names a card twice');
  for (const id of ids) {
    d.cards.need(id);
    if (!onBattlefield(d, id)) reject(`only battlefield cards can be clipped; ${id} is not on a battlefield`);
  }
  return [...ids].sort(byId);
}

export function clipAdd(d: Draft, a: ActionOf<'clipAdd'>): void {
  const by = d.seats.need(checkId(a.by, 'seat')).id;
  const id = checkId(a.clip, 'clip');
  if (d.clips.has(id)) reject(`clip ${id} already exists`);
  const cards = checkCards(d, a.cards);
  const anchor = checkAnchor(a.anchor, cards);
  const key = cards.join('\u0000');
  for (const c of d.clips.values()) if (c.cards.join('\u0000') === key) reject(`these cards are already clipped together (${c.id})`);
  d.clips.set(id, { id, cards, anchor, by });
}

export function clipRemove(d: Draft, a: ActionOf<'clipRemove'>): void {
  d.seats.need(checkId(a.by, 'seat'));
  const id = checkId(a.clip, 'clip');
  d.clips.need(id);
  d.clips.delete(id);
}

/** A table point from an anchor on a card at `pose` (the card's stored frame: x along its width, y toward its top). */
export function anchorPoint(pose: { x: number; y: number; rot: number }, anchor: { x: number; y: number }): { x: number; y: number } {
  const { right, up } = cardAxes(pose.rot);
  return { x: pose.x + right.x * anchor.x + up.x * anchor.y, y: pose.y + right.y * anchor.x + up.y * anchor.y };
}

/** The anchor offset of table point `p` on a card at `pose`, quantised. */
export function anchorOffset(pose: { x: number; y: number; rot: number }, p: { x: number; y: number }): { x: number; y: number } {
  const { right, up } = cardAxes(pose.rot);
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  return { x: q(dx * right.x + dy * right.y), y: q(dx * up.x + dy * up.y) };
}

/** Where a clip lies on the table in `state` (its anchor card's pose plus the offset), or null when that card is gone. */
export function clipPoint(state: TableState, clip: Clip): { x: number; y: number } | null {
  const c = Object.hasOwn(state.cards, clip.anchor.card) ? state.cards[clip.anchor.card] : undefined;
  return c ? anchorPoint(c.pose, clip.anchor) : null;
}

/**
 * After every step: cards that left the battlefield leave their clips; a clip whose anchor card left is anchored on
 * its first remaining card at the same table point; a clip with fewer than CLIP.minCards cards disappears.
 */
export function pruneClips(d: Draft): void {
  const ids = d.clips.keys();
  for (const id of ids) {
    const clip = d.clips.get(id)!;
    const keep = clip.cards.filter((c) => onBattlefield(d, c));
    if (keep.length === clip.cards.length) continue;
    if (keep.length < CLIP.minCards) {
      d.clips.delete(id);
      continue;
    }
    const w = d.clips.w(id);
    w.cards = keep;
    if (keep.includes(clip.anchor.card)) continue;
    // The clip stays where it lay: the point is taken from the anchor card's pose before this step.
    const was = Object.hasOwn(d.base.cards, clip.anchor.card) ? d.base.cards[clip.anchor.card] : undefined;
    const next = keep[0]!;
    const pose = d.cards.need(next).pose;
    const at = was ? anchorPoint(was.pose, clip.anchor) : { x: pose.x, y: pose.y };
    const off = anchorOffset(pose, at);
    const lim = (v: number) => Math.max(-MAX_ANCHOR_MM, Math.min(MAX_ANCHOR_MM, v));
    w.anchor = { card: next, x: lim(off.x), y: lim(off.y) };
  }
}
