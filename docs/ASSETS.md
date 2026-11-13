# Asset licence manifest

Every file the app bundles or fetches for a theme is listed here (DESIGN "Themes and rendering", Assets: CC0 physically based materials from libraries such as Poly Haven and ambientCG; embers, fog, glow and runes are shaders; no Wizards artwork, logos or official card back). PLAN M4-P3 to M4-P5 require each theme asset to be listed here with a CC0 source, or to be procedural. M4-P6 owns this file's format and the check (`tests/unit/themes/conformance/assets.test.ts`, part of `pnpm check`); each theme package adds its own rows.

## Format

- One `## ` section per group: `Shared`, then one per theme (`Paper`, `Dusk`, `Wyrm`, `Stonetable`). A theme with no bundled assets says so in a sentence instead of a table.
- Each table has exactly these columns, in this order: **Asset** (repository path in backticks), **Used by** (theme or module and what for), **Kind** (`texture`, `model`, `sound`, `font`, `shader` or `environment`), **Source** (the https URL of the original, or `procedural`), **Licence**, **Notes** (resolution, changes made).
- Procedural assets (drawn on a canvas or computed in a shader) are listed by the module that generates them (a `.ts`, `.glsl`, `.wgsl`, `.frag` or `.vert` path), with the source `procedural` and the licence `MIT (this repository)`.
- In a theme section every row is `CC0` / `CC0-1.0` or `procedural`. Only the shared section may list another free licence, named with its licence file.
- Every texture, model, sound or font file under `src/` or `public/` (png, jpg, webp, avif, gif, ktx2, basis, hdr, exr, dds, glb, gltf, bin, mp3, ogg, opus, wav, m4a, flac, ttf, otf, woff, woff2) has a row, and every row names a file that exists. The check fails otherwise.
- Nothing from Wizards of the Coast (card art, logos, the official card back, set symbols) is ever listed, because nothing of it is bundled. Card images are fetched from Scryfall at runtime and are not assets of the app.

## Shared

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/scene/fonts/Roboto-Medium.ttf` | scene (SDF table text, every theme) | font | https://github.com/googlefonts/roboto | Apache-2.0 (`src/scene/fonts/Roboto-LICENSE.txt`) | Bundled so nothing is fetched at runtime; predates M4, not a theme asset |

## Paper

No bundled assets: a flat white plane drawn by `src/themes/paper/index.ts`.

## Dusk

No bundled files: everything is drawn or synthesised in code (nothing under `public/themes/dusk/`).

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/dusk/textures.ts` | Dusk table felt and neutral card back | texture | procedural | MIT (this repository) | `FELT_ALBEDO`, `FELT_NORMAL`: 256 × 256 tileable nap from seeded value noise and fibres, grey albedo and normal map, repeated every 180 mm (used by the felt and rail materials in `src/themes/dusk/table.ts`); `DUSK_BACK`: 488 × 680, geometric only (frame, lozenges, eight-pointed star), not the official back |
| `src/themes/dusk/sounds.ts` | Dusk sound set and room tone | sound | procedural | MIT (this repository) | `DUSK_SOUNDS`: Web Audio synthesis from filtered seeded noise and sine partials; no audio files |

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
