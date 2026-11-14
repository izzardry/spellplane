/**
 * Other players' cursors and drags (DESIGN "Players, seats and formats", Other players' cursors: each player's pointer
 * and any card they are dragging are shown live in their seat colour, so intent is visible before an action lands;
 * "Multiplayer architecture": presence travels on the unreliable channel and is never logged). Implementer: M1-P5.
 *
 * Two halves over a TableScene, both outside the scene's own render loop so they work with every theme and rig:
 *  - the presence layer, a pointer-transparent 2D canvas over the scene host that projects each remote cursor and the
 *    outline of every card a remote player drags through `worldToScreen` on every frame (pan, zoom, rig blends);
 *  - the sender, which reports this browser's pointer in table millimetres and the cards it drags: a press on a card
 *    on the scene host, or a drag the HUD hands to the scene (hand fan, pile viewer). Ghost poses hang off the pointer
 *    as the cards are drawn (scene debug cards), not as TableState stores them; the sequenced move stays authoritative.
 *
 * The net/ Presence types are mirrored structurally here (scene may not import net/); net/types.ts PeerPresence and
 * Presence satisfy them.
 */
import { GEOMETRY } from '../core/geometry';
import type { InstanceId, Pose, SeatId, TableState } from '../core/types';
import { normDeg, rotateCw } from '../games/frame';
import { registerDebug } from '../util/debug';
import type { ScreenPoint, TablePoint, TablePoint3, TableScene } from './types';

/** A remote player's presence as the layer needs it (net/types.ts PeerPresence satisfies it). */
export interface RemotePresence {
  peerId: string;
  seat: SeatId | null;
  cursor: { x: number; y: number } | null;
  drag: readonly { id: InstanceId; pose: Pose }[];
  /** Local clock (ms) of the last presence message. */
  at: number;
}

/** Where own presence goes and remote presence comes from (net/types.ts Presence satisfies it). */
export interface PresenceChannel {
  cursor(at: { x: number; y: number } | null, over?: InstanceId | null): void;
  drag(cards: readonly { id: InstanceId; pose: Pose }[]): void;
  peers(): RemotePresence[];
  subscribe(listener: (peers: RemotePresence[]) => void): () => void;
}

/** A presence older than this is no longer drawn (the peer went quiet or left without saying so). */
export const PRESENCE_STALE_MS = 30_000;
/** Height of a dragged card above the table (DESIGN "Specification: geometry, layout and motion": lift while dragged 12). */
export const DRAG_LIFT = GEOMETRY.dragLift;
/** Pointer travel in CSS px before a press on a card counts as a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** One remote player's shapes in screen space. */
export interface PresenceShape {
  peer: string;
  seat: SeatId | null;
  colour: string;
  label: string;
  cursor: ScreenPoint | null;
  ghosts: { id: InstanceId; corners: ScreenPoint[] }[];
}

/** The four corners of a card at `pose` (centre, rot clockwise), in table millimetres. */
export function cardCorners(pose: Pose, w: number = GEOMETRY.card.w, h: number = GEOMETRY.card.h): TablePoint[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ].map(([u, v]) => {
    const p = rotateCw(u!, v!, pose.rot);
    return { x: pose.x + p.x, y: pose.y + p.y };
  });
}

/**
 * Project remote presences to screen shapes. Presences of `selfSeat`, stale ones and ones with nothing to show are
 * left out; a ghost or cursor that does not project (behind the camera) is dropped.
 */
export function presenceShapes(
  peers: readonly RemotePresence[],
  project: (p: TablePoint3) => ScreenPoint | null,
  style: { colourOf(seat: SeatId | null): string; labelOf(p: RemotePresence): string },
  now: number,
  selfSeat: SeatId | null = null,
  staleMs: number = PRESENCE_STALE_MS,
): PresenceShape[] {
  const out: PresenceShape[] = [];
  for (const p of peers) {
    if (selfSeat !== null && p.seat === selfSeat) continue;
    if (now - p.at > staleMs) continue;
    const cursor = p.cursor ? project({ x: p.cursor.x, y: p.cursor.y, z: 0 }) : null;
    const ghosts: PresenceShape['ghosts'] = [];
    for (const d of p.drag) {
      const corners = cardCorners(d.pose).map((c) => project({ x: c.x, y: c.y, z: DRAG_LIFT }));
      if (corners.every((c): c is ScreenPoint => c !== null)) ghosts.push({ id: d.id, corners });
    }
    if (!cursor && ghosts.length === 0) continue;
    out.push({ peer: p.peerId, seat: p.seat, colour: style.colourOf(p.seat), label: style.labelOf(p), cursor, ghosts });
  }
  return out;
}

