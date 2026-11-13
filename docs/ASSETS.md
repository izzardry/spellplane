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

To be filled by M4-P3.

## Wyrm

No bundled files: everything is computed or drawn at runtime by the theme's own code (MIT, this repository).

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/wyrm/scales.ts` | Wyrm (slab) | texture | procedural | MIT (this repository) | Obsidian scale relief: albedo, normal, AO/roughness/metalness and ember emissive maps computed as one 768 × 768 tile per 288 mm, cached per page |
| `src/themes/wyrm/slab.ts` | Wyrm (slab) | shader | procedural | MIT (this repository) | A travelling heat wave on the seams' glow, injected into three's standard material |
| `src/themes/wyrm/embers.ts` | Wyrm (particles) | shader | procedural | MIT (this repository) | Drifting ember particles, motion computed on the GPU |
| `src/themes/wyrm/shimmer.ts` | Wyrm (stack) | shader | procedural | MIT (this repository) | Heat-shimmer post pass over the stack lane (three's ShaderPass) |
| `src/themes/wyrm/back.ts` | Wyrm (card back) | texture | procedural | MIT (this repository) | Neutral geometric card back drawn on a canvas; no text, logos or official back |

## Stonetable

To be filled by M4-P5.
