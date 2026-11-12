/**
 * Caption bubbles in the scene (DESIGN "Chat and voice", Dictation and captions: Placement; "Specification: geometry,
 * layout and motion", Screen layer: at most 280 px wide and three lines). Anchored to a card or stack item, else beside
 * the speaker's avatar (TableLayout seat `zones.avatar`), upright for every viewer. Implementer: M3-P4; the table scene
 * calls the layer from its `update` (ViewState.captions) and repositions the bubbles every frame.
 *
 * A bubble is DOM over the canvas, so it stays upright and sharp whatever the camera does. It is filled in the
 * speaker's seat colour (a neutral one for a spectator) with text in black or white, whichever reads better on it. It
 * grows as interim words arrive (interim text is set in italics), and when a caption leaves the list it fades out
 * (a cut with reduced motion).
 */
import { SCREEN_LAYER } from '../core/geometry';
import type { Anchor, SeatId, TableState } from '../core/types';
import type { TableLayout } from '../games/types';
import { pileAnchor, seatLayoutOf, stackPose, viewerAngle } from './layout';
import { rot2 } from './math';
import type { DebugCaption, SceneCaption, TablePoint } from './types';

/** At most 280 px wide and three lines (DESIGN "Specification: geometry, layout and motion", Screen layer). */
export const CAPTION_MAX_WIDTH_PX = SCREEN_LAYER.captionMaxWidthPx;
export const CAPTION_MAX_LINES = SCREEN_LAYER.captionMaxLines;
/** Line height of caption text, relative to its size. */
const LINE_HEIGHT = 1.35;

/** How far a bubble's tail sits above its anchor point, px. */
const LIFT_PX = 10;
/** Distance kept from the canvas edges, px. */
const MARGIN_PX = 6;
/** Fade-out of a bubble whose caption ended, ms. */
export const CAPTION_FADE_MS = 400;

export interface CaptionPointOptions {
  /** The viewer's seat: the stack lane is rotated for it, and a spectator's caption sits at its near edge. */
  viewer?: SeatId | null;
  /** Where the scene draws an anchor right now (a moving card), if it draws it; else the state's resting place is used. */
  drawn?: (anchor: Anchor) => TablePoint | null;
}

/**
 * The table point a caption hangs from: the anchored card's or stack item's position, else the speaker's avatar; null
 * when neither exists (DESIGN "Chat and voice", Placement). A card counts only while it is in a public zone (a card
 * that went to a hand or library leaves its caption at the avatar); a spectator (seat null) has no avatar, and its
 * caption sits at the viewer's near edge of the table (DECISIONS [M3-C]).
 */
export function captionPoint(state: TableState, layout: TableLayout, caption: Pick<SceneCaption, 'anchor' | 'seat'>, opts: CaptionPointOptions = {}): { point: TablePoint; anchoredTo: Anchor | null } | null {
  const viewer = opts.viewer ?? null;
  const angle = viewerAngle(state, layout, viewer);
  const a = caption.anchor;
  if (a && a.kind !== 'seat') {
    const p = anchorPoint(state, layout, a, angle, opts.drawn);
    if (p) return { point: p, anchoredTo: a };
  }
  // A seat anchor names that seat's avatar; otherwise the speaker's own.
  const seat = a?.kind === 'seat' && state.seats[a.id] ? a.id : caption.seat;
  if (seat) {
    const sl = seatLayoutOf(state, layout, seat);
    if (sl) return { point: { x: sl.zones.avatar.x, y: sl.zones.avatar.y }, anchoredTo: { kind: 'seat', id: seat } };
    return null;
  }
  // A spectator: the viewer's near edge, centred.
  const [x, y] = rot2(0, -layout.table.d / 2, angle);
  return { point: { x, y }, anchoredTo: null };
}

function anchorPoint(state: TableState, layout: TableLayout, a: Anchor, angle: number, drawn?: (a: Anchor) => TablePoint | null): TablePoint | null {
  if (a.kind === 'stackItem') {
    const i = state.stack.findIndex((s) => s.id === a.id);
    if (i < 0) return null;
    const d = drawn?.(a);
    if (d) return d;
    const p = stackPose(layout.stackLane, i, angle);
    return { x: p.x, y: p.y };
  }
  if (a.kind !== 'card') return null;
  const c = state.cards[a.id];
  const zone = c ? state.zones[c.zone] : undefined;
  if (!c || !zone || zone.visibility !== 'public') return null;
  const d = drawn?.(a);
  if (d) return d;
  if (zone.kind === 'stack') {
    const i = state.stack.findIndex((s) => s.card === c.id);
    const p = stackPose(layout.stackLane, i < 0 ? Math.max(0, zone.ids.indexOf(c.id)) : i, angle);
    return { x: p.x, y: p.y };
  }
  const sl = seatLayoutOf(state, layout, zone.owner);
  const pile = sl ? pileAnchor(sl, zone.kind) : null;
  if (pile) return { x: pile.x, y: pile.y };
  if (zone.kind === 'command' && sl) return { x: sl.zones.command.x, y: sl.zones.command.y };
  return { x: c.pose.x, y: c.pose.y };
}

/** Black or white, whichever reads better on a CSS hex colour (WCAG relative luminance). */
export function textOn(colour: string): '#000' | '#fff' {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return '#fff';
  const hex = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join('') : m[1]!;
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  // Contrast with black (l + 0.05) / 0.05 against white 1.05 / (l + 0.05).
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000' : '#fff';
}