/** What the debug hook reports about drawn presence (screen px, CSS). */
export interface PresenceDebug {
  drawn(): PresenceShape[];
  /** The layer's frame loop is running (only while some remote presence is drawable). */
  running(): boolean;
}

declare module '../util/debug' {
  interface DebugParts {
    presence: PresenceDebug;
  }
}

/** Options of the layer. */
export interface PresenceLayerOptions {
  /** Seat colour (CSS) of a seat; a neutral colour for null. */
  colourOf(seat: SeatId | null): string;
  /** The name shown beside a cursor. */
  labelOf(p: RemotePresence): string;
  /** This browser's seat, never drawn. */
  selfSeat: SeatId | null;
  now?: () => number;
}

/** A drawn layer. */
export interface PresenceLayer {
  /** Shapes drawn in the last frame. */
  drawn(): PresenceShape[];
  /** The frame loop is running. */
  running(): boolean;
  dispose(): void;
}

/** A remote presence the layer would draw: not the own seat, not stale, with a cursor or a drag. */
function drawable(p: RemotePresence, now: number, selfSeat: SeatId | null, staleMs: number): boolean {
  if (selfSeat !== null && p.seat === selfSeat) return false;
  if (now - p.at > staleMs) return false;
  return p.cursor !== null || p.drag.length > 0;
}

/**
 * Draw remote cursors and drag outlines over `host` (the scene's host element) until disposed. The layer only runs
 * a frame loop while some remote presence is drawable (render only when needed: nothing runs on the solo table); it
 * restarts when presence arrives and clears the canvas once when the last shape goes.
 */
export function createPresenceLayer(host: HTMLElement, scene: Pick<TableScene, 'worldToScreen'>, channel: Pick<PresenceChannel, 'peers' | 'subscribe'>, opts: PresenceLayerOptions): PresenceLayer {
  const now = opts.now ?? (() => Date.now());
  const canvas = document.createElement('canvas');
  canvas.dataset.testid = 'presence-layer';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let peers: RemotePresence[] = channel.peers();
  let shapes: PresenceShape[] = [];
  let raf = 0;
  let painted = false;
  let disposed = false;
  const active = (): boolean => peers.some((p) => drawable(p, now(), opts.selfSeat, PRESENCE_STALE_MS));
  const wake = (): void => {
    if (!disposed && raf === 0 && active()) raf = requestAnimationFrame(draw);
  };
  const unsub = channel.subscribe((p) => {
    peers = p;
    wake();
  });

  // worldToScreen gives viewport coordinates; the canvas sits at the host's offset.
  function draw(): void {
    raf = 0;
    if (disposed) return;
    if (!active()) {
      shapes = [];
      if (painted && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      painted = false;
      return;
    }
    raf = requestAnimationFrame(draw);
    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    shapes = presenceShapes(peers, (p) => scene.worldToScreen(p), opts, now(), opts.selfSeat);
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, -rect.left * dpr, -rect.top * dpr);
    ctx.clearRect(rect.left, rect.top, rect.width, rect.height);
    for (const s of shapes) paint(ctx, s);
    painted = true;
  }
  wake();

  const layer: PresenceLayer = {
    drawn: () => shapes.map((s) => ({ ...s, ghosts: s.ghosts.map((g) => ({ ...g, corners: [...g.corners] })) })),
    running: () => raf !== 0,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      unsub();
      canvas.remove();
    },
  };
  registerDebug({ presence: { drawn: () => layer.drawn(), running: () => layer.running() } });
  return layer;
}

