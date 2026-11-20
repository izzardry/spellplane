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
| `public/icons/icon-192.png` | web app manifest (installable app, M5-P3) | texture | https://github.com/izzardry/spellplane/blob/main/scripts/make-icons.mjs | MIT (this repository) | 192 × 192, drawn by `scripts/make-icons.mjs`: Spellplane's own neutral card-back motif, no Wizards marks |
| `public/icons/icon-512.png` | web app manifest (installable app, M5-P3) | texture | https://github.com/izzardry/spellplane/blob/main/scripts/make-icons.mjs | MIT (this repository) | 512 × 512, drawn by `scripts/make-icons.mjs` |
| `public/icons/icon-512-maskable.png` | web app manifest, maskable icon (M5-P3) | texture | https://github.com/izzardry/spellplane/blob/main/scripts/make-icons.mjs | MIT (this repository) | 512 × 512, full bleed with the mark in the safe zone, drawn by `scripts/make-icons.mjs` |
| `public/icons/apple-touch-icon.png` | iOS Home Screen icon (`index.html`, M5-P3) | texture | https://github.com/izzardry/spellplane/blob/main/scripts/make-icons.mjs | MIT (this repository) | 180 × 180, opaque, drawn by `scripts/make-icons.mjs` |
| `node_modules/@fontsource/fira-code/index.css` | the design kit's one monospace face, every look's chrome (M8, `src/ui/design`) | font | https://github.com/fontsource/font-files/tree/main/fonts/google/fira-code | OFL-1.1 (`node_modules/@fontsource/fira-code/LICENSE`) | `@fontsource/fira-code` 5.3.0 from npm: woff2 files bundled by Vite with the app, nothing fetched at runtime (added by M8-C) |

Libraries that bundle no asset file but are recorded here because they ship with the app (M8-C): `qrcode-generator` 2.0.4 (MIT, https://github.com/kazuhikoarase/qrcode-generator), loaded lazily by `src/ui/qr.ts` to draw invite QR codes as a module matrix; no image is bundled.

## Plain

No bundled assets: a stub of Paper's flat plane under the id `plain` until M7-P1 builds the Plain table world (added by M8-C).

## Paper

No bundled assets: a flat white plane drawn by `src/themes/paper/index.ts`.

## Dusk

No bundled files: everything is drawn or synthesised in code (nothing under `public/themes/dusk/`).

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/dusk/textures.ts` | Dusk table felt and neutral card back | texture | procedural | MIT (this repository) | `FELT_ALBEDO`, `FELT_NORMAL`: 256 × 256 tileable nap from seeded value noise and fibres, grey albedo and normal map, repeated every 180 mm (used by the felt and rail materials in `src/themes/dusk/table.ts`); `DUSK_BACK`: 488 × 680, geometric only (frame, lozenges, eight-pointed star), not the official back |
| `src/themes/dusk/sounds.ts` | Dusk sound set and room tone | sound | procedural | MIT (this repository) | `DUSK_SOUNDS`: Web Audio synthesis from filtered seeded noise and sine partials; no audio files |

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

No bundled files: every texture and sound is generated in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/stonetable/stone.ts` | Stonetable slab | texture | procedural | MIT (this repository) | Tileable stone height field (fractal value noise, ridged veins, pits): albedo, tangent-space normal and roughness maps, 256 × 256, one tile per 360 mm |
| `src/themes/stonetable/runes.ts` | Stonetable rune band and card back | texture | procedural | MIT (this repository) | Invented straight-stroke rune alphabet drawn on canvases: the glowing band around the slab (1024 × 64) and the neutral card back (488 × 680) |
| `src/themes/stonetable/motes.ts` | Stonetable dust motes | shader | procedural | MIT (this repository) | Point sprites drifting in a vertex shader, lit inside the torch's cone |
| `src/themes/stonetable/sounds.ts` | Stonetable sound set | sound | procedural | MIT (this repository) | Web Audio: filtered seeded noise and sine partials (slide, tap, shuffle, turn chime, prompt tick, torch crackle) |

## Plain

No bundled files: every texture and sound is drawn or synthesised in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/plain/textures.ts` | Plain table, desk and card back | texture | procedural | MIT (this repository) | `TABLE_HALFTONE` and `DESK_HALFTONE`: 256 × 256 white tiles with a 0.5 mm dot every 4 mm at 5 % and 3 % ink (antialiased by coverage, so every mip level keeps the tone), one tile per 16 mm; `PLAIN_BACK`: 488 × 680 pale paper, grey hairline frame and a ring of ink dots, geometric only |
| `src/themes/kit/sounds.ts` | Plain sound set | sound | procedural | MIT (this repository) | `soundSet` with a dry, light timbre (paper on a desk): every table and card-feel cue synthesised with Web Audio; no audio files |

## Kitchen Table

No bundled files: every texture and sound is drawn or synthesised in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/kitchen/textures.ts` | Kitchen Table playmat, board and card back | texture | procedural | MIT (this repository) | `LINEN`: 256 × 256 plain weave (a thread every 2 mm, slubs, mottling) as grey albedo and normal map, one tile per 64 mm (generator `src/themes/kit/surfaces.ts`); `WALNUT`: 512 × 512 walnut boards with grain and rings, one tile per 440 mm; `KITCHEN_BACK`: 488 × 680, brick stripes, cream frame and a paper medallion, geometric only, not the official back |
| `src/themes/kit/sounds.ts` | Kitchen Table sound set | sound | procedural | MIT (this repository) | `soundSet` with the look's timbre: every table and card-feel cue synthesised with Web Audio from band-passed seeded noise and soft partials; no audio files |

## Graphite

No bundled files: every texture and sound is drawn or synthesised in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/graphite/textures.ts` | Graphite slab, plinth and card back | texture | procedural | MIT (this repository) | `SLATE`: 360 × 360 fine stone grain with a dot every 20 mm as grey albedo and normal map, one tile per 120 mm; `PLINTH`: the same grain without dots (generator `src/themes/kit/surfaces.ts`); `GRAPHITE_BACK`: 488 × 680 gradient field, hairline frame and mint ring, geometric only |
| `src/themes/kit/sounds.ts` | Graphite sound set | sound | procedural | MIT (this repository) | `soundSet` with the look's timbre: every table and card-feel cue synthesised with Web Audio from band-passed seeded noise and soft partials; no audio files |

## Codex

No bundled files: every texture and sound is drawn or synthesised in the browser by the modules below.

| Asset | Used by | Kind | Source | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/themes/codex/textures.ts` | Codex leather, desk and card back | texture | procedural | MIT (this repository) | `LEATHER`: 256 × 256 pebbled midnight leather with a ±45° lattice tooled in (faintly gilt grooves) as albedo and normal map, one tile per 64 mm; `EBONY`: 512 × 512 dark boards, one tile per 480 mm (generators `src/themes/kit/surfaces.ts`); `CODEX_BACK`: 488 × 680 navy chequer, gilt frame with diamond corners and a vermilion seal, geometric only |
| `src/themes/kit/sounds.ts` | Codex sound set | sound | procedural | MIT (this repository) | `soundSet` with the look's timbre: every table and card-feel cue synthesised with Web Audio from band-passed seeded noise and soft partials; no audio files |
