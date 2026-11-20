# M8-P2 Shell, Home and History: parked

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". The review found three blocking issues (listed below). The implementer's fix commit `57768de` answers all three, but no second review ran, so nothing was merged.
- **Branch:** `m8-p2` (worktree `spellplane-wt/m8-p2`), head `57768de fix(m8-p2): keep reopened solo games on leave, reopen summaries on a rematch, lock Home's options while searching`. The branch is local only (not on `origin`). `m8` (`108e759`) is an ancestor of it, so today it merges as a fast-forward. The working tree is clean. `git diff m8...m8-p2 --stat`: 32 files, +4112 / -194. There are 22 lines of `[M8-P2]` decisions in its `docs/DECISIONS.md`.
- **Checked by the integrator at parking (20 Nov 2026, about 15:12, in the worktree):** `npx vitest run tests/unit/games tests/unit/home` (through `oomph run --reserve 1G`) passed: 7 files and 168 tests. I did not run the full `pnpm check` or any e2e (`tests/e2e/home/home.spec.ts`, `tests/e2e/history/history.spec.ts`, gate M0) at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P2 Shell, Home and History | The landing, the nav, the backdrop, launching every mode, first run, leaving; the games store, summaries, checkpoints and the History list | no | `src/ui/shell/**`, `src/ui/home/**`, `src/ui/history/**`, `src/ui/play/{launch,leave}.ts`, `src/store/games.ts`, `src/session/{summary,checkpoint,practice}.ts` |

The design is `journey.md` sections 3, 4.1, 4.10 "Leaving", 4.14 and 6, `persistence.md` sections 2 and 3, and `visual.md` boards 1, 4 and 6. Per contracts.md, the package also owns the `games` and `home` debug registrars (`src/debug/games.ts`, `src/debug/home.ts`). The acceptance list (docs/PLAN.md, "M8-P2 Shell, Home and History") asks for these pieces:

- **Unit tests for Home's logic:**
  - `homeView` for every row of journey 4.1's primary-button table
  - `randomNickname()`
  - the `BoosterSetup` ↔ `LobbySettings` round trip
  - each launcher against fake dependencies
  - first run saves the starter deck before it starts
- **Unit tests for saving (fake-indexeddb, fake timers):**
  - purge leaves no row
  - `endOlderSolo(3)`
  - the checkpoint timing (20 s, at once on a turn pass or hide)
  - `summarise` of fixture states with a public-only `thumb`
  - a failed write retries once and then shows `notSaving`
  - `leaveTable` purges a solo game with fewer than 10 own actions
- **`tests/e2e/home/home.spec.ts`** on `?harness=home`:
  - a fresh profile, a saved fixture deck, the mode switch, Draft night
  - `CONTINUE`, seeking, first-run failure
  - 390 px width, `live()` counts at 0, `designAudit`
  - the real app at `./` shows Home
- **`tests/e2e/history/history.spec.ts`** on `?harness=history`:
  - rows newest first
  - the filter
  - ended solo games hidden
  - Remove and `UNDO`
  - `designAudit`

## What the branch contains

- **Games store and saving:**
  - `src/store/games.ts`: purge, `endOlderSolo`, `trim`, soft remove and `purgeRemoved`
  - `src/session/summary.ts`: `summarise`, `thumbOf`, `countOwnActions`
  - `src/session/checkpoint.ts`: the checkpointer with retry, `settled()` and a monotonic action count
  - `src/session/practice.ts`
- **Launch and leave:** `src/ui/play/launch.ts` and `leave.ts`.
- **Shell, Home and History:**
  - Shell: `src/ui/shell/Shell.svelte` and `nav.ts`
  - Home: `src/ui/home/{Home,HomeHarness}.svelte`, `view.ts`, `deps.ts` and `harness.ts`
  - History: `src/ui/history/{HistoryList,HistoryPage}.svelte`, `rows.ts` and `harness.ts`
- **Debug registrars:** `src/debug/games.ts` and `home.ts`.
- **Tests:**
  - Unit: `tests/unit/games/{saving,store}.test.ts` and `tests/unit/home/{deps,home,practice}.test.ts`
  - E2e: `tests/e2e/home/home.spec.ts` and `tests/e2e/history/history.spec.ts`, with the helper `tests/e2e/helpers/home.ts`
- **Additive contract edits, tagged `[M8-P2]`:**
  - `GameStore.purgeRemoved?` in `src/store/types.ts`
  - `GamesDebug.get?`, `HomeDebug.prefs?` and `HomeDebug.live?` in `src/debug/types.ts`
