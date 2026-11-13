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

No bundled files: everything is drawn or synthesised in code (nothing under `public/themes/dusk/`).

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/dusk/textures.ts` (`FELT_ALBEDO`, `FELT_NORMAL`) | Dusk table felt | texture | procedural | n/a (original code) | 256 × 256 tileable nap from seeded value noise and fibres, grey albedo and normal map, repeated every 180 mm |
| `src/themes/dusk/textures.ts` (`DUSK_BACK`) | Dusk neutral card back | texture | procedural | n/a (original code) | 488 × 680, geometric only (frame, lozenges, eight-pointed star); not the official back |
| `src/themes/dusk/table.ts` (`FELT`, `RAIL`) | Dusk table and rail | material | procedural | n/a (original code) | Physically based colour, roughness and the maps above; no image files |
| `src/themes/dusk/sounds.ts` (`DUSK_SOUNDS`) | Dusk sound set and room tone | sound | procedural | n/a (original code) | Web Audio synthesis: filtered seeded noise and sine partials; no audio files |

## Wyrm

To be filled by M4-P4.

## Stonetable

To be filled by M4-P5.
