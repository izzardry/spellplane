/**
 * The far-zoom stack badge (DESIGN "The effect stack", Reading it: "at far zoom it collapses to a count badge that
 * expands on hover"; PLAN Milestone 5, owner decisions, Far-zoom stack: "expands on hover, or on tap on touch"; M5-P7).
 *
 * A screen-anchored element over the canvas at the lane's centre, shown while the scene draws the lane collapsed
 * (scene/stack.ts stackCollapsed). It shows the item count. Hovering it with a mouse or pen, focusing it, or tapping it
 * on touch expands it: the items cascade beside it at a readable size, newest at the front, each with its number, kind,
 * controller colour, note and its card's face (the spell's own, a marker's source's), drawn whole and undistorted
 * (CLAUDE.md: card faces are never recoloured, cropped or distorted). A face this viewer may not see shows a plain
 * back. A tap elsewhere, leaving it, or Escape collapses it again.
 */
import type { CardRef } from '../core/types';
import type { FaceSource } from '../data/types';
import { faceKey } from './faces-key';
import { drawPlaceholderFace } from './placeholder';
import { stackBadgeText, type BadgeItem } from './stack';
import type { ScreenPoint, StackBadgeState } from './types';

/** The expanded cascade: card height (CSS px, at least the 160 px a normal-tier face needs), step between items. */
export const BADGE_CARD_PX = 168;
const BADGE_CARD_W = Math.round((BADGE_CARD_PX * 63) / 88);
/** Each buried item shows its top strip: the title bar, as in the lane (cascade offset 22 of 88). */
export const BADGE_STEP_PX = Math.round((BADGE_CARD_PX * 22) / 88);
const LABEL_W = 92;

export interface StackBadgeColours {
  fg: string;
  surface: string;
  border: string;
  pending: string;
  font: string;
}

export interface StackBadgeOptions {
  faces: FaceSource;
  colours: () => StackBadgeColours;
  /** The badge expanded or collapsed (the scene redraws). */
  onChange?: () => void;
}

/** What the scene hands the badge each frame. */
export interface StackBadgeFrame {
  collapsed: boolean;
  count: number;
  /** The lane's centre in canvas px (null when off the projection). */
  at: ScreenPoint | null;
  items: BadgeItem[];
}

