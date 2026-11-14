# M5-P4 Accessibility: parked

- **Status:** parked, not merged into `m5`. The pipeline stopped after three review rounds without a clean review. The last review left one blocking finding (quoted below). It cites `src/ui/Hud.svelte:1439` and the rule `.stack-chip button { opacity: 0.55 }`, which is the round-2 code (`57eeb2a`). The implementer's round-3 commit (`56b5f44`) targets that finding, but no review round has checked it.
- **Branch:** `m5-p4` (worktree `spellplane-wt/m5-p4`), head `56b5f44 fix(m5-p4): stack chip contrast, no pointer hover under keyboard focus, menu anchor, arrow scope, passed-on focus order`. It has 6 commits on top of merge base `7767675`. There is no remote copy (`origin/m5-p4` does not exist). The working tree is clean.
- **Behind `m5`:** M5-P5 (Finish), M5-P3 (Offline and storage), M5-P1 (Touch) and M5-P7 (Table and voice) were merged into `m5` after the branch was cut. `git merge-tree m5 m5-p4` reports conflicts in four files:
  - `docs/DECISIONS.md`: both sides append lines at the end.
  - `src/ui/Hud.svelte`: 3 regions, against M5-P1's touch HUD and M5-P7's stack badge, talk keys and badge focus.
  - `src/ui/App.svelte`: 1 region.
  - `src/scene/table-scene.ts`: 1 region, M5-P4's focus ring and hover-under-focus against M5-P1 and M5-P7's scene changes.
  - `ContextMenu.svelte`, `HandFan.svelte` and `tests/unit/m5-contracts.test.ts` merge cleanly.
- **Checked by the integrator at parking (13 Nov 2026), at `56b5f44` in the worktree:**
  - `pnpm check` is green: tsc, svelte-check, eslint, and vitest with 2698 tests in 192 files.
  - `pnpm e2e -- tests/e2e/a11y` is green: 48 tests (axe, keyboard, table) on Chromium and WebKit. This includes round 3's new axe case, which scans the table HUD with a spell on the stack, the keyboard context menu and the library viewer.
  - The full `pnpm e2e` was not run at parking. Round 3 changes `src/ui/Hud.svelte`, `src/scene/table-scene.ts` and `tests/e2e/ui/hud.spec.ts`, so the full suite has to pass again after the merge with `m5`.

## What the package was supposed to do

docs/PLAN.md, M5 package table:

> | M5-P4 Accessibility | Keyboard focus cycling through cards in a zone, log as a live region, seat patterns beside colours, AA contrast in Paper, reduced-motion audit. | `ui/a11y/*` | M4 |

docs/PLAN.md, ownership: M5-P4 owns
- `ui/a11y/*`.
- Drawing `ViewState.focused` in the scene.
- The log's live region in `ui/chat/*`.
- Seat patterns beside colours in the HUD.
- Paper's AA contrast (`themes/paper/*` tokens).
- The reduced-motion audit.
- The `a11y` debug part and the axe dev dependency.

The M5 acceptance tests include: "axe reports no serious violations on lobby, table HUD and builder list."

DESIGN "Input and interaction design", Accessibility, requires: "Paper meets WCAG AA contrast throughout."

The M5 owner decisions (13 Nov 2026) say nothing specific to this package.

## What the branch contains

`git diff m5...m5-p4 --stat` lists 42 files, +2602/−58. There are 16 `[M5-P4]` lines in `docs/DECISIONS.md`.

- **Keyboard card focus** (`ui/a11y/focus.ts`, `ui/a11y/index.ts`, `Hud.svelte`):
  - Arrows cycle the cards of a zone and Page keys move between zones, in the order the viewer sees them. Hidden cards are never focused.
  - The keymap acts on the focused card, and the keyboard focus wins over a resting pointer.
  - The context-menu key and Shift+F10 open the focused card's menu.
  - Library cards that Search or Look shows in the pile viewer take focus.
  - An accessible mirror (`ui/a11y/FocusMirror.svelte`) names the focused card for screen readers.
