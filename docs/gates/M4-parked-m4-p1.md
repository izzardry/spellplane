# M4-P1 Camera rigs: parked

- **Status:** parked, not merged into `m4`. The pipeline stopped after three review rounds without a clean review. The last review left one blocking finding, quoted below. The implementer's round-3 commit (`fada822`) targets exactly that finding, but no review round checked that commit.
- **Branch:** `m4-p1` (worktree `spellplane-wt/m4-p1`), head `fada822 fix(m4-p1): ego to bird's-eye holds the cursor point from any lean; picking at card height; projected tier height; clip planes`. Five commits on top of `c5d4c74 feat(m4-c): contracts`. The branch has no remote copy (`origin/m4-p1` does not exist). The working tree is clean.
- **Behind `m4`:** M4-P2 (Lit pipeline) and M4-P6 (Theme switcher and conformance) were merged into `m4` after the branch was cut. `git merge-tree m4 m4-p1` reports conflicts in three files:
  - `src/scene/table-scene.ts`, five hunks. They cover the imports (`BirdseyeRig` against `TableRig`, card boxes, contact shadows and held lift from M4-P2), the harness `idle` predicate (M4-P2's `lift.moving` against M4-P1's `pendingFollow`), the theme rebuild in `setTable` (M4-P2's `rebuildTheme` against M4-P1's `viewerLateral`), and teardown (M4-P2's dressing, runtime, box and shadow disposal against M4-P1's pointer listeners).
  - `tests/unit/themes/m4-contracts.test.ts`, two hunks.
  - `docs/DECISIONS.md`, one hunk (both appended lines at the end).
- **Checked by the integrator at parking (13 Nov 2026), at `fada822` in the worktree:**
  - `pnpm check` is green: tsc, svelte-check, eslint and vitest with 2234 tests in 154 files.
  - The camera unit tests pass on their own: 60 tests in 4 files (`tests/unit/camera/*`). They include the reviewer's four reproductions, which round 3 added as a unit test.
  - `pnpm e2e` was not run at parking. The branch's browser specs, `tests/e2e/camera/rigs.spec.ts` and `tests/e2e/camera/hud.spec.ts`, still have to pass on Chromium and WebKit after the merge with `m4`.

## What the package was supposed to do

docs/PLAN.md, M4 package table:

> | M4-P1 Camera rigs | Ego rig with lean, dolly and pitch limits; continuous blend to and from bird's-eye in 400 ms with the cursor point fixed; follow-stack and follow-active-player toggles; reduced-motion cuts. | `scene/camera/*` | M4-C |

docs/PLAN.md, M4 acceptance tests:

> **M4-P1.** During a blend the world point under the cursor moves less than 2 px; the ego camera never passes below the table edge; with reduced motion the switch is a cut.

docs/PLAN.md, ownership: M4-P1 owns
- `scene/camera/*`. It may move the bird's-eye rig from `scene/camera.ts` there.
- The camera controls and the `rig` debug part in `scene/table-scene.ts`.
- The P key and right-drag pitch in the HUD's key and pointer handling.
- The wiring of `Settings.followStack`/`followActive` to `setFollow`.

The design source is DESIGN "Camera and navigation": Ego perspective ("the camera never goes below the table edge or behind the seat") and Switching ("The point under the cursor stays under the cursor").

## What the branch contains

`git diff m4...m4-p1 --stat`: 22 files, +3230/−381. No contract source file is changed. `tests/unit/themes/m4-contracts.test.ts` changes by 7 lines.

- **Rigs:**
  - `src/scene/camera/birdseye.ts`: the bird's-eye rig, moved out of `scene/camera.ts`.
  - `src/scene/camera/ego.ts`: the ego rig, with lean, dolly and pitch limits. `egoLimitsFor` widens the lean per table and seat.
  - `src/scene/camera/pose.ts`: camera poses, projection and unprojection.
  - `src/scene/camera/blend.ts`: the blend. It solves the camera's position so the cursor's table point stays fixed.
  - `src/scene/camera/rig.ts`: `TableRig`, the controller for both rigs. It handles pan, zoom at the cursor, fit, seat keys, inertia, `setRig`, clip planes and picking at card height.
  - `src/scene/camera/follow.ts`: follow the stack and follow the active player.
