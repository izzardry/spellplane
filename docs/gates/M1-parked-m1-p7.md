# M1-P7 Resume: parked

> **Update (gate fix round):** M1-P8 is merged. The pure parts of this package landed on `m1`: `chooseResume`, `recoveryLibrarySize`/`recoveryRemainder`, the `recover`/`recoverCommit` reducer (`core/reducer/recovery.ts`), their log lines, unit tests (`tests/unit/recovery/recovery.test.ts`) and the shared leak scenario. Still open: the session's recovery driver and `ui/recovery/*`, and the M1-P7 browser acceptance tests. See DECISIONS `[M1-P7 partial, gate fix]`. The rest of this note is the record at parking.

- **Status:** parked, not merged into `m1`. The package never started. The pipeline's reason: "dependency not merged: M1-P8".
- **Branch:** none. There is no `m1-p7` branch, local or on `origin`, and no worktree `spellplane-wt/m1-p7`. There is nothing to diff or test.
- **History:** this note replaces the first park note (`89cc782`, written at `m1` head `9b3ce24`). At that time M1-P1 and M1-P2 were also unmerged. Since then:
  - M1-C landed the retry contracts (`54e4eae`), including the lost-save recovery contract.
  - The PLAN row was corrected.
  - M1-P2 (`e5f0476`) and M1-P1 (`4d3965e`, `f76bd1a`) were merged.
  - M1-P8 was parked (`11e5d2e`, `docs/gates/M1-parked-m1-p8.md`).
- **State of `m1` for this package (11 Nov 2026, head `11e5d2e`):**
  - `src/net/sync.ts`: holds the `ResumeOffer`/`ResumeChoice` contracts. `chooseResume` is a stub that always keeps the local copy. Nothing calls it.
    - The merged M1-P1 engine already reconciles on its own: `NetEngine.deferTo()` (`src/net/engine.ts:858`) follows the connected peer with the highest `lastSeq` and catches up from it before electing.
  - `src/core/recovery.ts`: `recoveryLibrarySize` and `recoveryRemainder` are stubs that throw `not implemented: M1-P7`.
  - `src/core/reducer/index.ts:117-118`: `recover` and `recoverCommit` are refused as `later('M1-P7')`. `src/core/reducer/recovery.ts` does not exist.
  - The `away` reducer already exists. The M1-G fix round landed it in core (DECISIONS `[M1-G fix]` line 385; `src/core/reducer/index.ts:101`). The avatar shows away seats.
  - `src/ui/recovery/` does not exist.
  - `src/store/tables.ts` has `saveAction`, `saveSnapshot`, `loadTable`, `loadLog`, `saveSecrets`, `listTables` and `deleteTable`.
  - The solo session (`src/session/solo.ts`) saves the log, the table and the secret store in one transaction, stores a snapshot every 200 actions, and restores from its own save after a reload.
  - On `m1`, `src/session/net.ts` still rejects with `not implemented: M1-P8`. No networked session exists on `m1`.

## What the package was supposed to do

docs/PLAN.md, M1 package table (line 118):

> | M1-P7 Resume | Persist the sequenced log, snapshots every 200 actions and the secret store; rejoin a seat by key pair; restore with no peers present and reconcile to the highest sequence number; away seats; the logged lost-save recovery (re-import, subtract public cards, recommit, reshuffle). | `store/tables.ts`, `net/sync.ts`, `core/recovery.ts`, `core/reducer/recovery.ts`, `ui/recovery/*` | M1-P1, M1-P2, M1-P8 |

docs/PLAN.md, M1 acceptance tests (line 129):

> **M1-P7.** Reloading either page mid-game rejoins the same seat with the same hand; closing both pages and reopening either restores the table; the recovery flow yields a library whose size equals deck size minus public cards minus the agreed hand.

DESIGN describes the behaviour in two places:

- "Multiplayer architecture", "Resume and failure handling":
  - Save the log continuously, with snapshots, and save the own secret store.
  - Rejoin by key pair and catch up from any connected peer.
  - The first browser back restores from its own save. Later arrivals reconcile to the highest sequence number.
  - Away seats.
  - The public, logged lost-save recovery.
- "Specification: network protocol and secrecy", Sync: the 200-action snapshot interval.

The recovery contract is fixed by M1-C (DECISIONS lines 395-397):

