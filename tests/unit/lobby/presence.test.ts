/**
 * Other players' cursors and drags (DESIGN "Players, seats and formats", Other players' cursors: each player's pointer
 * and any card they are dragging are shown live in their seat colour; "Specification: geometry, layout and motion":
 * table millimetres, rot clockwise, lift while dragged 12). scene/presence.ts geometry, without a DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceId, Pose, TableState } from '../../../src/core/types';
import { normDeg } from '../../../src/games/frame';
import { mtg } from '../../../src/games/index';
import { placeCards } from '../../../src/scene/layout';
import type { TablePoint3 } from '../../../src/scene/types';
import {
  cardCorners,
  createPresenceLayer,
  createPresenceTracker,
  DRAG_LIFT,
  dragPoses,
  dragSet,
  grabsOf,
  mayShowDrag,
  PRESENCE_RESEND_MS,
  PRESENCE_STALE_MS,
  presenceShapes,
  type PresenceScene,
  type RemotePresence,
  type ShownCard,
} from '../../../src/scene/presence';
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
    st = act(st, 's0', { type: 'ready', commits: ['c1', 'c2', 'c3'], instanceIds: ['lib1', 'lib2', 'lib3'], zone: 'library:s0' });
    st = act(st, 's0', { type: 'draw', instanceId: 'lib2' });
    return st;
  }
  /** The cards as the scene draws them for `st` (scene/layout.ts placeCards, Ann's view). */
  function shownOf(st: TableState, dragging: InstanceId[] = []): ShownCard[] {
    const view = { selection: [], hovered: null, privateFaces: {}, reducedMotion: true, pings: [], openPile: null };
    return [...placeCards(st, view, { game: mtg, layout: mtg.layout('1v1'), viewerSeat: 's0' }).entries()].map(([id, p]) => ({ id, pose: p.rest, dragging: dragging.includes(id) }));
  }

  it('a press on a selected card drags the selection, otherwise the card alone', () => {
    expect(dragSet('t1', ['t1', 't2'])).toEqual(['t1', 't2']);
    expect(dragSet('t1', ['t2'])).toEqual(['t1']);
    expect(dragSet('t1', [])).toEqual(['t1']);
  });

  it('every dragged card hangs off the pointer as drawn; a tapped card shows its tap turn', () => {
    const st = table();
    const shown = shownOf(st);
    const t1 = shown.find((c) => c.id === 't1')!.pose;
    const grabs = grabsOf(st, shown, ['t1', 't2'], { x: t1.x, y: t1.y }, 's0', false);
    const poses = dragPoses(grabs, { x: t1.x + 30, y: t1.y + 50 });
    expect(poses.map((p) => p.id)).toEqual(['t1', 't2']);
    expect(poses[0]!.pose).toEqual({ x: t1.x + 30, y: t1.y + 50, rot: 0 });
    expect(poses[1]!.pose.rot).toBe(90);
    expect(poses[1]!.pose.x - poses[0]!.pose.x).toBeCloseTo(80);
  });

  it('a graveyard card starts its ghost at the pile anchor where it is drawn, not at its stored battlefield pose', () => {
    let st = table();
    // A plain zone move (G key, drop on the pile) sends no pose: the card keeps its last battlefield pose in state.
    st = act(st, 's0', { type: 'move', card: 't1', to: 'graveyard:s0' });
    expect(st.cards['t1']!.pose).toMatchObject({ x: 0, y: -200 });
    const shown = shownOf(st);
    const anchor = shown.find((c) => c.id === 't1')!.pose;
    expect(Math.hypot(anchor.x - 0, anchor.y + 200)).toBeGreaterThan(50);
    // Ann grabs the top of her graveyard 5 mm off its centre and has not moved yet: the ghost sits on the pile.
    const press = { x: anchor.x + 5, y: anchor.y - 5 };
    const ghost = dragPoses(grabsOf(st, shown, ['t1'], press, 's0', false), press);
    expect(ghost).toEqual([{ id: 't1', pose: { x: anchor.x, y: anchor.y, rot: normDeg(anchor.rot) } }]);
  });

  it('the scene’s own drag set wins over the selection guess (a squared pile grabbed by its top card)', () => {
    const st = table();
    const shown = shownOf(st, ['t2']);
    expect(grabsOf(st, shown, ['t1'], { x: 0, y: 0 }, 's0', false).map((g) => g.id)).toEqual(['t2']);
  });

  it('never reports library cards or unknown ids; a hand card only for its owner and only when handed out by the HUD', () => {
    const st = table();
    expect(st.zones['hand:s0']!.ids).toEqual(['lib2']);
    expect(mayShowDrag(st, 'lib1', 's0', true)).toBe(false);
    expect(mayShowDrag(st, 'nope', 's0', true)).toBe(false);
    expect(mayShowDrag(st, 't1', 's1', false)).toBe(true);
    expect(mayShowDrag(st, 'lib2', 's0', true)).toBe(true);
    expect(mayShowDrag(st, 'lib2', 's0', false)).toBe(false);
    expect(mayShowDrag(st, 'lib2', 's1', true)).toBe(false);
    const shown: ShownCard[] = [
      { id: 'lib1', pose: { x: 0, y: 0, rot: 0 } },
      { id: 't1', pose: { x: 0, y: 0, rot: 0 } },
    ];
    expect(grabsOf(st, shown, ['lib1', 'nope', 't1'], { x: 0, y: 0 }, 's0', true).map((g) => g.id)).toEqual(['t1']);
  });
});

