# M7-P1 Table worlds, tilt and the arena still: parked (second launch)

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". Review round 1 found two blocking issues (listed below). The implementer's fix commit `ced0808` answers both, but no second review ran, so nothing was merged.
- **Branch:** `m7-p1` (worktree `spellplane-wt/m7-p1`). Its head is `d588061 Merge branch 'm8' into m7-p1`. The branch is local only, not on `origin`. The working tree is clean.
- **Merge state:** `git diff m8...m7-p1 --stat` shows 73 files, +7697 / -2496. There are 30 `[M7-P1]` lines in its `docs/DECISIONS.md`. Since the branch last merged `m8`, `m8` has moved on to `68adaa9`: M8-P5, then M7-P5, were integrated. A trial `git merge-tree m8 m7-p1` reports **one conflicting file, `src/scene/table-scene.ts`, with four small hunks**:
  - the imports: m8 adds `cardFeel` and `rigForTilt`; m7-p1 adds `table-marks`, `camera/tilt` and `camera/anchors`;
  - the constants: m8's `HAND_BAND_GAP_PX` beside m7-p1's `SEAT_ANCHOR_SETTLE_MS` and `startTilt()`;
  - the frame loop: m8's `tableTheme.set(theme.id)` beside the comment both sides edited;
  - the state update: m8's `affordDirty = true` beside m7-p1's `syncMarks()`.

  All four want both sides. PLAN ("Merge order in `src/scene/table-scene.ts`") meant M7-P1 to go in before M7-P5. M7-P5 went in first, so the retry resolves the hunks on M7-P1's side of the merge.
- **Checked by the integrator at parking (20 Nov 2026, 18:10, in the worktree):**
  - I ran `pnpm exec vitest run tests/unit/perf tests/unit/camera tests/unit/themes`: 31 files, 809 tests passed and 1 skipped.
  - I ran the reviewer's reproduction tests against the branch head (scratch files, not in the repository). Finding 2's `snap.scratch.test.ts` passes. Finding 1's `gpu.scratch.test.ts` still fails, but it feeds a **constant** gap that fewer pixels never shorten. Under the branch's "judge by effect" rule, that is the covered-window case. The branch's own unit test feeds a GPU-bound gap that scales with the pixel count, and there the scale steps down to `MIN_PIXEL_RATIO`. Which model is right is the question for the re-review (see finding 1).
  - I did not run the full `pnpm check`, the package's e2e folders or gates M0 and M4 at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M7-P1 Table worlds, tilt and the arena still | Four looks as 3D table worlds (Plain new and default); the one continuous tilt with the owner's mouse rule (was M7-P3); the soft arena still; renderer lifecycle, the mount / dispose soak, the no-blur guard | no | `src/themes/**`, `src/scene/{materials,lights,textures,post,table-marks,resolution,quality,switches,pacing,presence,lifecycle,still,camera}.ts`, `src/scene/camera/**`, `src/ui/perf/**` |

The brief is `docs/design/m8/m7-adjustments.md`, sections "M7-P1" and "M7-P3", and the lifecycle part of "M7-P6". Gate M4 applies too. The package also owns the camera gesture paths, renderer create and dispose, the marks and the resolution regions of `src/scene/table-scene.ts` and `gestures.ts` (PLAN, "Fixed paths of the seams"). It owns two seams: `src/scene/camera/pose.ts` `poseAt(tilt, layout, seat)` and `src/scene/still.ts` `renderArenaStill(theme, { width })`.

