# M5-P2 Audit: parked

- **Status:** parked, not merged into `m5`. The pipeline stopped after three review rounds without a clean review. The round-3 review left one blocking finding (quoted below), raised against the round-2 code (`f6a5d4f`). The implementer's round-3 commit (`1e97717`) targets that finding, but no review round has checked it.
- **Branch:** `m5-p2` (worktree `spellplane-wt/m5-p2`), head `1e97717 fix(m5-p2): audit round 3 — every held chair acknowledges the game's end`. It has 5 commits on top of merge base `7767675`. There is no remote copy (`origin/m5-p2` does not exist). The working tree is clean.
- **Behind `m5`:** M5-P5 (Finish), M5-P3 (Offline and storage) and M5-P1 (Touch) were merged into `m5` after the branch was cut. `git merge-tree m5 m5-p2` reports one conflict:
  - `docs/DECISIONS.md`: both sides append lines at the end.
  - `tests/unit/m5-contracts.test.ts` merges cleanly. `src/session/net.ts`, `src/session/effects.ts`, `src/ui/describe.ts` and `src/ui/flow/Stage.svelte` (shared files) merge without a textual conflict, but have not been checked together with the merged packages.
- **Checked by the integrator at parking (13 Nov 2026), at `1e97717` in the worktree:**
  - `pnpm check` is green: tsc, svelte-check, eslint, and vitest with 2687 tests in 194 files.
  - The audit suites (`tests/sim/audit`, `tests/unit/audit`, `tests/unit/m5-contracts.test.ts`) pass: 67 tests in 8 files.
  - The reviewer's scratch test (the late-sitter fork, see below) now passes at `1e97717`: all three browsers end on stage 'match', game 1, seq 118, and Ben has seen none of Anna's nonces ("Anna nonces seen by Ben: 0"). It failed against `f6a5d4f`, according to the review.
  - `pnpm e2e` was not run at parking. The branch's browser spec, `tests/e2e/audit/audit.spec.ts`, still has to pass on Chromium and WebKit after the merge with `m5`.

## What the package was supposed to do

docs/PLAN.md, M5 package table:

> | M5-P2 Audit | End-of-game audit: publish nonces and order history, replay every shuffle and draw, show a per-player verdict and any mismatch. | `core/audit.ts`, `ui/audit/*` | M4 |

docs/PLAN.md, ownership: M5-P2 owns
- `core/audit.ts` and the `auditPublish` reducer checks.
- The session's publishing at game end and the verdict log lines (`session/*`, `ui/describe.ts`).
- `ui/audit/*` and the `audit` debug part.
- The audit scenario of the shared leak test.

docs/PLAN.md, owner decisions for M5, "Audit: automatic at game end":
- "When a game ends ("Next game", or the evening ends), every browser publishes its nonces and order history automatically. Each player's verdict appears in the log and in an audit panel."
- "A player whose records are missing (left early, storage lost) is shown neutrally as "could not be checked: records missing", never as a mismatch. A mismatch is reserved for records that exist and disagree."

The M5 acceptance tests include: "the audit detects a tampered library order in a simulated game and passes an honest one". Gate M5-G ends the tablet evening with the audit.

## What the branch contains

`git diff m5...m5-p2 --stat` lists 24 files, +3297/−25. There are 21 `[M5-P2]` lines in `docs/DECISIONS.md`.