describe('the presence tracker (pointer input to cursor and drag messages)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    let st = sit(freshTable(), 's0', 'Ann', 0, 'a'.repeat(16));
    st = act(st, 's0', { type: 'createToken', card: 't1', zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 }, label: 'Soldier' });
    st = act(st, 's0', { type: 'ready', commits: ['c1', 'c2'], instanceIds: ['lib1', 'lib2'], zone: 'library:s0' });
    st = act(st, 's0', { type: 'draw', instanceId: 'lib2' });
    const state = st;
    // 1 px = 1 mm, screen y down; t1 is drawn at (10, -190), i.e. not at its stored pose.
    let shown: ShownCard[] = [{ id: 't1', pose: { x: 10, y: -190, rot: 0 } }];
    const scene: PresenceScene = {
      screenToTable: (x, y) => ({ x, y: -y }),
      cardAt: (x, y) => (Math.abs(x - 10) < 30 && Math.abs(-y + 190) < 40 ? 't1' : null),
      debug: { cards: () => shown },
    };
    const sent: { t: 'cursor' | 'drag'; v: unknown }[] = [];
    const channel = { cursor: (at: unknown, over?: unknown) => sent.push({ t: 'cursor', v: { at, over } }), drag: (cards: unknown) => sent.push({ t: 'drag', v: cards }) };
    const tracker = createPresenceTracker(scene, channel, { state: () => state, selection: () => [], seat: 's0' });
    return { tracker, sent, setShown: (s: ShownCard[]) => (shown = s), drags: () => sent.filter((m) => m.t === 'drag').map((m) => m.v as { id: string; pose: Pose }[]) };
  }

  it('reports the cursor over the table, ignores moves elsewhere and clears it when the pointer leaves', () => {
    const { tracker, sent } = setup();
    tracker.move(100, 50, true);
    tracker.move(100, 50, false);
    tracker.leave();
    expect(sent).toEqual([
      { t: 'cursor', v: { at: { x: 100, y: -50 }, over: null } },
      { t: 'cursor', v: { at: null, over: null } },
    ]);
  });

  it('re-sends a resting cursor so it never goes stale, and stops when it leaves the table', () => {
    const { tracker, sent } = setup();
    tracker.move(100, 50, true);
    vi.advanceTimersByTime(PRESENCE_RESEND_MS * 3);
    expect(sent.filter((m) => m.t === 'cursor')).toHaveLength(4);
    expect(PRESENCE_RESEND_MS).toBeLessThan(PRESENCE_STALE_MS);
    tracker.leave();
    vi.advanceTimersByTime(PRESENCE_RESEND_MS * 3);
    expect(sent).toHaveLength(5);
  });

  it('a press on a card past the drag threshold sends the drawn pose under the pointer; release ends it', () => {
    const { tracker, drags } = setup();
    tracker.down(15, 185, 0);
    tracker.move(16, 185, true);
    expect(drags()).toEqual([]);
    tracker.move(25, 175, true);
    tracker.move(45, 145, true);
    tracker.up();
    expect(drags()).toEqual([
      [{ id: 't1', pose: { x: 20, y: -180, rot: 0 } }],
      [{ id: 't1', pose: { x: 40, y: -150, rot: 0 } }],
      [],
    ]);
  });

  it('a drag out of the hand fan shows the hand card at the pointer, with its public opaque id only', () => {
    const { tracker, drags, setShown } = setup();
    // TableScene.startDrag placed the hand card under the pointer and drags it.
    setShown([
      { id: 't1', pose: { x: 10, y: -190, rot: 0 } },
      { id: 'lib2', pose: { x: 300, y: -400, rot: 0 }, dragging: true },
    ]);
    tracker.beginExternalDrag('lib2', 300, 400);
    tracker.move(320, 350, false);
    tracker.up();
    expect(drags()).toEqual([[{ id: 'lib2', pose: { x: 300, y: -400, rot: 0 } }], [{ id: 'lib2', pose: { x: 320, y: -350, rot: 0 } }], []]);
  });

  it('a library card handed out by a pile viewer is never shown (its id would leak the library order)', () => {
    const { tracker, sent, setShown } = setup();
    setShown([{ id: 'lib1', pose: { x: 300, y: -400, rot: 0 }, dragging: true }]);
    tracker.beginExternalDrag('lib1', 300, 400);
    tracker.move(320, 350, false);
    tracker.up();
    expect(sent.filter((m) => m.t === 'drag')).toEqual([]);
    // The cursor still travels while the drag runs.
    expect(sent.filter((m) => m.t === 'cursor').length).toBe(2);
  });
});

