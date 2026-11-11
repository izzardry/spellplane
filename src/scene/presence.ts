/**
 * Other players' cursors and drags (DESIGN "Players, seats and formats", Other players' cursors: each player's pointer
 * and any card they are dragging are shown live in their seat colour, so intent is visible before an action lands;
 * "Multiplayer architecture": presence travels on the unreliable channel and is never logged). Implementer: M1-P5.
 *
 * Two halves over a TableScene, both outside the scene's own render loop so they work with every theme and rig:
 *  - the presence layer, a pointer-transparent 2D canvas over the scene host that projects each remote cursor and the
 *    outline of every card a remote player drags through `worldToScreen` on every frame (pan, zoom, rig blends);
 *  - the sender, which reports this browser's pointer in table millimetres and the cards it drags, derived from the
 *    pointer on the scene host (the scene's drag API is internal; the shown poses are a hint, the sequenced move wins).
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
  dispose(): void;
}

/** Draw remote cursors and drag outlines over `host` (the scene's host element) until disposed. */
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
  let disposed = false;
  const unsub = channel.subscribe((p) => (peers = p));

  // worldToScreen gives viewport coordinates; the canvas sits at the host's offset.
  const draw = (): void => {
    if (disposed) return;
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
  };
  raf = requestAnimationFrame(draw);

  const layer: PresenceLayer = {
    drawn: () => shapes.map((s) => ({ ...s, ghosts: s.ghosts.map((g) => ({ ...g, corners: [...g.corners] })) })),
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      unsub();
      canvas.remove();
    },
  };
  registerDebug({ presence: { drawn: () => layer.drawn() } });
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

/** Inputs the sender needs from the HUD. */
export interface PresenceSenderOptions {
  state(): TableState;
  selection(): readonly InstanceId[];
  /** This browser's seat: only cards it may drag are reported. */
  seat: SeatId | null;
}

/** Cards a press on `card` would drag: the selection when the card is in it, else the card alone (DESIGN "Card manipulation"). */
export function dragSet(card: InstanceId, selection: readonly InstanceId[]): InstanceId[] {
  return selection.includes(card) ? [...selection] : [card];
}

/**
 * The poses the dragged cards show: each card's pose moved by the pointer's travel in table space, its rot including
 * the tap turn as drawn (DESIGN "Specification: geometry, layout and motion"). Cards that are not on the table, or that
 * sit in a hidden zone of another seat, are left out.
 */
export function dragPoses(state: TableState, ids: readonly InstanceId[], from: TablePoint, to: TablePoint): { id: InstanceId; pose: Pose }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const out: { id: InstanceId; pose: Pose }[] = [];
  for (const id of ids) {
    const c = state.cards[id];
    if (!c) continue;
    const zone = state.zones[c.zone];
    if (!zone || zone.visibility !== 'public') continue;
    out.push({ id, pose: { x: c.pose.x + dx, y: c.pose.y + dy, rot: normDeg(c.pose.rot + (c.tapped ? 90 : 0)) } });
  }
  return out;
}

/** Report this browser's pointer and drags on `host` (the scene host) to `channel`; returns a stop function. */
export function sendPresence(host: HTMLElement, scene: Pick<TableScene, 'screenToTable' | 'cardAt'>, channel: Pick<PresenceChannel, 'cursor' | 'drag'>, opts: PresenceSenderOptions): () => void {
  let press: { x: number; y: number; table: TablePoint; ids: InstanceId[]; dragging: boolean } | null = null;

  const move = (e: PointerEvent): void => {
    const at = scene.screenToTable(e.clientX, e.clientY);
    channel.cursor(at ? { x: at.x, y: at.y } : null, at ? scene.cardAt(e.clientX, e.clientY) : null);
    if (!press || !at) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) return;
    press.dragging = true;
    const poses = dragPoses(opts.state(), press.ids, press.table, at);
    if (poses.length) channel.drag(poses);
  };
  const down = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const card = scene.cardAt(e.clientX, e.clientY);
    const table = scene.screenToTable(e.clientX, e.clientY);
    press = card && table ? { x: e.clientX, y: e.clientY, table, ids: dragSet(card, opts.selection()), dragging: false } : null;
  };
  const up = (): void => {
    if (press?.dragging) channel.drag([]);
    press = null;
  };
  const leave = (): void => {
    if (!press) channel.cursor(null);
  };

  host.addEventListener('pointermove', move, { capture: true });
  host.addEventListener('pointerdown', down, { capture: true });
  window.addEventListener('pointerup', up, { capture: true });
  window.addEventListener('pointercancel', up, { capture: true });
  host.addEventListener('pointerleave', leave);
  return () => {
    host.removeEventListener('pointermove', move, { capture: true });
    host.removeEventListener('pointerdown', down, { capture: true });
    window.removeEventListener('pointerup', up, { capture: true });
    window.removeEventListener('pointercancel', up, { capture: true });
    host.removeEventListener('pointerleave', leave);
    if (press?.dragging) channel.drag([]);
    channel.cursor(null);
  };
}

/** Both halves at once: draw the others' presence over `host` and report this browser's. Returns a stop function. */
export function attachPresence(
  host: HTMLElement,
  scene: Pick<TableScene, 'worldToScreen' | 'screenToTable' | 'cardAt'>,
  channel: PresenceChannel,
  opts: PresenceLayerOptions & Omit<PresenceSenderOptions, 'seat'>,
): () => void {
  const layer = createPresenceLayer(host, scene, channel, opts);
  const stop = sendPresence(host, scene, channel, { state: opts.state, selection: opts.selection, seat: opts.selfSeat });
  return () => {
    stop();
    layer.dispose();
  };
}
