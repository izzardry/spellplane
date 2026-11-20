/**
 * PLAN M7-P2: the design system's tokens for the three looks (Principles: "One design system … accessibility
 * (contrast, focus, nothing by hue alone) is kept through the redesign"; A0: no blur or backdrop-filter). Every text
 * colour a component sets on a surface meets WCAG AA in every look; the looks change materials, not sizes.
 */
import { describe, expect, it } from 'vitest';
import { paper } from '../../../src/themes/paper/index';
import { contrastRatio } from '../../../src/themes/signals';
import { stubTheme } from '../../../src/themes/stub';
import type { LookId } from '../../../src/themes/types';
import { WCAG_AA } from '../../../src/ui/a11y/index';
import { hudLook, lookCssVars, spVarsFromLook } from '../../../src/ui/design/css';
import { designCssVars, LAYOUT, LOOKS, lookTokens } from '../../../src/ui/design/tokens';

const IDS: LookId[] = ['kitchen', 'graphite', 'codex'];

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
    expect(hudLook(paper)).toBe('kitchen');
  });
});
