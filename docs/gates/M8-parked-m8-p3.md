# M8-P3 Decks: parked (second launch)

> **Update (20 Nov 2026, evening): merged.** The M8 gate fix round merged this branch into `m8` without the second review (decision `[M8-G]` in docs/DECISIONS.md) and fixed the integration failures it found there. The text below is the parking record.

This note replaces the first launch's note. That launch parked M8-P3 because the UI contracts were missing from `m8`. They are on `m8` now, and the package has built its screens.

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". Review round 1 found blocking issues (listed below). The implementer's fix commit `f6521ac` answers all of them, but no second review ran, so nothing was merged.
- **Branch:** `m8-p3` (worktree `spellplane-wt/m8-p3`). Its head is `c6c82c4 test(m8-p3): pause the fake clock in the search debounce spec`. The branch is local only, not on `origin`. The working tree is clean.
- **Merge state:** `git diff m8...m8-p3 --stat` shows 70 files, +7243 / -366. There are 26 `[M8-P3]` lines in its `docs/DECISIONS.md`. Since the branch last merged `m8`, `m8` has moved on to `b10efca` (M8-P4, M8-P5, M7-P5). A trial `git merge-tree m8 m8-p3` reports no conflicts.
- **Checked by the integrator at parking (20 Nov 2026, 18:07, in the worktree):**
  - I ran `pnpm vitest run tests/unit/decks tests/unit/packs/solo-sealed.test.ts tests/unit/data/sets.test.ts tests/unit/store`: 25 files and 234 tests passed.
  - I did not run the full `pnpm check`, the e2e specs under `tests/e2e/decks/`, or gate M0 at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P3 Decks | Deck mode: model, seal, strength, boosters, library, deck page | no | `src/ui/decks/**`, `src/data/deck/**`, `src/store/decks.ts`, `src/draft/solo-sealed.ts`, `src/data/{sets,mtgjson,cards,source,scryfall}.ts` |

The design is `docs/design/m8/decks.md`. The look is `visual.md` 2.8 "Deck parts", boards 2 and 3. The package owns three seams: `src/ui/decks/DecksRoute.svelte` (all `#/decks…` routes), `DeckPickerSheet.svelte` (`allow`, `onpick`) and `BoosterSetupSheet.svelte` (`value`, `mode: 'deck' | 'draft'`). `App.svelte`, Home and the waiting room consume them.

The acceptance list in docs/PLAN.md, "M8-P3 Decks", has three parts:
- **Unit and leak tests** (`tests/unit/decks/**`, `queue-leak.test.ts`). They cover:
  - the seal and `notInPool`, and `convertToCustom`;
  - `migrateDeckRecord`;
  - the analysis and strength pins;
  - `isSimpleDeck`, `autobuild` and `openBoosters`;
  - `queueEligibility`, the chip queries and the `queueDeckInfo` field set.
- **Browser specs on `?harness=decks`:**
  - `library.spec.ts`: the empty state, seeded tiles, select, edit, delete and `UNDO`, and the picker's `allow` badge with the face kept at opacity 1.
  - `custom.spec.ts`: search, copies, autosave, undo and redo, the curve text, `+N LANDS`, the offline source, and keyboard-only use.
  - `sealed.spec.ts`: a pinned-seed `OPEN`, 40 cards in `MAIN`, `SUGGEST A DECK`, no search field, `notInPool` through the hook, and `CONVERT TO CUSTOM DECK` with the original byte-equal.
- **Rendering checks:** a 63:88 card ratio, `designAudit` on the library, the deck page and the build stage, and a 20-times open and close of the deck page that leaves the DOM node and `img` counts where they were.

## What the branch contains

- **Model:** everything listed in the first note.
  - `src/data/deck/*`: the seal, edits, strength, lands, autobuild, query, queue and simple deck.
  - `src/draft/solo-sealed.ts` and `src/data/sets.ts`.
  - `src/store/decks.ts`: migration, the import checks and `settleEdited`.
  - `src/ui/decks/state/*`: the library, the editor, the opening, quick decks and rows.
- **Screens:**
  - `Library.svelte`, `DeckTile.svelte` and `NewDeck.svelte`.
  - `DeckPage.svelte`: custom and sealed decks, and ALL CARDS · IN DECK.
  - `Opening.svelte`, `DeckPickerSheet.svelte`, `BoosterSetupSheet.svelte` and `DecksRoute.svelte`.
  - `CardImage.svelte`, with a fallback to the neutral back.
  - The harness: `HarnessRoot.svelte`, `harness.ts`, `env.ts` and `debug.ts`.
  - The build-stage sweep: `Builder.svelte`, `list/Library.svelte`, `ListView.svelte` and `DeckImport.svelte`.
- **Tests:**
  - `tests/e2e/decks/{library,custom,sealed,build-stage}.spec.ts`, with `audit.ts` and `helpers.ts`.
  - The unit tests under `tests/unit/decks/`, with the fixture `tests/fixtures/decks/library-v1.json`.