describe('the presence layer runs only while there is something to draw', () => {
  const frames: (() => void)[] = [];
  beforeEach(() => {
    frames.length = 0;
    const canvas = { dataset: {}, style: {}, width: 0, height: 0, setAttribute() {}, getContext: () => null, remove() {} };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('getComputedStyle', () => ({ position: 'relative' }));
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  function channel(initial: RemotePresence[] = []) {
    let peers = initial;
    const listeners = new Set<(p: RemotePresence[]) => void>();
    return {
      peers: () => peers,
      subscribe: (l: (p: RemotePresence[]) => void) => (listeners.add(l), () => listeners.delete(l)),
      push(p: RemotePresence[]) {
        peers = p;
        for (const l of listeners) l(p);
      },
    };
  }
  const host = { style: {}, appendChild() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
  const runFrame = () => frames.shift()?.();

  it('no frame loop on a table without remote presence (solo); it starts with a cursor and stops when the cursor goes', () => {
    let t = 1000;
    const ch = channel();
    const layer = createPresenceLayer(host, { worldToScreen: (p) => flat(p) }, ch, { ...style, selfSeat: 's0', now: () => t });
    expect(frames).toHaveLength(0);
    expect(layer.running()).toBe(false);
    ch.push([presence({ cursor: { x: 0, y: 0 } })]);
    expect(layer.running()).toBe(true);
    runFrame();
    expect(layer.drawn()).toHaveLength(1);
    runFrame();
    expect(frames).toHaveLength(1);
    // The own seat's echo never wakes it; the cursor leaving the table stops it after one clearing frame.
    ch.push([presence({ seat: 's0', cursor: { x: 0, y: 0 } })]);
    runFrame();
    expect(layer.drawn()).toEqual([]);
    expect(layer.running()).toBe(false);
    expect(frames).toHaveLength(0);
    // A cursor that went stale stops it as well.
    ch.push([presence({ cursor: { x: 0, y: 0 }, at: t })]);
    runFrame();
    t += PRESENCE_STALE_MS + 1;
    runFrame();
    expect(layer.running()).toBe(false);
    layer.dispose();
  });
});
