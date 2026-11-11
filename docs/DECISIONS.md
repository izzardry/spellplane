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
- [M0-P4] A bare key acts on the hovered card, or on the whole selection when the hovered card is selected or nothing is hovered; a multi-card gesture shares one `group` — DESIGN "hover plus key … or the selection" leaves the precedence open.
- [M0-P4] T on a mixed selection taps the untapped cards; a fully tapped selection untaps — per-card toggling would scramble a mixed selection.
- [M0-P4] + / − change +1/+1 counters (− falls back to another kind on the card); named kinds (−1/−1, loyalty, charge) come from the context menu — the canonical keymap gives 1–4 to seats, so number keys cannot pick counter kinds.
- [M0-P4] G, E, H, L, Shift+L send a card to its owner's graveyard, exile, hand or library; C casts from hand, graveyard, exile or the command area, never from the battlefield, the stack or the library.
- [M0-P4] R resolves to the game's default destination (`to` omitted); before everyone passed, a second R within 3 s resolves with `force`. The stack chip asks where a spell goes with inline buttons (default first, then battlefield, graveyard, exile, hand); R accepts the default — DESIGN "Resolve asks where the item goes … One key accepts the default" without a modal chooser.
- [M0-P4] D, Shift+D, S and Ctrl+M act on the own library whatever is hovered.
- [M0-P4] Tab at the last step does not wrap (Ctrl+Enter passes the turn clockwise); the new active player's untap-and-draw offer appears in that player's own HUD when it sees the turn number change to its seat or team, and uses bare U while it shows (U is a reserved key: listed in the cheat sheet, refused by remapping, not remappable because `ActionId` is a contract type); Enter while holding the floor releases the hold; K asks without a label.
- [M0-P4] Ctrl+I rolls a d6 and Ctrl+Shift+I flips a coin, dispatching rngCommit then rngReveal back to back (solo); milestone 1 waits for the peers' commits.
- [M0-P4] V, Shift+V and M call an `onVoice` hook and show a chip; the voice module connects in milestone 3.
- [M0-P4] Tidy keeps the previous row bands (lands behind creatures stay behind), wraps at the territory width minus the pile column, and leaves displaced cards alone.
- [M0-P4] Token copies (X) and created tokens enter untapped 69 mm to the controller's right of the source or hovered card, else in the territory centre.
- [M0-P4] The log hides protocol-only steps (rngCommit, shuffleNonce, shuffleDone, snapshotHash, sequencerClaim); life changes merge when by the same actor on the same seat within 2 s.
- [M0-P4] Scry: L / Shift+L on a looked-at library card dispatches `toZone` into the same library; the session performs the private reorder. Search = look at the whole library, shuffle on close (default on). Other seats' libraries show the count only.
- [M0-P4] Leaving a note field cancels the note; Enter saves, empty text clears.
- [M0-P4] AppProps gained optional `settings` (SettingsStore, persists remaps) and `parseDecklist` (data/'s parser); without the parser the HUD uses a minimal plain-list parser. main.ts (M0-P7) should pass both — additive contract change.
- [M0-P4] App shows the B0 bootstrap stage (ui/Smoke.svelte) until main.ts passes a session, so the B0 smoke test stays green before M0-P7 lands.
- [M0-P4] The HUD reads only the own SecretStore and never shows library faces except from an explicit lookAt result; it sends nothing but session actions, so it adds no leak-test scenario.
- [M0-P4] Double-click on the own library draws one card; on any other library, a graveyard or exile it opens the pile viewer; the avatar zone buttons open every viewer, including the own library.
- [M0-P4] Mill N dispatches one `move` to the own graveyard per card of `libraryOrder.slice(0, N)` with a shared group (the session emits the reveals); reveal top dispatches `revealTo` for the top card to every other seat (targeted-reveal path, the card stays hidden in shared state). Both are in the library viewer (sharing the N field with look at top N) and the table menu.
- [M0-P4] While a confirmation prompt shows, Esc first closes a transient overlay (context menu, reveal-to, token search, inspect, cheat sheet) and otherwise holds; pile viewers and the deck dialog do not take Esc from Hold.
- [M0-P4] A HUD hover (hand, pile viewer, log card name) is dropped as soon as its card is no longer shown in that surface, since a removed element fires no pointerleave.
- [M0-P4] Stored keymap overrides are filtered to well-formed records on load, and a load that resolves after the player already remapped in this session is ignored.
