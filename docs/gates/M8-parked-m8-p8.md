# M8-P8 Journey integration: parked

- **Status:** parked, not started, not merged into `m8`. The pipeline's reason: "dependency not merged: M7-P2, M8-P1, M8-P2, M8-P3, M8-P4, M8-P5, M8-P6, M8-P7".
- **That list is partly stale.** Checked on `m8` at `077e843` (20 Nov 2026, 18:23) with `git merge-base --is-ancestor`:
  - **Merged into `m8`:** M8-P4 (`64d5aa9`), M8-P5 (`63ede01`) and M7-P5 (`9ff5e47`).
  - **Parked, not merged:** M7-P1, M7-P2, M8-P1, M8-P2, M8-P3, M8-P6 and M8-P7. Each has its own note in `docs/gates/M8-parked-*.md`.
  - Six of M8-P8's eight dependencies are still missing, so the package correctly did not start: there is nothing real to mount in the frame for Home, Decks, the kit, the HUD, Sparring or matchmaking.
- **Branch and worktree:** none. There is no `m8-p8` branch (local or on `origin`) and no worktree at `spellplane-wt/m8-p8`. No code was written for this package, so there was nothing to test.
- **Open review findings:** none. No review ran.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P8 Journey integration | After the others: the table frame with the real parts, the cross-package journey specs, the page-wide soak, seam fixes | yes | `src/ui/table/**`, `src/ui/App.svelte`, `src/main.ts`, `src/ui/flow/Stage.svelte`, `tests/e2e/journey/**` |

And in "How the run works", step 3: "M8-P8 Journey integration (depends on M7-P2 and M8-P1 to M8-P7; deep): mounts the real parts in the table frame, writes and passes the cross-package journey specs, fixes seams." The design is `docs/design/m8/journey.md` in full plus every seam in PLAN's "Fixed paths of the seams". It may fix seams in any file and may change a contract (contracts.md, rule 3), because every package is merged by the time it runs. It also owns the frozen M8-C files once the parallel phase ends (`src/core/reducer/result.ts`, `table.ts`, `src/session/entry.ts`, `result.ts`, `src/util/lifecycle.ts`, `src/debug/index.ts`, the legacy start page).

Its acceptance list (docs/PLAN.md, "M8-P8 Journey integration"):

- **`tests/e2e/journey/first-run.spec.ts`:** a fresh profile presses `PLAY` once and reaches a table against Sparring (alone when M8-P6 is parked) with 7 cards, the log closed, no dialog and no key pressed. Decks lists the new deck.
- **`solo.spec.ts`:** `SOLO · SPARRING` and `SOLO · ALONE`, the cue on the HUD's primary, leave by the arrow (toast `Game saved. Continue any time.`), the strip, continue with the same state hash, browser Back, `Sparring concedes`.
- **`private.spec.ts`:** two profiles from `CREATE TABLE` through the invite, `READY`, versus, 7 cards each, `Concede`, the overlay, `HOME`.
- **`draft-night.spec.ts`:** Home's boosters, `OPEN DRAFT TABLE`, lobby settings equal to the booster setup, start leads to the draft stage.
- **`quick-match.spec.ts`:** two profiles `FIND MATCH` (one browses Decks with the queue bar), accept, no waiting room; a ranked concession shows the rating change.
- **`rejoin.spec.ts`:** leave by the arrow, B's toast and A's plate away, History, reopen live with B's hash, `BRING ANN BACK` with QR and link, a fresh profile recovers.
- **`soak.spec.ts`:** ten enter-and-leave cycles on practice, computer and local networked tables; on Home every `live()` count is 0 and `residue()` is all zeros.
- **`audit.spec.ts`:** `designAudit` and axe on Home, Decks, the deck page, History, the waiting room, Gathering, the table HUD, a context menu, the pile viewer, the build stage and the recovery panel.
- **No `it.todo` left in the five leak files** of contracts.md Part A.

## State of `m8` that a retry inherits

- **`src/ui/table/`** holds M8-C's working simple frame: `TableFrame.svelte`, `menu-top.ts`, `context.ts`, `notices.ts`, `types.ts`. M8-P4, M8-P5 and M7-P5 were integrated against it.
- **`tests/e2e/journey/`** does not exist yet.
- **Leak files still holding `it.todo` on `m8`**, all from parked packages:
  - `tests/unit/decks/queue-leak.test.ts` (1, M8-P3)
  - `tests/sim/bot/leak.test.ts` (2, M8-P6)
  - `tests/sim/lobby/leak.test.ts` (1, M8-P7)

  The two merged packages' files (`tests/sim/flow/leak-lobby.test.ts`, `tests/sim/resume/leak-rejoin.test.ts`) hold none. `tests/unit/ui/keymap-actions.test.ts` also holds one `it.todo`; it is not one of the five leak files.
- **PLAN's fallbacks for parked packages** ("If a package is parked") describe what the journey looks like without each one. With six dependencies missing, almost every journey spec above would test fallbacks rather than the design, which is why the package was not started.

## What a retry should do first

1. **Land the dependencies.** Each parked note (`M8-parked-m7-p1.md`, `-m7-p2.md`, `-m8-p1.md`, `-m8-p2.md`, `-m8-p3.md`, `-m8-p6.md`, `-m8-p7.md`) says its fix commit answers the round-1 findings and lacks only the second review. Run that review, merge `m8` into each branch, then integrate them serially. Suggested order, because later ones build on earlier ones:
   1. M8-P1 (the kit; it owns `tests/e2e/helpers/design-audit.ts`, which M8-P2 also creates)
   2. M7-P2 (the HUD and shell slots)
   3. M8-P2 (shell, Home, History)
   4. M8-P3 (Decks)
   5. M8-P6 (Sparring)
   6. M8-P7 (matchmaking)
   7. M7-P1 (worlds, tilt)

   After each push to `m8`, run `push-preview.sh`.
2. **Then start M8-P8 from `m8`** in a new worktree `spellplane-wt/m8-p8`. Per the wall-clock table, put the solo and private journeys first (`first-run`, `solo`, `private`), then `rejoin`, `quick-match`, `draft-night`, `soak` and `audit`.
3. **If some dependencies stay parked,** M8-P8 can still run against PLAN's fallbacks. Its specs must then assert the fallback route (for example, `SOLO` offers `ALONE` only without M8-P6, and `QUICK MATCH` is disabled with "Matchmaking is not in this build yet." without M8-P7) and name each fallback in the return value, so the gate report can list them.
4. **Run the checks.**
   - Run `pnpm check` through `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`.
   - Run the journey specs one file at a time, with WebKit on the remote server, and at most four pages per spec.
   - Then run `pnpm e2e:gate -- M0` and the M8 gate.
