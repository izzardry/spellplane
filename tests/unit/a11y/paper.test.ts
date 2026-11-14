/**
 * Paper meets WCAG AA contrast throughout (DESIGN "Input and interaction design", Accessibility; "Themes and
 * rendering": Paper is black on white; PLAN M5-P4). Text 4.5:1 (1.4.3), non-text marks a player must see 3:1 (1.4.11):
 * every text colour on every surface it is set on (the HUD panels, the table, the page around the table), the zone
 * hairlines, the hover, selection, pending and ghost outlines, the keyboard focus ring, seat colours as text and their
 * ink. The DOM parts are also checked in the browser by axe (tests/e2e/a11y/axe.spec.ts); this covers what axe cannot
 * see: what the scene draws on the canvas.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb } from '../../../src/themes/signals';
import { paper, PAPER_SURROUND } from '../../../src/themes/paper/index';
import { WCAG_AA } from '../../../src/ui/a11y/index';

const c = paper.tokens.colours;
const hud = paper.tokens.hud!;
const d = paper.cardDressing;

/** A colour drawn at `alpha` over `under`, as hex. */
function over(colour: string, alpha: number, under: string): string {
  const a = hexToRgb(colour);
  const b = hexToRgb(under);
  return `#${a.map((v, i) => Math.round((v * alpha + b[i]! * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

describe('Paper text contrast (WCAG 1.4.3, 4.5:1)', () => {
  const surfaces = { bg: c.bg, surface: c.surface, panel: hud.panel, around: PAPER_SURROUND };
  for (const [name, colour] of Object.entries({ fg: c.fg, muted: c.muted, accent: c.accent, danger: c.danger, warning: c.warning })) {
    it(`${name} text on every surface`, () => {
      for (const [where, bg] of Object.entries(surfaces)) expect(contrastRatio(colour, bg), `${name} ${colour} on ${where} ${bg}`).toBeGreaterThanOrEqual(WCAG_AA.text);
    });
  }
  it('the page around the table is opaque and text on the translucent overlay stays readable over the table', () => {
    expect(contrastRatio(c.fg, over('#ffffff', 0.92, c.fg))).toBeGreaterThanOrEqual(WCAG_AA.text);
  });
  it('seat colours as text (confirm prompt names), and their ink on seat-coloured chips', () => {
    for (const s of c.seats) {
      for (const bg of [c.surface, hud.panel, PAPER_SURROUND]) expect(contrastRatio(s.colour, bg), `seat ${s.index} on ${bg}`).toBeGreaterThanOrEqual(WCAG_AA.text);
      expect(contrastRatio(s.ink ?? c.bg, s.colour), `ink on seat ${s.index}`).toBeGreaterThanOrEqual(WCAG_AA.text);
    }
  });
});

describe('Paper non-text contrast (WCAG 1.4.11, 3:1)', () => {
  it('zone hairlines and panel borders against the table and the page', () => {
    for (const bg of [c.surface, c.bg]) {
      expect(contrastRatio(c.border, bg)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
      expect(contrastRatio(hud.panelBorder, bg)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
    }
  });
  it('hover, selection and pending outlines against the table', () => {
    for (const o of [d.hover, d.selected, d.pending]) expect(contrastRatio(o.colour, c.surface), o.colour).toBeGreaterThanOrEqual(WCAG_AA.nonText);
    expect(contrastRatio(d.tappedBadge, c.surface)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
    expect(contrastRatio(d.displacedMarker, c.surface)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
  });
  it('the ghost outline at a displaced card\'s home slot, as drawn (its colour at its opacity over the table)', () => {
    expect(contrastRatio(over(d.ghost.colour, d.ghost.opacity, c.surface), c.surface)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
  });
  it('the keyboard focus ring against the table, the page around it and its own halo', () => {
    for (const bg of [c.surface, PAPER_SURROUND, c.bg]) expect(contrastRatio(c.focus, bg), bg).toBeGreaterThanOrEqual(WCAG_AA.nonText);
  });
  it('seat colours (lines, avatars, glyphs) against the table', () => {
    for (const s of c.seats) expect(contrastRatio(s.colour, c.surface)).toBeGreaterThanOrEqual(WCAG_AA.nonText);
  });
});
