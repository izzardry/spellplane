# M1-P7 Resume: parked

- **Status:** parked, not merged into `m1`. The package never started. The pipeline did not run it because its dependencies were not merged. The pipeline's reason was "dependency not merged: M1-P1, M1-P8".
- **Branch:** none. There is no `m1-p7` branch, local or on `origin`, and no worktree `spellplane-wt/m1-p7`. There is nothing to diff or test.
- **State of `m1` for this package (11 Nov 2026, at parking, head `9b3ce24`):** only the M1-C stubs and the solo-session persistence from M0 exist.
  - `src/net/sync.ts`: holds the `ResumeOffer` and `ResumeChoice` contracts. `chooseResume` is a stub that always keeps the local copy.
  - `src/core/reducer/index.ts:100`: the `away` action (added by M1-C, `core/actions.ts:212`) is refused as `later('M1-P7')`.
  - `src/store/table.ts` (named in the PLAN row) does not exist. Table persistence lives in `src/store/tables.ts` (M0-P5, plus M1-C's `loadLog` and `saveSecrets`) behind the `TableStore` contract in `src/store/types.ts`.
  - `src/ui/recovery/` does not exist.
  - The solo session (`src/session/solo.ts`) already persists the log, the table record and the secret store in one transaction and stores a snapshot every 200 actions (`SNAPSHOT_EVERY`). It restores from its own save after a reload (DECISIONS `[M0-P7]` lines 148, 153).
  - No contract carries the lost-save recovery: `core/actions.ts`, `core/types.ts` and `net/messages.ts` have no recovery action, message or record.
  - The network pieces this package would call are stubs. `src/net/engine.ts` and `src/net/sequencer.ts` throw "not implemented: M1-P1", and `src/session/net.ts` rejects with "not implemented: M1-P8".

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P7 Resume | Persist the sequenced log, snapshots every 200 actions and the secret store; rejoin a seat by key pair; restore with no peers present and reconcile to the highest sequence number; away seats; the logged lost-save recovery (re-import, subtract public cards, recommit, reshuffle). | `store/table.ts`, `net/sync.ts`, `ui/recovery/*` | M1-C |

docs/PLAN.md, M1 acceptance tests:

> **M1-P7.** Reloading either page mid-game rejoins the same seat with the same hand; closing both pages and reopening either restores the table; the recovery flow yields a library whose size equals deck size minus public cards minus the agreed hand.

DESIGN "Multiplayer architecture", "Resume and failure handling" has the behaviour: continuous save of the log with snapshots and of the own secret store; rejoin by key pair and catch-up from any connected peer; first browser back restores from its own save, later arrivals reconcile to the highest sequence number; away seats; the public, logged lost-save recovery. DESIGN "Specification: network protocol and secrecy", Sync, sets the 200-action snapshot interval and the 500-action snapshot threshold for `syncRes`.

Ownership (PLAN, M1-C note): M1-P7 owns `net/sync.ts` inside `net/`. DECISIONS `[M1-C]` line 180 gives it the reducer for `away`.

## Why it is parked

1. **The PLAN row lists only M1-C as a dependency, but every acceptance criterion is networked.** "Reloading either page rejoins the same seat with the same hand", "closing both pages and reopening either restores the table", away seats and a recovery "agreed by the table" all need two live peers. The pipeline therefore ran it after M1-P1 and M1-P8. That is the right order, and the PLAN row understates it.
2. **M1-P1, Transport and sequencer, is not merged.** It is parked after 3 review rounds without convergence, see `docs/gates/M1-parked-m1-p1.md`. Without its `NetEngine`, rejoin by key pair (the hello handshake), catch-up (`syncReq`/`syncRes` with snapshots), the sequencer's 6 s liveness rule that proposes `away`, and handover after the sequencer page closes do not exist. `chooseResume` has nothing to be called from.
3. **M1-P8, Networked session, is not merged.** It never started, because M1-P1 and M1-P2 are parked; see `docs/gates/M1-parked-m1-p8.md`. M1-P8 owns `session/*` and the `#/t/<room>/<key>` route. A networked reload, the persistence of sequenced actions received from peers, and the restore-then-reconcile flow all run through that session. Without it, this package could only change the solo session, which already does what the solo case needs.
4. **M1-P2, Secrecy, is also needed and is parked** (`docs/gates/M1-parked-m1-p2.md`). The lost-save recovery recommits and reshuffles a new library. That uses M1-P2's commitments and its shuffle protocol with peer nonces. The "same hand after reload" check also depends on M1-P2's received-identity handling (`receiveIdentity`, `pruneReceived` are stubs on `m1`).

## Open review findings

None. The package was never implemented or reviewed. The open findings that block it belong to M1-P1 (2 blocking, round 3) and M1-P2 (3 blocking, round 3). They are recorded in those packages' park notes.

## What a retry should do first

1. **Unblock the dependencies, in the order the M1-P8 park note gives:** land the M1-C contract amendments (`NetEngine.pending()`, `Reissue`), merge M1-P1 and M1-P2 after their focused round-3 re-reviews, then build and merge M1-P8. Do not start M1-P7 on unmerged branches.
2. **Fix the PLAN row's dependency column** to "M1-P1, M1-P2, M1-P8" (and log it in DECISIONS), so the next pipeline run does not schedule the package early.
3. **Decide the recovery contract before writing code**, in a small contracts change, since this package may not edit `core/actions.ts`, `core/types.ts` or `net/messages.ts`. The design needs:
   - a public, logged action that starts the recovery for a seat and discards its hidden zones (hand and library) in shared state;
   - a way for the table to agree on the fresh hand count (the simplest consistent choice: the recovering player proposes a count, and it goes through the M1-P3 confirmation round);
   - the recommit and reshuffle, reusing M1-P2's import commitments and shuffle round rather than a new protocol.

   Report this as a needed contract change if it falls to the package itself.
4. **Reconcile the file names:** the PLAN row says `store/table.ts`, but the code is `store/tables.ts`. Extend `store/tables.ts` rather than adding a parallel module, and log that.
5. **Reuse the solo session's persistence.** `session/solo.ts` already writes log, table and secrets in one transaction, snapshots every 200 actions and restores up to `lastSeq` (DECISIONS `[M0-P7]` lines 148, 153, 156). Move what M1-P8 does not already share into a place both sessions use, instead of writing a second save path.
6. **Implement the pure parts first, with Vitest:**
   - `chooseResume` (highest sequence number wins; own save wins ties);
   - the `away` reducer, replacing the stand-ins in the M1-P3 sim tests and `ui/confirm/harness.ts` (DECISIONS `[M1-P3]` lines 255, 260, 279);
   - the recovery arithmetic: library size = deck size − the seat's public cards − agreed hand.
7. **Then write the acceptance tests:**
   - Sim (Vitest, `LoopbackNetwork`, fake timers): reload either peer mid-game and rejoin the same seat with the same hand hash; kill both peers and revive either one alone from its save, then the other, and reconcile to the higher seq; mark a silent seat away and back.
   - Browser (Playwright, broadcast transport, `?profile=a`/`?profile=b`): reload each page, close and reopen both. The M1-G gate also reloads each page and closes and reopens the sequencer page.
   - Add the recovery scenario (re-import after a lost save) to the shared leak test, as CLAUDE.md requires for code that touches hidden information.
