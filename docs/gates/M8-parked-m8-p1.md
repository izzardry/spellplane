# M8-P1 Ztyle kit: parked

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". The review found three blocking issues (listed below). The implementer's fix commit `c10c49a` answers all three, but no second review ran, so nothing was merged.
- **Branch:** `m8-p1` (worktree `spellplane-wt/m8-p1`), head `c10c49a fix(m8-p1): review round 1 — band names, 16:9 still, seed seams, button scan, audit gaps`. The branch is local only (not on `origin`). `m8` (`5240e98`) is an ancestor of it, so it merges as a fast-forward with no conflicts. The working tree is clean. `git diff m8...m8-p1 --stat`: 58 files, +4387 / -938. There are 17 `[M8-P1]` lines in its `docs/DECISIONS.md`.
- **Checked by the integrator at parking (20 Nov 2026, about 14:50, in the worktree):** `pnpm check` (run through `oomph run --reserve 2G`) is **green**: tsc, svelte-check (0 errors, 1 warning: an unused selector `.deck-split > .tiles` in `KitPage.svelte`), eslint and vitest (254 files and 3739 tests passed, 21 todo). I did not run any e2e (`tests/e2e/design/kit.spec.ts`, gate M0) at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P1 Ztyle kit | Plain's look and the whole kit from `mock.html`; fonts; the design audit; the look picker | no | `src/ui/design/**`, `src/ui/settings/**` |

The design is `docs/design/m8/visual.md` and `mock.html`. The component shapes are in `contracts.md` Part B. The acceptance list (docs/PLAN.md, "M8-P1 Ztyle kit") asks for these pieces:

- `tests/unit/design/tokens.test.ts`: tokens, control heights and contrast.
- `tests/e2e/design/kit.spec.ts` on `?harness=kit` in four looks. It covers fonts offline, the pressed state, `Segmented` arrow keys, focus rings, 44 px coarse hit areas, the undo toast, `packArt`, the booster SVG, the 63:88 card faces and the seal band.
- `tests/e2e/helpers/design-audit.ts` (`designAudit(page)`).
- `tests/unit/design/no-adhoc.test.ts`: no blur or backdrop-filter, and no raw `<button>` against a legacy allow-list.
- The look picker with Plain, Kitchen Table, Graphite and Codex, plus screenshots `artifacts/shots/M8/kit-<look>.png`.

Every other package builds its screens from this kit. While M8-P1 is parked, the screens wear M8-C's plain seed stubs (PLAN, "If a package is parked").

## What the branch contains

- **Plain's look and the base recipes:** `src/ui/design/base.css` (about +1950 lines), the `tokens.ts` values, `grain.png` and `fonts.ts`.
- **All Part B components restyled:** they live under `src/ui/design/*.svelte`. Helpers were added: `strength.ts`, `thumb.ts`, `toasts.ts`, `segmented.ts`, `curve.ts`, `icons.ts`, `css.ts` and `kit.ts`.
- **The kit page:** `KitPage.svelte` and `harness.ts`, laid out in board-0 order. The other looks appear as samples.
- **Tests:**
  - `tests/e2e/design/kit.spec.ts` (about 535 lines).
  - `tests/e2e/helpers/design-audit.ts`.
  - Unit tests: `tests/unit/design/{no-adhoc,parts,render,toasts,tokens}.test.ts`.
- **Look picker:** `src/ui/settings/**` is unchanged on the branch. The four-look picker was already landed by M8-C (`5240e98`). The cut line drops "the tuning of the three other looks" first.

## Open review findings (round 1) and their state on `c10c49a`

All three were blocking. "Fixed" below means fixed on the branch but **not re-reviewed**.

1. **`src/ui/design/StrengthPips.svelte:9`: wrong band names.**
   - **Finding:** the component used `BANDS = ['Casual', 'Light', 'Solid', 'Strong', 'Fierce']`. The design names the bands Rough, Casual, Solid, Tuned and Fierce (decks.md D19 and section 5; visual.md 2.7). Also, `label` had become the visible text instead of the accessible name.
   - **On the branch:** `src/ui/design/strength.ts` has `STRENGTH_BANDS = ['Rough', 'Casual', 'Solid', 'Tuned', 'Fierce']`. `label` is the aria-label again, and `text={false}` draws the bars only. `tests/unit/design/render.test.ts` asserts all five names and renders `15 Rough` and `75 Tuned`.
2. **`src/ui/design/TableThumb.svelte:31`: the thumbnail height followed the thumb's aspect.**
   - **Finding:** `GameThumb` from M8-P2's `thumbOf` is a bounding box, not 16:9. A one-card thumb rendered at 128 x 128, and a 1v1 thumb at 128 x 430. visual.md 2.8 requires 128 x 72 in a row and 96 x 54 in the continue strip.
   - **On the branch:** `height = Math.round(width * 9 / 16)`. The frame is centred in a 16:9 mat box at least a table wide, with `preserveAspectRatio="xMidYMid meet"` (`thumb.ts`). `render.test.ts` renders the thumbs `{80 x 80}`, `{143 x 480}` and `{3000 x 400}` and checks that each comes out at 128 x 72 (96 x 54 in the strip).
3. **`tests/unit/design/no-adhoc.test.ts:71`: the test "the allow-list only shrinks" turns `m8` red when other packages sweep their files.**
   - **Finding:** sweeps on m7-p2 (11 files), m7-p5 (3) and m8-p4 (2) would each break `pnpm check` through a file only M8-P1 owns.
   - **On the branch:** that test is gone. The remaining tests are the scanner self-test, "every `<button>` in a new file carries a kit class" and "the kit itself has no raw button". LEGACY is now a plain allow-list.

## What a retry should do first

1. Merge the current `m8` into `m8-p1`, taking `m8`'s side on contract files. Since parking, packages from the same batch (m8-p4, m7-p2, m7-p5) may have landed and swept legacy files.
2. Re-review `c10c49a` against the three findings above. That is the round the pipeline did not run. Also check that the round-1 extras keep the seed's seams intact:
   - `<CODE> booster` labels
   - `BoosterPack` width 80
   - the fan's `data-count`
   - `PileStack` count 0
   - the toast `data-testid`
   - controlled `Segmented`
   - `CoachMark` without clock comparisons
   
   Other packages' specs read these.
3. Run `pnpm check`, then `pnpm e2e -- tests/e2e/design/kit.spec.ts`: Chromium first, then `--project=webkit` on its own (one file at a time, per the memory rules). Then run `pnpm e2e:gate -- M0`. None of these e2e runs happened at parking.
4. Fix the svelte-check warning (the unused `.deck-split > .tiles` selector in `KitPage.svelte`).
5. If it is green, merge by fast-forward and run `push-preview.sh`. After that, M8-P8 can check that the other packages' screens look right in the real kit, since they were built against the seed stubs.