- **Focus ring in the scene** (`scene/focus-ring.ts`): a dashed ring that stands off the card's projected outline, drawn apart from hover and selection. While a keyboard focus is set, the scene draws no hover outline.
- **Live region** (`ui/a11y/announcer.ts`, `ui/a11y/log.ts`, `ui/chat/ChatLines.svelte`): page-wide polite and assertive regions that carry new log lines. Prompts addressed to this player are announced assertively. A focus change is spoken after the waiting log lines (`focusAfterLog`). The log list itself is no longer `aria-live`.
- **Seat glyphs** (`ui/a11y/SeatGlyph.svelte`, `ui/a11y/seats.ts`): the seat's shape stands beside every seat-coloured name or mark in the log, the turn strip, the confirm prompt, flashes, the team hand and the draft view.
- **Paper AA** (`themes/paper/index.ts`): seat colours darkened slightly and the ghost outline's opacity raised. `tests/unit/a11y/paper.test.ts` checks the token contrasts.
- **Reduced motion** (`ui/a11y/motion.ts`): under `prefers-reduced-motion`, every CSS animation and transition is cut to one 1 ms run and the camera cuts between rigs instead of blending. `tests/e2e/a11y/table.spec.ts` records the motion to check this.
- **axe** (`@axe-core/playwright` 4.14.0, dev dependency): `tests/e2e/a11y/axe.spec.ts` scans the start page, the lobby, the table HUD (empty, with the cheat sheet, and with a stack item, the keyboard menu and the library viewer) and the builder list. Serious and critical violations fail the test.

## Open review finding (last round, against `57eeb2a`)

**Blocking.** `src/ui/Hud.svelte:1439`. Design references: DESIGN "Input and interaction design" > Accessibility, "Paper meets WCAG AA contrast throughout"; PLAN Milestone 5 acceptance tests (axe on the table HUD).

> Paper fails WCAG AA on the table HUD whenever the stack holds an item. `.stack-chip button { opacity: 0.55 }` draws the always-visible 'Counter' button, and the 'Resolve' button whenever it is not lit (during a pending confirmation round), as #111 at 55% on the #fff surface. That gives 4.17:1, below 4.5:1. Their `<kbd>` key labels also carry the HUD's `kbd { opacity: 0.7 }` (Hud.svelte:1409-1412), so the effective opacity is 0.385, about 2.51:1. Reproduction: solo table in Paper, focus a hand card, press C. The stack chip appears with 'Counter Shift+R' at 4.17:1 and its kbd at 2.51:1. `tests/e2e/a11y/axe.spec.ts` only scans the table HUD with an empty stack, so the acceptance test misses this state. The reviewer did not confirm it in a browser: the load average was about 313.
>
> Suggested fix: stop dimming stack-chip buttons with opacity. Mark the not-ready state with something that keeps contrast, such as a lighter or dashed border, or `color: var(--sp-muted)` (#5f5f5f, 6.4:1) with the kbd at full opacity: muted at 0.7 opacity is only 3.2:1. Add an axe case on the table HUD with an item on the stack, cast by keyboard as table.spec.ts castFirstByKeyboard does, ideally also with the keyboard context menu and the library pile viewer open.

### Round 3 (`56b5f44`, not reviewed)

The round-3 commit follows the suggested fix:
- It removes the `opacity: 0.55` rule. Counter and a Resolve that is not ready now keep full-contrast `#111` text, and a ready Resolve gets a heavier foreground border, a 1 px inset shadow and weight 600.
- It adds the suggested axe case. The case focuses a hand card, casts it with C, scans the HUD with the stack chip showing, then scans again with the keyboard context menu open and with the library viewer open. That case passes on Chromium and WebKit.

I checked the contrast myself with the WCAG formula:
- The stack chip's `<kbd>` labels still carry the HUD-wide `kbd { opacity: 0.7 }`. #111 at 70% on #fff is #585858, 7.11:1, so it passes AA.
- The finding's numbers check out for the old code: 55% is 4.17:1 and 38.5% is 2.52:1.

The finding therefore looks fixed, but no reviewer has confirmed it.

## What a retry should do first

1. Merge `m5` into `m5-p4` (merge, not rebase, so the reviewed commits keep their ids). Resolve the four conflicts:
   - `Hud.svelte`: keep M5-P1's touch HUD, M5-P7's stack badge, talk keys and badge focus, and M5-P4's key focus and stack chip.
   - `App.svelte`.
   - `table-scene.ts`: the focus ring alongside M5-P7's stack badge and M5-P1's touch hover.
   - `DECISIONS.md`: keep both sides' appended lines.
2. Re-check the merged HUD against the finding's rule, not just the old selector:
   - No `opacity` below 1 on text anywhere in the Paper HUD. Include M5-P7's far-zoom stack badge and M5-P1's thumb bar and radial menu, which arrived after this branch was cut.
   - The HUD-wide `kbd { opacity: 0.7 }` is about 7.1:1 on #fff, but on white it only reaches 4.5:1 while the foreground is #3b3b3b or darker. Check it on every surface that holds a kbd, including the seat-coloured and grey (#f1f1ee) surfaces.
3. Run `pnpm check`, then `pnpm e2e` in full, then the M5 gate spec. The axe spec should also scan two states added by other packages: the touch HUD under iPad emulation (M5-P1) and the far-zoom stack badge (M5-P7). These are table HUD states that the acceptance test covers.
4. Run one review round on the merged result, with the round-3 stack-chip change as its first item. Merge if it is clean.
