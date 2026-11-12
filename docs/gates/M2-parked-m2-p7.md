# M2-P7 Evening flow: parked

- **Update (gate fix round, 12 Nov 2026):** merged into `m2` as `d538d5b merge(m2): M2-P7 Evening flow` (one conflict, in docs/DECISIONS.md, resolved by keeping both sides). `pnpm check` is green on `m2` after the merge. Its browser specs and the M2 gate have still not run: the UserNotificationCenter prompt (pid 97721) was still open, so pw-guard refuses every Playwright run.

- **Status:** parked, not merged into `m2`. The code is finished and `pnpm check` passes, but its browser specs have never run. The only `pnpm e2e` attempt exited with code 3: `scripts/pw-guard.mjs` found a macOS UserNotificationCenter prompt open (pid 97721) and refused to start Playwright. As instructed, the implementer did not retry. The prompt needs a person to click it.
- **Branch:** `m2-p7` (worktree `spellplane-wt/m2-p7`), head `f48fbb6 test(m2-p7): sealed with search-and-add and Winston browser specs; late picks only for pool builds`. Three commits on top of `cc47731 merge(m2): M2-P5 Builder table`, which is the current `m2` head, so it is 0 commits behind. `git merge-tree m2 m2-p7` reports no conflicts. The working tree is clean. The branch has no remote copy (`origin/m2-p7` does not exist).
- **Checked by the integrator at parking (12 Nov 2026, about 11:00):**
  - `pnpm check` is green in the worktree: tsc, svelte-check (1263 files, 0 errors, 0 warnings), eslint, and vitest with 1741 tests in 124 files.
  - `pnpm e2e` was not run: pid 97721 (`UserNotificationCenter`) is still running. The user also reported that the machine ran out of memory under parallel Playwright runs, so the integrator did not try again.
- This note replaces the earlier park note (`f39173c`), which was written when M2-P2, M2-P4 and M2-P5 were not yet on `m2`. All six other M2 packages are now merged: P1, P6, P4, P3, P2, P5.

## What the package was supposed to do

docs/PLAN.md, M2 package table:

> | M2-P7 Evening flow | Stage transitions for everyone at once, return to builder between games for sideboarding, rematch, new draft on the same link, resume in any stage. | `core/stage.ts`, `ui/flow/*` | M2-C |

docs/PLAN.md, M2 acceptance tests:

> **M2-P7.** A reload in each stage returns to that stage with the same pool, deck and table.

docs/PLAN.md, "Ownership within M2": M2-P7 owns
- `core/stage.ts` and the `stageSet` case in `core/reducer/table.ts`;
- `ui/flow/*`;
- the session wiring:
  - a new `session/draft.ts`;
  - the `draft` and `evening` members in `session/solo.ts` and `session/net.ts`;
  - `main.ts` (set data, pack generation);
  - the debug hook's `draft` part;
  - the stage switch in `ui/App.svelte` / `ui/lobby/TableRoom.svelte`.

Gate M2-G needs this package for its whole script: two pages run a full evening (draft, build, game, back to the builder, sideboard, game two), then a sealed start and a two-seat Rochester.

## What the branch contains

`git diff m2...m2-p7 --stat`: 26 files, +2743/−43. The diff touches no contract file (`*/types.ts`, `core/actions.ts`, `net/messages.ts`).

- **Pure part:**
  - `src/core/stage.ts`: `stageProblem` covers the host rule (`actingHost`), draft done, everyone committed, the labelled confirmation round and the seat count. `enterStage` creates the draft, clears the game on match → build, drops the draft on a new draft, and counts `games`. A `GAME_START` table holds starting life and phase.
  - `src/core/reducer/table.ts`: the `stageSet` case.
- **Session:**
  - `src/session/draft.ts` (new): `DraftHost`/`DraftControls`, the driver lifetime, pack seeds and the M2-P3 hand-off (`sendCards`/`onCards`, `confirmedState`, `drive()` on peer join).
  - `src/session/net.ts`: the `draft` and `evening` members.
  - `src/main.ts`: set data and pack generation.
  - The solo session offers neither member (DECISIONS).
