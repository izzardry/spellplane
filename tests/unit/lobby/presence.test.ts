/**
 * Other players' cursors and drags (DESIGN "Players, seats and formats", Other players' cursors: each player's pointer
 * and any card they are dragging are shown live in their seat colour; "Specification: geometry, layout and motion":
 * table millimetres, rot clockwise, lift while dragged 12). scene/presence.ts geometry, without a DOM.
 */
import { describe, expect, it } from 'vitest';
import type { TablePoint3 } from '../../../src/scene/types';
import { cardCorners, DRAG_LIFT, dragPoses, dragSet, PRESENCE_STALE_MS, presenceShapes, type RemotePresence } from '../../../src/scene/presence';
import { act, freshTable, sit } from './helpers';

const style = { colourOf: (seat: string | null) => (seat === 's0' ? '#00f' : seat === 's1' ? '#f00' : '#777'), labelOf: (p: RemotePresence) => p.seat ?? '?' };
/** A projection that drops height and scales mm to px, like a bird's-eye camera centred on the table. */
const flat = (p: TablePoint3) => ({ x: 500 + p.x / 2, y: 400 - p.y / 2 });
const presence = (p: Partial<RemotePresence>): RemotePresence => ({ peerId: 'p', seat: 's1', cursor: null, drag: [], at: 1000, ...p });

describe('cardCorners', () => {
  it('an upright card spans 63 x 88 around its centre', () => {
    const c = cardCorners({ x: 10, y: 20, rot: 0 });
    expect(c.map((p) => [p.x, p.y])).toEqual([
      [-21.5, 64],
      [41.5, 64],
      [41.5, -24],
      [-21.5, -24],
    ]);
  });

  it('a card turned 90° clockwise is 88 wide and 63 deep, and its top edge faces +x', () => {
    const c = cardCorners({ x: 0, y: 0, rot: 90 });
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(88);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(63);
    // The first two corners are the card's top edge (local +v): clockwise by 90° it points to +x.
    expect(c[0]!.x).toBeCloseTo(44);
    expect(c[1]!.x).toBeCloseTo(44);
  });

  it('an opponent card at 180° keeps its centre and size', () => {
    const c = cardCorners({ x: 100, y: 300, rot: 180 });
    expect((c[0]!.x + c[2]!.x) / 2).toBeCloseTo(100);
    expect((c[0]!.y + c[2]!.y) / 2).toBeCloseTo(300);
    expect(c[0]!.y).toBeCloseTo(256);
  });
});

describe('presenceShapes', () => {
  it('projects a remote cursor at table height 0 in its seat colour', () => {
    const shapes = presenceShapes([presence({ cursor: { x: 100, y: -200 } })], flat, style, 1000);
    expect(shapes).toEqual([{ peer: 'p', seat: 's1', colour: '#f00', label: 's1', cursor: { x: 550, y: 500 }, ghosts: [] }]);
  });

  it('projects each dragged card as an outline lifted by the drag height', () => {
    const seen: number[] = [];
    const shapes = presenceShapes(
      [presence({ drag: [{ id: 'c1', pose: { x: 0, y: 0, rot: 0 } }, { id: 'c2', pose: { x: 69, y: 0, rot: 0 } }] })],
      (p) => {
        seen.push(p.z);
        return flat(p);
      },
      style,
      1000,
    );
    expect(shapes[0]!.ghosts.map((g) => g.id)).toEqual(['c1', 'c2']);
    expect(shapes[0]!.ghosts[0]!.corners).toHaveLength(4);
    expect(shapes[0]!.cursor).toBeNull();
    expect(new Set(seen)).toEqual(new Set([DRAG_LIFT]));
    expect(DRAG_LIFT).toBe(12);
  });

  it('leaves out the own seat, stale presences and peers with nothing to show', () => {
    const peers = [presence({ peerId: 'me', seat: 's0', cursor: { x: 0, y: 0 } }), presence({ peerId: 'old', cursor: { x: 0, y: 0 }, at: 0 }), presence({ peerId: 'idle' })];
    expect(presenceShapes(peers, flat, style, PRESENCE_STALE_MS + 1, 's0')).toEqual([]);
    expect(presenceShapes(peers, flat, style, PRESENCE_STALE_MS, 's0').map((s) => s.peer)).toEqual(['old']);
  });

  it('drops a ghost whose corners do not project', () => {
    const shapes = presenceShapes([presence({ cursor: { x: 0, y: 0 }, drag: [{ id: 'c1', pose: { x: 0, y: 0, rot: 0 } }] })], (p) => (p.z > 0 ? null : flat(p)), style, 1000);
    expect(shapes[0]!.ghosts).toEqual([]);
    expect(shapes[0]!.cursor).not.toBeNull();
  });

  it('an unseated peer (spectator) gets the neutral colour', () => {
    expect(presenceShapes([presence({ seat: null, cursor: { x: 0, y: 0 } })], flat, style, 1000)[0]!.colour).toBe('#777');
  });
});

describe('what this browser reports while dragging', () => {
  function table() {
    let st = sit(freshTable(), 's0', 'Ann', 0, 'a'.repeat(16));
    st = act(st, 's0', { type: 'createToken', card: 't1', zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 }, label: 'Soldier' });
    st = act(st, 's0', { type: 'createToken', card: 't2', zone: 'battlefield:s0', pose: { x: 80, y: -200, rot: 0 }, label: 'Soldier' });
    st = act(st, 's0', { type: 'tap', card: 't2', tapped: true });
    return st;
  }

  it('a press on a selected card drags the selection, otherwise the card alone', () => {
    expect(dragSet('t1', ['t1', 't2'])).toEqual(['t1', 't2']);
    expect(dragSet('t1', ['t2'])).toEqual(['t1']);
    expect(dragSet('t1', [])).toEqual(['t1']);
  });

  it('every dragged card moves by the pointer travel; a tapped card shows its tap turn', () => {
    const poses = dragPoses(table(), ['t1', 't2'], { x: 0, y: -200 }, { x: 30, y: -150 });
    expect(poses).toEqual([
      { id: 't1', pose: { x: 30, y: -150, rot: 0 } },
      { id: 't2', pose: { x: 110, y: -150, rot: 90 } },
    ]);
  });

  it('never reports cards outside public zones or unknown ids', () => {
    let st = table();
    st = act(st, 's0', { type: 'ready', commits: ['c'], instanceIds: ['lib1'], zone: 'library:s0' });
    expect(dragPoses(st, ['lib1', 'nope', 't1'], { x: 0, y: 0 }, { x: 0, y: 0 }).map((p) => p.id)).toEqual(['t1']);
  });
});
