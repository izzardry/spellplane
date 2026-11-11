# Decisions made during implementation

One line per decision the design did not fix. Format: `- [package] decision — reason`. Newest at the bottom of each milestone section.

## B0 Bootstrap

- [B0] Run mode: the unattended prompt in docs/PROMPT.md is authoritative; the owner pasted the older pausing version on 11 Nov 2026 after asking for an overnight run, so the run does not stop between milestones — the owner's latest instruction was an unattended run.
- [B0] TypeScript 6.0 rather than 7.0 — typescript-eslint supports < 6.1 only.
- [B0] Added `src/util/` as the lowest shared layer (flags, seeded PRNG for tests, debug-hook registration) — every module needs these and none of the planned folders may be imported by all.
- [B0] Debug-hook registration (`registerDebug`) lives in `util/debug.ts`; modules register the part they own, and `debug/` holds the full type and app assembly — avoids every module depending on `debug/`.
- [B0] `Transport` gained `readonly selfId: PeerId` — every implementation needs to name itself; Trystero exposes `selfId` too.
- [B0] e2e runs against a test-mode production build (`vite build --mode test` into `dist-test/`, then `vite preview`); `__SPELLPLANE_DEBUG__` is true in every mode except `production`.
- [B0] Broadcast transport filters addressed (`to`) frames at the receiver, since BroadcastChannel reaches every page; leak tests on this harness check what is delivered to the application.
- [B0] Extra harness flag `?speech=fake` selects `voice/fake.ts`, driven by tests through the debug hook.
- [B0] Extra dev dependencies: `eslint-import-resolver-typescript` (boundaries rule resolves TS paths), `@eslint/js`, `globals`, `svelte-eslint-parser`, `@types/node`, `workbox-window` (peer of vite-plugin-pwa).
- [B0] Fixtures: full M19 + tokens from Scryfall, ~24-card samples of the other nine target sets, MTGJSON booster data and a trimmed uuid map for all ten; recorded by `scripts/record-fixtures.mjs`.
- [B0] Deploy copies `index.html` to `404.html` so deep links survive on GitHub Pages (routing is hash-based anyway).
- [B0] BLOCKER (owner): izzardry/spellplane is private and the org plan has no Pages for private repos (HTTP 422). The run did not make the repository public, since that exposure cannot be undone; the deploy workflow skips while the repo is private. To go live: make the repo public, then `gh api -X POST repos/izzardry/spellplane/pages -f build_type=workflow` and re-run "Deploy to GitHub Pages". Gates verify the production build locally with `vite preview` instead.

## M0 Solo table

- [M0] Added package M0-P7 Solo session (`src/session/`, `main.ts`, `debug/`), second wave after M0-P1 and M0-P5 — the plan had no owner for the client that glues reducer, secret store, private effects, undo, persistence and app wiring. M0-P5's reload acceptance test moves to M0-P7.
- [M0] New lint element `session` (may import core, net, store, data, draft, games, voice, util; imported by ui and debug).
- [M0] Package agents may make additive-only changes to contract files (new optional fields or new exports) when unavoidable and must report them; they never change or remove existing contract members — keeps parallel packages unblocked.
- [M0] Module test pages: `?harness=<name>` in dev/test builds loads `src/<module>/harness.ts` instead of the app, so scene and HUD can be tested before the session exists.
- [M0-P3] Tap state: `pose.rot` includes the tap (a tapped card of a seat at θ rests at `rot = θ + 90`, as the geometry spec words it); the scene draws `pose.rot` as is and animates a rotation change with the 120 ms tap motion when `tapped` flipped. The reducer (M0-P1) must turn `pose.rot` by ±90 on `tap`.
- [M0-P3] Drag on empty table pans (as the navigation table says); Shift+drag on empty table draws the marquee (adds to the selection). Click selects one card, Shift+click toggles, click on empty table clears.
- [M0-P3] Drop resolution details: rules 2 and 3 apply to single cards only (a dragged group or pile only aligns or lands free); rule 2 targets loose cards and the top of squared piles, rule 3 loose cards and the last card of a cascade; "lower third" and "toward the owner" are in the target controller's seat frame; "overlapping by at least half" means half the dropped card's width; rule 4 also aligns the other axis to the neighbour's matching edge or centre when within 12 mm, so rows line up; every result is clamped to the table.
- [M0-P3] A squared pile has no reachable bottom card, so dragging its count badge (top-left corner) moves the whole pile; dragging the top card pulls it out singly.
- [M0-P3] Rule 1 avatar drop means the seat's hand (`toZone … position 'any'`); library drops go on top; the stack lane pushes a spell (`stackPush`). Library cards are not draggable from the scene (drawing is a private effect: the HUD maps double-click on the library, reported as `pileOpen('library:<seat>')`, to draw).
- [M0-P3] Mouse wheel vs trackpad: ctrl+wheel (pinch) and line-mode or whole-notch wheel events (deltaX 0, integer |deltaY| ≥ 50) zoom; other wheel events pan.
- [M0-P3] Zone outlines and labels are drawn by the scene from the layout in the theme's border/muted colours (the Theme v1 SceneContext carries no layout); the theme builds the table surface and background only. Paper's surround is #f1f1ee so the white table reads as a sheet.
- [M0-P3] SDF text uses a bundled font (src/scene/fonts/Roboto-Medium.ttf, Apache-2.0, licence alongside) so troika never fetches a font from a CDN; table text is limited to Latin characters (others become '?') so troika's unicode fallback resolver is never called.
- [M0-P3] Texture tiers by on-screen card height in CSS px; one texture array per tier (atlas pages as layers) so all cards are one draw call; the 400 MB cap counts decoded level-0 bytes (frameStats.textureBytes); while a texture is missing the next smaller resident tier is drawn, else a blank card.
- [M0-P3] The scene registers cards/camera/lines/frameStats on the debug hook itself; `cards()` reports displayed (animated) poses and screen rects from the real camera projection, plus extra fields (zone, shows, dimmed, tier, moving…). `camera().position` is [centre x, centre y, height] in table mm, pitch 90.
- [M0-P3] The scene harness uses its own synthetic 1v1 layout, game definition, faces and reducer stub (src/scene/harness-fixture.ts), not mtg/core, so scene tests do not depend on M0-P1/M0-P6 internals.
- [M0-P3] B0 stage.ts and App.svelte are left as they are (the B0 smoke still passes); M0-P4/M0-P7 replace the stage with createTableScene when they wire the app.