- **Wiring:**
  - `src/scene/table-scene.ts`: the rig, the `rig` debug part, follow requests, pointer-release tracking and per-card texture tier from the projected height.
  - `src/ui/Hud.svelte` and `src/ui/commands.ts`: the P key, the View button and right-drag pitch.
  - Both harnesses (`src/scene/harness.ts`, `src/ui/harness.ts`).
- **Tests:**
  - Unit: `tests/unit/camera/{blend,ego,follow,rig}.test.ts` and `helpers.ts`. They include properties over every format and seat.
  - Browser: `tests/e2e/camera/{rigs,hud}.spec.ts`.
- **Decisions:** 30 `[M4-P1]` lines in `docs/DECISIONS.md`. Among them:
  - Deep bird's-eye zooms can leave the cursor point out of reach of the ego limits. That case falls outside the 2 px guarantee, like a cursor over the surround.
  - A move that arrives mid-blend restarts the blend.
  - The round-3 rule that a bird's-eye centre may stay beyond the table edge after a switch.

## Open review finding (round 3, against the round-2 code)

**Blocking.** `src/scene/camera/rig.ts:355` (round-2 numbering, in `setRig`). Design references: PLAN M4-P1 acceptance, "During a blend the world point under the cursor moves less than 2 px"; DESIGN Camera and navigation, Switching, "The point under the cursor stays under the cursor."

