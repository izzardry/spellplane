import fs from 'node:fs';
import path from 'node:path';
/**
 * PLAN M7-P2: the design system's tokens for the three looks (Principles: "One design system … accessibility
 * (contrast, focus, nothing by hue alone) is kept through the redesign"; A0: no blur or backdrop-filter). Every text
 * colour a component sets on a surface meets WCAG AA in every look; the looks change materials, not sizes.
 */
import { describe, expect, it } from 'vitest';
import { paper } from '../../../src/themes/paper/index';
import { contrastRatio } from '../../../src/themes/signals';
import { stubTheme } from '../../../src/themes/stub';
import { DEFAULT_LOOK, type LookId } from '../../../src/themes/types';
import { WCAG_AA } from '../../../src/ui/a11y/index';
import { hudLook, lookCssVars, spVarsFromLook } from '../../../src/ui/design/css';
import { designCssVars, LAYOUT, LOOKS, lookTokens } from '../../../src/ui/design/tokens';

// Four looks (visual.md 2.2).
const IDS: LookId[] = ['plain', 'kitchen', 'graphite', 'codex'];

/** Text colour on surface, as the components pair them (ui/design/base.css and the HUD components). */
const PAIRS: [ink: string, on: string, where: string][] = [
  ['ink', 'panel', 'body text on panels and plates'],
  ['ink', 'panelRaised', 'menus, popovers and dialogs'],
  ['ink', 'chip', 'chips and hovered menu items'],
  ['ink', 'mat', 'start page text on the mat'],
  ['muted', 'panel', 'secondary text in panels'],
  ['muted', 'panelRaised', 'menu group labels and shortcut keys'],
  ['accentInk', 'accent', 'the primary button'],
  ['onInk', 'on', 'the current step and pressed toggles'],
  ['badgeInk', 'badge', 'count badges'],
  ['tipInk', 'tip', 'toasts and tooltips'],
  ['coachInk', 'coach', 'coach marks'],
];

describe('design tokens (PLAN M7-P2)', () => {
  for (const id of IDS) {
    const c = LOOKS[id].colour as unknown as Record<string, string>;
    describe(id, () => {
      for (const [ink, on, where] of PAIRS) {
        it(`${ink} on ${on} meets AA (${where})`, () => {
          expect(contrastRatio(c[ink]!, c[on]!)).toBeGreaterThanOrEqual(WCAG_AA.text);
        });
      }
      it('danger text on panels meets AA (it is never told by hue alone: a word or icon goes with it)', () => {
        expect(contrastRatio(c.danger!, c.panel!)).toBeGreaterThanOrEqual(WCAG_AA.text);
      });
      it('the focus ring stands out against panels and the mat (3:1, non-text contrast)', () => {
        expect(contrastRatio(c.focus!, c.panel!)).toBeGreaterThanOrEqual(3);
      });
      it('the primary button is the one accent: its fill differs from every panel surface', () => {
        for (const s of ['panel', 'panelRaised', 'chip', 'ghost']) expect(c.accent).not.toBe(c[s]);
      });
    });
  }

  it('no token uses blur or backdrop-filter (Safari: CSS blur over the canvas is a measured cost)', () => {
    for (const id of IDS) for (const v of Object.values(designCssVars(LOOKS[id]))) expect(v).not.toMatch(/blur|backdrop/i);
  });

  it('the looks share sizes, spacing and control heights: only materials and mood change', () => {
    const keys = (id: LookId) => Object.entries(designCssVars(LOOKS[id])).filter(([k]) => /^--ds-(space|type|control|edge)/.test(k));
    expect(keys('graphite')).toEqual(keys('kitchen'));
    expect(keys('codex')).toEqual(keys('kitchen'));
    // Touch targets keep the 44 pt minimum (docs/design/m7-hud-proposal.md, iPad).
    expect(LAYOUT.control.touch).toBeGreaterThanOrEqual(44);
    expect(LAYOUT.control.primary).toBeGreaterThanOrEqual(44);
  });

  it('reduced motion zeroes every duration', () => {
    for (const id of IDS) {
      const vars = designCssVars(LOOKS[id], true);
      for (const [k, v] of Object.entries(vars)) if (k.startsWith('--ds-duration-')) expect(v).toBe('0ms');
    }
  });
});

describe('applying a look (ui/design/css.ts)', () => {
  const kitchenTheme = stubTheme('kitchen', 'Kitchen Table', { defaultRig: 'birdseye', tilt: 1 }, 'test');

  it("a look's own table theme dresses the older --sp-* components in the look too", () => {
    const vars = lookCssVars(kitchenTheme, 'kitchen');
    const t = lookTokens('kitchen');
    expect(vars['--ds-panel']).toBe(t.colour.panel);
    expect(vars['--sp-fg']).toBe(t.colour.ink);
    expect(vars['--sp-surface']).toBe(t.colour.panel);
    expect(vars['--sp-hud-blur']).toBe('0px');
    expect(vars['color-scheme']).toBe('light');
    expect(spVarsFromLook(lookTokens('codex'))['--sp-font']).toBe(lookTokens('codex').type.body);
  });

  it('an M4 theme keeps its own --sp-* HUD tokens and colour scheme; the design system wears the stored look', () => {
    const vars = lookCssVars(paper, 'graphite');
    expect(vars['--sp-fg']).toBe(paper.tokens.colours.fg);
    expect(vars['--ds-accent']).toBe(lookTokens('graphite').colour.accent);
    expect(vars['color-scheme']).toBe(paper.tokens.hud?.scheme ?? 'light');
  });

  it("the HUD's look is the table theme's own look, else the stored one", () => {
    expect(hudLook(kitchenTheme, 'codex')).toBe('kitchen');
    expect(hudLook(paper, 'codex')).toBe('codex');
    expect(hudLook(paper)).toBe(DEFAULT_LOOK);
  });
});

