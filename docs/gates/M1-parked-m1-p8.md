# M1-P8 Networked session: parked

- **Status:** parked, not merged into `m1`. The package never started. The pipeline did not run it because its dependencies were not merged. The pipeline's reason was "dependency not merged: M1-P1, M1-P2, M1-P5".
- **Branch:** none. There is no `m1-p8` branch, local or on `origin`, and no worktree `spellplane-wt/m1-p8`. There is nothing to diff or test.
- **State of `m1` for this package (11 Nov 2026, at parking, head `0e9261a`):** only the M1-C stubs exist.
  - `src/session/net.ts`: `createNetSession` rejects with "not implemented: M1-P8".
  - `src/session/types.ts`: holds the `NetSessionOptions`, `NetSession` and `CreateNetSession` contracts.
  - `src/main.ts`: still starts only the solo session.
  - `src/debug/`: has no `net` part.
  - `tests/leak/scan.ts`: the shared leak scanner is on `m1`.
  - The stubs this package would call are still in place in `src/net/engine.ts`, `src/net/sequencer.ts`, `src/net/identity.ts` and `src/net/private.ts`. Their packages, M1-P1 and M1-P2, are parked.

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P8 Networked session | *(added 11 Nov 2026 by M1-C)* The networked game client that glues the modules: `TableSession` over a transport, the `NetEngine` (sequencer, sync, presence), the pair channel for hidden information and the sequencer's confirmation and commit-window timers, with the owner's secret store and persistence as in the solo session; routes `#/t/<room>/<key>` to the networked session in `main.ts`; debug-hook `net` part. | `session/*`, `main.ts`, `debug/*` | M1-P1, M1-P2, M1-P5 |

docs/PLAN.md, M1 acceptance tests:

> **M1-P8.** Two `LoopbackNetwork` sessions converge on the same hash for a scripted game and the leak scan (`tests/leak/scan.ts`) finds nothing.

DECISIONS `[M1-C]` added the package because the plan had no owner for this glue.

## Why it is parked

1. **M1-P1, Transport and sequencer, is not merged.** It is parked, see `docs/gates/M1-parked-m1-p1.md`. Without its `NetEngine`, sequencer, handshake and transports, a networked session has nothing to run on. The stubs on `m1` reject.
2. **M1-P2, Secrecy, is not merged.** It is parked, see `docs/gates/M1-parked-m1-p2.md`. Without it the pair channel (`net/private.ts`), commitments, the shuffle protocol and the commit-window deadlines are stubs, and the acceptance leak scan cannot pass meaningfully. The M1-P2 branch also hands this package concrete work, listed under "What a retry should do first" below.
3. **M1-P5, Lobby and seats, is in fact merged.** It went into `m1` as `77bda8b merge(m1): M1-P5 Lobby and seats` and is ticked in PLAN. So the pipeline's listing of M1-P5 among the unmerged dependencies looks stale, probably because the dependency state was read before that merge landed. It does not change the outcome, since M1-P1 and M1-P2 alone block this package.
4. **A related gap the plan does not list as a dependency:** the `NetEngine` scope includes "sync", and `net/sync.ts` belongs to M1-P7, Resume. M1-P7 is not merged either, though it is not parked as such. A retry will need at least the catch-up sync M1-P1 implements, and reload or rejoin needs M1-P7.

## Open review findings

None. The package was never implemented or reviewed. The open findings that matter here belong to M1-P1 (2 blocking, round 3) and M1-P2 (3 blocking, round 3). They are recorded in those packages' park notes.

## What a retry should do first

1. **Unblock the dependencies, in this order:**
   1. Land the M1-C contract amendments on `m1`:
      - `NetEngine.pending()` in `net/types.ts`.
      - `Reissue` and `reissue?` in `core/actions.ts`.
      - `ReissueRecord` and `reissue?` in `core/types.ts`.
   2. Merge M1-P1, after its focused round-3 re-review.
   3. Merge M1-P2, after its focused round-3 re-review. Ideally its leak test then moves from the minimal sequencer to M1-P1's engine.

   Do not start M1-P8 on unmerged branches. Its acceptance test and the M1 gate both need the real engine and the real pair channel.
2. **Create `m1-p8` from `m1` once both are merged**, in worktree `spellplane-wt/m1-p8`. Run `pnpm install --frozen-lockfile` first.
3. **Carry the integration notes the other packages left for M1-P8 into the package brief:**
   - **From M1-P5 (DECISIONS lines 296-298, 312-314):**
     - Replace the stand-in `ui/lobby/local-session.ts` with the real `NetSession`, passed through `AppProps`. `RoomRoute` takes main.ts's session when its `roomId` matches. `local-session.ts` and `dev-room.ts` may be deleted.
     - `takeSeat` must read the current nickname from the `IdentityStore`, not the `NetSessionOptions` snapshot.
     - `takeSeat` must fall back to a non-empty name ('Player'), because a fresh identity's nickname is '' and the reducer refuses it.
     - A chair move takes the new chair before it leaves the old one.
     - The lobby stamps a chair move as `seatTake {seat: new, by: new}`. M1-P1's round-3 fix is meant to accept that, and M1-P8 should have a sim test that drives it through the real engine.
   - **From M1-P1:** at seq 0 with nobody seated, a creator's table and a fresh joiner's table are indistinguishable. The session should take its chair before others join.
   - **From M1-P2:**
     - Call `undoPlan` and send the owner's verified re-reveals after an undo, as `solo.ts` does on the M1-P2 branch.
     - Call `reissueZone` after a card returns to the hand.
     - Keep the `disclosed` set, and rebuild it from the log on reload.
     - Keep a pending rng nonce in local storage.
     - Answer looks from `engine.confirmedState()`, and pass `pending()` to the pair channel.
   - **From M1-P6 (DECISIONS line 202):** own chat lines that the log does not hold yet are shown as pending until their cid is sequenced. The optimistic networked session must feed this.
   - **From M1-P3:** the confirmation-round timer deadlines in `core/reducer/confirm.ts` are driven by the sequencer's clock, which this package owns.
4. **Write the acceptance test first.** It runs two `LoopbackNetwork` sessions through a scripted game under Vitest fake timers, asserts equal `stateHash`, and runs `tests/leak/scan.ts` over B's received messages, state, stores and SecretStore against A's `secretTokens`. Add the package's leak scenarios to the shared leak test, as CLAUDE.md requires.
5. **Expect the macOS WebKit limit** from DECISIONS `[M1-P5]`, CryptoKey in IndexedDB. It should be gone since `7b61414`, which keeps the identity keys as JWK. Confirm that before the session's browser tests skip on webkit+darwin.