function paint(ctx: CanvasRenderingContext2D, s: PresenceShape): void {
  ctx.save();
  ctx.strokeStyle = s.colour;
  ctx.fillStyle = s.colour;
  for (const g of s.ghosts) {
    ctx.beginPath();
    g.corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.cursor) {
    const { x, y } = s.cursor;
    ctx.globalAlpha = 1;
    // An arrow pointer with a white rim, its tip at the table point.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 17);
    ctx.lineTo(x + 4.5, y + 13);
    ctx.lineTo(x + 8, y + 20);
    ctx.lineTo(x + 10.5, y + 19);
    ctx.lineTo(x + 7, y + 12);
    ctx.lineTo(x + 12.5, y + 12);
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.fill();
    ctx.stroke();
    if (s.label) {
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(s.label).width;
      ctx.fillStyle = s.colour;
      ctx.beginPath();
      ctx.roundRect(x + 14, y + 16, tw + 10, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(s.label, x + 19, y + 29);
    }
  }
  ctx.restore();
}

/** A card as the scene draws it (scene debug `cards()`; TableScene's DebugCard satisfies it, the scene adds `dragging`). */
export interface ShownCard {
  id: InstanceId;
  /** The displayed pose: a pile member at its pile anchor, a stack card in the lane, a tapped card turned. */
  pose: Pose;
  /** The scene is dragging this card (present on the scene's own debug cards). */
  dragging?: boolean;
}

/** What the sender reads from the scene: the table point under the pointer, the card there and the cards as drawn. */
export type PresenceScene = Pick<TableScene, 'screenToTable' | 'cardAt'> & { readonly debug: { cards(): readonly ShownCard[] } };

/** Inputs the sender needs from the HUD. */
export interface PresenceSenderOptions {
  state(): TableState;
  selection(): readonly InstanceId[];
  /** This browser's seat: only cards it may drag are reported. */
  seat: SeatId | null;
}

/** While the pointer rests on the table the last cursor is sent again this often, so a still cursor never goes stale. */
export const PRESENCE_RESEND_MS = 10_000;

/** Cards a press on `card` would drag: the selection when the card is in it, else the card alone (DESIGN "Card manipulation"). */
export function dragSet(card: InstanceId, selection: readonly InstanceId[]): InstanceId[] {
  return selection.includes(card) ? [...selection] : [card];
}

/**
 * Whether a dragged card may be shown to the others. Cards in public zones may. A drag the HUD handed to the scene
 * (`external`: out of the own hand fan or a pile viewer) may also show a card of a zone only its owner sees ('owner'
 * visibility: hand, sideboard), because those zones are unordered and their opaque ids are already in shared state;
 * only the position travels, never an identity. Cards of 'nobody' zones (the library) never do: which opaque id is on
 * top would leak the library's order (DESIGN "Table model", Hidden cards).
 */
export function mayShowDrag(state: TableState, id: InstanceId, seat: SeatId | null, external: boolean): boolean {
  const c = state.cards[id];
  if (!c) return false;
  const zone = state.zones[c.zone];
  if (!zone) return false;
  if (zone.visibility === 'public') return true;
  return external && seat !== null && zone.visibility === 'owner' && zone.owner === seat;
}

/** A dragged card's offset from the pointer's table point at press time and its displayed rot. */
export interface Grab {
  id: InstanceId;
  dx: number;
  dy: number;
  rot: number;
}

/**
 * How the dragged cards hang off the pointer, from what the scene draws (not from TableState: a card in a squared
 * pile or the stack lane is drawn at the pile anchor or lane slot, not at its stored pose; DESIGN "Specification:
 * geometry, layout and motion"). The scene's own drag set wins when it reports one; otherwise the press drags `ids`.
 * Cards that may not be shown (`mayShowDrag`) or are not drawn are left out.
 */
export function grabsOf(state: TableState, shown: readonly ShownCard[], ids: readonly InstanceId[], at: TablePoint, seat: SeatId | null, external: boolean): Grab[] {
  const byId = new Map(shown.map((c) => [c.id, c]));
  const sceneDrag = shown.filter((c) => c.dragging).map((c) => c.id);
  const set = sceneDrag.length > 0 ? sceneDrag : ids;
  const out: Grab[] = [];
  for (const id of set) {
    const c = byId.get(id);
    if (!c || !mayShowDrag(state, id, seat, external)) continue;
    out.push({ id, dx: c.pose.x - at.x, dy: c.pose.y - at.y, rot: normDeg(c.pose.rot) });
  }
  return out;
}

/** The poses the grabbed cards show with the pointer at `at`. */
export function dragPoses(grabs: readonly Grab[], at: TablePoint): { id: InstanceId; pose: Pose }[] {
  return grabs.map((g) => ({ id: g.id, pose: { x: at.x + g.dx, y: at.y + g.dy, rot: g.rot } }));
}

/** Which pointer an event came from: its `pointerId`, and whether it is a finger (`pointerType === 'touch'`). */
export interface PresencePointer {
  id: number;
  touch: boolean;
}

/**
 * This browser's presence as a state machine over pointer input in CSS px (the DOM wiring is `sendPresence`): the
 * cursor while over the table, the dragged cards while a drag runs (a press on a card past the drag threshold, or a
 * drag the HUD handed to the scene).
 *
 * Fingers (M5-P1; DESIGN "Input and interaction design", Touch): a finger that presses a card and moves does not always
 * drag it (long-press then drag draws a line; two fingers drive the camera), so a touch press shows a drag only while
 * the scene reports cards it drags. A second finger ends the press: two-finger gestures always drive the camera.
 */
export interface PresenceTracker {
  /** A press on the scene host. */
  down(x: number, y: number, button: number, pointer?: PresencePointer): void;
  /** A pointer move anywhere; `overTable` when it is over the scene host. */
  move(x: number, y: number, overTable: boolean, pointer?: PresencePointer): void;
  /** A pointer released or cancelled. */
  up(pointer?: PresencePointer): void;
  /** The pointer left the scene host. */
  leave(): void;
  /** The HUD handed a drag of `card` to the scene at (x, y) (hand fan, pile viewer: `TableScene.startDrag`). */
  beginExternalDrag(card: InstanceId, x: number, y: number): void;
  stop(): void;
}

export function createPresenceTracker(scene: PresenceScene, channel: Pick<PresenceChannel, 'cursor' | 'drag'>, opts: PresenceSenderOptions): PresenceTracker {
  let press: {
    x: number;
    y: number;
    at: TablePoint;
    card: InstanceId | null;
    external: boolean;
    dragging: boolean;
    grabs: Grab[] | null;
    /** The finger that pressed (a touch press); null for a mouse or pen. */
    finger: number | null;
  } | null = null;
  /** Fingers down on the scene host (touch pointer ids). */
  const fingers = new Set<number>();
  let last: { at: { x: number; y: number } | null; over: InstanceId | null } = { at: null, over: null };
  let resend: ReturnType<typeof setInterval> | null = null;
  // Presence travels on the unreliable channel; a lost drag end would leave the ghost on the others' tables until it
  // goes stale. So the end of a drag is said once more with the next cursor (a move or the resting-cursor resend).
  let echoEnd = false;
  const endDrag = (): void => {
    channel.drag([]);
    echoEnd = true;
  };
  const echo = (): void => {
    if (!echoEnd) return;
    echoEnd = false;
    channel.drag([]);
  };

  const cursor = (at: { x: number; y: number } | null, over: InstanceId | null): void => {
    last = { at, over };
    channel.cursor(at, over);
    echo();
    if (at && !resend)
      resend = setInterval(() => {
        if (!last.at) return;
        channel.cursor(last.at, last.over);
        echo();
      }, PRESENCE_RESEND_MS);
    if (!at && resend) {
      clearInterval(resend);
      resend = null;
    }
  };
  const sendDrag = (at: TablePoint): void => {
    if (!press) return;
    if (press.finger !== null && press.grabs === null) {
      // A finger shows only what the scene drags: none while it draws a line, a marquee or moves the camera. The scene
      // starts its drag past its own slop, so the cards already follow the finger: they hang off where it is now.
      const grabs = grabsOf(opts.state(), scene.debug.cards(), [], at, opts.seat, press.external);
      if (!grabs.length) return;
      press.grabs = grabs;
    }
    press.grabs ??= grabsOf(opts.state(), scene.debug.cards(), press.card ? dragSet(press.card, opts.selection()) : [], press.at, opts.seat, press.external);
    if (!press.grabs.length) return;
    echoEnd = false;
    channel.drag(dragPoses(press.grabs, at));
  };

  return {
    down(x, y, button, pointer) {
      if (pointer?.touch) {
        fingers.add(pointer.id);
        if (fingers.size > 1) {
          // A second finger: a camera gesture (or a finger the scene ignores while it drags); never a drag of its card.
          // A card drag the scene holds keeps running (it ignores further fingers); any other press ends here.
          if (press && press.finger !== null && press.finger !== pointer.id && !scene.debug.cards().some((c) => c.dragging)) {
            if (press.dragging && press.grabs?.length) endDrag();
            press = null;
          }
          return;
        }
      }
      if (button !== 0) return;
      const card = scene.cardAt(x, y);
      const at = scene.screenToTable(x, y);
      press = card && at ? { x, y, at, card, external: false, dragging: false, grabs: null, finger: pointer?.touch ? pointer.id : null } : null;
    },
    move(x, y, overTable, pointer) {
      // While several fingers are down only the pressing one (or, with none, the first) is followed.
      if (pointer?.touch && fingers.size > 1 && (press?.finger ?? [...fingers][0]) !== pointer.id) return;
      if (!overTable && !press?.dragging) return;
      const at = scene.screenToTable(x, y);
      const p = at ? { x: at.x, y: at.y } : null;
      cursor(p, p ? scene.cardAt(x, y) : null);
      if (!press || !at) return;
      if (!press.dragging && Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      sendDrag(at);
    },
    up(pointer) {
      if (pointer?.touch) {
        fingers.delete(pointer.id);
        // Another finger lifting leaves the pressing finger's drag running.
        if (press && press.finger !== null && press.finger !== pointer.id) return;
      }
      if (press?.dragging && press.grabs?.length) endDrag();
      press = null;
    },
    leave() {
      if (!press) cursor(null, null);
    },
    beginExternalDrag(card, x, y) {
      const at = scene.screenToTable(x, y);
      if (!at) return;
      if (press?.dragging && press.grabs?.length) endDrag();
      press = { x, y, at, card: null, external: true, dragging: true, grabs: null, finger: null };
      // The scene placed the card under the pointer (startDrag); its own drag set names it.
      press.grabs = grabsOf(opts.state(), scene.debug.cards(), [card], at, opts.seat, true).filter((g) => g.id === card);
      cursor({ x: at.x, y: at.y }, null);
      sendDrag(at);
    },
    stop() {
      if (press?.dragging && press.grabs?.length) endDrag();
      press = null;
      fingers.clear();
      cursor(null, null);
    },
  };
}

/** What `sendPresence` and `attachPresence` return. */
export interface PresenceHandle {
  /** Report a drag the HUD handed to the scene (call right after `TableScene.startDrag`). */
  beginExternalDrag(card: InstanceId, x: number, y: number): void;
  stop(): void;
}

/**
 * Report this browser's pointer and drags on `host` (the scene host) to `channel`. Moves are read on the window after
 * the scene handled them (bubble phase), so a scene drag that starts on that move is already reported by the scene.
 */
export function sendPresence(host: HTMLElement, scene: PresenceScene, channel: Pick<PresenceChannel, 'cursor' | 'drag'>, opts: PresenceSenderOptions): PresenceHandle {
  const tracker = createPresenceTracker(scene, channel, opts);
  const who = (e: PointerEvent): PresencePointer => ({ id: e.pointerId, touch: e.pointerType === 'touch' });
  const move = (e: PointerEvent): void => tracker.move(e.clientX, e.clientY, e.target instanceof Node && host.contains(e.target), who(e));
  const down = (e: PointerEvent): void => tracker.down(e.clientX, e.clientY, e.button, who(e));
  const up = (e: PointerEvent): void => tracker.up(who(e));
  const leave = (): void => tracker.leave();

  window.addEventListener('pointermove', move);
  host.addEventListener('pointerdown', down, { capture: true });
  window.addEventListener('pointerup', up, { capture: true });
  window.addEventListener('pointercancel', up, { capture: true });
  host.addEventListener('pointerleave', leave);
  return {
    beginExternalDrag: (card, x, y) => tracker.beginExternalDrag(card, x, y),
    stop() {
      window.removeEventListener('pointermove', move);
      host.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
      host.removeEventListener('pointerleave', leave);
      tracker.stop();
    },
  };
}

/** Both halves at once: draw the others' presence over `host` and report this browser's. */
export function attachPresence(host: HTMLElement, scene: Pick<TableScene, 'worldToScreen'> & PresenceScene, channel: PresenceChannel, opts: PresenceLayerOptions & Omit<PresenceSenderOptions, 'seat'>): PresenceHandle {
  const layer = createPresenceLayer(host, scene, channel, opts);
  const sender = sendPresence(host, scene, channel, { state: opts.state, selection: opts.selection, seat: opts.selfSeat });
  return {
    beginExternalDrag: sender.beginExternalDrag,
    stop() {
      sender.stop();
      layer.dispose();
    },
  };
}
