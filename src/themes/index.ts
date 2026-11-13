/**
 * Theme loading and HUD token mapping (DESIGN "Themes and rendering": themes load on demand as separate chunks;
 * tokens are exposed to the HUD as CSS custom properties).
 */
import type { HudTokens, Theme, ThemeId, ThemeTokens } from './types';

export * from './types';
export * from './signals';

/** Theme ids that exist today (DESIGN "Themes and rendering"). */
export const THEME_IDS: readonly ThemeId[] = ['paper', 'dusk', 'wyrm', 'stonetable'];

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** HUD tokens of a theme without `tokens.hud`: Paper's light defaults (DESIGN "Themes and rendering", Tokens). Added by M4-C. */
export const DEFAULT_HUD_TOKENS: HudTokens = { scheme: 'light', panel: '#ffffff', panelBorder: '#8c8c8c', shadow: 'none', blur: 0, overlay: 'rgba(255, 255, 255, 0.92)' };

/**
 * CSS custom properties for the HUD (DESIGN "Themes and rendering", Tokens): --sp-<colour> (e.g. --sp-bg, --sp-fg),
 * --sp-seat-<i>, --sp-font, --sp-font-mono, --sp-font-size(-small|-large), --sp-font-weight(-bold),
 * --sp-radius-<sm|md|lg>, --sp-space-<xs..xl>. Sizes are px. v2 (M4-C): --sp-seat-<i>-ink, --sp-seat-<i>-glow,
 * --sp-hud-scheme (a `color-scheme` value), --sp-hud-panel, --sp-hud-panel-border, --sp-hud-shadow, --sp-hud-blur,
 * --sp-hud-overlay. M4-P6 owns the mapping from here on.
 */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  const { seats, ...colours } = tokens.colours;
  for (const [name, value] of Object.entries(colours)) vars[`--sp-${kebab(name)}`] = value;
  for (const seat of seats) {
    vars[`--sp-seat-${seat.index}`] = seat.colour;
    vars[`--sp-seat-${seat.index}-ink`] = seat.ink ?? tokens.colours.bg;
    vars[`--sp-seat-${seat.index}-glow`] = seat.glow ?? seat.colour;
  }
  vars['--sp-font'] = tokens.type.family;
  vars['--sp-font-mono'] = tokens.type.mono;
  vars['--sp-font-size'] = `${tokens.type.size}px`;
  vars['--sp-font-size-small'] = `${tokens.type.small}px`;
  vars['--sp-font-size-large'] = `${tokens.type.large}px`;
  vars['--sp-font-weight'] = String(tokens.type.weight);
  vars['--sp-font-weight-bold'] = String(tokens.type.weightBold);
  for (const [name, value] of Object.entries(tokens.radii)) vars[`--sp-radius-${name}`] = `${value}px`;
  for (const [name, value] of Object.entries(tokens.spacing)) vars[`--sp-space-${name}`] = `${value}px`;
  const hud = tokens.hud ?? DEFAULT_HUD_TOKENS;
  vars['--sp-hud-scheme'] = hud.scheme;
  vars['--sp-hud-panel'] = hud.panel;
  vars['--sp-hud-panel-border'] = hud.panelBorder;
  vars['--sp-hud-shadow'] = hud.shadow;
  vars['--sp-hud-blur'] = `${hud.blur}px`;
  vars['--sp-hud-overlay'] = hud.overlay;
  return vars;
}

/**
 * The HUD's custom properties for a theme (DESIGN "Themes and rendering", Tokens: "Exposed to the HUD as CSS custom
 * properties"; M4-P6): `tokensToCssVars`, with the HUD's panel colours in the two variables HUD components paint
 * panels and their frames with. The DOM never draws the table, so inside the HUD `--sp-surface` is the panel
 * (`tokens.hud.panel`) and `--sp-border` the panel border; the table's own values stay available as
 * `--sp-table-surface` and `--sp-table-border`. `color-scheme` follows `--sp-hud-scheme`. In Paper the two pairs are
 * the same colours, so the light HUD is unchanged.
 */
export function hudCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars = tokensToCssVars(tokens);
  const hud = tokens.hud ?? DEFAULT_HUD_TOKENS;
  vars['--sp-table-surface'] = tokens.colours.surface;
  vars['--sp-table-border'] = tokens.colours.border;
  vars['--sp-surface'] = hud.panel;
  vars['--sp-border'] = hud.panelBorder;
  vars['color-scheme'] = hud.scheme;
  return vars;
}

/** A `style` attribute value from custom properties (`--a: 1; --b: 2`). */
export function cssText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

/** Human names of the themes for the picker, without loading their chunks (DESIGN "Themes and rendering"). Added by M4-C. */
export const THEME_LABELS: Readonly<Record<ThemeId, string>> = { paper: 'Paper', dusk: 'Dusk', wyrm: 'Wyrm', stonetable: 'Stonetable' };

/** A stored setting as a theme id; anything unknown is Paper (store/types.ts Settings.theme is a string). Added by M4-C. */
export function themeIdOf(value: string): ThemeId {
  return (THEME_IDS as readonly string[]).includes(value) ? (value as ThemeId) : 'paper';
}

/**
 * Load a theme chunk on demand (DESIGN "Themes and rendering": "loaded on demand as separate chunks"): one dynamic
 * import per theme, so Vite emits one chunk each. Dusk, Wyrm and Stonetable are stubs until M4-P3, M4-P4 and M4-P5.
 */
export async function loadTheme(id: ThemeId): Promise<Theme> {
  switch (id) {
    case 'paper':
      return (await import('./paper/index')).paper;
    case 'dusk':
      return (await import('./dusk/index')).dusk;
    case 'wyrm':
      return (await import('./wyrm/index')).wyrm;
    case 'stonetable':
      return (await import('./stonetable/index')).stonetable;
  }
}
