# M2-P7 Evening flow: parked

- **Status:** parked, not merged into `m2`. No work was attempted. The pipeline did not start the package because three of the packages it wires together are not on `m2`: M2-P2, M2-P4 and M2-P5.
- **Branch:** none. There is no `m2-p7` branch, local or on `origin`, and no worktree `spellplane-wt/m2-p7`. Nothing was built, so there is nothing to test or review.
- **State of `m2` at parking (12 Nov 2026, checked by the integrator):** head `0b56fed docs(m2): park M2-P3`, the same as `origin/m2`. On `m2`: M2-C (contracts), M2-P1 (pack generation) and M2-P6 (list view and deck library). M2-P3 is parked (`docs/gates/M2-parked-m2-p3.md`).

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

DESIGN "Specification: card data, packs and draft formats", Evening stages: `lobby → draft → build → match → build → match …`. The host advances from the lobby. The draft advances automatically. The build stage advances when every seated player is Ready. From a match, any player proposes "next game" or "new draft" and the others confirm.

Gate M2-G depends on this package for its whole script: two pages run a full evening (draft, build, game, back to the builder, sideboard, game two), then a sealed start and a two-seat Rochester.

## What M2-C left for M2-P7 on `m2`

The contracts and stubs are in place. M2-P7 fills them in and edits no contract file:

- `src/core/stage.ts`: `STAGE_EDGES`, `nextStage`, `hostSeat` and lobby validation are done. `stageProblem` returns `null` and `enterStage` only sets `stage`. M2-P7 implements both:
  - `stageProblem` checks the host rule, draft done, everyone Ready, the confirmation `round` and the seat count.
  - `enterStage` creates `TableState.draft`, clears the game table when going from a match back to the builder, drops the draft on a new draft, and counts `games`.

  M2-P7 then wires both into `stageSet` in `src/core/reducer/table.ts:176`.
- `src/session/types.ts`: `TableSession.draft?` (`DraftControls`) and `TableSession.evening?` (`EveningControls`). Neither session provides them yet.
- `src/draft/types.ts`: the `DraftHost` seam that the drivers expect from the session.
- `src/ui/types.ts`: `FlowProps` for `ui/flow/*`. The `sets` prop is to be wired in `main.ts`.
- `src/debug/types.ts`: the `draft` part of the debug hook.
- DECISIONS lines that bind M2-P7: `[M2-C]` stage edges, `stageSet.round`, `DeckBuild` in the SecretStore (needed for the reload-in-build test), and session ownership.

## What fails and why

Nothing was run, so nothing failed. The package is blocked on its inputs. M2-P7 is the integration package of M2: it connects the drivers, the draft UI and the builder to the session and to the stage switch. It cannot be built or tested against stubs for all three:

- **M2-P2 Pass draft and sealed:** not on `m2`. There is no `m2-p2` branch or worktree. Without it, the draft stage has no pass or sealed driver for `session/draft.ts` to start. "draft advances automatically" (the `draftDone` event) has no producer. The gate's M19 booster draft and sealed start cannot run.
- **M2-P4 Draft UI:** not on `m2`. The branch `m2-p4` (head `c3683c9`, worktree `spellplane-wt/m2-p4`) exists. A local, unpushed branch `m2-p4-integrated` holds a merge commit `f66bf17 merge(m2): M2-P4 Draft UI` on top of `0b56fed`, made on 11 Nov 2026 at 23:39. That commit has not reached `m2` or `origin/m2`. Until it does, the stage switch has no draft stage view to show.
- **M2-P5 Builder table:** not on `m2`. There is no `m2-p5` branch or worktree. Without it:
  - the build stage has no builder container (M2-P5 owns `ui/builder/*` outside `list/*`);
  - there is no Ready with commitment, so the `allReady` event has no producer;
  - "return to builder between games for sideboarding" has nothing to return to.

## Open review findings

None. No review ran, because there is no branch.

## Work handed to M2-P7 by other packages

A retry must pick these up. They are recorded on the package branches, not yet on `m2`:

- **From M2-P3** (`docs/gates/M2-parked-m2-p3.md`, "What a retry should do first" step 2, and the `[M2-P3]` DECISIONS lines on `m2-p3`). `session/draft.ts` must:
  - implement `DraftHost.sendCards`/`onCards` on top of `net/draftcards.ts`;
  - implement `DraftHost.confirmedState` on top of NetEngine `confirmedState`;
  - call the Winston driver's `drive()` when a peer (re)joins;
  - keep the Winston driver alive after the draft ends until the other player's pool covers `taken`.

  These seams depend on the M2-C contracts amendment requested in the M2-P3 park note.
- **From M2-P3 and M2-P4:** the lobby offers a pick timer for Rochester, Winston and Grid, where it does nothing. This is a gate-report item: either hide the setting or have `draftDeadlines` time those formats.
- **From M2-P4 and M2-P6:** both packages test their surfaces on module pages bundled by their own specs, because the `?harness=` registry in `main.ts` belongs to M2-P7. Once the real stage switch exists, the M2-P7 browser specs should drive the real app path through the stages.

## What a retry should do first

1. **Wait until M2-P2, M2-P4 and M2-P5 are merged into `m2`,** and land the M2-C contracts amendment from the M2-P3 park note. M2-P3 itself should merge too, since the gate's Rochester run needs it. If only M2-P4 is missing, check whether `m2-p4-integrated` (`f66bf17`) just needs to be pushed to `m2`.
2. **Create `m2-p7` from the current `m2`** in `spellplane-wt/m2-p7`. Run `pnpm install --frozen-lockfile`, then `pnpm check`.
3. **Build the pure part first:** `stageProblem`, `enterStage` and the `stageSet` case, with unit tests for every edge, the host rule, the confirmation round, and the clearing of the game table on match → build. This part depends only on M2-C and could start before the other packages land.
4. **Then wire the session:**
   - `session/draft.ts` (`DraftHost` and `DraftControls`, including the M2-P3 hand-off above);
   - the `evening` members in `solo.ts` and `net.ts`;
   - `main.ts` set data and `generatePack` from M2-P1;
   - the debug hook's `draft` part;
   - the stage switch with `ui/flow/*`.
5. **Write the acceptance test as a browser spec:** a reload in each of lobby, draft, build and match returns to that stage with the same pool, `DeckBuild` and table, checked by state hash through the debug hook. Add any new hidden-information path (for example the pool and deck across reload and rematch) to the shared leak test.
6. **Then run `pnpm e2e` and the M2 gate script.**
