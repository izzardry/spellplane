# M2-P3 Open formats: parked

- **Status:** parked, not merged into `m2`. The pipeline ran out of rounds: it did not converge after 3 review rounds. The last round left one blocking finding (below). It is about where the code lives, not about how it behaves.
- **Branch:** `m2-p3` (worktree `spellplane-wt/m2-p3`), head `46fb1dc fix(m2-p3): confirmed-state seeds, Winston disclosures after the last look, face-up memory`. It branches from `d2cc789` and is 7 commits behind `m2` (M2-P1, M2-P6, the four-Playwright-runs chore). `git merge-tree m2 m2-p3` reports one conflict, in `docs/DECISIONS.md`, where both sides appended lines. No source file conflicts. The branch has no remote copy (`origin/m2-p3` does not exist).
- **State of the branch (11 Nov 2026, at parking, checked by the integrator):**
  - `pnpm check` is green in the worktree: tsc, svelte-check, eslint, 1414 vitest tests in 98 files.
  - `pnpm e2e` was not run for this note. The package adds no browser specs.
  - The diff against `m2` touches 28 files, +3498/−29.
  - It edits contract files: `src/core/types.ts` (+12) and `src/draft/types.ts` (+15). It also adds one line to `src/net/engine.ts`, an M1-P1 file.
  - The worktree has an uncommitted change to `scripts/pw-guard.mjs`. It is not part of the package, and the integrator left it alone.

## What the package was supposed to do

docs/PLAN.md, M2 package table:

> | M2-P3 Open formats | Rochester (public pack, snake order, rotating opener, configurable packs per player and burn count), Winston (stack, three piles, private looks), Grid (3×3, row or column, refill). | `draft/rochester.ts`, `draft/winston.ts`, `draft/grid.ts` | M2-C |

docs/PLAN.md, M2 acceptance tests:

> **M2-P3.** Rochester pick order for 2, 3 and 4 seats matches the snake with a rotating opener; burn count leaves that many cards unpicked; Winston and Grid end states account for every card.

Ownership (PLAN, "Ownership within M2"): M2-P3 owns `core/reducer/open.ts`, `rochesterOrder` in `core/drafting.ts`, and a new `net/draftcards.ts` for the `draftCards` pair message (Winston piles). It does not edit `net/private.ts`.

Gate M2-G needs this package: its script ends with "a two-seat Rochester of one pack each", and the screenshot set includes the Rochester table.

## What the branch contains

- **Reducer, `src/core/reducer/open.ts`:** `packOpen` for the open formats. Each pack has its own pack-seed round, and a public pack's cards are checked against their commitments. The file also holds the Rochester picks with snake order, rotating opener and burn, `pileLook` for Winston (with the end-of-stack rules) and `gridTake`.
- **Pure helpers:**
  - `src/core/open.ts` (new): seeded card ids and the Winston combined commitment.
  - `rochesterOrder` in `src/core/drafting.ts`.
- **Drivers:**
  - `src/draft/rochester.ts`, `src/draft/winston.ts` and `src/draft/grid.ts`.
  - A shared `src/draft/open.ts` (new), which fills the pool from `DraftState.taken` of confirmed states and remembers face-up cards.
  - The Winston dealer discloses a pile only while the confirmed state has the other player looking at it, and retries until `sendCards` delivers it. The other player asks with `winston:need`.
- **Pair message, `src/net/draftcards.ts`:** send and receive `draftCards`. The message type was already in `net/messages.ts` from M2-C.
- **Tests:**
  - Simulated drafts: `tests/sim/draft/open/` covers Rochester, Winston and Grid end states, plus the Winston leak scenario on the shared scanner, with a plain run and a kill/revive run.
  - Unit tests: `tests/unit/draft/open/`.
  - Two expectations in `tests/unit/core/m2-contracts.test.ts` and `reducer.test.ts` were updated. They had pinned the stubs.
- **Docs:** 17 DECISIONS lines tagged `[M2-P3]`. They live only on the branch. Two of them are items for the gate report:
  - Grid deals each grid from its own booster. The owner should confirm this reading of "18 grids of nine face-up cards from shuffled packs".
  - The lobby still offers a pick timer for the open formats, where it does nothing.

## What fails and why

Nothing fails in `pnpm check`. The package is parked because the branch edits contract files. CLAUDE.md forbids that outside a contracts package, and in M1 the same situation blocked the merge: M1-P2 waited for the M1-C amendment. The branch's DECISIONS line asks the integrator for the amendment, but the branch makes the edits itself as well. As a result, `git diff m2...m2-p3` changes `*/types.ts` and `net/engine.ts`.

These are the edits, all additive and optional:

- `src/core/types.ts`:
  - `WinstonState.stackIds?: InstanceId[]` and `WinstonState.pileIds?: InstanceId[][]`: opaque ids of the dealt stack and the three piles.
  - `DraftState.taken?: Record<DrafterId, InstanceId[]>`: ids each drafter took in an open format, in pick order.
