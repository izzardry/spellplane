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
- [M0-P2] Rate limit is a sliding window: a request starts only if fewer than 2 started in the last 1000 ms, in order — reads '2 requests/s' as 'never 3 in any second'
- [M0-P2] A 429 blocks all requests for 30 s from when it arrives, then the request is retried, at most 3 attempts — the design gives the back-off but no retry policy
- [M0-P2] Decklist lines without a count are syntax errors, and counts must be 1–999 — the grammar requires <count>
- [M0-P2] Headers accept any case, a trailing colon or a '(n)' count; an MTGA 'About' block is skipped — common export variants
- [M0-P2] '(SET)' with no collector number pins the set only (a {name, set} identifier); set codes are 2–6 alphanumerics so '(Showcase)' stays part of the name
- [M0-P2] A set or collector number Scryfall does not know falls back silently to the name alone — the printing chooser can correct it
- [M0-P2] Near matches come from Scryfall's fuzzy lookup (first 10 unresolved names only, because of the rate limit) plus every card name already known locally, ranked by edit distance (at most max(2, len/3)), top 3
- [M0-P2] ResolvedDeck gained optional commander and companion fields — the grammar has these headers and the cards belong in neither main nor side
- [M0-P2] Cards where every face has its own image_uris (transform, modal_dfc) give one image per face; split, adventure and flip cards give their single image; face 1 of a single-faced card falls back to the front; an unknown card or one with no image gets a placeholder face
- [M0-P2] Single-id lookups made at the same time are combined into one /cards/collection request, so a board of cards does not queue one rate-limited request per card
- [M0-P2] Cards older than 30 days are served from the cache at once and refreshed in the background; refreshStale() refreshes them all for the session to call at start-up; cache errors fall back to fetching
- [M0-P2] A pinned printing (set+number, or name+set) is used only if its name, a face name or a ' // ' part equals the line's name after normalisation. Otherwise the line silently falls back to a name-only lookup, and if that fails too it is reported as unresolved. Reason: MTGA set codes and numbers can differ from Scryfall's, and a wrong card must never enter the deck without notice.
- [M0-P2] A blank line after a Commander or Companion block that has a card returns to main, or goes to side if main already has cards. A blank line straight after the header is ignored. Reason: the simplest reading of 'a blank line after the main deck also starts the sideboard'.
- [M0-P2] The limiter runs on performance.now(), and a 429 retry goes to the front of the queue (it keeps its place), so FIFO order holds for first attempts. Reason: clock jumps must not stall Scryfall access, and a retried request should not wait behind later ones.
- [M0-P2] CONTRACT CHANGE, flagged for the integrator: src/data/types.ts gained two additive optional fields. DeckEntry.text holds the source line as pasted, for unresolved-error text. CardFaceData.oracle_id, layout and cmc hold the per-face fields of reversible_card. Reason: the reviewer's suggested fixes. These follow the earlier additive M0-P2 change to ResolvedDeck. CLAUDE.md says contract files are edited only in a contracts package, so the integrator may want to move these into a contracts package. Both are recorded in docs/DECISIONS.md.
- [M0-P2] pnpm e2e was not run in this round. The changes are in data/ only and are covered by unit tests; pnpm check is green with 100 tests.
- [M0-P2] Id lookups are batched before the first await: one cache read, then /cards/collection in batches of 75 for the rest, per tick. If a request fails, its callers and the rest of that tick's batch are rejected, so no further requests go out right after a 429 give-up or a 5xx.
- [M0-P2] Ids Scryfall does not return are remembered as missing for 10 minutes, for the session only; refreshStale() forgets them — the simplest bound that both protects the 2/s budget and lets a card that appears later be found.
- [M0-P2] Refreshes send one 75-id request at a time and remember each before the next; refreshStale() skips ids a background refresh is already fetching.
- [M0-P2] FaceSource.faceFor rejects when the lookup fails and returns the 'Unknown card' placeholder only when Scryfall definitely has no such card — the design says nothing on this, and a placeholder would look permanent.
- [M0-P2] A 200 response whose body is not JSON becomes ScryfallError('Scryfall: invalid JSON'); a decklist count over 999, including one too large to be exact, is reported as 'at most 999'.
