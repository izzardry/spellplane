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
- [M0-P2] Limiter is a sliding window (a request starts only if fewer than 2 started in the last 1000 ms), FIFO; a 429 blocks all requests for 30 s from its arrival and the request is retried, at most 3 attempts — "2 requests/s" read as "never 3 in any second".
- [M0-P2] Decklist lines without a count are syntax errors (the grammar requires `<count>`); counts must be 1–999; headers accept any case, a trailing colon or a `(n)` count; an MTGA `About` block is skipped; `(SET)` without a collector number pins the set only (`{name, set}` identifier).
- [M0-P2] An unknown set/collector number falls back to resolving the name alone, silently — the printing chooser can correct it.
- [M0-P2] Near matches for unresolved names: Scryfall `/cards/named?fuzzy=` (first 10 unresolved names only, to respect the rate limit) plus every card name already known locally, ranked by edit distance (≤ max(2, len/3)), top 3.
- [M0-P2] `ResolvedDeck` gained optional `commander` and `companion` (additive): the grammar has those headers and they belong in neither main nor side.
- [M0-P2] Faces: transform/modal_dfc-style cards (every face has `image_uris`) give one image per face; split, adventure and flip cards give their single top-level image; a face index beyond the card's faces falls back to the front; a card that is unknown or has no image gets a placeholder face even in Scryfall mode.
- [M0-P2] Lookups of single ids made in the same tick are coalesced into one `/cards/collection` request (concurrent identical lookups share it), so a board of cards does not queue one rate-limited request per card.
- [M0-P2] Stale cards (fetched > 30 days ago) are served from the cache immediately and refreshed in the background; `refreshStale()` refreshes all of them (for the session to call at start-up). Cache errors degrade to fetching.