describe('the M8 kit tokens (PLAN M8-P1; visual.md 2.3, 2.12)', () => {
  const keysOf = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keysOf(v as object, `${prefix}${k}.`) : [`${prefix}${k}`]));

  it('every look defines every token, none empty', () => {
    const want = keysOf(LOOKS.plain).sort();
    for (const id of IDS) {
      expect(keysOf(LOOKS[id]).sort(), id).toEqual(want);
      for (const [k, v] of Object.entries(designCssVars(LOOKS[id]))) expect(String(v).trim(), `${id} ${k}`).not.toBe('');
    }
    for (const k of ['--ds-veil', '--ds-font-reading', '--ds-radius-button', '--ds-radius-panel', '--ds-radius-card', '--ds-radius-sheet', '--ds-elevation-sheet', '--ds-elevation-dialog', '--ds-elevation-pressed', '--ds-elevation-well', '--ds-elevation-stack', '--ds-texture-page', '--ds-texture-dense', '--ds-texture-grain', '--ds-mana-w', '--ds-mana-c', '--ds-control-xs', '--ds-control-lg', '--ds-space-xxxl', '--ds-space-huge', '--ds-foil-0', '--ds-foil-line']) {
      for (const id of IDS) expect(designCssVars(LOOKS[id])[k], `${id} ${k}`).toBeTruthy();
    }
  });

  it('control heights are 28, 36, 44 and 56 only', () => {
    expect([LAYOUT.control.xs, LAYOUT.control.sm, LAYOUT.control.md, LAYOUT.control.lg]).toEqual([28, 36, 44, 56]);
    for (const v of Object.values(LAYOUT.control)) expect([28, 36, 44, 56]).toContain(v);
  });

  it("Plain's ink, muted, danger and success reach 4.5:1 on mat, chip, panel and panelRaised", () => {
    const c = LOOKS.plain.colour;
    for (const ink of [c.ink, c.muted, c.danger, c.success]) for (const on of [c.mat, c.chip, c.panel, c.panelRaised]) expect(contrastRatio(ink, on), `${ink} on ${on}`).toBeGreaterThanOrEqual(4.5);
  });

  it('every look: ink and muted on panel and panelRaised, accentInk on accent 4.5:1, the focus ring 3:1', () => {
    for (const id of IDS) {
      const c = LOOKS[id].colour;
      for (const ink of [c.ink, c.muted]) for (const on of [c.panel, c.panelRaised]) expect(contrastRatio(ink, on), `${id}: ${ink} on ${on}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accentInk, c.accent), `${id} primary`).toBeGreaterThanOrEqual(4.5);
      for (const on of [c.panel, c.panelRaised, c.mat]) expect(contrastRatio(c.focus, on), `${id} focus on ${on}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('no token contains blur( or backdrop', () => {
    for (const id of IDS) expect(JSON.stringify(LOOKS[id])).not.toMatch(/blur\(|backdrop/i);
    for (const id of IDS) for (const v of Object.values(designCssVars(LOOKS[id]))) expect(v).not.toMatch(/blur\(|backdrop/i);
  });

  it('Plain is Ztyle on paper: one monospace face, round buttons, grey-scale chrome', () => {
    const p = LOOKS.plain;
    expect(p.type.body.startsWith('"Fira Code"')).toBe(true);
    expect(p.type.heading).toBe(p.type.body);
    expect(p.radius.button).toBeGreaterThanOrEqual(999);
    expect(p.colour.accent).toBe(p.colour.ink);
    expect(designCssVars(p)['--ds-texture-grain']).toBe('var(--ds-grain-url)');
    // The tile is bound once in the kit's stylesheet, so the tokens import no asset (Node loads them in e2e specs).
    expect(fs.readFileSync(path.join('src', 'ui', 'design', 'base.css'), 'utf8')).toMatch(/--ds-grain-url:\s*url\('\.\/grain\.png'\)/);
    expect(designCssVars(LOOKS.graphite)['--ds-texture-grain']).toBe('none');
  });
});

describe('stacking order (LAYOUT.z)', () => {
  it('is one order: the kit reads it as --ds-z-*, and a menu opens above a dialog scrim', () => {
    const vars = designCssVars(LOOKS.plain);
    for (const [k, v] of Object.entries(LAYOUT.z)) expect(vars[`--ds-z-${k}`], k).toBe(String(v));
    expect(LAYOUT.z.menu).toBeGreaterThan(LAYOUT.z.dialog);
    expect(LAYOUT.z.coach).toBeGreaterThan(LAYOUT.z.menu);
    expect(LAYOUT.z.toast).toBeGreaterThan(LAYOUT.z.coach);
    const css = fs.readFileSync(path.join('src', 'ui', 'design', 'base.css'), 'utf8');
    const zOf = (sel: string): string | undefined => new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{[^}]*?z-index:\\s*([^;]+);`).exec(css)?.[1];
    const want: [string, keyof typeof LAYOUT.z][] = [['.ds-menu', 'menu'], ['.ds-scrim', 'dialog'], ['.ds-coach', 'coach'], ['.ds-toast-host', 'toast']];
    for (const [sel, k] of want) expect(zOf(sel), sel).toBe(`var(--ds-z-${k}, ${LAYOUT.z[k]})`);
  });
});
