# M8-P3 Decks: parked

- **Status:** parked, not merged into `m8`. The package did not fail on its own code. It was blocked because its UI half could not start. M8-C's second commit, "ui contracts and frame", was still not on `m8` at 10:28 on 20 Nov 2026, and `m8` was still at `a521b08 feat(m8-c): core contracts`.
- **Branch:** `m8-p3` (worktree `spellplane-wt/m8-p3`), head `b97a88b feat(m8-p3): deck library model`. It has 3 commits on top of merge base `a521b08`, which is the current tip of `m8`, so it merges without conflicts. The working tree is clean.
- **Checked by the integrator at parking (20 Nov 2026, 10:29, in the worktree):** the package's unit tests are green. I ran `pnpm vitest run tests/unit/decks tests/unit/packs/solo-sealed.test.ts tests/unit/data/sets.test.ts tests/unit/store`: 24 files and 222 tests passed. I did not run the full `pnpm check` or any e2e at parking. The package has no browser spec yet.
- **Open review findings:** none. The package never reached review.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P3 Decks | Deck mode: model, seal, strength, boosters, library, deck page | no | `src/ui/decks/**`, `src/data/deck/**`, `src/store/decks.ts`, `src/draft/solo-sealed.ts`, `src/data/{sets,mtgjson,cards,source,scryfall}.ts` |

The design is `docs/design/m8/decks.md`. The look is `visual.md` 2.8 "Deck parts", boards 2 and 3. The seams in the "Fixed paths of the seams" table are `src/ui/decks/DecksRoute.svelte` (all `#/decks…` routes), `DeckPickerSheet.svelte` (`allow`, `onpick`) and `BoosterSetupSheet.svelte` (`value`, `mode: 'deck' | 'draft'`). `App.svelte`, Home and the waiting room consume them.

The acceptance list in docs/PLAN.md, "M8-P3 Decks", has three parts:
- **Unit and leak tests** (`tests/unit/decks/**`, `queue-leak.test.ts`). These cover seal and `notInPool`, `convertToCustom`, `migrateDeckRecord`, analysis and strength pins, `isSimpleDeck`, `autobuild`, `openBoosters`, `queueEligibility`, the chip queries, and the `queueDeckInfo` field set.
- **Browser specs on `?harness=decks`**:
  - `tests/e2e/decks/library.spec.ts`: empty state, seeded tiles, select, edit, delete and `UNDO`, and the picker's `allow` badge with the face kept at opacity 1.
  - `custom.spec.ts`: search, copies, autosave, undo and redo, curve text, `+N LANDS`, offline source, keyboard only.
  - `sealed.spec.ts`: pinned-seed `OPEN`, 40 in `MAIN`, `SUGGEST A DECK`, no search field, `notInPool` through the hook, `CONVERT TO CUSTOM DECK` with the original byte-equal.
- **Rendering checks**: a 63:88 card ratio, `designAudit` on the library, the deck page and the build stage, and a 20-times open and close of the deck page that leaves the DOM node and `img` counts where they were.

## What the branch contains (done, unit-tested, committed)

`git diff m8...m8-p3 --stat` shows 42 files changed, with 3418 insertions and 47 deletions. There are nine `[M8-P3]` lines in `docs/DECISIONS.md`.

- **Deck model** (`src/data/deck/*`):
  - `seal.ts`: the sealed check and `convertToCustom`.
  - `edit.ts`: edits, with `notInPool` and `sealed` answers.
  - `strength.ts` and `summary.ts`: analysis, the strength score and band, and the land suggestion.
  - `lands.ts`: `+N LANDS`.
  - `autobuild.ts`: at most two colours, deterministic.
  - `query.ts`: compiles the chips to Scryfall terms, and evaluates them locally for the fixture source and the pool page.
  - `queue.ts`: `queueEligibility` and `queueDeckInfo`.
  - `simple.ts`: `isSimpleDeck`.
