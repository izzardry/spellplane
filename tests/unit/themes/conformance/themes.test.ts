// Theme checklist, run over every registered theme (PLAN M4-P6: per-theme seat-colour tuning, HUD token mapping to CSS
// custom properties, automated conformance; DESIGN "Themes and rendering": "the eight seat colours, tuned per theme for
// contrast", "Exposed to the HUD as CSS custom properties", "every theme must render all of them distinguishably";
// "Input and interaction design", Accessibility: seat colours paired with a shape or pattern, Paper meets WCAG AA).
import { describe, expect, it } from 'vitest';
import {
  SEAT_CONTRAST,
  SIGNALS,
  THEME_IDS,
  colourDistance,
  contrastRatio,
  cssText,
  hexToRgb,
  hudCssVars,
  loadTheme,
  tokensToCssVars,
  type Theme,
} from '../../../../src/themes/index';
import { paper } from '../../../../src/themes/paper/index';

const themes: Theme[] = await Promise.all(THEME_IDS.map((id) => loadTheme(id)));

/** An opaque sRGB hex colour for a CSS colour: hex as is, rgb()/rgba() composited over `under`. */
function opaque(css: string, under: string): string {
  if (css.startsWith('#')) return css;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css.trim());
  if (!m) throw new Error(`cannot read colour ${css}`);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const base = hexToRgb(under).map((c) => c * 255);
  const mixed = [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + base[k]! * (1 - a)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(themes.map((t) => [t.id, t] as const))('%s', (_id, theme) => {
  const c = theme.tokens.colours;
  const seats = c.seats;

  it('has eight seat colours, index = position, each a hex colour', () => {
    expect(seats.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const s of seats) expect(s.colour).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it(`seat colours reach ${SEAT_CONTRAST.surface}:1 against the table surface (WCAG 1.4.11)`, () => {
    for (const s of seats) expect(contrastRatio(s.colour, c.surface), `seat ${s.index} ${s.colour} on ${c.surface}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.surface);
  });

  it(`every two seat colours are at least ${SEAT_CONTRAST.pairwise} apart`, () => {
    for (let i = 0; i < seats.length; i++)
      for (let j = i + 1; j < seats.length; j++) expect(colourDistance(seats[i]!.colour, seats[j]!.colour), `seats ${i} and ${j}`).toBeGreaterThanOrEqual(SEAT_CONTRAST.pairwise);
  });

  it('seat colours reach 3:1 against the HUD panels they mark (avatar edges, log lines, chips)', () => {
    const panel = opaque((theme.tokens.hud ?? { panel: c.bg }).panel, c.bg);
    for (const s of seats) expect(contrastRatio(s.colour, panel), `seat ${s.index} ${s.colour} on panel ${panel}`).toBeGreaterThanOrEqual(3);
  });

  it('text on a seat-coloured chip (its ink) reaches 4.5:1 (WCAG AA)', () => {
    for (const s of seats) {
      const ink = s.ink ?? c.bg;
      expect(contrastRatio(ink, s.colour), `ink ${ink} on seat ${s.index} ${s.colour}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('pairs every seat with the same pattern and glyph as every other theme, all distinct (nothing by hue alone)', () => {
    expect(seats.map((s) => [s.pattern, s.glyph])).toEqual(paper.tokens.colours.seats.map((s) => [s.pattern, s.glyph]));
    expect(new Set(seats.map((s) => s.pattern)).size).toBe(8);
    expect(new Set(seats.map((s) => s.glyph)).size).toBe(8);
  });

  it('maps every token to a CSS custom property the HUD reads', () => {
    const vars = tokensToCssVars(theme.tokens);
    for (const s of seats) {
      expect(vars[`--sp-seat-${s.index}`]).toBe(s.colour);
      expect(vars[`--sp-seat-${s.index}-ink`]).toBe(s.ink ?? c.bg);
      expect(vars[`--sp-seat-${s.index}-glow`]).toBe(s.glow ?? s.colour);
    }
    for (const k of ['bg', 'fg', 'muted', 'accent', 'danger', 'warning', 'focus'] as const) expect(vars[`--sp-${k}`]).toBe(c[k]);
    expect(vars['--sp-font']).toBe(theme.tokens.type.family);
    expect(vars['--sp-font-size']).toBe(`${theme.tokens.type.size}px`);
    for (const [k, v] of Object.entries(theme.tokens.radii)) expect(vars[`--sp-radius-${k}`]).toBe(`${v}px`);
    for (const [k, v] of Object.entries(theme.tokens.spacing)) expect(vars[`--sp-space-${k}`]).toBe(`${v}px`);
    for (const [k, v] of Object.entries(vars)) {
      expect(k).toMatch(/^--sp-[a-z0-9-]+$/);
      expect(v, k).not.toMatch(/undefined|NaN|\[object/);
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it('paints HUD panels with the HUD tokens and keeps the table colours apart', () => {
    const hud = theme.tokens.hud;
    const vars = hudCssVars(theme.tokens);
    expect(vars['--sp-surface']).toBe(hud?.panel ?? '#ffffff');
    expect(vars['--sp-border']).toBe(hud?.panelBorder ?? '#8c8c8c');
    expect(vars['--sp-table-surface']).toBe(c.surface);
    expect(vars['--sp-table-border']).toBe(c.border);
    expect(vars['color-scheme']).toBe(hud?.scheme ?? 'light');
    expect(vars['--sp-hud-scheme']).toBe(vars['color-scheme']);
  });

  it('HUD text reaches 4.5:1 on its panels and its page background (WCAG AA)', () => {
    const panel = opaque((theme.tokens.hud ?? { panel: c.bg }).panel, c.bg);
    expect(contrastRatio(c.fg, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.muted, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('styles every functional signal it is checked for (the theme checklist)', () => {
    // Each signal names the theme fields that draw it (themes/signals.ts styledBy); a theme leaves none of them out.
    for (const s of SIGNALS)
      for (const path of s.styledBy) {
        if (path.startsWith('lineStyle(')) {
          const kind = /lineStyle\('(\w+)'\)/.exec(path)![1] as Parameters<Theme['lineStyle']>[0];
          for (const seat of seats) {
            const style = theme.lineStyle(kind, seat);
            expect(style.widthPx, `${s.id}: ${path}`).toBeGreaterThan(0);
            expect(style.colour, `${s.id}: ${path}`).toBeTruthy();
          }
          continue;
        }
        let v: unknown = theme;
        for (const key of path.split('.')) v = (v as Record<string, unknown>)[key];
        if (path === 'cardDressing.back') continue; // null means the game's neutral back (DESIGN: no official card back).
        if (path === 'tokens.hud') continue; // optional: Paper's light HUD defaults apply (DEFAULT_HUD_TOKENS).
        expect(v, `${s.id}: ${theme.id}.${path}`).not.toBeUndefined();
        expect(v, `${s.id}: ${theme.id}.${path}`).not.toBeNull();
        // A switch that turns the signal off is not a style of it.
        if (typeof v === 'boolean') expect(v, `${s.id}: ${theme.id}.${path}`).toBe(true);
      }
  });
});

describe('style text', () => {
  it('joins custom properties into a style attribute', () => {
    expect(cssText({ '--a': '1', '--b': 'red' })).toBe('--a: 1; --b: red');
  });
  it('covers every registered theme', () => {
    expect(themes.map((t) => t.id)).toEqual([...THEME_IDS]);
  });
});