The acceptance list is in docs/PLAN.md, "M7-P1 Table worlds, tilt and the arena still":
- **Worlds:** unit tests per look (builds, deterministic textures, bounded sounds, light model, the surface and surround tokens, built without a table state, a clean `dispose`, Plain's halftone, zero post passes and double ring). In e2e: conformance, exile marks, and screenshots at tilt 0, 0.5 and 1.
- **Camera:** unit tests of the interpolation and of `poseAt`. In e2e: a right-drag tilts, a horizontal right-drag leaves yaw, the wheel zooms, a two-finger swipe tilts, and `tests/e2e/touch/gestures.spec.ts` stays green.
- **Still:** a Blob for each look, with no card, soft, and leaving no contexts or residue behind. It resolves `null` without WebGL.
- **Lifecycle:** `tests/e2e/perf/soak.spec.ts` (20 mounts and disposes) and `tests/e2e/perf/no-backdrop-filter.spec.ts`.
- **Policy:** unit tests that hidden or covered frame gaps do not lower the resolution and that the table at rest renders at full resolution.

## What the branch contains

- **Looks:** `src/themes/{plain,kitchen,graphite,codex}/` with `textures.ts`, plus a shared world kit in `src/themes/kit/` (`look`, `marks`, `procedural`, `sounds`, `surfaces`, `world`).
- **Camera:** the one continuous tilt.
  - `src/scene/camera/rig.ts`, rewritten from M7-P3, which was merged into this branch first.
  - `camera/tilt.ts`, `camera/anchors.ts`, `camera/pose-at.ts` and `pose.ts`.
  - The old `ego.ts` is removed, and its tests (`blend`, `ego`, `switch`) are replaced by `rig`, `tilt` and `pose-at`.
- **Scene:**
  - `table-marks.ts`: marks only where used.
  - `still.ts`: the arena still.
  - `resolution.ts`: the hidden and covered-window policy.
  - `lifecycle.ts`.
  - Renderer lifecycle hooks in `builder.ts`, `draft.ts` and `stage.ts`. These are outside the package's globs, but the acceptance needs them: the draft, builder and stage scenes count as contexts.
- **Tests:**
  - `tests/e2e/camera/{tilt,touch-tilt}.spec.ts`.
  - `tests/e2e/themes/looks/{conformance,looks,marks}.spec.ts`.
  - `tests/e2e/perf/{soak,no-backdrop-filter}.spec.ts` and `tests/e2e/scene/still.spec.ts`.
  - The unit tests under `tests/unit/{camera,themes/looks,perf}/`.
  - Edits to `tests/e2e/m4.gate.spec.ts`, `touch/gestures.spec.ts` and `camera/rigs.spec.ts`.
- **Contract edits:** additive lines only, all tagged `[M7-P1]`. `TableScene.zoneMarks?()` is in `src/scene/types.ts`, and the selection ring's `gap?` is in `src/themes/types.ts`.

## Open review findings (round 1) and their state on `d588061`

Both were blocking. "Fixed" below means fixed on the branch but **not re-reviewed**.

1. **`src/scene/resolution.ts:54`: the covered-window rule switches the adaptive resolution off for a slow GPU.**
   - **Finding:** `foreignGap()` dropped every frame with a gap of at least 50 ms (`COVERED_GAP_MS`) and a CPU draw of at most 8 ms (`COVERED_DRAW_MS`). A GPU-bound frame has exactly that signature, because `table-scene.ts` passes `stats.frameMs`, the CPU time of the render calls, as `drawMs`. Under SwiftShader that time measured 1.0-1.4 ms. So below 20 fps (Safari on a 5K canvas, an older Mac, an iPad, CI) the motion resolution never stepped down. That is the case M7-A0 built it for (docs/gates/M7-A0.md section 3).
   - **On the branch:** `ced0808` follows both of the reviewer's options.
     - (b) `foreignGap` drops a short-draw frame only from `THROTTLED_GAP_MS` = 1000 ms.
     - (a) A run with a median gap of at least 50 ms and a median draw of at most 8 ms (`suspectRun`) still steps down, on probation. The next full run keeps the step only if its median gap is at most `HELPED_RATIO` (0.9) of the one before. Otherwise the step is undone, and frames are ignored (`stalled`) until one arrives at the display rate (at most `FAST_MS`).
     - `tests/unit/perf/policy.test.ts` gained these cases: a slow GPU with the M7-A0 numbers (61, 224 and 396 ms; draws of 1 and 4 ms), modelled as a gap that scales with the scale squared, reaches `MIN_PIXEL_RATIO`; it is lowered within two runs; and an undone step plus `stalled`.
   - **Re-review should check:**
     - A slow GPU whose gap does **not** shrink with the pixel count. One example is a fixed compositing cost of a large canvas in Safari. The reviewer's `gpu.scratch.test.ts` models this as a constant gap, and it still ends at scale 1 on the branch. Decide whether that is acceptable or whether `stalled` should time out and probe again later.
     - That `stalled` cannot pin the scale at 1 for good on a GPU that is slow all the time: no frame at the display rate ever clears it, but a pause or a new run does.
     - Whether gate M7-A0 section 3 still passes in real Safari (`pnpm perf -- --safari-open`, at the desk).
2. **`src/scene/camera/rig.ts:277`: a right-drag with no vertical travel changes the view in the default look.**
   - **Finding:** `endTiltDrag()` snapped to a preset within 0.1 whether or not the drag had moved the tilt. Plain and Kitchen Table open at 0.55, so a horizontal right-drag, or a right-click that slipped past the 4 px threshold, eased the camera to 0.5. It also set `rigChosen`, emitted tilt events, un-fitted the view and opened no context menu. That breaks the owner's rule ("horizontal movement does not turn the view") and the acceptance line "a horizontal right-drag leaves yaw".
   - **On the branch:**
     - `beginTiltDrag` only records `{ from, press, moved: false }`. The anchor, `lookMove`, the start event and `fitted` change only on the first real `tiltDragBy`.
     - `endTiltDrag` does nothing for a drag that never moved.
     - The look's own tilt (`homeTilt`, passed from `startTilt(...)` and updated on a theme switch at `table-scene.ts:3078`) is a snap stop beside the presets.
     - `table-scene.ts` sets `rigChosen` only when `rig.tiltDragMoved()`.
     - `tests/e2e/camera/tilt.spec.ts` now covers the tilts 0, 0.5, 1, 0.55, 0.8 and 0.3. For each it checks heading, pitch, field of view, camera position and tilt.
     - Unit cases were added to `tests/unit/camera/rig.test.ts`.
     - The reviewer's `snap.scratch.test.ts` passes on the branch head.
   - **Re-review should check:**
     - That a right-click without travel still opens the context menu.
     - That `fitted` stays set after a no-travel drag.
     - That the e2e ran green in both browsers. It did not run at parking.

The fix commit also contains these review minors:
- the arena still halves to a sixteenth for odd widths;
- Plain's double ring is measured on screen;
- lit frames are tuned to the frame token;
- `scripts/perf/measure.mjs` opens `#/solo` with the four looks;
- the soak's baseline is all zeros;
- the no-blur guard waits for each surface and requires the menu, the drawer and a dialog.

## What a retry should do first

1. In `spellplane-wt/m7-p1`, merge the current `m8` into `m7-p1` and resolve the four `table-scene.ts` hunks by keeping both sides (see "Merge state"). Take `m8`'s side in any contract or frozen file. Then run `pnpm install --frozen-lockfile` and `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`.
2. M7-P5 is already on `m8`, so check its specs after the merge as well as M7-P1's: the read-only scene, drag and drop, and the strip, which share `table-scene.ts` gesture paths with the tilt drag.
3. Run the package's browser specs one file at a time per browser, with WebKit on the remote server:
   - `tests/e2e/camera/`, `tests/e2e/themes/looks/`, `tests/e2e/perf/soak.spec.ts`, `tests/e2e/perf/no-backdrop-filter.spec.ts`, `tests/e2e/scene/still.spec.ts` and `tests/e2e/touch/gestures.spec.ts`.
   - Then the folders in both browsers, `pnpm e2e:gate -- M0` and `pnpm e2e:gate -- M4`.

   None of these ran at parking. The first launch lost WebKit runs to memory, so watch the Studio's WebKit footprint during the looks and soak specs.
4. Run a second review limited to the two findings above and the open points under "Re-review should check" (`git show ced0808`). The worlds, the tilt rig and the still are complete enough that the retry should not rebuild them.
5. If the review converges, merge it and run `push-preview.sh`. While M7-P1 is parked, `m8` runs as PLAN's parking line says: Plain shows the Paper table, the camera is today's, `poseAt` is the bird's-eye stub, and Home's still is the look's gradient.
6. If time is short, keep the finding fixes, the four worlds and the lifecycle (soak and no-blur). The screenshot evidence at five tilts and Graphite's depth can wait.