- **Boosters:**
  - `src/draft/solo-sealed.ts`: `openBoosters`, seeded. Six M19 packs give 90 refs.
  - `src/data/sets.ts`: booster sets.
  - Fixture edits: `tests/fixtures/scryfall/m19.json` (hand-set `edhrec_rank` on seven cards, see DECISIONS) and `src/debug/fixture-*`.
- **Store:** `src/store/decks.ts`. `migrateDeckRecord` runs on list, get and `importLibrary`. The import validates the M8 deck fields and never reads `summary` from the file. The fixture is `tests/fixtures/decks/library-v1.json`.
- **UI state models, with no Svelte yet** (`src/ui/decks/state/*`):
  - `DeckLibrary` (`library.ts`).
  - `DeckEditor` (`editor.ts`): undo 50, one step per gesture, autosave after 400 ms on injected timers.
  - `openBoosterDeck` and `finishOpening` (`open.ts`): save the sealed deck before any card is shown.
  - `quickBoosterDeck` (`quick.ts`).
- **Debug hook part:** `src/debug/decks.ts` (`registerDecksDebug`, with `decks.edit(...)` and others). It is not registered, because `src/debug/index.ts` is frozen and belongs to M8-C.
- **Leak:** `tests/unit/decks/queue-leak.test.ts` asserts that `queueDeckInfo` holds exactly kind, size, cards, score, band and version.

## What fails and why

The DecksRoute, DeckPickerSheet and BoosterSetupSheet screens depend on things that M8-C's "ui contracts and frame" commit was meant to land. The package does not own any of them:

1. **The design kit.** Committed `m8` holds only `src/ui/design/tokens.ts`. The kit components (`Button`, `Chip`, `Dialog`, `Panel`, `Tabs`, `Toast`, `MenuPopover`, `Icon`, `IconButton`) and `base.css` are not committed. They currently sit as untracked files in the main checkout. The run's rule is "build only from the kit", so no screen could be built.
2. **`src/ui/routes.ts`** has no `#/decks…` routes.
3. **The stubs** `src/ui/decks/DecksRoute.svelte`, `DeckPickerSheet.svelte` and `BoosterSetupSheet.svelte` do not exist.
4. **The `decks` harness entry** is missing from `src/main.ts`, so nothing mounts at `?harness=decks`. Every browser spec in the acceptance list needs it.
5. **The `registerDecksDebug` call** is missing from `src/debug/index.ts`. The browser specs drive `decks.edit(...)` and the store through the hook.

`main.ts` and `debug/index.ts` are frozen M8-C files. The package was right to leave them alone and stop at the model layer.

## What a retry should do first

1. Wait until M8-C's "ui contracts and frame" commit is on `m8`. Check that `git ls-files src/ui/design` lists the components and `base.css`, that `src/ui/decks/*.svelte` stubs exist, that `grep decks src/main.ts src/debug/index.ts` shows the harness entry and the `registerDecksDebug` call, and that `routes.ts` has the deck routes.
2. In `spellplane-wt/m8-p3`, merge `m8` into `m8-p3`. Today this is a fast merge with no conflicts. On a conflict in `src/debug/index.ts` or `src/main.ts`, take m8's side. Then run `pnpm install --frozen-lockfile` and `pnpm check`.
3. Build the screens on the existing models instead of rewriting them, in the brief's order:
   - the library route and the `DeckPickerSheet` with `allow`;
   - the deck page on `DeckEditor` (custom: search with the chips; sealed: pool page, `SUGGEST A DECK`, `CONVERT TO CUSTOM DECK`);
   - `BoosterSetupSheet` in both modes;
   - the opening flow on `openBoosterDeck` and `finishOpening`;
   - the build-stage sweep;
   - last, the cut-line items: the pack reveal, the type chips and the `SIMPLE DECK` chooser entry.
4. Write `tests/e2e/decks/{library,custom,sealed}.spec.ts` on `?harness=decks`, together with the ratio, `designAudit` and open/close-20 checks. Before handing back, run them in both browsers along with `pnpm e2e:gate -- M0`.
5. The model layer is already green, so most of a retry's time can go to the screens.