- **Core** (`src/core/audit.ts`, `src/core/reducer/audit.ts`): game spans, `buildAuditBundle` (the seat's shuffle and reorder records of one game, stripped of identities), `verifyAudit` (replays every shuffle and draw, verdict per player). The reducer refuses an `auditPublish` for a game that has not ended.
- **Ledger** (`src/net/audit.ts`, `AuditLedger`): fed with every sequenced action, keeps the finished games, their bundles and verdicts.
- **Session** (`src/session/audit.ts`, wired in `src/session/net.ts`): publishes the own bundle automatically when a game ends ("Next game", or "New draft" back to the lobby). It publishes only once every other seat holding a chair has acknowledged the game's end in this browser's history (heartbeat in step at or after the end, or its own bundle sequenced). `outgoing` swaps an own `auditPublish` proposal that the confirmed history does not accept for a withheld stub, so a requeued bundle never carries its records into a history where the game goes on. The ledger is rebuilt from the saved log after a reload, rewind or catch-up.
- **UI** (`src/ui/audit/AuditPanel.svelte`, `panel.ts`, `ui/describe.ts`, `ui/flow/Stage.svelte`): one log line per verdict (a mismatch as a warning), an audit panel that steps aside during a match, and a note on the own row while the bundle is held ("Published once Ben (away) has the game's end").
- **Tests:** `tests/sim/audit/audit.test.ts` (honest and tampered games, via `tests/sim/audit/cheat.ts`), `tests/sim/audit/leak.test.ts` (the audit scenarios of the shared leak test, including the late-sitter fork since round 3), unit tests under `tests/unit/audit/`, and `tests/e2e/audit/audit.spec.ts`.

## Open review finding (round 3, against `f6a5d4f`)

**Blocking.** `src/session/audit.ts:228` (round-2 numbering; `blockers()` is at line 233 in `1e97717`). Design references: DESIGN "Multiplayer architecture", Hidden information 6 ("At game end each browser can publish its nonces and order history") and "Resume and failure handling" ("later arrivals reconcile to the copy with the highest sequence number"); CLAUDE.md hard rule "Hidden information never leaves its owner's browser except through the design's reveal paths"; the module's own guarantee "Only into a history in which every player has seen the game end".

> `blockers()` only waits for the seats in `g.players` (from core/audit.ts `auditSeats`: seats that held a deck commitment). A seated peer without a deck (someone who opened the link mid-match and took the free chair, which `sitIfUnseated` allows) can sequence alone, so it can hold a competing history, but it never blocks publication.
>
> Setup: an ffa3 table. Anna (s0) and Ben (s1) Ready and start the match. Cara opens the link mid-match and sits in s2 with no deck. Cara's link goes silent. Anna and Ben end the game with "Next game" (the pass timer answers for Cara), acknowledge each other and sequence both `auditPublish` bundles at seq ~34. Cara is alone, so she becomes sequencer, chats 80 times and opens her own "Attacks?" round, which gives her history seq 111. The link heals and Cara's longer history wins. Anna's requeued "Next game?" is asked again, Cara answers "hold", and the requeued stageSet does not happen. Final state on all three browsers: stage 'match', games 1, seq 118. Ben's received messages (and his saved log) contain Anna's game-1 owner nonce. With the public peer nonces, that gives Ben Anna's whole library order in a game still being played. The test's assertion `!(stage === 'match' && AnnaNonceSeenByBen)` fails.

Suggested fix (reviewer):
- Make the acknowledgement set every seat that holds a chair (name not empty, role player) in the confirmed state, not only `g.players`. A seat that has not published must acknowledge the end by heartbeat, as now.
- Keep `g.players` only for which verdicts are shown.
- Apply the same set in `mayCarry` (it calls `blockers`) and in the "Published once … has the game's end" note.
- Add this late-sitter fork scenario to `tests/sim/audit/leak.test.ts`.

Scratch test: `/private/tmp/claude-501/-Users-holzschneider-Workspace-spellplane/2e63b412-9733-428d-b047-164292c08ec6/scratchpad/rv-m5p2-r3-det/latesitter.test.ts`, with `vitest.config.mjs` in the same folder. Run it from the worktree with `npx vitest run --config <that dir>/vitest.config.mjs --root <that dir>`. The scratchpad is session-local and may be gone; the scenario is now also in `tests/sim/audit/leak.test.ts` ("a peer who sat down mid-match without a deck holds a chair …").

## State of the finding after round 3 (not reviewed)

`1e97717` follows the suggested fix:
- `blockers()` now takes every seat of the confirmed state whose name is not empty, except the own seat and seats whose bundle of the game is sequenced, and waits for its acknowledgement. `mayCarry` and the row note use the same set; verdicts still cover only `g.players`, and the note names the chair's current holder.
- The late-sitter fork scenario is in `tests/sim/audit/leak.test.ts`, and the reviewer's scratch test passes (see above).
- Also new in round 3: the log line of a seat without a bundle, written when this browser's wait ran out, reads "could not be checked: records missing (none published so far; records published later are still checked)".

Gaps that still need a review:
1. **No "role player" filter.** `blockers()` counts every seat with a non-empty name. The table state has no seat role field, so this matches the reviewer's intent as far as the state allows, but a review should confirm that spectators never appear in `st.seats` with a name (otherwise a spectator would hold every bundle).
2. **Liveness of the hold.** Any seated peer who left before the end, player or not, now holds every bundle until they come back or their chair is freed. Round 2 recorded this as a design tension for the owner (DECISIONS, "audit round 2"): a bounded hold would trade the audit for secrecy in that case. With late sitters counted, the hold is reached more often. The owner should rule on it, or a review should accept it.
3. **End of the evening.** DECISIONS "audit round 3" records that there is no explicit "End the evening" signal: a table closed mid-match is not audited, because the game can be continued later. The owner decision says the audit also runs "when the evening ends", so this is open for the owner (an "End the evening" proposal or a hint in the evening bar, both outside M5-P2's files).
4. **Unreviewed:** the new wording of the time-out log line and its per-browser difference (display only, never in a verdict).

## What a retry should do first

1. **Merge `m5` into `m5-p2`.**
   - Resolve the one conflict: append both sides in `docs/DECISIONS.md`.
   - Check the shared files (`session/net.ts`, `ui/flow/Stage.svelte`, `ui/describe.ts`) against M5-P1, M5-P3 and M5-P5 changes; keep their lines and add only M5-P2's own.
   - Rerun `pnpm check`, then `pnpm e2e`, including `tests/e2e/audit/audit.spec.ts` on Chromium and WebKit.
2. **Confirm the seat set of `blockers()`.** Add a unit test that a spectator (no chair) never holds a bundle, and one that a late sitter who acknowledged the end by heartbeat releases it.
3. **Get owner rulings on gaps 2 and 3** (indefinite hold for a seat that left before the end; audit when the evening ends without "Next game"), and record them in DECISIONS.
4. **Run one fresh review round** on the result, including the round-3 changes listed above, before merging into `m5`.