- `src/draft/types.ts`:
  - `DraftHost.sendCards?(to, about, cards): boolean`: returns false when `to` has no connected peer.
  - `DraftHost.onCards?(listener)`.
  - `DraftHost.confirmedState?(): TableState`. The review finding below does not list this one, but the diff and the DECISIONS amendment line both include it.
- `src/net/engine.ts:792`: `case 'draftCards':` next to `case 'pack':`, so the engine passes the pair message to its listeners. Without it, every `draftCards` message falls through the switch and is dropped, and no Winston look reaches the app. This is a gap in M2-C's own wiring: M2-C added the message type and its `'prv'` channel to `net/messages.ts` but not the engine case.

## Open review finding (round 3, blocking)

The reviewer's text, as handed to the integrator:

### `src/core/types.ts:550`: the package edits contract files

- **Design reference:**
  - CLAUDE.md Hard rules: "Do not edit contract files (*/types.ts, core/actions.ts, net/messages.ts) outside a contracts package; report a needed change instead."
  - PLAN Agent orchestration: "no package edits */types.ts ... after the contracts commit; a needed change goes through the integrator as a contracts amendment."
- **Issue:**
  - The package edits two contract files:
    - `src/core/types.ts` adds `WinstonState.stackIds`/`pileIds` (lines ~550-556) and `DraftState.taken` (~590-594).
    - `src/draft/types.ts` adds `DraftHost.sendCards`/`onCards` (~156-164).
  - It also adds a one-line `case 'draftCards':` to `src/net/engine.ts` (line 792). `engine.ts` belongs to M1-P1 and is outside M2-P3's ownership: `core/reducer/open.ts`, `rochesterOrder`, `net/draftcards.ts` and `draft/rochester|winston|grid.ts`.
  - DECISIONS.md records these as an "amendment requested from the integrator", but the branch also makes the edits, so `git diff m2...m2-p3` changes contract files. That breaks the hard rule. The M1 precedent treats this as a merge blocker: M1-P2 stayed parked until the M1-C amendment landed on m1.
  - The additions are additive and optional, and the package needs them. Without the engine case, every `draftCards` message falls through the switch and is dropped, so no Winston look reaches the app.
- **Suggested fix:**
  - Do not merge until the integrator lands these exact additions as an M2-C contracts amendment on `m2`:
    - the optional `DraftState.taken`
    - `WinstonState.stackIds`/`pileIds`
    - `DraftHost.sendCards`/`onCards`
    - the `engine.ts` `draftCards` case, which fixes a gap in M2-C's own wiring
  - Then merge `m2` into `m2-p3`, so the package diff no longer touches `*/types.ts` or `net/engine.ts`.
  - The alternative is to rework the package so it needs no contract change. That does not look feasible for the Winston ids, which must be in shared state.

## What a retry should do first

1. **Land an M2-C contracts amendment on `m2`** (a contracts commit by the integrator, not by the package). Copy the exact hunks from `git diff m2...m2-p3 -- src/core/types.ts src/draft/types.ts src/net/engine.ts`:
   - `WinstonState.stackIds?` and `pileIds?`, and `DraftState.taken?`, in `core/types.ts`.
   - `DraftHost.confirmedState?`, `sendCards?` and `onCards?` in `draft/types.ts`.
   - `case 'draftCards':` in `net/engine.ts`.

   Add an `[M2-C amendment]` DECISIONS line. Everything is optional, so the other packages and the fakes keep compiling. Run `pnpm check` on `m2`.
2. **Wire the session side, or hand it to M2-P7 explicitly.** M2-P7 owns `session/draft.ts`. It must:
   - implement `sendCards`/`onCards` on top of `net/draftcards.ts`, and `confirmedState` on top of NetEngine `confirmedState`;
   - call the Winston driver's `drive()` when a peer (re)joins;
   - keep the driver alive after the draft ends until the other player's pool covers `taken`.

   The `[M2-P3]` DECISIONS lines state these needs. Make sure the M2-P7 package or the gate picks them up.
3. **Merge `m2` into `m2-p3`.** Resolve the `docs/DECISIONS.md` conflict by keeping both sides' appended lines. Drop the branch's own contract hunks in favour of `m2`'s. Then confirm that `git diff m2...m2-p3 --stat` lists no `*/types.ts` and no `net/engine.ts`.
4. **Run one focused review round on the contract-free diff, then `pnpm check` and `pnpm e2e`, and merge.** Rounds 1 and 2 already reviewed the behaviour (Winston secrecy, reload recovery, per-pack seeds). Round 3's only open finding is the one above. The retry does not need a full fresh review unless the merge changes behaviour.
5. **Carry the two gate-report items into `docs/gates/M2.md`:** the Grid deal interpretation, and the pick timer that the lobby offers for the open formats. Carry the residual-risk note as well: a modified Winston dealer client can choose its seeded ids, because no audit replays the Winston or Grid PackRecords yet.

## Resolved

The main session landed the contracts amendment on `m2` (`e870d35`), merged `m2` into `m2-p3` (no contract-file diff left; `pnpm check` green, 1553 tests) and merged the package into `m2`. Its behaviour had been reviewed in rounds 1 and 2; the only round-3 finding was the contract edits. The session wiring is handed to M2-P7.
