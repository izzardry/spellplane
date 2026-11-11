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
- [M0-P6] Stack lane depth is clamped to the centre band: 200 × 220 on the 1v1 and Two-Headed Giant tables, 200 × 320 elsewhere — the spec's 320-deep lane is deeper than the 220 band and would cover both battlefields, which "The effect stack" forbids; the cascade scrolls or collapses to its count badge once it outgrows the lane.
- [M0-P6] The hand row of backs that others see (420 × 88) sits at the seat, 6 outside the territory's near edge, to the owner's right of the avatar — inside the territory it would cover the free-placement battlefield where lands usually go.
- [M0-P6] Avatar centre 40 outside the territory's near edge (footprint radius 34), so on every current table it lies just off the table edge; the scene's fit should include this seat strip (up to 94 beyond the edge with the hand row).
- [M0-P6] Within-territory margins: 12 from the territory edges to the pile column and the command area; command and emblem area 150 × 112 in the near-left corner (two cards side by side).
- [M0-P6] Default resolve destination uses the instance's current face (faceIndex of the '//'-split type line, front face as fallback); without card data a spell defaults to its controller's battlefield — a wrong guess costs one drag.
- [M0-P6] Three-, four-player and Two-Headed Giant layouts are provisional until M3-P1 (follow the spec table, untuned). The spec's four-player territories (1100 × 440 on an 1800 table) overlap 90 × 90 at each corner although the design calls the corners unused; kept as specified for M3-P1 to settle (920 wide would remove the overlap).
- [M0-P6] Draft pack zone is seat-scoped and owner-visible; Rochester's table-scoped public pack is left to the draft package (M2, TODO in games/mtg/zones.ts).
- [M0-P6] Exile is unordered (ordered=false) — the design gives it no order, unlike the graveyard's ordered fan.
- [M0-P6] Solo goldfish uses the '1v1' format and layout with seat 0 only; soloLayout() is exported — Format has no solo value, and the contract layout(format) has no seat-count parameter
- [M0-P6] Provisional ffa3/ffa4/2hg layouts are marked by an exported isProvisionalLayout()/PROVISIONAL_FORMATS rather than a new TableLayout field — clearly marked without a contract change
- [M0-P6] Inside a territory (owner's orientation): pile column at the right edge (library nearest the owner, card edges 12 apart); command area in the near-left corner — the spec gives only the relative placement
- [M0-P6] All anchors rest at rot = seat angle; stackLane is canonical rot 0, and stackLaneForViewer() rotates it so it cascades toward the viewer
- [M0-P6] Two-Headed Giant provisional seat order: seats 0 and 1 on the near edge (team 1), seats 2 and 3 across; each seat on its team's left in its own orientation; ffa3 seat 1 top-left, seat 2 top-right — clockwise order
- [M0-P6] defaultDestination reads the front face of the type line, before // and the subtype dash. Any permanent type sends the spell to the controller's battlefield, otherwise instant or sorcery sends it to the owner's graveyard. With no instance given, the owner falls back to the controller. With no card data, the spell defaults to the controller's battlefield. A spell item with no card returns null
- [M0-P6] Exile is unordered and drawn as squared; graveyard and library are ordered and squared — the design gives exile no order
- [M0-P6] The card back keeps the stub's texture id 'mtg-back' at 488 x 680. It fills the whole texture first, with square corners, so the scene's card mask does the rounding
