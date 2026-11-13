# Asset licence manifest

Every file the app bundles or fetches for a theme is listed here (DESIGN "Themes and rendering", Assets: CC0 physically based materials from libraries such as Poly Haven and ambientCG; embers, fog, glow and runes are shaders; no Wizards artwork, logos or official card back). PLAN M4-P3 to M4-P5 require each theme asset to be listed here with a CC0 source, or to be procedural. M4-P6 owns this file's format and the check; each theme package adds its own rows.

Columns: **Asset** (path in the repository), **Used by** (theme or module), **Kind** (texture, model, sound, font, shader), **Source** (URL of the original), **Licence**, **Notes** (resolution, changes made).

Procedural assets (drawn on a canvas or computed in a shader) are listed by the module that generates them, with the source "procedural".

## Shared

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/scene/fonts/Roboto-Medium.ttf` | scene (SDF table text, every theme) | font | https://github.com/googlefonts/roboto | Apache-2.0 (`src/scene/fonts/Roboto-LICENSE.txt`) | Bundled so nothing is fetched at runtime; predates M4, not a theme asset |

## Paper

No bundled assets: a flat white plane drawn by `src/themes/paper/index.ts`.

## Dusk

To be filled by M4-P3.

## Wyrm

To be filled by M4-P4.

## Stonetable

No bundled files: every texture and sound is generated in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/stonetable/stone.ts` | Stonetable slab | texture | procedural | MIT (this repository) | Tileable stone height field (fractal value noise, ridged veins, pits): albedo, tangent-space normal and roughness maps, 256 × 256, one tile per 360 mm |
| `src/themes/stonetable/runes.ts` | Stonetable rune band and card back | texture | procedural | MIT (this repository) | Invented straight-stroke rune alphabet drawn on canvases: the glowing band around the slab (1024 × 64) and the neutral card back (488 × 680) |
| `src/themes/stonetable/motes.ts` | Stonetable dust motes | shader | procedural | MIT (this repository) | Point sprites drifting in a vertex shader, lit inside the torch's cone |
| `src/themes/stonetable/sounds.ts` | Stonetable sound set | sound | procedural | MIT (this repository) | Web Audio: filtered seeded noise and sine partials (slide, tap, shuffle, turn chime, prompt tick, torch crackle) |
