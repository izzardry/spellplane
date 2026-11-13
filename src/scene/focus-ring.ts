/**
 * The keyboard focus ring on the table (DESIGN "Input and interaction design", Accessibility: "every card action is
 * reachable from the keyboard by cycling focus through cards in a zone"; ViewState.focused: "drawn with a focus ring
 * distinct from hover and selection"; PLAN M5-P4). Hover and selection are outlines drawn in the card shader in the
 * theme's colours; the focus ring is a separate stroke over the canvas: a dashed line in the theme's focus colour on a
 * solid halo of its background colour, outside the card's edge, so it reads on any table and beside any outline. Some
 * themes draw the selection outline in the same colour as focus, so the ring differs from selection in form, not only
 * in colour: it is dashed (a selection outline is solid) and it stands off the card by at least FOCUS_RING_MIN_GAP_PX
 * on screen even in the far view, so a selected card and a focused card never read alike. It follows the card's
 * projected corners each drawn frame (a trapezoid in the ego view), never touches the face, and never animates.
 */
import { CARD_H, CARD_W } from './math';
import type { ScreenPoint } from './types';

/** Gap between the card's edge and the ring, mm on the table (when that is more than FOCUS_RING_MIN_GAP_PX on screen). */
export const FOCUS_RING_GAP_MM = 2.5;
/** The least gap between the card's edge and the ring's centre line on screen, CSS px (the far view is about 1 px/mm). */
export const FOCUS_RING_MIN_GAP_PX = 7;
/** Stroke widths in CSS px: the focus colour, and the halo under it. */
export const FOCUS_RING_PX = { ring: 3, halo: 7 } as const;
/** The ring's dash pattern (SVG stroke-dasharray, CSS px): what sets it apart from the solid selection outline. */
export const FOCUS_RING_DASH = '7 4';

/**
 * The ring's polygon around a card drawn through `corners` (its four projected corners, host CSS px, in order): the
 * card's outline pushed outward by FOCUS_RING_GAP_MM at the card's on-screen scale, or FOCUS_RING_MIN_GAP_PX when that
 * is more. Each edge moves out along its normal and the corners are where neighbouring edges meet, so the gap is even
 * on every side, in the ego view's trapezoid too. Pure.
 */
export function ringPolygon(corners: readonly ScreenPoint[]): ScreenPoint[] {
  const n = corners.length;
  let perimeter = 0;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % n]!;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    area2 += a.x * b.y - b.x * a.y;
  }
  const pxPerMm = perimeter / (2 * (CARD_W + CARD_H));
  const gap = Math.max(FOCUS_RING_MIN_GAP_PX, FOCUS_RING_GAP_MM * pxPerMm);
  // Outward normal of edge (a→b): rotate its direction by -90° for a counter-clockwise polygon, +90° for clockwise.
  const sign = area2 >= 0 ? 1 : -1;
  const lines = corners.map((a, i) => {
    const b = corners[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const nx = sign * dy;
    const ny = -sign * dx;
    return { px: a.x + nx * gap, py: a.y + ny * gap, dx, dy, nx, ny };
  });
  return corners.map((c, i) => {
    const l1 = lines[(i - 1 + n) % n]!;
    const l2 = lines[i]!;
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    // Parallel neighbours (a degenerate projection): push the corner out along the shared normal.
    if (Math.abs(det) < 1e-9) return { x: c.x + l2.nx * gap, y: c.y + l2.ny * gap };
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
    return { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t };
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface FocusRing {
  /** Draw the ring around `card`, whose projected corners (host-relative CSS px) are `corners`, or hide it with null. */
  set(target: { card: string; corners: readonly ScreenPoint[] } | null, colours: { ring: string; halo: string }): void;
  /** The ring's polygon while shown (debug and tests). */
  points(): ScreenPoint[] | null;
  dispose(): void;
}

/** A ring element over the canvas in `host` (absolutely positioned, ignores the pointer, hidden from screen readers). */
export function createFocusRing(host: HTMLElement): FocusRing {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('data-scene', 'focus-ring');
  svg.setAttribute('data-testid', 'focus-ring');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', display: 'none' });
  const halo = document.createElementNS(SVG_NS, 'polygon');
  const ring = document.createElementNS(SVG_NS, 'polygon');
  for (const [el, w] of [
    [halo, FOCUS_RING_PX.halo],
    [ring, FOCUS_RING_PX.ring],
  ] as const) {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke-width', String(w));
    el.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(el);
  }
  ring.setAttribute('stroke-dasharray', FOCUS_RING_DASH);
  host.appendChild(svg);
  let shown: ScreenPoint[] | null = null;
  let key = '';
  return {
    set(target, colours) {
      const corners = target?.corners ?? null;
      const points = corners && corners.length >= 3 && corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? ringPolygon(corners) : null;
      const usable = points && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? points : null;
      const next = usable ? `${usable.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}|${colours.ring}|${colours.halo}|${target!.card}` : '';
      if (next === key) return;
      key = next;
      shown = usable ? usable.map((p) => ({ x: p.x, y: p.y })) : null;
      if (!usable) {
        svg.style.display = 'none';
        svg.removeAttribute('data-focus-card');
        return;
      }
      const attr = usable.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      svg.setAttribute('data-focus-card', target!.card);
      halo.setAttribute('points', attr);
      ring.setAttribute('points', attr);
      halo.setAttribute('stroke', colours.halo);
      ring.setAttribute('stroke', colours.ring);
      svg.style.display = 'block';
    },
    points: () => (shown ? shown.map((p) => ({ ...p })) : null),
    dispose() {
      svg.remove();
    },
  };
}
