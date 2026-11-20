// Surface and surround colours equal the look's design tokens (docs/design/m8/m7-adjustments.md, M7-P1: "Surface and
// surround colours equal the look's `mat` and `frame` tokens … a unit test compares"; visual.md 2.2: the shell wears the
// look, so the table and the chrome around it are one material). The looks spec measures the same colours on screen.
import { describe, expect, it } from 'vitest';
import { CODEX_WORLD } from '../../../../src/themes/codex/index';
import { GRAPHITE_WORLD } from '../../../../src/themes/graphite/index';
import { LISTED_THEME_IDS, loadTheme, type ThemeId } from '../../../../src/themes/index';
import type { WorldSpec } from '../../../../src/themes/kit/look';
import { KITCHEN_WORLD } from '../../../../src/themes/kitchen/index';
import { PLAIN_WORLD } from '../../../../src/themes/plain/index';
import { LOOKS, type LookTokens } from '../../../../src/ui/design/tokens';

const WORLDS: Record<string, Omit<WorldSpec, 'seats'>> = { plain: PLAIN_WORLD, kitchen: KITCHEN_WORLD, graphite: GRAPHITE_WORLD, codex: CODEX_WORLD };
/** Plain's tokens (docs/design/m8/visual.md 2.3; mock.html `:root`) until the kit's tokens carry the Plain look. */
const PLAIN_TOKENS = { mat: '#f2f2f2', frame: '#e3e3e3' };

function tokensOf(id: ThemeId): { mat: string; frame: string } {
  const t = (LOOKS as Partial<Record<string, LookTokens>>)[id];
  if (t) return t.colour;
  expect(id).toBe('plain');
  return PLAIN_TOKENS;
}

describe.each(LISTED_THEME_IDS.map((id) => [id] as const))('%s', (id) => {
  it('its table surface is the look’s mat token and what frames it is the frame token', async () => {
    const theme = await loadTheme(id);
    const world = WORLDS[id]!;
    const tokens = tokensOf(id);
    expect(world.surface.toLowerCase()).toBe(tokens.mat.toLowerCase());
    expect(world.surround.toLowerCase()).toBe(tokens.frame.toLowerCase());
    // The HUD and the contrast rules see the same table colour.
    expect(theme.tokens.colours.surface.toLowerCase()).toBe(tokens.mat.toLowerCase());
  });
});

describe('Plain', () => {
  it('is the pale slab on a pale desk: the room behind the desk is the desk’s colour, so the horizon has no seam', async () => {
    const plain = await loadTheme('plain');
    expect(plain.lighting.background.toLowerCase()).toBe(PLAIN_WORLD.surround.toLowerCase());
    // Not pure white: a white-bordered card keeps an edge.
    expect(PLAIN_WORLD.surface.toLowerCase()).not.toBe('#ffffff');
  });
});
