# M7-P2 Table HUD and in-table panels: parked (second launch)

> **Update (20 Nov 2026, evening): merged.** The M8 gate fix round merged this branch into `m8` without the second review (decision `[M8-G]` in docs/DECISIONS.md) and fixed the integration failures it found there. The text below is the parking record.

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". Review round 1 found two blocking issues (listed below). The implementer's fix commit `c2cbff7` (20 Nov, 15:57) answers both, and later commits on the branch build on it, but no second review ran, so nothing was merged.
- **Branch:** `m7-p2` (worktree `spellplane-wt/m7-p2`). Its head is `5079589 Merge branch 'm8' into m7-p2`. The branch is local only, not on `origin`. The working tree is clean.
- **Merge state:** the current `m8` (`874c0a6`) is an ancestor of `m7-p2`, so the branch merges into `m8` without conflicts. `git diff m8...m7-p2 --stat` shows 90 files, +4449 / -766. There are 37 `[M7-P2]` lines in its `docs/DECISIONS.md`.
- **Checked by the integrator at parking (20 Nov 2026, 18:22, in the worktree):**
  - I ran `pnpm exec vitest run tests/unit/hud tests/unit/m8-contracts.test.ts`: 7 files, 136 tests passed.
  - I read the fix commit against both findings (see below). The code paths and the specs the reviewer asked for are on the branch.
  - I did not run the full `pnpm check`, the package's e2e folders or gate M0 at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M7-P2 Table HUD and in-table panels | The rebuilt HUD on the kit with every `HudShellProps` slot, the log closed on entry, `KEEP` / `MULLIGAN`, the View control; in-table panels swept to kit classes | no | `src/ui/Hud.svelte`, `TurnStrip.svelte`, `Avatar.svelte`, `LogPanel.svelte`, `src/ui/hud/**`, `src/ui/menu.ts`, `src/ui/harness.ts` |

The brief is `docs/design/m8/m7-adjustments.md`, section "M7-P2", chunks P2-1 to P2-4, with `HudShellProps` from section 2 (and `primaryOverride` from PLAN "Fixed paths of the seams"). PLAN "How M7 changed" records the revision: the design system went to M8-P1 and the start page work is not merged.