- **Files outside the package's ownership** (a retry or the integrator must settle these):
  - **`tests/e2e/helpers/design-audit.ts`:** created here (126 lines). This file belongs to M8-P1, whose parked branch `m8-p1` also creates it (174 lines). When both land, git reports an add/add conflict. Take M8-P1's version and make Home and History pass under it.
  - **`src/ui/lobby/names.ts`:** a new file holding `randomNickname()`. It lies outside `src/ui/{shell,home,history}/**`. Either move it under `src/ui/home/`, or record it in DECISIONS as a new file that no other package owns.

## Open review findings (round 1) and their state on `57768de`

All three were blocking. "Fixed" below means fixed on the branch but **not re-reviewed**.

### 1. `src/ui/play/leave.ts:71`: a reopened long solo game is purged when it is left (data loss)

**The finding:** `leaveTable` counted own actions from `session.log()`. A restored solo session holds only the log after its stored snapshot, and that snapshot moves every 200 actions.

- The reviewer's scratch test made 205 actions, reopened the game, made 3 more moves and left. The result was `purged`: the games, tables, log and secrets rows were deleted, with no toast.
- The checkpointer had the same undercount (`checkpoint.ts:143` overwrote `GameSummary.actions` with the tail count).

**On the branch:**

- `countOwnActions(log, seat, stateSeq, prior)` in `summary.ts` returns `{ n, exact }`. It is exact only when the log reaches back to seq 1, and it never goes below `prior.actions`.
- `leaveTable` purges only on an exact count under 10, and it waits for `checkpointer.settled()` and `session.whenSaved()` before purging.
- The checkpointer's count only grows.
- New rows in `tests/unit/games/saving.test.ts` cover this.

**The re-review should check:**

- The reviewer's scenario: across seq 200, reopen, leave. The scratch test was at `/private/tmp/claude-501/-Users-holzschneider-Workspace-spellplane/2e63b412-9733-428d-b047-164292c08ec6/scratchpad/tests/unit/scratch/review.test.ts` (test A). It may be gone by now, in which case rebuild it.
- `countOwnActions`'s middle branch: `prior.actions > 0 ? ownPlay filter : ownActions`. It treats the automatic deal differently depending on `prior.actions`. Check that a game whose only own actions are the deal and 9 moves still purges, and that a game with 10 moves is kept.

### 2. `src/session/summary.ts:105`: a summary stays ended for ever once a result was seen

**The finding:** a rematch clears `TableState.result`, but the summary kept `result`, `ended: 'result'` and `endedAt`. This had three consequences:

- History showed the running game as ended.
- `CONTINUE` was absent.
- `trim()` could purge a live networked game.

**On the branch:**

- When the state has no result, `summarise` deletes `result`. If `prior.ended === 'result'`, it also deletes `ended` and `endedAt`. A `'replaced'` game stays ended.
- A unit row in `saving.test.ts` covers this.

### 3. `src/ui/home/Home.svelte:377`: the option row is not locked while searching

**The finding:** Home passed `disabled` to the kit's `Segmented`, which has no such prop (contracts.md Part B). The attribute landed on a `<div>`, so the Format and Ranked options stayed clickable while the matchmaker was seeking.

**On the branch:**

- Every Opponent, Format and Ranked option carries `disabled: view.optionsLocked`.
- Each `onchange` also returns early while locked.
- The seeking step of `tests/e2e/home/home.spec.ts` asserts that the radios are disabled. That spec has not been run at parking.

## What a retry should do first

1. **Merge the current `m8` into `m8-p2`.** On contract files, take `m8`'s side. The glue batch (M8-P7, M8-P6) and M8-P1 may have landed since parking.
   - **`tests/e2e/helpers/design-audit.ts`:** if M8-P1 has merged, take its version. Otherwise coordinate, because only one of the two can own it.
   - **`src/ui/lobby/names.ts`:** settle its ownership (see above).
2. **Re-review `57768de` against the three findings above.** That is the round the pipeline did not run. For finding 1, re-run the reviewer's scratch scenario against the real solo session and fake-indexeddb.
3. **Run the checks.**
   - Run `pnpm check` through `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`.
   - Run `pnpm e2e -- tests/e2e/home/home.spec.ts` and then `tests/e2e/history/history.spec.ts`. Use Chromium first, then `--project=webkit` one file at a time, per the memory rules.
   - Then run `pnpm e2e:gate -- M0`. None of these e2e runs happened at parking.
4. **If all of this is green:** merge into `m8`, push and run `push-preview.sh`. Without this package, PLAN's fallback applies: the frame, History's stub and the routes still work, and M8-P8 links them from a plain Home.