- **Contract edit:** one additive line in `src/store/types.ts`, tagged `[M8-P3]`. It adds `LibraryImport.notes?`.
- **Files outside the package's listed globs:**
  - `src/debug/decks.ts`, `src/debug/fixture-cards.ts` and `src/debug/fixture-sets.ts`.
  - `src/ui/DeckImport.svelte`, `src/ui/builder/Builder.svelte`, `src/ui/builder/list/Library.svelte` and `src/ui/builder/list/ListView.svelte`.

  The brief's build-stage sweep covers the builder files. The merge should still confirm that no other package owns them.

## Open review findings (round 1) and their state on `c6c82c4`

All four were blocking. "Fixed" below means fixed on the branch but **not re-reviewed**.

1. **`src/ui/decks/DeckPage.svelte:181`: a foil pool card cannot be put into a sealed deck.**
   - **Finding:** `addSid` builds the ref `{ sid }` without `foil`. `add` in `src/data/deck/edit.ts` matched the pool by `refKey`, so a foil-only pool card answered `notInPool`. An example is Isareth the Awakener with seed `'01'x32`. A suggested deck's foil card could never be put back once it was removed (decks.md section 3, D5).
   - **On the branch:** `add` on a sealed deck takes the exact printing first, then any remaining pool copy of the same sid (`edit.ts`, about lines 66-90). `tests/unit/decks/seal.test.ts` gained tests for this.
   - **Re-review should check:** the case with one plain and one foil copy, and that the page's + button and a click on a pool card both reach this path.
2. **`src/ui/decks/state/editor.ts:113`: an edited pre-M8 record keeps the stale M2 `pool`.**
   - **Finding:** after an edit, the record's own export failed `importLibrary` with "the pool does not hold the same cards", so backup restore lost the deck (decks.md section 7, D23, DK-1).
   - **On the branch:** `settleEdited` in `src/store/decks.ts` (about lines 75-85) deletes `pool` and `origin` on a custom deck and `pool` on a sealed deck. `editor.ts` saves through it. `deckRecord` keeps an M2 pool only while it matches the lists. `tests/unit/decks/migrate.test.ts` gained round-trip tests.
   - **Re-review should check:** that every save path goes through `settleEdited`. The paths are `DeckEditor.flush`, the debug hook's `edit` and `finishOpening`.
3. **`src/store/decks.ts:471`: the sealed check on import was never applied.**
   - **Finding:** `checkSealedImport` had no caller, so a tampered file stayed `kind: 'sealed'` (decks.md section 7, DK-1, DESIGN "Deck building mode").
   - **On the branch:** `importLibrary(text, { isFreeBasic, now })` runs `checkSealedImport` on every record and reports `UNSEALED_NOTE` in `notes`. The check is never skipped. Without `isFreeBasic`, every main card outside the pool counts as foreign. The exception is basics flagged `basic` in a matching M2 pool. The builder's import (`builder/list/Library.svelte:145`) and the harness pass `isFreeBasic`. The test now asserts on the import result.
   - **Still open, for the integrator:** `src/store/backup.ts:316` and `:326` call `importLibrary` without `isFreeBasic`. The package does not own that file. The import stays safe, because it is strict, but a restored booster deck with added basics comes back as a custom deck. Wire `isFreeBasic` there, or accept the strict behaviour and record the decision.
4. **`src/ui/decks/parts/CardImage.svelte:39`: no neutral back when an image fails to load.**
   - **Finding:** DESIGN "Deck building mode", Failure behaviour, and decks.md section 8 ask that a cover that cannot be loaded shows the app's neutral card back. The finding's full text was cut off in the integrator's brief.
   - **On the branch:** `onerror` calls `forgetFaceUrl(src)` and sets `src = null`, which renders `<span class="back">`.
   - **Re-review should check:** that no e2e asserts on this yet. A spec with a failing face URL would close the finding.

The fix commit also contains these review minors:
- undone renames stay undone;
- search ignores stale answers, and the field follows online and offline events;
- `+N LANDS` shows only when basics can be added, with the no-coloured-costs line;
- duplicated decks get a summary;
- the opening's last pack counts at `BUILD DECK`;
- the deck page suggests from the record.

## What a retry should do first

1. In `spellplane-wt/m8-p3`, merge the current `m8` into `m8-p3`. The trial merge has no conflicts. On a conflict in a contract or frozen file, take `m8`'s side. Then run `pnpm install --frozen-lockfile` and `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`.
2. Run the package's browser specs one file at a time per browser: `pnpm e2e -- tests/e2e/decks/<file>`, with WebKit on the remote server. Then run the folder in both browsers and `pnpm e2e:gate -- M0`. None of these ran at parking.
3. Run a second review limited to the four findings above and the fix commit's minors (`git show f6521ac`). The model and screens are complete enough that the retry should not rebuild them.
4. If the review converges, merge it. The integrator then wires `isFreeBasic` into `src/store/backup.ts` (finding 3), or records the strict restore as a decision. The integrator also confirms that the builder files outside the package's globs were not claimed by another package.
5. If time is short, the cut line (PLAN, "The cut line") drops these first: the pack reveal, the type chips and the `SIMPLE DECK` chooser entry. The seal and convert stay.
