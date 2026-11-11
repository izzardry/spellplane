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