- **UI:**
  - `src/ui/flow/Stage.svelte`, `EveningBar.svelte`, `LobbyDraft.svelte` and `model.ts`.
  - The stage switch in `ui/lobby/TableRoom.svelte`, plus a one-line `sets` pass-through in `ui/lobby/RoomRoute.svelte`.
  - `ui/draft/settings.ts`: the pick timer is offered only for the pass drafts. This settles the gate-report item from M2-P3 and M2-P4.
- **Debug and fixtures:**
  - `src/debug/draft.ts` adds the `draft` part and a `flow` part.
  - `src/debug/fixture-sets.ts` injects MTGJSON fixtures as `window.__spellplaneSets` in dev and test builds.
  - `src/debug/fixture-cards.ts` makes the fixture source answer `searchCards`.
- **Tests:**
  - Unit: `tests/unit/flow/stage.test.ts`, `tests/unit/flow/model.test.ts`.
  - Simulation: `tests/sim/flow/evening.test.ts`, `edges.test.ts`, `open.test.ts`, and `leak.test.ts`, which adds the evening scenario to the shared leak test.
  - Browser: `tests/e2e/flow/evening.spec.ts` with three specs, never run:
    1. a reload in each stage returns to that stage with the same pool, deck and table (the PLAN acceptance test);
    2. sealed: pools open for everyone at once; the builder searches card data and a reload keeps the added card;
    3. Winston: the piles reach only the player looking at them, through the session, until the builder.
- **`docs/DECISIONS.md`:** 20 `[M2-P7]` lines. They cover the stage rules, the acting host, the `enterStage` clearing rules, `GAME_START`, refusing a next game during an open shuffle, refusing Two-Headed Giant drafts until M3-P2, host-only automatic steps, driver lifetime, pack seeds, pool card ids, keeping a constructed deck as `SecretStore.build`, dropping a stale draft's private state, the solo session, the placement of the lobby panel and the evening bar, remount keys, the pick timer, fixture injection, the `flow` debug part, and the `RoomRoute` pass-through.

## What fails and why

Nothing in the code is known to fail. The package is parked because it is unverified, not because it is broken:

- `pnpm e2e` exited with code 3 (macOS security or privacy prompt) before Playwright started. The UserNotificationCenter prompt (pid 97721) stayed open through five checks over about 20 minutes, and it was still open when this note was written.
- The acceptance test for M2-P7 exists only as a browser spec (spec 1 above), so the package's acceptance test has not passed yet.
- The real app path through the stages (lobby → draft → build → match → build) has never run in a browser. M2-P4 and M2-P6 tested their surfaces only on module pages and left the app-level path to M2-P7.
- `ui/lobby/RoomRoute.svelte` belongs to M1-P5 and lies outside the files the plan gives M2-P7. The edit is a one-line prop pass-through and is recorded in DECISIONS. The integrator should accept or move it when merging.

## Open review findings

None. The package was parked before review because e2e could not run.

## What a retry should do first

1. **Dismiss the macOS prompt** (UserNotificationCenter, pid 97721; check with `pgrep -lf UserNotificationCenter`). Also make sure no other Playwright run is active on the machine: an earlier run with more parallel Playwright runs exhausted the memory.
2. In `spellplane-wt/m2-p7`, confirm that `m2` has not moved (`git log m2-p7..m2`). If it has, merge `m2` in and rerun `pnpm check`.
3. **Run the new specs alone first:** `pnpm e2e -- tests/e2e/flow --project=chromium`, with a 10-minute timeout. Then run the full `pnpm e2e` (Chromium and WebKit). Run one at a time. Fix any failures on `m2-p7` and never add retries.
4. **Review** the diff, especially:
   - `session/draft.ts` (driver lifetime, pack-seed recovery after reload);
   - the stage-clearing rules in `enterStage` (what a rematch keeps and what it drops);
   - the leak scenario for pools and builds across reload, rematch and new draft.
5. **Merge into `m2`,** remove this note, and then run the M2 gate script (`pnpm e2e:gate -- M2`, `pnpm shots -- M2`).
