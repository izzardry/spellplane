# M8-P6 Computer opponent: parked

- **Status:** parked, not merged into `m8`. The pipeline's reason: "did not converge after 1 review rounds". The review left two blocking findings (below). The implementer's fix commit `b401b7a` answers both, but no second review ran, so nothing was merged.
- **Branch:** `m8-p6` (worktree `spellplane-wt/m8-p6`), head `b401b7a fix(m8-p6): Sparring skips the draw of its first turn after winning the roll; leak check that can fail; resume after a cut-off setup; whole-game delete; no second Attack after a counted combat; bot internals off the handle`. The branch exists only locally; it is not on `origin`. The working tree is clean. `m8` has moved on by docs-only park commits since the branch last merged it (`159c4fb`), and `git merge-tree` shows that `m8` merges into it without conflict. `git diff m8...m8-p6 --stat`: 40 files, +4957 / -47. Its `docs/DECISIONS.md` adds 21 `[M8-P6]` lines.
- **Checked by the integrator at parking (20 Nov 2026, about 15:40, in the worktree):** `npx vitest run tests/unit/bot tests/sim/bot tests/unit/data/starter.test.ts` (through `oomph run --reserve 2G`) passed: 12 files and 64 tests, including the new `tests/sim/bot/first-turn.test.ts` and the rewritten `tests/sim/bot/leak.test.ts`. I did not run the full `pnpm check` or any e2e (`tests/e2e/computer/computer.spec.ts`, `tests/e2e/computer/route.spec.ts`, gate M0) at parking.

## What the package was supposed to do

docs/PLAN.md, Milestone 8 package table:

> | M8-P6 Computer opponent | Sparring: bot, in-page network, computer session and route, starter decks | no | `src/bot/**`, `src/net/local.ts`, `src/store/computer.ts`, `src/data/starter.ts`, `src/session/computer.ts`, `src/ui/computer/**` |

The design is `docs/design/m8/computer.md` together with `contracts.md` Part G "Computer opponent". Per contracts.md, the package also owns these files:

- the `bot` debug registrar `src/debug/bot.ts`
- the leak scenario in `tests/sim/bot/leak.test.ts`
- the `?harness=computer` page
- the `bot` runner and `LocalNetwork` lifecycle counters

The acceptance list (docs/PLAN.md, "M8-P6 Computer opponent") asks for these pieces:

- **Unit tests (`tests/unit/bot/**`):**
  - card reading over fixture cards
  - mana payment
  - `decide` is pure and seeded
  - attack and block choices on hand-made boards
  - `combatResult`
  - the starter generator builds 17 lands and 23 green creatures by the 3 / 7 / 6 / 4 / 2 / 1 recipe, and the same seed gives the same deck
- **Sim tests (`tests/sim/bot/**`, fake timers):**
  - a whole game against a scripted human over `LocalNetwork` ends with the bot's own `concede`, and both sessions have equal state hashes
  - the bot never touches a card it does not own (a property over 50 seeded games)
  - creating and disposing 50 games leaves `live()` at zero
  - resuming from the saved record continues with the same next step
- **Leak test (`tests/sim/bot/leak.test.ts`):**
  - neither session's observed data holds the other's hidden cards
  - `BotView` never holds the human's hidden cards or the bot's library order
- **E2E (`tests/e2e/computer/computer.spec.ts` on `?harness=computer`):**
  - 7 cards in hand
  - Sparring plays a land on its turn
  - marking an attacker offers the `ATTACK` cue
  - `DAMAGE` follows, and life totals change
  - the coach mark shows once
  - there is no invite entry
  - leaving and mounting again restores the state hash, and Sparring goes on
  - `Sparring concedes` sets `TableState.result`

Without this package, PLAN says `SOLO` offers `ALONE` only, `SIMPLE DECK` stays disabled, and M8-P8's first-run journey arrives at a table alone.

## What the branch contains

- **The bot (pure):**
  - `src/bot/{types,cards,mana,combat,cues,place,plan,view}.ts`
  - `src/bot/runner.ts`, with the manual clock in `src/bot/clock.ts`
- **In-page network:** `src/net/local.ts` (`LocalNetwork`, `timeoutScheduler`).
- **Computer session and record:**
  - `src/session/computer.ts`: `createComputerGame`, `resumeComputerGame`, `deleteComputerGame`, and `runnerOf` / `botSessionOf` over a module-private WeakMap
  - `src/store/computer.ts`
- **Starter decks:**
  - `src/data/starter.ts` (`buildStarterDeck`, `buildStarterFromPool`)
  - the fixture pool `tests/fixtures/starter/starter-pool.m19.json`
- **Route and harness:**
  - the route `src/ui/computer/ComputerRoute.svelte`
  - the harness and its helpers: `src/ui/computer/{HarnessPage.svelte,harness.ts,page.ts,shell.ts,debug.ts}`
  - the registrar `src/debug/bot.ts`, which delegates to `src/ui/computer/debug.ts`
- **Tests:**
  - unit tests: `tests/unit/bot/{cards,combat,debug,local,plan,route-shell}.test.ts` and `tests/unit/data/starter.test.ts`
  - sim tests: `tests/sim/bot/{computer,first-turn,game,leak,open}.test.ts`, with `harness.ts`
  - e2e: `tests/e2e/computer/{computer,route}.spec.ts`
