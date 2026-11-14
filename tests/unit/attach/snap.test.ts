/**
 * Drop rule 3a, tuck (PLAN Milestone 6, owner decisions, Tuck; DESIGN "Specification: geometry, layout and motion",
 * Drop resolution 3a): the dragged card's bottom edge within the upper third of another card, overlapping it
 * horizontally by at least half, tucks behind that card at the attachment tuck offset (10 sideways, 10 up), further
 * attachments behind the previous one. Symmetric to the cascade rule; Ctrl skips it; groups do not tuck.
 */
import { describe, expect, it } from 'vitest';
import { tuckPose } from '../../../src/core/reducer';
import { resolveDrop, type DropContext, type DropInput, type SnapCard } from '../../../src/scene/snap';

const W = 63;
const H = 88;
const TABLE = { w: 1400, d: 1100 };

const card = (id: string, x: number, y: number, rot = 0, extra: Partial<SnapCard> = {}): SnapCard => ({ id, pose: { x, y, rot }, frameDeg: 0, ...extra });
const ctx = (cards: SnapCard[]): DropContext => ({ table: TABLE, cards, targets: [] });
const drop = (x: number, y: number, rot = 0, extra: Partial<DropInput> = {}): DropInput => ({ pose: { x, y, rot }, cursor: { x, y }, single: true, ctrl: false, frameDeg: 0, ...extra });

/** The dragged card's centre y for its bottom edge to lie `below` mm under the host's top edge (host at y 0). */
const bottomAt = (below: number) => H / 2 - below + H / 2;

describe('rule 3a: tuck', () => {
  it('a bottom edge within the upper third tucks behind the card at the tuck offset and attaches to it', () => {
    const r = resolveDrop(drop(5, bottomAt(10)), ctx([card('host', 0, 0)]));
    expect(r).toEqual({ rule: '3a', kind: 'tuck', host: 'host', pose: { x: 10, y: 10, rot: 0 } });
  });

  it('the upper third is the band: at the top edge and one third down it tucks, below it does not', () => {
    const c = ctx([card('host', 0, 0)]);
    expect(resolveDrop(drop(0, bottomAt(0)), c).kind).toBe('tuck');
    expect(resolveDrop(drop(0, bottomAt(H / 3 - 0.01)), c).kind).toBe('tuck');
    expect(resolveDrop(drop(0, bottomAt(H / 3 + 0.5)), c).kind).not.toBe('tuck');
    // Above the host's top edge (bottom edge outside the card): no tuck.
    expect(resolveDrop(drop(0, bottomAt(-0.5)), c).kind).not.toBe('tuck');
  });

  it('needs at least half of the dragged card overlapping horizontally', () => {
    const c = ctx([card('host', 0, 0)]);
    expect(resolveDrop(drop(W / 2 - 0.01, bottomAt(10)), c).kind).toBe('tuck');
    expect(resolveDrop(drop(W / 2 + 1, bottomAt(10)), c).kind).not.toBe('tuck');
  });

  it('further attachments fan behind the previous one: the slot counts the host\'s attachments', () => {
    const cards = [card('host', 100, -200), card('aura', 110, -190, 0, { attachedTo: 'host' })];
    const r = resolveDrop(drop(100, -200 + bottomAt(5)), ctx(cards));
    expect(r).toMatchObject({ kind: 'tuck', host: 'host', pose: tuckPose({ x: 100, y: -200, rot: 0 }, 2) });
    expect(tuckPose({ x: 100, y: -200, rot: 0 }, 2)).toEqual({ x: 120, y: -180, rot: 0 });
  });

  it('a drop on the strip of a tucked card peeking out joins its host\'s fan', () => {
    const cards = [card('host', 0, 0), card('aura', 10, 10, 0, { attachedTo: 'host' })];
    // Bottom edge 3 mm under the Aura's top edge: above the host's own top edge.
    const r = resolveDrop(drop(10, 10 + bottomAt(3)), ctx(cards));
    expect(r).toMatchObject({ kind: 'tuck', host: 'host', pose: { x: 20, y: 20, rot: 0 } });
  });

  it('a tapped host: the slot comes from its stored pose (the reducer\'s tuck), not the drawn turn', () => {
    const r = resolveDrop(drop(0, H / 2 + 20, 0), ctx([card('host', 0, 0, 90, { tapped: true })]));
    // Drawn turned by 90°, the host's top edge in the frame is its half width; the slot ignores the tap turn.
    expect(r).toMatchObject({ kind: 'tuck', host: 'host', pose: { x: 10, y: 10, rot: 0 } });
  });

  it('works in every seat\'s frame: the far seat\'s "up" points toward the near seat', () => {
    const host = card('host', 0, 200, 180, { frameDeg: 180 });
    const r = resolveDrop(drop(0, 200 - bottomAt(10), 180, { frameDeg: 180 }), ctx([host]));
    expect(r).toMatchObject({ kind: 'tuck', host: 'host', pose: { x: -10, y: 190, rot: 180 } });
  });

  it('Ctrl skips it, and a dragged group never tucks', () => {
    const c = ctx([card('host', 0, 0)]);
    expect(resolveDrop(drop(0, bottomAt(10), 0, { ctrl: true }), c).kind).toBe('free');
    expect(resolveDrop(drop(0, bottomAt(10), 0, { single: false }), c).kind).not.toBe('tuck');
  });

  it('rules 2 and 3 come first; the nearest candidate wins among several', () => {
    // Over a card's lower third (cascade) and another's upper third (tuck) at once: the cascade wins.
    const cards = [card('upper', 0, 120), card('lower', 0, -48)];
    expect(resolveDrop(drop(0, 44 - 10), ctx(cards)).kind).toBe('cascade');
    // Two hosts side by side: the one the card is centred over.
    const two = [card('left', -40, 0), card('right', 40, 0)];
    expect(resolveDrop(drop(30, bottomAt(10)), ctx(two))).toMatchObject({ kind: 'tuck', host: 'right' });
  });
});