> Switching from ego back to bird's-eye does not hold the cursor's table point once the viewer has leaned sideways on a multi-seat table. The point can be on the table and still move 230 to 670 px. egoLimitsFor (ego.ts:51) widens the lean to halfWidth + |lateral|, so the ego camera can stand beyond the table's side edge and show table points near that edge on the opposite side of the screen. The bird's-eye centre is clamped to the table (BirdseyeRig.clampView, birdseye.ts:155). That clamp means no bird's-eye zoom, minDist included, can put such a point under the cursor. The zoom-in search in setRig finds no on-table centre and leaves the clamped view, and blendPose then slides the point between the two end positions. This case is over the table, so neither documented exemption covers it (cursor over the surround; deep bird's-eye zoom into ego). The existing ego-to-bird tests start only from the default nav or a wheel zoom, so they never lean.
>
> Reproduction (scratch vitest, 1440x900 viewport, TableRig with the table scene's lateral, rig 'ego', panBy(dx/20, 0) x20, then setRig('birdseye', 0, 400, cursor), stepped every 10 ms):
> - ffa3 viewer s1 (lateral 500): panBy total -1500 (lean 1492), cursor (36, 202) over table point (-984, -612). The point moves 673 px.
> - ffa4 viewer s0: pan -1500 (lean 990), cursor (396, 833) over (865, -716). It moves 308 px.
> - 2hg viewer s0: pan -800 (lean 796), cursor (252, 878) over (1048, -399). It moves 436 px.
> - 2hg viewer s1: pan +800, cursor (972, 382) over (-1071, 204). It moves 234 px.
>
> A cursor grid gives 9 to 16 failing cursors per affected seat. 1v1 and ffa3 s0 show none in 4,400 random ego navs.
>
> Suggested fix: make the switch to bird's-eye able to hold any table point the ego view shows. One way is to let the post-switch bird's-eye view keep a centre beyond the table edge. For example, clamp to the table grown by the visible half-extent at that zoom, apply that in setRig, and keep it until the next pan or zoom re-clamps it. The other way is to bound the ego lean so the camera cannot leave the table's side extent, but bird's-eye-to-ego must keep holding the point. Add a property test for ego to bird's-eye from random lean, dolly and pitch within the limits, on every format and seat, with cursors over the table.

**Why it failed to converge.** Each round fixed the cursor-point guarantee in one direction and opened it in the other:
- Round 2 (`6c21e07`) widened the ego lean to `halfWidth + |lateral|`, so bird's-eye-to-ego could hold every table point from seats beside the centre line.
- That widening let the ego camera stand beyond the table's side edge. Then ego-to-bird's-eye could not hold the point, because the bird's-eye centre is clamped to the table.
- Round 3 (`f824447`) widened the ego anchor solve over lean, dolly and pitch. That review then found the reverse direction broken.

The two rigs' reachable sets were never made to cover each other.

**What round 3 did about it (`fada822`, unreviewed):** it took the reviewer's first suggested fix.
- `setRig` keeps the bird's-eye centre beyond the table edge, at the zoom the viewer left, when no zoom can keep it on the table and the cursor's point is on the table.
- `BirdseyeRig.clampView(v, keep)` grows the clamp box to include the current centre. A later pan, zoom, inertia step, inset change or resize then never pushes the centre further out and never jumps. Panning back brings the centre toward the table, and the box shrinks with it.
- Fit, seat keys and zoom to a card still clamp to the table.
- Round 3 added three tests to `tests/unit/camera/blend.test.ts`:
  - a 1500-run property over random lean, dolly and pitch, every format and seat, and bird's-eye tilt 0 and 10;
  - a 20×20 cursor grid at both lean limits on every seat;
  - the reviewer's four cases, plus no-jump checks on the next pan.

  All three pass.
- The same commit also changed things the finding did not ask for, and no review covered them:
  - picking and the pile badge test the card's drawn top, not z = 0;
  - the texture tier comes from the card's projected long-axis length;
  - near and far clip planes (`TableRig.clipPlanes`);
  - a pointer move with no button down ends a stale press;
  - `setRig` to the current rig no longer counts as the viewer's choice.

The finding therefore looks addressed, but a reviewer has not confirmed it. Risks to check:
- A bird's-eye centre beyond the table edge is a new state. Fit detection (`atFit`), the `rig` debug part's table view, follow moves and the M4 gate screenshots may assume a centre on the table.
- The clip planes and the card-height picking interact with M4-P2's card boxes and held lift, which landed on `m4` after the branch was cut. The two packages may disagree on a card's drawn height (P1 picks at pile height + drag lift + thickness; P2 owns `HeldLift`).
- The per-card texture tier from projected height affects texture memory against the 400 MB performance cap.

## What a retry should do first

1. Merge `m4` into `m4-p1` in the worktree and resolve the three conflicts:
   - In `src/scene/table-scene.ts`, keep M4-P2's render loop, `rebuildTheme`, card boxes, contact shadows, held lift and their disposal. Replace the `BirdseyeRig` with M4-P1's `TableRig`, and pass `viewerLateral(state)` to `rig.setTable`. Keep the `idle` conditions from both sides (`pendingFollow.length === 0` and `rc.lift.moving`).
   - Make picking use the card's drawn height from M4-P2's `HeldLift`/box thickness, not a second copy of it.
   - Feed `TableRig.clipPlanes` to the camera from inside M4-P2's render loop.
2. Run `pnpm check`, then `pnpm e2e` (Chromium and WebKit) on the merged branch, including `tests/e2e/camera/*`.
3. Run one review round on `fada822` plus the merge. Ask the reviewer to verify the open finding first, in both directions:
   - ego to bird's-eye from any lean, dolly and pitch, and bird's-eye to ego from any pan and zoom, on every format and seat, with the cursor over the table;
   - the reviewer's four reproductions, which are already a unit test ("the reviewer's cases: ego leaned beyond the side edge…").
4. Have the reviewer check that nothing downstream assumes the bird's-eye centre stays on the table: fit detection, follow, seat keys, the `rig` debug part and the gate's perspective switch.
5. Run `pnpm e2e:gate -- M4` and the performance checks (draw calls, texture memory) with the ego rig, so the M4 gate's "both camera rigs" screenshot matrix can be taken.
6. Report these items to the M4 gate:
   - the deep-zoom exemption from the 2 px guarantee (DECISIONS `[M4-P1]`);
   - the off-table bird's-eye centre after a switch, which the owner should judge at the playtest.
