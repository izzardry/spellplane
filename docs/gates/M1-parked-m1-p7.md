# M1-P7 Resume (remainder): parked

- **Status:** parked, not merged into `m1`. The pipeline's reason: "did not converge after 2 review rounds".
- **Branch:** `m1-p7`, local only (not on `origin`), worktree `/Users/holzschneider/Workspace/spellplane-wt/m1-p7`, head `587447f`, based on `m1` at `58683a6`. Four commits:
  - `b0a02ca` test: sequence `away` through the real reducer in the confirm harness and sims.
  - `157e27a` feat: lost-save recovery driver, recovery panel and resume acceptance tests.
  - `2cc474e` fix 1: resumable recovery after `recoverCommit`, public identities from the log.
  - `587447f` fix 2: the recovery stays on offer after a public card returns to the library; owed record and draw guards; deterministic too-small deck in the acceptance test.
- **Diff** (`git diff m1...m1-p7 --stat`): 18 files, +2180 −39. The main files are `src/session/net.ts` (+278), the new `src/session/resume.ts` (314 lines), `src/ui/recovery/RecoveryPanel.svelte` and `model.ts`, one mount line in `src/ui/lobby/TableRoom.svelte`, and tests: `tests/sim/resume/{recovery,resume,leak}.test.ts`, `tests/unit/resume/*`, `tests/e2e/resume/resume.spec.ts`. It also adds 13 DECISIONS lines (`[M1-P7]`, `[M1-P7 fix 1]`, `[M1-P7 fix 2]`). No contract file changed.
- **History:** the previous note (`26972aa`) parked M1-P7 because M1-P8 was not merged. M1-P8 was then merged (`9ed1838`). The gate fix round landed the pure parts on `m1` (`chooseResume`, `recoveryLibrarySize`/`recoveryRemainder`, the `recover`/`recoverCommit` reducer, log lines and the leak scenario; DECISIONS `[M1-P7 partial, gate fix]`). This run was the remainder: the session's recovery driver, `ui/recovery/*` and the acceptance tests.

## What the package was supposed to do

docs/PLAN.md, M1 package table (line 118):

> | M1-P7 Resume | Persist the sequenced log, snapshots every 200 actions and the secret store; rejoin a seat by key pair; restore with no peers present and reconcile to the highest sequence number; away seats; the logged lost-save recovery (re-import, subtract public cards, recommit, reshuffle). | `store/tables.ts`, `net/sync.ts`, `core/recovery.ts`, `core/reducer/recovery.ts`, `ui/recovery/*` | M1-P1, M1-P2, M1-P8 |

docs/PLAN.md, M1 acceptance tests (line 129):

> **M1-P7.** Reloading either page mid-game rejoins the same seat with the same hand; closing both pages and reopening either restores the table; the recovery flow yields a library whose size equals deck size minus public cards minus the agreed hand.

DESIGN: "Multiplayer architecture" › "Resume and failure handling", in particular: "If a player loses their local save … their hidden zones are gone. The recovery path is public and logged: the player re-imports the deck …".

## What fails and why

Neither open finding reproduces at the branch head. Both were raised in review round 2 against `2cc474e`. Fix 2 (`587447f`) addresses both, but no review round was left to confirm that, so the pipeline parked the package. Checked by the integrator in the `m1-p7` worktree at `587447f`:

- `pnpm check` passed: tsc, svelte-check (0 errors, 0 warnings), eslint, and Vitest with 86 files and 1343 tests.
- I ran `vitest run tests/sim/resume/recovery.test.ts -t 'refused with nothing proposed|went back to the library'` 30 times in a row. All 30 passed. This loop covers the formerly flaky case and the new regression case.
- `pnpm e2e` and `pnpm e2e:gate -- M1` were not run on the branch in this integration step. `tests/e2e/resume/resume.spec.ts` is new and has not been verified here.

So the package is parked for lack of a confirming review, not because of a known failure. Fix 2 is a sizeable, unreviewed change (+292 −57 across `session/net.ts`, `session/resume.ts` and the panel). It adds new behaviour, notably the `dispatch` guard that refuses draws and moves out of an unshuffled recovered library, and a reworked owed-record rule.