/** What the caption layer needs from its scene. */
export interface CaptionLayerHost {
  /** The element the bubbles are placed in (the scene host, positioned). */
  container: HTMLElement;
  /** Table point to canvas pixels. */
  toScreen(p: TablePoint): { x: number; y: number };
  /** Canvas size in CSS px. */
  viewport(): { w: number; h: number };
  /** The canvas's rectangle on the page (debug screen rectangles are page coordinates). */
  canvasRect(): DOMRect;
  /** Where the caption hangs now (captionPoint with the scene's drawn positions). */
  point(caption: SceneCaption): { point: TablePoint; anchoredTo: Anchor | null } | null;
  /** Fill colour of a caption: its seat colour, or a neutral one. */
  fill(caption: SceneCaption): string;
  reduced(): boolean;
}

interface Bubble {
  caption: SceneCaption;
  el: HTMLDivElement;
  text: HTMLSpanElement;
  anchoredTo: Anchor | null;
  /** Placed this frame (null while its anchor has no point). */
  rect: { x: number; y: number; w: number; h: number } | null;
  leaving: boolean;
}

/** The DOM bubbles of the captions (one per caption id). */
export class CaptionLayer {
  private readonly bubbles = new Map<string, Bubble>();
  private readonly root: HTMLDivElement;

  constructor(private readonly host: CaptionLayerHost) {
    this.root = document.createElement('div');
    this.root.setAttribute('data-scene', 'captions');
    this.root.setAttribute('aria-live', 'polite');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    host.container.appendChild(this.root);
  }

  /** Whether any bubble is shown (the scene then places them every frame). */
  get active(): boolean {
    return this.bubbles.size > 0;
  }

  /** Show exactly these captions; bubbles of captions no longer listed fade out. */
  set(captions: readonly SceneCaption[]): void {
    const ids = new Set<string>();
    for (const c of captions) {
      ids.add(c.id);
      let b = this.bubbles.get(c.id);
      if (!b || b.leaving) {
        b?.el.remove();
        b = this.create(c);
        this.bubbles.set(c.id, b);
      }
      b.caption = c;
      if (b.text.textContent !== c.text) b.text.textContent = c.text;
      b.el.dataset.final = String(c.final);
      b.el.style.fontStyle = c.final ? 'normal' : 'italic';
      const fill = this.host.fill(c);
      b.el.style.background = fill;
      b.el.style.color = textOn(fill);
      b.el.style.setProperty('--tail', fill);
      b.el.style.opacity = String(Math.max(0, Math.min(1, c.opacity)));
    }
    for (const [id, b] of this.bubbles) {
      if (ids.has(id) || b.leaving) continue;
      this.leave(id, b);
    }
    this.place();
  }

  /** Position every bubble at its anchor (call every frame while `active`). */
  place(): void {
    const vp = this.host.viewport();
    for (const b of this.bubbles.values()) {
      const at = this.host.point(b.caption);
      b.anchoredTo = at?.anchoredTo ?? null;
      if (!at) {
        b.rect = null;
        b.el.style.visibility = 'hidden';
        continue;
      }
      const s = this.host.toScreen(at.point);
      const w = b.el.offsetWidth;
      const h = b.el.offsetHeight;
      const x = Math.max(MARGIN_PX, Math.min(vp.w - w - MARGIN_PX, s.x - w / 2));
      const y = Math.max(MARGIN_PX, Math.min(vp.h - h - MARGIN_PX, s.y - h - LIFT_PX));
      b.el.style.visibility = 'visible';
      b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      b.rect = { x, y, w, h };
    }
  }

  /** The bubbles as drawn (SpeechDebug.drawn). */
  debug(): DebugCaption[] {
    const r = this.host.canvasRect();
    return [...this.bubbles.values()]
      .filter((b) => !b.leaving)
      .map((b) => ({
        id: b.caption.id,
        text: b.caption.text,
        final: b.caption.final,
        anchoredTo: b.anchoredTo,
        screen: b.rect ? new DOMRect(r.left + b.rect.x, r.top + b.rect.y, b.rect.w, b.rect.h) : null,
      }));
  }

  dispose(): void {
    this.bubbles.clear();
    this.root.remove();
  }

  private create(c: SceneCaption): Bubble {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'caption');
    el.setAttribute('data-caption', c.id);
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      boxSizing: 'border-box',
      maxWidth: `${CAPTION_MAX_WIDTH_PX}px`,
      padding: '5px 9px',
      borderRadius: '9px',
      font: `500 13px/${LINE_HEIGHT} system-ui, sans-serif`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      visibility: 'hidden',
      transition: this.host.reduced() ? 'none' : `opacity ${CAPTION_FADE_MS}ms ease-out`,
      overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>);
    // At most three lines; a longer caption shows its last three (it grows at the end), the earlier ones clipped.
    const box = document.createElement('div');
    Object.assign(box.style, { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', maxHeight: `${CAPTION_MAX_LINES * LINE_HEIGHT}em`, overflow: 'hidden' });
    const text = document.createElement('span');
    text.setAttribute('data-caption-text', '');
    box.appendChild(text);
    el.appendChild(box);
    const tail = document.createElement('i');
    Object.assign(tail.style, {
      position: 'absolute',
      left: 'calc(50% - 6px)',
      bottom: '-6px',
      width: '0',
      height: '0',
      borderLeft: '6px solid transparent',
      borderRight: '6px solid transparent',
      borderTop: '6px solid var(--tail)',
    });
    el.appendChild(tail);
    this.root.appendChild(el);
    return { caption: c, el, text, anchoredTo: null, rect: null, leaving: false };
  }

  private leave(id: string, b: Bubble): void {
    b.leaving = true;
    if (this.host.reduced()) {
      b.el.remove();
      this.bubbles.delete(id);
      return;
    }
    b.el.style.opacity = '0';
    setTimeout(() => {
      if (this.bubbles.get(id) === b) this.bubbles.delete(id);
      b.el.remove();
    }, CAPTION_FADE_MS);
  }
}