The acceptance list is in docs/PLAN.md, "M7-P2 Table HUD and in-table panels":
- `tests/e2e/hud/seams.spec.ts` in the ui harness with `setShell(partial)`: every `HudShellProps` member as chunk P2-3 lists, plus `primaryOverride` (the primary button shows the given label, runs it, and returns to its own step when cleared); `HUD_SHELL` is `true`.
- `sizes.spec.ts` (every HUD button has one of the kit's heights), `no-literals.test.ts`, `log-closed.spec.ts` (three window sizes; never opens by itself), `view.spec.ts`, `opening.spec.ts` (`KEEP` / `MULLIGAN`), axe in Plain and Graphite, `tests/e2e/touch/hud.spec.ts` (no wrapped row at 768 px), screenshots in four looks.
- Sweep: with the context menu, the pile viewer, inspect, token search and the confirm prompt open in the ui harness, every button has a kit height and nothing computes a blur.

## What the branch contains

- **HUD:** `src/ui/Hud.svelte` rebuilt on the kit, with every `HudShellProps` slot: the back arrow (`onleave`), `menuTop`, `sandbox`, the no-deck line (`onchoosedeck`), `seatPresence`, `plateMenuTop`, `plateBadge`, `status`, `notice`, `chrome`, `readOnly` and `primaryOverride`. `HUD_SHELL` is `true` in `src/ui/hud/shell.ts`.
- **New HUD parts in `src/ui/hud/`:**
  - `HudMenu.svelte` with `menu-model.ts`.
  - `LifePlate.svelte` and `CounterChip.svelte`.
  - `ViewControl.svelte` with `view.ts`.
  - `OpeningHand.svelte` with `opening.ts` (`KEEP` / `MULLIGAN`).
  - `NoDeck.svelte`.
  - `turn.ts`: the primary button and `passTarget`.
  - `scrub.ts`, `ticker.ts` and `hud.css`.
  - The harness pieces `harness-shell.svelte.ts` and `shell-fixtures.ts`.
- **Rewritten:** `Avatar.svelte`, `TurnStrip.svelte`, `LogPanel.svelte` (the log is closed on entry; a drawer) and `src/ui/menu.ts`.
- **Sweep to kit classes and heights:** `ContextMenu`, `PileViewer`, `TokenSearch`, `CheatSheet`, `audit/AuditPanel`, `chat/FilterBar` and `confirm/ConfirmPrompt`.
- **Tests:**
  - `tests/e2e/hud/{seams,sizes,view,opening,sweep,shots,hud,newcomer}.spec.ts`.
  - The unit tests `tests/unit/hud/{menu,no-literals,opening,scrub,turn,view}.test.ts`.
  - Re-routed specs that followed the new HUD: gates M0 to M5, settings, signals, spectators, teams, themes, touch, ui, voice and `m8/frame.spec.ts`. Their `data-testid` values are kept where a function survives.

## Open review findings (round 1) and their state on `5079589`

Both were blocking. "Fixed" below means fixed on the branch but **not re-reviewed**.

1. **`src/ui/Hud.svelte:564`: `readOnly` still lets the player change the table through five HUD routes.**
   - **Finding:** after `setShell({ readOnly: true })` on `?harness=ui`, the reviewer found five routes that still acted:
     1. A right-click or Shift+F10 on a card opened the full card menu. "Tap" dispatched `tap`, and on a hand card "To graveyard" dispatched `move`.
     2. The own library's pile viewer still showed Draw / Draw N / Shuffle / Look / Mill / Search / Mulligan.
     3. With an untap offer open, the U key ran untap-all-and-draw. The reserved-key branch ran before `keyAllowed`.
     4. The stack chip's Resolve / Resolve to / Counter buttons still acted.
     5. A drag out of the hand still called `scene.startDrag`.

     `TableFrame` passes `readOnly` from Gathering's LOOK AT THE TABLE, so a standby browser on a stale save could propose actions. That contradicts `m7-adjustments.md` section 2 ("Look, do not touch") and DESIGN "Save, leave, rejoin and history".
   - **On the branch:**
     - `c2cbff7` adds `viewOnly = readOnly || !full` (`Hud.svelte:134`), which also covers chrome `'plates'`.
     - It gates the untap key, the card, table and radial menus (they keep look-only entries), the clip menu, the own library's pile actions, drags out of the hand and out of viewers, double-click draw and the stack chip's buttons.
     - The keymap keeps only view keys under `readOnly` and `'plates'`.
     - `e18c7b7` also gates M7-P5's pile buttons and coach marks under `readOnly`.
     - `tests/e2e/hud/seams.spec.ts` gained "readOnly: no route acts — card and table menus look only, piles, stack, untap key, drags" (line 196). It asserts that the proposed actions, the session calls and the scene's `startDrag` calls stay empty.
   - **Re-review should check:**
     - Each of the five routes again, plus routes added since round 1: the plate menu's "Set life…" and Volume/Mute from `c2cbff7`, and the View control.
     - That nothing in a `readOnly` HUD calls `session.*` or `scene.startDrag`.
     - That the new spec ran green in both browsers. It did not run at parking.
2. **`src/ui/hud/turn.ts:74`: at the solo table the HUD dead-ends after the first End turn.**
   - **Finding:** on `#/solo`, End turn passed the turn to the empty chair `s1`. The primary button then read "Waiting for" and was disabled, and the tracker read "'s turn". Only Ctrl+Enter or the hidden table menu's "Next turn" got the turn back. The branch had removed the strip's `next-turn` button. Its own specs (`newcomer.spec.ts:94`, `hud.spec.ts:81`) handed the turn back with a debug-hook `turnPass`, so "play a turn, no key" never proved that a second turn was reachable.
   - **On the branch:**
     - `c2cbff7` adds `emptyChair` to `primaryAction`. When the active seat is an empty chair it returns an enabled `{ kind: 'endTurn', label: 'Next turn ▸' }`.
     - `passTarget` (`turn.ts`) makes the primary End turn pass over empty chairs, so the sandbox's End turn comes straight back to the player.
     - The tracker reads "Empty seat's turn".
     - An open untap offer makes the primary button "Untap & draw ▸" on whatever step the marker was left.
     - `newcomer.spec.ts` and `hud.spec.ts` now reach the next turn with the primary button. `hud.spec.ts:114-119` asserts "Empty seat's turn", "Next turn ▸" and a `turnPass` to `s0`.
     - `tests/unit/hud/turn.test.ts` covers the empty-chair case.
   - **Re-review should check:**
     - On `#/solo` (the real app, not the harness), with zero keydowns, that End turn returns to `s0` and that a second and third turn are playable by mouse and by touch.
     - That passing over empty chairs is right for a table where the other seat is merely away (M8-P5's presence), not empty.
     - The `next-turn` data-testid is gone from `src/` and `tests/` on the branch. The primary button's "Next turn ▸" is its replacement route. Check that every spec that used `next-turn` on `m8` now goes through that route. The task rule is "never delete a behaviour test without replacing it".

Later branch commits also contain non-finding fixes: closed sub-steps never catch a press, the Menu stays mounted during a drag out, the table's fit stays clear of the plate row on an iPad, and the coach mark waits while the shell's notice shows.

## What a retry should do first

1. In `spellplane-wt/m7-p2`, merge the current `m8` again; it has moved since `5079589` only if other packages have been integrated. Take `m8`'s side in any contract or frozen file. Then run `pnpm install --frozen-lockfile` and `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`.
2. Run a second review limited to the two findings above and their "Re-review should check" points (`git show c2cbff7`, then `e18c7b7`). The HUD, the shell slots and the sweep are complete enough that the retry should not rebuild them.
3. Run the package's browser specs one file at a time per browser, with WebKit on the remote server:
   - `tests/e2e/hud/` (seams first, then newcomer, hud, sizes, view, opening, sweep and shots), `tests/e2e/touch/hud.spec.ts` and the axe spec.
   - Then the folders in both browsers and `pnpm e2e:gate -- M0`.

   None of these ran at parking. The branch touches gates M1 to M5 and many re-routed specs, so the integrator's batch run (the full `pnpm e2e` and gates M0 to M5) must follow the merge.
4. M7-P5 is already on `m8` and shares the read-only scene, the pile buttons and the coach marks with this HUD. After the merge, run M7-P5's no-keys, read-only and strip specs as well.
5. If the review converges, merge it and run `push-preview.sh`. While M7-P2 is parked, `m8` runs as PLAN's parking line says: the old HUD ignores the shell slots, the frame keeps its fallback bar (Leave, the cue button, the status), and M8-P8 adds `Bring back` to it.
6. If time is short, keep the `readOnly` gating, the empty-chair primary button and the `HudShellProps` slots with `seams.spec.ts`. The screenshots in four looks and the sweep of the rarer panels can wait.
