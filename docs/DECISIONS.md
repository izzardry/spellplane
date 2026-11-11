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
- [M0-P5] The peer id hashes the SPKI (DER) export of the public key: the design gives no format, and SPKI is the standard Web Crypto export a peer can import. `exportPublicKey` and `peerIdOf` are the single source for M1's hello.
- [M0-P5] A new identity has an empty nickname (the UI asks for one). Its preferred seat colour (0..7) comes from the peer id, so two new browsers rarely default to the same colour.
- [M0-P5] Nicknames are trimmed, inner whitespace collapsed and capped at 32 characters. A seat colour outside the integers 0..7 throws RangeError: themes have eight seat colours.
- [M0-P5] When two tabs open at once, only one identity is created: the key pair is generated outside the transaction and inserted with `add`, and the tab that loses re-reads the winner's record.
- [M0-P5] `saveAction` with secrets = null keeps the stored secret store. Log or table records whose roomId differs from the argument are rejected with TypeError before anything is written.
- [M0-P5] Saving a snapshot never deletes old log entries, because sync may still need the tail. `loadTable` returns the entries after `snapshotSeq`, read in one readonly transaction.
- [M0-P5] `listTables` and `decks.list` return the most recently updated first.
- [M0-P5] The service worker uses vite-plugin-pwa injectManifest with no precache or web app manifest, and is built and registered only in production builds, because the task says production only. Test and e2e builds have no worker.
- [M0-P5] The image cache stores only status-200, non-opaque responses: opaque ones can't be used as CORS/WebGL textures and inflate quota use. It keeps at most 2000 entries and evicts the oldest.
- [M0-P5] Only GET requests to https://cards.scryfall.io go through the worker. The cache name is `spellplane-images[-<profile>]`, taken from the requesting page's URL (the client id).
- [M0-P5] `requestPersistentStorage()` skips the browser prompt when storage is already persistent, and resolves false when the API is missing or fails.
