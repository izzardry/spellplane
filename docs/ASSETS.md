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

No bundled files: everything is computed or drawn at runtime by the theme's own code (MIT, this repository).

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/wyrm/scales.ts` | Wyrm (slab) | texture | procedural | MIT (project code) | Obsidian scale relief: albedo, normal, AO/roughness/metalness and ember emissive maps computed as one 768 × 768 tile per 288 mm, cached per page |
| `src/themes/wyrm/slab.ts` | Wyrm (slab) | shader | procedural | MIT (project code) | A travelling heat wave on the seams' glow, injected into three's standard material |
| `src/themes/wyrm/embers.ts` | Wyrm (particles) | shader | procedural | MIT (project code) | Drifting ember particles, motion computed on the GPU |
| `src/themes/wyrm/shimmer.ts` | Wyrm (stack) | shader | procedural | MIT (project code) | Heat-shimmer post pass over the stack lane (three's ShaderPass) |
| `src/themes/wyrm/back.ts` | Wyrm (card back) | texture | procedural | MIT (project code) | Neutral geometric card back drawn on a canvas; no text, logos or official back |

## Stonetable

To be filled by M4-P5.
