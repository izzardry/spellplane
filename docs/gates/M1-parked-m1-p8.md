# M1-P8 Networked session: parked

- **Status:** parked, not merged into `m1`. The pipeline's reason: "did not converge after 3 review rounds". Round 3 still had three blocking findings, listed below. The package then committed fixes for all three (`a8bde85`), but no fourth review ran, so nobody has re-reviewed them.
- **Branch:** `m1-p8`, local only (not on `origin`), in worktree `/Users/holzschneider/Workspace/spellplane-wt/m1-p8`. It is 9 commits ahead of `m1` (`427b1d3` .. `a8bde85`) and contains `m1` up to `f76bd1a` (M1-P1 and M1-P2 merged), so it needs no rebase. Diff `m1...m1-p8`: 29 files, +4173 / -1621.
- **State of `m1-p8` at parking (11 Nov 2026, head `a8bde85`):**
  - `pnpm check` is green: tsc, svelte-check, eslint, and vitest with 80 files and 1290 tests.
  - The last `pnpm e2e` before the round-3 fix (Chromium and WebKit) had 339 passed and 1 skipped.
  - `pnpm e2e:gate -- M1` passed 4 of 4 on Chromium and WebKit, including "two pages play a scripted 1v1 game to the same state hash, and the leak scan finds nothing".
  - Playwright was not run again while parking: the machine had just crashed under parallel Playwright load.
  - The round-3 reviewer's scratch repro (`zz-review3.test.ts`, seed 61, late-connecting transport) now passes against `a8bde85`, so the card stays face down. It was copied into the worktree, run and removed again.

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P8 Networked session | *(added 11 Nov 2026 by M1-C)* The networked game client that glues the modules: `TableSession` over a transport, the `NetEngine` (sequencer, sync, presence), the pair channel for hidden information and the sequencer's confirmation and commit-window timers, with the owner's secret store and persistence as in the solo session; routes `#/t/<room>/<key>` to the networked session in `main.ts`; debug-hook `net` part. | `session/*`, `main.ts`, `debug/*` | M1-P1, M1-P2, M1-P5 |

docs/PLAN.md, M1 acceptance tests:

> **M1-P8.** Two `LoopbackNetwork` sessions converge on the same hash for a scripted game and the leak scan (`tests/leak/scan.ts`) finds nothing.

## What the branch contains

- `src/session/net.ts` (about 1560 lines): the networked `TableSession` over `NetEngine` and the pair channel.
  - Turn-ups happen only after the action that made a card public is sequenced: the owner proposes a verified `flip {face:'up', ref, salt}` afterwards.
  - Owed turn-ups and hand re-issues are kept in the nonce store and retried.
  - Peeks are answered only for the controller of a stolen face-down card; every other look is refused.
  - The session takes a chair after `SETTLE_MS`, or after `LONE_WAIT_MS` for a joiner. If it sat alone and then meets a connected peer that claims its chair, it rejoins.
  - Joins can be aborted.
- `src/session/persist.ts` and `src/session/effects.ts` hold the save queue and the reveal rules. `solo.ts` and `net.ts` now share them.
- Other new session files:
  - `session/nonces.ts`: the open-round nonce store.
  - `session/live-identity.ts`: a nickname that follows renames.
  - `session/transports.ts`.
- `src/main.ts` routes `#/t/<room>/<key>` to the networked session.
- `src/debug/net.ts` is the `net` part of the debug hook.
- The lobby stand-in is deleted: `ui/lobby/local-session.ts`, `ui/lobby/dev-room.ts` and their test.
- Tests:
  - `tests/sim/session/acceptance.test.ts`, `session.test.ts` and `leak.test.ts` (scenarios added to the shared leak test).
  - `tests/unit/session/net-parts.test.ts`.
  - `tests/e2e/session/net.spec.ts`.
  - The webkit+darwin skip is removed from the lobby e2e specs.
- `docs/DECISIONS.md` gains 23 `[M1-P8]` lines, several of them superseding earlier ones.
- Edits outside the package's files, all logged in DECISIONS:
  - `ui/lobby/RoomRoute.svelte`: wiring.
  - `ui/diag/DiagRoute.svelte`.
  - `tests/unit/lobby/diag.test.ts`.
  - `tests/sim/net/chairs.test.ts`: its stand-in describe moved to the real session.
  - `tests/e2e/lobby/*`.

## Open review findings (round 3, all blocking)