## Open review findings (round 2, against `2cc474e`)

1. **Blocking: flaky acceptance test.** `tests/sim/resume/recovery.test.ts:188`.
   - **Issue:** the "too small a deck" case re-imported `right.main.slice(0, 30)` and expected `/has \d+ cards/`. Hands and shuffles come from crypto randomness (`session/secrecy.ts`), not the loopback seed. When B's public card (`tests/sim/session/script.ts:74`) is a non-land outside those 30 entries, `recoveryProblem` correctly reports "not the deck you played" instead, and the test fails. The reviewer saw 2 failures in 50 runs, and one red `pnpm check`.
   - **Suggested fix:** build the small deck from the seat's public identities plus a few other cards. Do not loosen the regex.
   - **State at `587447f`:** done as suggested. The deck is the public refs plus `rest.slice(0, 10)`, and the test expects the exact message `has N cards; the table needs M`. The 30 runs above passed.
2. **Blocking: lost-save recovery never offered.** `src/session/resume.ts:111`.
   - **Issue:** `identitiesFromLog` took back the identity of any own card still on the table, including one back in the seat's library. Once `reissueHand` had named one library card, `recoveryStatus` saw `holdsLibrary` and reported phase 'none'. The panel stayed hidden although 6 hand cards and 52 library cards were lost. The trigger was a revealed or played card put back on top of the library with its id kept; a `reveal` of a library card did the same. This breaks DESIGN "Resume and failure handling" (lost-save recovery).
   - **Suggested fix:** skip library cards in `identitiesFromLog`, or ignore log-derived ids in `holdsLibrary`, and add a regression test.
   - **State at `587447f`:** both halves done.
     - `identitiesFromLog` takes only cards in a public zone or the seat's hand (`resume.ts:117`).
     - Phase 'lost' ignores library ids that the seat's own log entries published (`ownPublishedIds`, which the panel passes from `session.log()`).
     - The regression test "a card that was public and went back to the library under its id does not hide the lost save: the recovery is offered and completes" (`recovery.test.ts:346`) passes.
     - A retry should check one gap. `ownPublishedIds` covers only ids the seat itself published. A card revealed by its owner and then moved to the library by another seat's action still matches. Also check the case where the panel's log (`session.log()`, `RecoveryPanel.svelte:31`) starts at a snapshot and so misses the reveal.

Known gaps the branch records in DECISIONS, which the gate report needs:

- A player whose key pair is gone too (cleared site data, another device) cannot take the chair back in M1. `seatTake` refuses a taken chair.
- Reveals that a catch-up from a snapshot skipped cannot be recovered, because snapshots carry no salts. Such a card stays unnamed in the hand, and the hand is not re-issued. This is a contract gap.

## What a retry should do first

1. **Push `m1-p7` to `origin`** so the work survives another crash. Do not rebase it; `m1` has not moved since its base `58683a6`, apart from this note.
2. **Run one focused review of `587447f` only** (`git diff 2cc474e..587447f`), against the two findings above and the new behaviour fix 2 introduced:
   - the owed-record and finish-draw rule in `session/net.ts` `drive`, including the fallback to hand size after a snapshot catch-up;
   - the `dispatch` guard on draws and moves out of an unshuffled recovered library;
   - the `publicCards`/`lostHiddenCards` change for own sideboard and pack zones (maxHand must equal the reducer's limit);
   - the gap in `ownPublishedIds` noted above.

   Do not reopen the whole package.
3. **Re-verify, one Playwright run at a time:**
   - `pnpm check`.
   - A repeat loop (50 or more runs) of `tests/sim/resume/recovery.test.ts` and `tests/sim/resume/resume.test.ts`, since crypto randomness drives their hands.
   - `pnpm e2e`, which includes the new `tests/e2e/resume/resume.spec.ts`.
   - `pnpm e2e:gate -- M1`.

   If all are green and the review finds nothing blocking, merge `m1-p7` into `m1` as is.
4. **If a test is still randomness-dependent,** make its setup derive from the state, as fix 2 did for the small deck. Do not loosen assertions and do not add retries.
