/**
 * The scene's paperclip geometry (scene/clips.ts; PLAN Milestone 6, owner decisions, Paperclips): a clip about 12 × 32 mm
 * lying over the overlap, on its anchor card (it moves with the card and never turns with a tap); a press makes a clip
 * of every card under the point, never one that only repeats an existing clip; the keyboard clips the selection or the
 * card with the cards it overlaps.
 */
import { describe, expect, it } from 'vitest';
import { CLIP } from '../../../src/core/geometry';
import { createTable } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg/index';
import { cardsOverlap, clipForCards, clipFrame, clipHere, clipPath, overlapPoint, pointInClip } from '../../../src/scene/clips';

const P = (x: number, y: number, rot = 0) => ({ x, y, rot });

function table(): TableState {
  const t = createTable({ game: mtg, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] });
  const card = (id: string, x: number, y: number, rot = 0, tapped = false) => ({ id, owner: 's0', controller: 's0', zone: 'battlefield:s0', face: 'up' as const, faceIndex: 0 as const, tapped, pose: P(x, y, rot), counters: {} });
  t.cards = { a: card('a', 0, 0), b: card('b', 30, 20), c: card('c', 200, 0), d: card('d', 40, -60, 0, true) };
  t.zones['battlefield:s0'] = { ...t.zones['battlefield:s0']!, ids: ['a', 'b', 'c', 'd'] } as TableState['zones'][string];
  return t;
}

describe('clip geometry', () => {
  it('the paperclip shape fits its 12 × 32 mm footprint', () => {
    const pts = clipPath();
    expect(Math.max(...pts.map((p) => Math.abs(p.x)))).toBeLessThanOrEqual(CLIP.w / 2 + 1e-9);
    expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeLessThanOrEqual(CLIP.h / 2 + 1e-9);
    expect(Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))).toBeGreaterThan(CLIP.h * 0.9);
  });

  it('lies on its anchor card in the card\'s stored frame: it moves and turns with the card, not with a tap', () => {
    expect(clipFrame({ x: 10, y: 20 }, P(100, 100), false)).toMatchObject({ x: 110, y: 120, rot: 0 });
    const f = clipFrame({ x: 10, y: 20 }, P(100, 100, 90), false);
    expect(f.x).toBeCloseTo(120, 9);
    expect(f.y).toBeCloseTo(90, 9);
    expect(f.rot).toBe(90);
    // The same card tapped is drawn at 90°, stored at 0°: the clip stays where it was put.
    expect(clipFrame({ x: 10, y: 20 }, P(100, 100, 90), true)).toMatchObject({ x: 110, y: 120, rot: 0 });
  });

  it('hits within its footprint and a margin', () => {
    const f = { x: 0, y: 0, rot: 0 };
    expect(pointInClip({ x: 5, y: 15 }, f, 0)).toBe(true);
    expect(pointInClip({ x: 7.5, y: 0 }, f, 0)).toBe(false);
    expect(pointInClip({ x: 7.5, y: 0 }, f, 2)).toBe(true);
  });
});

describe('making a clip', () => {
  it('a press over two or more cards clips them all, anchored on the top card at the press point', () => {
    const s = table();
    const made = clipHere(s, [{ id: 'b', pose: P(30, 20), tapped: false }, { id: 'a', pose: P(0, 0), tapped: false }], { x: 20, y: 10 });
    expect(made).toEqual({ cards: ['a', 'b'], anchor: { card: 'b', x: -10, y: -10 } });
  });

  it('never over one card, and never repeating the cards of an existing clip (unless it is the clip being moved)', () => {
    const s = table();
    expect(clipHere(s, [{ id: 'a', pose: P(0, 0), tapped: false }], { x: 0, y: 0 })).toBeNull();
    s.clips = { k1: { id: 'k1', cards: ['a', 'b'], anchor: { card: 'a', x: 0, y: 0 }, by: 's0' } };
    const under = [{ id: 'b', pose: P(30, 20), tapped: false }, { id: 'a', pose: P(0, 0), tapped: false }];
    expect(clipHere(s, under, { x: 20, y: 10 })).toBeNull();
    expect(clipHere(s, under, { x: 20, y: 10 }, 'k1')).not.toBeNull();
  });

  it('never over cards already clipped together through a chain (M6.1: a hold there stays a plain press)', () => {
    const s = table();
    s.clips = {
      k1: { id: 'k1', cards: ['a', 'b'], anchor: { card: 'a', x: 0, y: 0 }, by: 's0' },
      k2: { id: 'k2', cards: ['b', 'c'], anchor: { card: 'b', x: 0, y: 0 }, by: 's0' },
    };
    const under = [{ id: 'c', pose: P(30, 20), tapped: false }, { id: 'a', pose: P(0, 0), tapped: false }];
    expect(clipHere(s, under, { x: 20, y: 10 })).toBeNull();
    // Moving k2 there: without it, a and c are not joined, so the moved clip lands.
    expect(clipHere(s, under, { x: 20, y: 10 }, 'k2')).not.toBeNull();
    // A card not in the group under the press makes a new clip of all of them.
    expect(clipHere(s, [...under, { id: 'd', pose: P(10, 10), tapped: false }], { x: 20, y: 10 })?.cards).toEqual(['a', 'c', 'd']);
  });

  it('the keyboard clips a card with every card it overlaps, or the selection, over their overlap', () => {
    const s = table();
    expect(cardsOverlap(P(0, 0), P(30, 20))).toBe(true);
    expect(cardsOverlap(P(0, 0), P(200, 0))).toBe(false);
    // d is tapped: drawn turned, its long side across, it reaches a.
    expect(cardsOverlap(P(0, 0), P(40, -60, 90))).toBe(true);
    const made = clipForCards(s, 'a', []);
    expect(made?.cards).toEqual(['a', 'b', 'd']);
    expect(made?.anchor.card).toBe('a');
    const sel = clipForCards(s, 'c', ['c', 'a']);
    expect(sel?.cards).toEqual(['a', 'c']);
    expect(clipForCards(s, 'c', [])).toBeNull();
  });

  it('the overlap point is the middle of the shared box (or of the centres when apart)', () => {
    expect(overlapPoint([P(0, 0), P(30, 20)])).toEqual({ x: 15, y: 10 });
    expect(overlapPoint([P(0, 0), P(200, 0)])).toEqual({ x: 100, y: 0 });
  });
});
