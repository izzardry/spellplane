/**
 * Theme loading and HUD token mapping (DESIGN "Themes and rendering": themes load on demand as separate chunks;
 * tokens are exposed to the HUD as CSS custom properties).
 */
import type { Theme, ThemeId, ThemeTokens } from './types';

export * from './types';

/** Theme ids that exist today (DESIGN "Themes and rendering"). */
export const THEME_IDS: readonly ThemeId[] = ['paper', 'dusk', 'wyrm', 'stonetable'];

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * CSS custom properties for the HUD (DESIGN "Themes and rendering", Tokens): --sp-<colour> (e.g. --sp-bg, --sp-fg),
 * --sp-seat-<i>, --sp-font, --sp-font-mono, --sp-font-size(-small|-large), --sp-font-weight(-bold),
 * --sp-radius-<sm|md|lg>, --sp-space-<xs..xl>. Sizes are px.
 */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  const { seats, ...colours } = tokens.colours;
  for (const [name, value] of Object.entries(colours)) vars[`--sp-${kebab(name)}`] = value;
  for (const seat of seats) vars[`--sp-seat-${seat.index}`] = seat.colour;
  vars['--sp-font'] = tokens.type.family;
  vars['--sp-font-mono'] = tokens.type.mono;
  vars['--sp-font-size'] = `${tokens.type.size}px`;
  vars['--sp-font-size-small'] = `${tokens.type.small}px`;
  vars['--sp-font-size-large'] = `${tokens.type.large}px`;
  vars['--sp-font-weight'] = String(tokens.type.weight);
  vars['--sp-font-weight-bold'] = String(tokens.type.weightBold);
  for (const [name, value] of Object.entries(tokens.radii)) vars[`--sp-radius-${name}`] = `${value}px`;
  for (const [name, value] of Object.entries(tokens.spacing)) vars[`--sp-space-${name}`] = `${value}px`;
  return vars;
}

/** Load a theme chunk on demand (DESIGN "Themes and rendering"). Only Paper exists before M4. */
export async function loadTheme(id: ThemeId): Promise<Theme> {
  switch (id) {
    case 'paper':
      return (await import('./paper/index')).paper;
    default:
      throw new Error(`not implemented: M4 (theme ${id})`);
  }
}