- **Files outside the listed paths:** the new file `src/debug/fixture-starter.ts` (22 lines, the fixture starter pool for debug and test builds). It is outside the package table's globs, though `src/debug/` neighbours the registrar the package owns. The integrator should accept it or move it under `src/ui/computer/`. No contract file outside `src/bot/` is edited. `src/bot/types.ts` is the package's own new file, not an M8-C contract.

## Open review findings (blocking, from the one review round)

1. **`src/bot/plan.ts:222`: Sparring draws on its first turn when it wins the first-player roll.** The design ref is computer.md 5.2 row 3, which says "Phase is draw, no draw this turn, and not (turn 1 and it is the starting player)". C2 acceptance adds "turn 1 on the play does not draw".
   - The code checked `view.turn.number !== 1`. But `rollFirstPlayer` (`src/session/entry.ts`, frozen M8-C code) hands the turn to `s1` with a `turnPass`, which raises `turn.number` to 2. So Sparring on the play drew. Harness seed 306 shows this; after a mulligan, seed 432 does too.
   - `tests/unit/bot/plan.test.ts` passed only because it builds a view with `number: 1` by hand. That state never happens when Sparring starts.
   - The reviewer's fix was to derive "first turn of the game" from the table: no `turnPass` since the newest `firstPlayer` round other than the roll's own hand-over. The scripted human's `st.turn.number > 1` shortcut in `tests/sim/bot/harness.ts` needed the same fix, and a sim test with a seed where Sparring wins the roll should prove it.
   - **The fix in `b401b7a`:**
     - It adds `firstTurnOfGame(state, actions)` in `src/bot/view.ts` and the `BotView.thisTurn.firstOfGame` field. `plan.ts` and the scripted human use them.
     - It adds `tests/sim/bot/first-turn.test.ts`. That test seeds the roll's salts and covers both outcomes: Sparring on the play draws `[s1 0, s0 1, s1 1]`, and the human on the play draws `[s0 0, s1 1, s0 1]`.
     - `firstTurnOfGame` finds the starter by taking the newest roll's `result` over the occupied seats in seat order, the same ordering as `occupiedSeats` in `entry.ts`. It does this when the view is built, not when the roll is made.
     - **Not reviewed:** `firstTurnOfGame` could pick the wrong starter if a seat's occupancy changed between the roll and the view.
2. **`tests/sim/bot/leak.test.ts:73`: half of the BotView leak check could not fail.** The design ref is PLAN M8-P6 Leak and computer.md 12.1 scenario 4.
   - The check searched the view for the pair (instance id, Scryfall id) and for salts. A `BotCard` carries neither: it holds an id, a name, a kind, a cost and stats. So a view with the human's whole hand injected passed.
   - The reviewer's fix was to check for leaks in the form a view would carry them: no instance id of the human's hand or library, and no named entry for a human card whose identity is hidden. A negative case should show that the check fails on a leaking view.
   - **The fix in `b401b7a`:**
     - It adds `viewLeaks(view, human)` to the leak test, which checks for the ids of the human's hand and library and for named entries of hidden human cards. It still checks for salts and Scryfall ids.
     - A new negative test injects the human's 7 hand cards as `BotCard`s and expects 14 hits: 7 ids and 7 named entries. It then expects one hit for a renamed hidden card on Sparring's side.

`b401b7a` also carries other fixes, described in the last five `[M8-P6]` lines of its DECISIONS:

- resume after a first setup that was cut off
- `deleteComputerGame`, which deletes the whole game
- no second `Attack` cue after a counted combat
- the bot's internals moved off the handle and into a WeakMap

## What a retry should do first

1. Merge the current `m8` into `m8-p6`. Today this merges cleanly; afterwards, the branch should hold `m8`'s remote-WebKit `pw-guard`. Then run `pnpm install --frozen-lockfile` if the lockfile moved.
2. **Run a second review on `b401b7a` alone.** Check that the two findings above are closed:
   - **Finding 1:** the `firstTurnOfGame` derivation, including a table where seat occupancy changed after the roll and a resumed game whose log starts after the roll.
   - **Finding 2:** that `viewLeaks` would also catch a leak through `view.theirs` with the real id of a hidden card. The negative case covers `hand` and a renamed entry.
3. Run `oomph run --reserve 2G --for 'spellplane pnpm check' --wait 9m -- pnpm check`. Then run `pnpm e2e -- --project=webkit tests/e2e/computer/computer.spec.ts` (one file at a time in WebKit), then `tests/e2e/computer/route.spec.ts`, then both files in Chromium. Finish with `pnpm e2e:gate -- M0`. None of these e2e runs happened at parking.
4. Settle `src/debug/fixture-starter.ts`: keep it as an integrator-accepted file, or move it under `src/ui/computer/`.
5. If the review is clean, merge into `m8` in the glue batch (M8-P7, M8-P6, M8-P2). Then M8-P8 can turn on `SOLO · SPARRING` and `SIMPLE DECK`. If time is short, the cut line in PLAN drops blocking by the bot first; it still attacks.
