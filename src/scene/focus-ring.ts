/**
 * The keyboard focus ring on the table (DESIGN "Input and interaction design", Accessibility: "every card action is
 * reachable from the keyboard by cycling focus through cards in a zone"; ViewState.focused: "drawn with a focus ring
 * distinct from hover and selection"; PLAN M5-P4). Hover and selection are outlines drawn in the card shader in the
 * theme's colours; the focus ring is a separate double stroke over the canvas, in the theme's focus colour on a halo of
 * its background colour, a few millimetres outside the card's edge, so it reads on any table and beside any outline.
 * It follows the card's projected corners each drawn frame (a trapezoid in the ego view), never touches the face, and
 * never animates.
 */
import type { ScreenPoint } from './types';

/** Gap between the card's edge and the ring, mm on the table. */
export const FOCUS_RING_GAP_MM = 2.5;
/** Stroke widths in CSS px: the focus colour, and the halo under it. */
export const FOCUS_RING_PX = { ring: 3, halo: 7 } as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface FocusRing {
  /** Draw the ring around `card` through these screen points (host-relative CSS px), or hide it with null. */
  set(target: { card: string; points: readonly ScreenPoint[] } | null, colours: { ring: string; halo: string }): void;
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
  host.appendChild(svg);
  let shown: ScreenPoint[] | null = null;
  let key = '';
  return {
    set(target, colours) {
      const points = target?.points ?? null;
      const usable = points && points.length >= 3 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? points : null;
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