export class StackBadgeView {
  readonly el: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private collapsed = false;
  private count = 0;
  private hovering = false;
  private pinned = false;
  private itemsKey = '';
  /** Loaded faces by face key (an image, or a drawn placeholder canvas); each row shows a copy. */
  private readonly faceCache = new Map<string, HTMLElement>();
  private disposed = false;
  private readonly offDoc: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly opts: StackBadgeOptions,
  ) {
    this.el = document.createElement('div');
    this.el.setAttribute('data-scene', 'stack-badge');
    this.el.setAttribute('data-testid', 'stack-badge');
    Object.assign(this.el.style, { position: 'absolute', display: 'none', zIndex: '2', transform: 'translate(-50%, -50%)', pointerEvents: 'auto', touchAction: 'manipulation' });
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.setAttribute('data-testid', 'stack-badge-count');
    this.button.setAttribute('aria-expanded', 'false');
    this.panel = document.createElement('div');
    this.panel.setAttribute('data-testid', 'stack-badge-items');
    this.panel.setAttribute('role', 'list');
    Object.assign(this.panel.style, { position: 'absolute', display: 'none', left: '100%', top: '50%', marginLeft: '10px', overflow: 'auto', borderRadius: '6px', padding: '8px' });
    this.el.append(this.button, this.panel);
    host.appendChild(this.el);

    this.el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      this.hovering = true;
      this.render();
    });
    this.el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      this.hovering = false;
      this.render();
    });
    // A tap toggles (touch has no hover); a click pins it open for mouse and keyboard users too.
    this.button.addEventListener('click', () => {
      this.pinned = !this.pinned;
      this.render();
    });
    this.button.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.pinned) return;
      this.pinned = false;
      e.stopPropagation();
      this.render();
    });
    // A tap or click anywhere else closes a pinned badge.
    const onDown = (e: PointerEvent): void => {
      if (!this.pinned || this.el.contains(e.target as Node | null)) return;
      this.pinned = false;
      this.render();
    };
    document.addEventListener('pointerdown', onDown, true);
    this.offDoc = () => document.removeEventListener('pointerdown', onDown, true);
  }

  get expanded(): boolean {
    return this.collapsed && (this.hovering || this.pinned);
  }

  /** Show, move or hide the badge for this frame. */
  update(f: StackBadgeFrame): void {
    if (this.disposed) return;
    const was = this.expanded;
    this.collapsed = f.collapsed && f.at !== null;
    this.count = f.count;
    if (!this.collapsed) {
      this.hovering = false;
      this.pinned = false;
    }
    if (f.at) {
      this.el.style.left = `${f.at.x}px`;
      this.el.style.top = `${f.at.y}px`;
    }
    const key = JSON.stringify(f.items.map((i) => [i.item, i.number, i.kindLabel, i.colour, i.note, i.pending, i.ref?.sid ?? null, i.faceIndex]));
    if (key !== this.itemsKey) {
      this.itemsKey = key;
      this.fill(f.items);
    }
    this.render();
    if (this.expanded !== was) this.opts.onChange?.();
  }

  /** The debug hook's view of the badge (scene/types.ts StackBadgeState). */
  state(): StackBadgeState {
    return { count: this.count, collapsed: this.collapsed, expanded: this.expanded, screen: this.collapsed ? this.button.getBoundingClientRect() : null };
  }

  private render(): void {
    const c = this.opts.colours();
    const expanded = this.expanded;
    this.el.style.display = this.collapsed ? 'block' : 'none';
    this.el.setAttribute('data-expanded', String(expanded));
    this.button.setAttribute('aria-expanded', String(expanded));
    this.button.setAttribute('aria-label', stackBadgeText(this.count));
    this.button.title = stackBadgeText(this.count);
    this.button.textContent = String(this.count);
    Object.assign(this.button.style, {
      minWidth: '44px',
      height: '44px',
      borderRadius: '22px',
      border: `2px solid ${c.fg}`,
      background: c.surface,
      color: c.fg,
      font: `600 18px/1 ${c.font}`,
      cursor: 'pointer',
      padding: '0 10px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    });
    this.panel.style.display = expanded ? 'block' : 'none';
    Object.assign(this.panel.style, { background: c.surface, border: `1px solid ${c.border}`, color: c.fg, font: `12px/1.3 ${c.font}` });
    if (expanded) this.place();
  }

  /** Keep the expanded panel inside the host: beside the badge, on the side with room. */
  private place(): void {
    const n = Math.max(1, this.panel.childElementCount);
    const h = BADGE_CARD_PX + (n - 1) * BADGE_STEP_PX + 16;
    const w = BADGE_CARD_W + 2 * LABEL_W + 16;
    const hostH = this.host.clientHeight || innerHeight;
    const hostW = this.host.clientWidth || innerWidth;
    const maxH = Math.max(120, hostH - 16);
    this.panel.style.width = `${w}px`;
    this.panel.style.height = `${Math.min(h, maxH)}px`;
    const left = parseFloat(this.el.style.left) || 0;
    const top = parseFloat(this.el.style.top) || 0;
    const right = left + 32 + w <= hostW;
    this.panel.style.left = right ? '100%' : 'auto';
    this.panel.style.right = right ? 'auto' : '100%';
    this.panel.style.marginLeft = right ? '10px' : '0';
    this.panel.style.marginRight = right ? '0' : '10px';
    const shown = Math.min(h, maxH);
    // Vertically centred on the badge, clamped to the host.
    const want = top - shown / 2;
    const clamped = Math.max(8, Math.min(hostH - 8 - shown, want));
    this.panel.style.top = `${clamped - top + 22}px`;
  }

  private fill(items: BadgeItem[]): void {
    this.panel.textContent = '';
    // Oldest at the back (top of the panel), newest last and fully visible, as the lane cascades toward the viewer.
    const ordered = [...items].reverse();
    ordered.forEach((it, i) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'listitem');
      row.setAttribute('data-testid', 'stack-badge-item');
      row.setAttribute('data-item', it.item);
      Object.assign(row.style, { position: 'absolute', left: '8px', top: `${8 + i * BADGE_STEP_PX}px`, width: `${BADGE_CARD_W + 2 * LABEL_W}px`, height: `${BADGE_CARD_PX}px` });
      const label = document.createElement('span');
      label.textContent = `${it.number} ${it.kindLabel.toUpperCase()}`;
      Object.assign(label.style, { position: 'absolute', left: '0', top: '2px', width: `${LABEL_W - 6}px`, textAlign: 'right', color: it.colour, fontWeight: '600', letterSpacing: '0.04em' });
      const face = this.faceEl(it.ref, it.faceIndex);
      Object.assign(face.style, { position: 'absolute', left: `${LABEL_W}px`, top: '0', width: `${BADGE_CARD_W}px`, height: `${BADGE_CARD_PX}px`, borderRadius: '6px', outline: `2px solid ${it.colour}`, outlineOffset: '0' });
      row.append(label, face);
      if (it.note) {
        const note = document.createElement('span');
        note.textContent = it.note.slice(0, 40);
        Object.assign(note.style, { position: 'absolute', left: `${LABEL_W + BADGE_CARD_W + 6}px`, top: '2px', width: `${LABEL_W - 6}px`, overflowWrap: 'anywhere' });
        row.append(note);
      }
      this.panel.append(row);
    });
  }

  /** The face drawn whole at the card's aspect (63 : 88): an image, a drawn placeholder, or a plain back. */
  private faceEl(ref: CardRef | null, faceIndex: 0 | 1): HTMLElement {
    if (!ref) {
      const back = document.createElement('div');
      back.setAttribute('data-face', 'back');
      Object.assign(back.style, { background: '#3a3a3e', boxSizing: 'border-box', border: '6px solid #1d1d20' });
      return back;
    }
    const key = faceKey(ref, faceIndex);
    const holder = document.createElement('div');
    holder.setAttribute('data-face', key);
    Object.assign(holder.style, { background: '#ececea', overflow: 'hidden' });
    const cached = this.faceCache.get(key);
    if (cached) {
      holder.append(copyFace(cached));
      return holder;
    }
    void this.opts.faces
      .faceFor(ref, faceIndex, 'normal')
      .then((img) => {
        if (this.disposed) return;
        let el: HTMLElement;
        if (img.kind === 'url') {
          const i = document.createElement('img');
          i.src = img.url;
          i.alt = '';
          i.decoding = 'async';
          el = i;
        } else {
          el = drawPlaceholderFace(img.face) as HTMLCanvasElement;
        }
        this.faceCache.set(key, el);
        for (const h of this.panel.querySelectorAll<HTMLElement>('[data-face]')) if (h.getAttribute('data-face') === key && !h.firstChild) h.append(copyFace(el));
      })
      .catch(() => undefined);
    return holder;
  }

  dispose(): void {
    this.disposed = true;
    this.offDoc();
    this.el.remove();
    this.faceCache.clear();
  }
}

/** A copy of a loaded face, sized to its box whole and undistorted (object-fit: contain keeps the face's own aspect). */
function copyFace(src: HTMLElement): HTMLElement {
  let el: HTMLElement;
  if (src instanceof HTMLCanvasElement) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
    el = c;
  } else el = src.cloneNode(true) as HTMLElement;
  Object.assign(el.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
  return el;
}
