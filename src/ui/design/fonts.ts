/**
 * Fira Code, Plain's one face (docs/design/m8/visual.md V10 and 2.6: "weights 300, 400, 500, 600, 700, `latin` and
 * `latin-ext`, bundled as woff2 through `@fontsource/fira-code` and precached by the service worker";
 * `font-variant-ligatures: none`, tabular numerals). The woff2 files are imported as assets, so Vite emits them into
 * the build and the service worker's precache list (vite.config.ts globPatterns `woff2`) holds them: the face works
 * offline and with the network blocked. Faces are registered with the FontFace API under unicode ranges (latin,
 * latin-ext); the browser downloads a file only when text needs it. Added by M8-P1.
 */
import l300 from '@fontsource/fira-code/files/fira-code-latin-300-normal.woff2';
import l400 from '@fontsource/fira-code/files/fira-code-latin-400-normal.woff2';
import l500 from '@fontsource/fira-code/files/fira-code-latin-500-normal.woff2';
import l600 from '@fontsource/fira-code/files/fira-code-latin-600-normal.woff2';
import l700 from '@fontsource/fira-code/files/fira-code-latin-700-normal.woff2';
import e300 from '@fontsource/fira-code/files/fira-code-latin-ext-300-normal.woff2';
import e400 from '@fontsource/fira-code/files/fira-code-latin-ext-400-normal.woff2';
import e500 from '@fontsource/fira-code/files/fira-code-latin-ext-500-normal.woff2';
import e600 from '@fontsource/fira-code/files/fira-code-latin-ext-600-normal.woff2';
import e700 from '@fontsource/fira-code/files/fira-code-latin-ext-700-normal.woff2';

/** The family name every look token uses for Plain (ui/design/tokens.ts FIRA). */
export const FIRA_FAMILY = 'Fira Code';

/** Fontsource's unicode ranges for the two subsets. */
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/** Every face as [weight, url, unicode range]. */
export const FIRA_FACES: readonly (readonly [number, string, string])[] = [
  [300, l300, LATIN],
  [400, l400, LATIN],
  [500, l500, LATIN],
  [600, l600, LATIN],
  [700, l700, LATIN],
  [300, e300, LATIN_EXT],
  [400, e400, LATIN_EXT],
  [500, e500, LATIN_EXT],
  [600, e600, LATIN_EXT],
  [700, e700, LATIN_EXT],
];

let installed = false;

/**
 * Register the faces once per page (idempotent; nothing in a page without `document.fonts`). Ligatures are off and
 * numerals tabular in the face itself too, so a component that forgets the CSS still shows `->` as two characters.
 */
export function installFonts(): void {
  if (installed || typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return;
  installed = true;
  for (const [weight, url, range] of FIRA_FACES) {
    const face = new FontFace(FIRA_FAMILY, `url("${url}") format("woff2")`, {
      weight: String(weight),
      style: 'normal',
      display: 'swap',
      unicodeRange: range,
      featureSettings: '"calt" 0, "liga" 0, "tnum" 1',
    });
    document.fonts.add(face);
  }
}

/** Resolves once the regular and medium latin faces are loaded (the kit page and tests wait on it). */
export async function fontsReady(): Promise<boolean> {
  installFonts();
  if (typeof document === 'undefined' || !document.fonts) return false;
  try {
    const got = await Promise.all([document.fonts.load(`400 14px "${FIRA_FAMILY}"`), document.fonts.load(`500 14px "${FIRA_FAMILY}"`)]);
    return got.every((g) => g.length > 0);
  } catch {
    return false;
  }
}