- `recover {hand, round}` discards the seat's hidden zones, sets `Seat.recovering` and opens an M1-P3 confirmation round.
- `recoverCommit {commits, instanceIds, zone}` commits exactly `recoveryLibrarySize` fresh ids.
- Then M1-P2's secret shuffle and `draw` run for the agreed hand.

## Why it is parked

1. **M1-P8, Networked session, is not merged.** It is parked after 3 review rounds, with an unreviewed fix for a hidden-information leak in its turn-up and resume bookkeeping (`a8bde85` on the local-only branch `m1-p8`); see `docs/gates/M1-parked-m1-p8.md`.
   - Every acceptance criterion of this package is networked. "Reload either page", "close both pages and reopen either" and a recovery "agreed by the table" all run through M1-P8's `session/net.ts` and the `#/t/<room>/<key>` route. Neither exists on `m1`.
   - The pipeline correctly did not start M1-P7 on top of an unmerged branch.
2. **M1-P8 already covers much of this package's row.** On `m1-p8` (not on `m1`):
   - `session/persist.ts` is the shared save queue with `SNAPSHOT_EVERY = 200`.
   - `session/net.ts` has `loadSaved` (around line 1463), which restores a room from its own snapshot plus log tail. It also has the rejoin logic.
   - M1-P8's round-3 findings are in exactly this resume path: kept turn-ups across reloads and late-connecting transports.

   Building M1-P7 before M1-P8 settles would duplicate that code or conflict with it.
3. **M1-P1 and M1-P2 are no longer blockers.** Both are merged on `m1`.

## Open review findings

None. The package was never implemented or reviewed. The open findings that block it are M1-P8's three round-3 findings, all addressed by `a8bde85` but not re-reviewed. They are recorded in `docs/gates/M1-parked-m1-p8.md`.

## What a retry should do first

1. **Merge M1-P8 first.** Follow its park note:
   - Push `m1-p8` so it survives another crash.
   - Run one focused review of `a8bde85` on the turn-up and resume paths.
   - Settle the `openRoom` contract question.
   - Run `pnpm check`, `pnpm e2e` and `pnpm e2e:gate -- M1`, one Playwright run at a time.

   Do not branch M1-P7 off `m1-p8`.
2. **Start from what `m1` then has; do not add a second save or restore path.**
   - Persistence and the 200-action snapshot belong to `session/persist.ts`. Restore from the own save belongs to M1-P8's `loadSaved`.
   - Reconciliation to the highest seq is already in the engine (`deferTo`).
   - Decide whether `chooseResume` is still needed. Either wire it into the engine or session where the start copy is chosen, or implement it as the pure rule (highest seq wins; own save wins ties) and assert that the engine agrees with it. Log the choice in DECISIONS.
   - `store/tables.ts` should change only if a gap is found (for example, keeping the secret store when the log is lost).
3. **Implement the pure parts first, with Vitest:**
   - `chooseResume`.
   - `recoveryLibrarySize` and `recoveryRemainder` in `core/recovery.ts`: multiset subtraction by `sid` and foil, tokens excluded, null when the deck cannot cover the public cards.
   - The `recover`/`recoverCommit` reducer in a new `core/reducer/recovery.ts`, replacing the two `later('M1-P7')` entries.
   - Log lines for both actions in `ui/describe.ts`.
4. **Replace the `away` stand-ins** that predate the core reducer: `ui/confirm/harness.ts` (lines 26, 85) and the M1-P3 sim tests (DECISIONS `[M1-P3]` lines 308, 327). Check them against the real reducer and the sequencer's liveness rule.
5. **Build `ui/recovery/*`.** It is the "my save is lost" entry point: re-import the deck, propose a hand count, and show the confirmation round's state. Then drive `recoverCommit`, the shuffle and the draws from the session.
6. **Then write the acceptance tests:**
   - Sim (Vitest, `LoopbackNetwork`, fake timers):
     - Reload either peer mid-game and rejoin the same seat with the same hand hash.
     - Kill both peers, revive either one alone from its save, then the other, and check that both reconcile to the higher seq.
     - The recovery flow ends with library size = deck size − public cards − agreed hand.
   - Browser (Playwright, `?transport=local`, `?profile=a`/`?profile=b`): reload each page, and close and reopen both. Use the 10-minute timeout and never run two Playwright runs at once.
   - Add the recovery scenario (re-import after a lost save) to the shared leak test, as CLAUDE.md requires.
