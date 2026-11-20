/**
 * Applying a look to the page (PLAN Milestone 7, Principles: "One design system … Nothing is styled ad hoc"; Owner
 * decisions: "All three looks are kept, as the three themes of the redesign"). The look's `--ds-*` variables
 * (ui/design/tokens.ts designCssVars) dress the design system's components. Components from before M7 read the M4
 * `--sp-*` variables; under a look's own table theme those are mapped from the look too, so every panel, menu and
 * dialog wears the same look. An M4 theme (set by the debug hook or an older save) keeps its own `--sp-*` HUD tokens,
 * and the design system's components then wear the viewer's stored look (M7-C decision).
 */
import { hudCssVars, lookOfTheme } from '../../themes/index';
import { DEFAULT_LOOK, type LookId, type Theme } from '../../themes/types';
import { designCssVars, lookTokens, type LookTokens } from './tokens';
// The kit's side effects (stylesheet, bundled face) come from ./kit, imported by every page and kit component, not
// here: this module stays loadable in Node, where the Playwright specs import it.

/** The look the HUD wears: the table theme's own look, else the viewer's stored look. */
export function hudLook(theme: Theme, stored: LookId = DEFAULT_LOOK): LookId {
  return lookOfTheme(theme.id) ?? stored;
}

/** The M4 `--sp-*` HUD variables taken from a look, so components from before M7 follow it. */
export function spVarsFromLook(look: LookTokens): Record<string, string> {
  const c = look.colour;
  return {
    '--sp-bg': c.panel,
    '--sp-fg': c.ink,
    '--sp-muted': c.muted,
    '--sp-surface': c.panel,
    '--sp-border': c.border,
    '--sp-accent': c.accent,
    '--sp-danger': c.danger,
    '--sp-warning': c.warning,
    '--sp-focus': c.focus,
    '--sp-font': look.type.body,
    '--sp-font-mono': look.type.mono,
    '--sp-radius-sm': `${look.radius.sm}px`,
    '--sp-radius-md': `${look.radius.button}px`,
    '--sp-radius-lg': `${look.radius.panel}px`,
    '--sp-hud-scheme': look.scheme,
    '--sp-hud-panel': c.panel,
    '--sp-hud-panel-border': c.border,
    '--sp-hud-shadow': look.elevation.pop,
    '--sp-hud-blur': '0px',
    '--sp-hud-overlay': c.overlay,
    '--sp-table-surface': c.mat,
    'color-scheme': look.scheme,
  };
}

/**
 * Every CSS variable of the HUD and the pages for a theme and the viewer's look: the theme's `--sp-*`, mapped from the
 * look under a look's table theme, and the look's `--ds-*` (durations zero under reduced motion).
 */
export function lookCssVars(theme: Theme, look: LookId, reduced = false): Record<string, string> {
  const tokens = lookTokens(look);
  const vars = hudCssVars(theme.tokens);
  const own = lookOfTheme(theme.id) !== null;
  if (own) Object.assign(vars, spVarsFromLook(tokens));
  const ds = designCssVars(tokens, reduced);
  // Under an M4 theme the page keeps that theme's colour scheme (its own panels and form controls follow it).
  if (!own) delete ds['color-scheme'];
  Object.assign(vars, ds);
  return vars;
}

/**
 * Put a look's `--ds-*` variables on an element (the shell's root, a harness page) and mark it with `data-look`.
 * Returns a function that removes them again. Added by M8-P1.
 */
export function applyLook(el: HTMLElement, look: LookId, reduced = false): () => void {
  const vars = designCssVars(lookTokens(look), reduced);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset['look'] = look;
  return () => {
    for (const k of Object.keys(vars)) el.style.removeProperty(k);
    delete el.dataset['look'];
  };
}