1. **`src/session/net.ts:1095`: a stored turn-up publishes a card later played face down.**
   - **What went wrong:** the `turnUp` nonce entry (instance id → cid), added in round 2, was honoured whenever its cid was neither pending nor in `turnUpAfter`. The code never checked that the action had actually been sequenced.
   - **Repro:**
     1. A face-up `move` to `battlefield:s1` is lost before it reaches the sequencer (crash, or reload while the proposal is in flight).
     2. B reopens on a transport whose join resolves before its peers connect, as Trystero's does. B is now 'alone' and the entry is still stored.
     3. B calls `playFaceDown` on the same card.
   - **Result:** A's confirmed state has the card `face:'up'` with its secret sid. This breaks DESIGN "Table model", Face-down on the battlefield, and the CLAUDE.md hidden-information rule.
   - **Suggested fix:**
     - Honour a kept turn-up only for an action this replica has seen sequenced, and only if the card has not moved since.
     - Drop the entry on any own move of the card.
     - Drop entries only while the replica is 'connected'.
     - Add the scenario to the shared leak test with a late-connecting transport.
2. **`src/ui/types.ts:38`: contract file edited outside a contracts package.**
   - **What went wrong:** the branch added `AppProps.openRoom?: (link: RoomLink) => Promise<NetSession>`. CLAUDE.md allows contract edits only in a contracts package.
   - **Suggested fix:** the integrator takes the field over in a separate contracts commit, or the package reverts it.
3. **`src/session/net.ts:1097`: same root cause as finding 1, a second repro.**
   - **What went wrong:** `turnUpOwed` treats a kept entry as owed without checking that its cid is in the sequenced history.
   - **Repro:** seed 26. The 'act' sends are dropped, and the loopback join completes 3 s after the session's join resolves. The `flip` with `ref.sid` and `salt` was delivered to peer-a at seq 57.
   - **Also:** the same leak happens without a reload delay whenever the first `drive()` after the reload comes from the face-down move's own `onSequenced`.
   - **Suggested fix:** check `this.entries` for an action with that cid. When the cid is neither pending nor sequenced and the replica is in step, drop the entry.

**What `a8bde85` changed for these (unreviewed):**

- **Findings 1 and 3:**
  - A kept turn-up is honoured only while the replica is 'connected', and only when its cid is in the sequenced log as an action on that card, with no move to another zone and no turn since.
  - The entry is dropped once the replica is in step and the cid is neither sequenced nor pending.
  - `playFaceDown`, and any own action on a card that lies in a hidden zone, drop the entry first.
  - The scan for own face-down cards in zones that show faces also waits for 'connected'.
  - The shared leak test gained the scenario, with join and peer delays of 0, 3000 and 50 ms.
- **Finding 2:** `ui/types.ts` is back to the contract. `main.ts` hands `openRoom` next to AppProps, and `RoomRoute.svelte` declares it locally as `RoomOpener`.
- **Hardening:** a rejoin's new save queue waits for the old queue's last write.

## Why it is parked

Each review round found a new hidden-information path in the owed-turn-up and resume logic:

- Round 1: a reveal was sequenced ahead of an action that was then refused.
- Round 2: a reload lost a turn-up, and peeks were answered for any seat.
- Round 3: a stored turn-up outlived an action that was never sequenced.

The round-3 fix has not been reviewed. The turn-up bookkeeping has a lot of state:

- what is pending, kept and owed, with `turnUpAfter`
- connection status gating
- rejoin
- resume from a snapshot

So the pipeline's round limit stopped it rather than merge an unreviewed fix to a leak.

## What a retry should do first

1. **Do not reimplement.** Resume from `m1-p8` at `a8bde85` in the existing worktree, and push the branch to `origin` so it survives another crash.
2. **Run one focused review of `a8bde85` and the turn-up and resume paths only.** Check that the turn-up bookkeeping cannot outlive the action or the card position it was recorded for:
   - `turnUpOwed`, the `turnUp` nonce entries, the drop rules and the 'connected' gating.
   - The reload, catch-up and rejoin paths.
   - Cases to check:
     - Undo of the sequenced move.
     - A move sequenced after a snapshot catch-up, when the cid is no longer in the log.
     - Another seat moving the card.
     - The three rejoin attempts.

   If the design allows it, consider a simpler shape: derive the owed turn-ups from the sequenced log plus own pending cids on every drive, and keep no separate durable entry.
3. **Decide the contract question as integrator.** Either accept `openRoom` on AppProps through a contracts commit (DECISIONS `[M1-P8]` proposes `openRoom?: (link: RoomLink) => Promise<NetSession>`) or keep the local `RoomOpener` declaration in `RoomRoute.svelte`.
4. **Re-run the checks, one Playwright run at a time:** `pnpm check`, then `pnpm e2e`, then `pnpm e2e:gate -- M1`, each with a 10-minute timeout.
5. **Carry the open M1-P1 gap the package reported:** in the engine's equal-seq, same-seat case, two sequencers never reconcile (DECISIONS `[M1-P8]` LONE_WAIT_MS line). The session works around it with its rejoin, but the engine fix belongs to M1-P1.
6. **After the merge:** M1-P7 Resume depends on this package. Its park note (`docs/gates/M1-parked-m1-p7.md`) lists what it needs from here.
