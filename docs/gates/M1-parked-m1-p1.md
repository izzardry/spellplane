# M1-P1 Transport and sequencer: parked

- **Status:** parked, not merged into `m1`. The pipeline ran out of rounds: it did not converge after 3 review rounds.
- **Branch:** `m1-p1` (worktree `spellplane-wt/m1-p1`), head `3eeee9e fix(m1-p1): review round 3 — chair moves, fork re-verification on re-claim`. It branches from `d981303 feat(m1-c): contracts` and is 19 commits behind `m1` (M1-P3, M1-P4, M1-P5, M1-P6, the JWK identity-key fix and the M1-P2 park note). `git merge-tree m1 m1-p1` reports one conflict, in `docs/DECISIONS.md`, where both sides appended lines. No source file conflicts.
- **State of the branch (11 Nov 2026, at parking):** `pnpm check` is green in the worktree, with tsc, svelte-check, eslint and 784 vitest tests in 47 files. `pnpm e2e` was not run for this note. The diff against `m1` touches 27 files, +5236/−32, all inside `net/*`, `tests/` and `docs/DECISIONS.md`. It edits no contract file.

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P1 Transport and sequencer | Trystero, loopback and broadcast transports; hello handshake with key-pair identity; sequencer election, sequencing, nack and rollback of optimistic actions; gap detection and resend; catch-up sync with snapshots; heartbeat and handover; state-hash exchange every 50 actions; presence channel. | `net/*` | M1-C |

docs/PLAN.md, M1 acceptance tests:

> **M1-P1 (simulated network, Vitest).** With 2, 3 and 4 engines on the loopback transport under random delay up to 400 ms, 5% drop and reordering, 2,000 random actions converge to one state hash. Killing the sequencer mid-stream hands over within the timeout and loses no acknowledged action. A late joiner reaches the same hash. Two players dragging the same card resolve to the last sequenced move on all peers.

Ownership (PLAN, M1-C note): M1-P1 owns `net/*` except `net/private.ts` (M1-P2) and `net/sync.ts` (M1-P7). M1-P8 (networked session) depends on M1-P1, M1-P2 and M1-P5, so M1-P8 and the M1 gate cannot start until this package is merged.

## What the branch contains

- **Engine, `src/net/engine.ts`:** the `NetEngine`. It covers the handshake, election, sequencing with nack and rollback, gap detection and resend, catch-up (`tail`, `overlap` and snapshot), heartbeat, claim and handover, fork repair by rewind, state-hash exchange every 50 actions, and the `away` proposals.
- **Sequencer, `src/net/sequencer.ts`:** `createSequencer`, `electSequencer`, `Replica`, `seatOfPeer` and `senderSeat`. Its structural checks and its hidden-zone authority nacks are listed in DECISIONS.
- **Transports and identity:** `hello.ts` (connection-bound handshake), `identity.ts`, `presence.ts`, `trystero.ts` (Nostr strategy only), `validate.ts`.
- **Tests:**
  - Simulated network: `tests/sim/net/` (acceptance, joining, protocol, sweep) on `LoopbackNetwork` with a deterministic fake identity.
  - Unit tests: `tests/unit/net/` (handshake, identity, lifecycle, presence, sequencer).
  - Browser specs: `tests/e2e/net/engine.spec.ts` and the network smoke spec.
- **Docs:** 24 DECISIONS lines tagged `[M1-P1]`. They live only on the branch.

## Why it is parked

1. **The review did not converge.** Each round found new blocking protocol holes:
   - Round 1: hidden-zone ownership, and a contract edit that was reverted.
   - Round 2: joiner election, and handshake channel binding.
   - Round 3: the two findings below.

   Commit `3eeee9e` attempts a fix for both round-3 findings and adds tests for them. The pipeline had no round left to review that commit, so neither fix is verified. The line numbers in the findings refer to `cdf5569`, the round-2 head.
2. **It is the critical path of M1.** M1-P8 and Gate M1-G both need it. M1-P2 also expects M1-P1's engine for its leak test, and it needs `pending()` on `NetEngine` (see the M1-P2 park note). The class on this branch already has a public `pending()` (`engine.ts:311`), but the `NetEngine` interface in `net/types.ts` does not declare it.

## Open review findings (round 3, both blocking)

The text below is the reviewer's as handed to the integrator, shortened. Under **Round-3 response** I note what `3eeee9e` claims to do about each one. That response has not been reviewed.

### 1. `src/net/sequencer.ts:152`: the "sender's seat" check breaks moving chairs

- **Design reference:** DESIGN "Specification: network protocol and secrecy", Sequencing 3 and Handshake ("the sequencer rejects any propose whose by is not the sender's seat"). Also "Players, seats and formats" (chair selection), PLAN M1-P5 (chair selection) and Gate M1-G.
- **Issue:** The authority check took "the sender's seat" to be `seatOfPeer(state, peerId)`, the first seat in insertion order that holds the sender's peer id. That breaks moving chairs, although DECISIONS line 206 says it does not. The reviewer checked this with a scratch Vitest run: `baseTable(4)` with s1 freed and peer3 at s3.
  1. On `m1`, M1-P5 (`src/ui/lobby/local-session.ts:390-392`) stamps a chair move as `seatTake {seat: new, by: new, peer: self}`. This sequencer refused it: "by s1 is not the sender's seat s3". Once M1-P8 wires in the engine, every lobby chair change would be nacked and rolled back.
  2. The package's own convention (`by` = the current seat, as in `tests/unit/net/sequencer.test.ts:127`) also fails when the player moves to a lower chair. After `seatTake {seat: s1, by: s3}` is sequenced, `seatOfPeer` returns s1. Then `seatLeave {seat: s3, by: s3}` is refused ("by s3 is not the sender's seat s1"), and `seatLeave {seat: s3, by: s1}` is refused ("a player leaves only its own seat"). The player keeps both chairs for good, and nobody else can take or free s3. The unit test covered only a move to a higher chair.
- **Suggested fix:**
  - Accept `by` when it names a chair the sender actually holds, instead of comparing it with the first match. In `onPropose` and `sequenceOwn`, pass `sender.seat = action.by` when `state.seats[action.by]?.peer === peerId`, and fall back to `seatOfPeer` otherwise.
  - Treat a `seatTake` with `by === seat` and `peer` = the sender's peer id the same way whether or not the sender is seated.
  - Allow `seatLeave` of any chair whose `peer` is the sender's.
  - The Sequencer contract does not change.
  - Add unit and sim cases for moves to a lower and to a higher chair with M1-P5's stamping, and correct DECISIONS line 206.
- **Round-3 response:**
  - The new `senderSeat(state, action, peerId)` returns `action.by` when the sender holds that chair, and its first chair otherwise. The engine passes it in `sequenceOwn` (`engine.ts:997`) and `onPropose` (`engine.ts:1035`).
  - `check` accepts a `seatTake` stamped as the chair it takes from a seated player too (`sequencer.ts:162`). `seatLeave` still requires `seat === by`, which now passes because `by` is checked against held chairs.
  - New tests: a sim case in `tests/sim/net/protocol.test.ts` for moves down and up with M1-P5's stamping, and a `senderSeat` table in `tests/unit/net/sequencer.test.ts`, including refusals for chairs the sender does not hold. The DECISIONS line was rewritten.

### 2. `src/net/engine.ts:922`: a follower misses the fork when its own sequencer adopts another history on re-claim

- **Design reference:** DESIGN "Multiplayer architecture", Shared state ("every peer applies actions in that order through the same pure reducer, so all browsers converge"; "the connected peer with the lowest seat number takes over from the last sequence number everyone acknowledges"). Also PLAN M1-P1 acceptance ("loses no acknowledged action") and DECISIONS [M1-P1] ("own actions of the abandoned part that the adopted history lacks are proposed again").
- **Issue:** When the current sequencer replaced its own history with another peer's during a re-claim, its followers never checked for the fork. The reviewer reproduced it with a scratch sim test (`tests/sim/net/sim.ts`, 4 engines, seed 5, delay 5–40 ms, no drops):
  1. The room is split into {peer0, peer1} and {peer2, peer3}.
  2. On side A, peer0 sequences five of peer1's `life` actions (seqs 29–33), all acked to peer1.
  3. On side B, peer2 is elected and sequences twenty of peer3's actions (seqs 29–49).
  4. After the split heals, peer0 claims again, finds the fork at 29, adopts side B's history (`lostOwn` holds only peer0's own actions) and becomes active at seq 49.
  5. peer1's sequencer was peer0 the whole time, so `recompute` never set `verifyNext`. `onClaim` (line 922) and `maybeCatchUp` (line 1061) fetched a plain `tail` from haveSeq=33. The fork check in `onSyncRes` (line 1121) only looks at seqs at or below the replica's head, so seqs 34–49 were applied on top of peer1's forked 29–33.

  **Result:** All four engines reported seq 49 and named peer0 as sequencer, but peer1's confirmed state had s1 life 15 while the others had 20. This lasted more than 8 s of idle time, until the next hash exchange. At seq 50, peer1 logged "State hash mismatch at seq 50 (a reducer bug)" and loaded the snapshot. `resyncState` requeues nothing, so peer1's five acknowledged actions were lost silently, with no rollback event.

  So for up to 50 actions a peer can run a different state from the sequencer's, a protocol fork is reported as a reducer bug, and acknowledged actions are lost. Any draw or reveal in that window is out of step with its owner's secret store.
- **Suggested fix:**
  - Make every follower re-verify its recent history whenever its sequencer claims again, not only when the sequencer changes. In `onClaim`, when `this.sequencer === e.info.peerId`, set `verifyNext = true` and call `replica.clearBuffer()`. The first catch-up or seq from that sequencer is then an `overlap` read, which reaches `adopt()`, rewinds and re-proposes the follower's lost own actions.
  - Add the split-and-heal scenario to `tests/sim/net/protocol.test.ts`. Assert three things: every peer's confirmed hash equals the sequencer's before any further action; no "State hash mismatch" is logged; and every acked cid ends up sequenced or rolled back, never silently dropped.
- **Round-3 response:**
  - `onClaim` now sets `verifyNext` and clears the buffer when the current sequencer claims again (`engine.ts:956-957`).
  - Every catch-up from the sequencer is an `overlap` read until the sequencer's next `seq` has been checked the same way.
  - While its sequencer is reachable, a follower catches up only from it, never with a plain tail from another peer that is ahead.
  - A claimant that adopted another history, or saw a peer name another sequencer, logs `sequencerClaim` when it becomes active, so followers always get a `seq` to verify even when both histories reached the same seq.
  - A split-and-heal sim test was added (`tests/sim/net/protocol.test.ts`). It asserts no hash mismatch on any peer, no rollbacks, every acked cid in the log, and both sides' life changes present on every peer.
  - Not done: that test checks convergence with `expectConverged` (15 s), not "confirmed hash equals the sequencer's before any further action" as the reviewer asked. The window between adoption and the follower's re-verify is not asserted.

## What a retry should do first

1. **Merge `m1` into `m1-p1`.** Resolve the `docs/DECISIONS.md` append conflict by keeping both sides. Then run `pnpm check` and `pnpm e2e`. Once the branch has `7b61414`, the JWK identity-key fix, drop the WebKit in-memory key fallback and the skip in `tests/e2e/net/engine.spec.ts` (`persist`), as the branch's own DECISIONS line asks.
2. **Run one focused review of `3eeee9e` against the two findings above, and turn each reviewer probe into a regression test.**
   - Rerun both scratch probes verbatim. The first is a chair move down and up with M1-P5's `by` = new seat stamping, followed by a leave of the old chair. The second is the 4-engine split-and-heal with seed 5.
   - Make the split-heal test assert the reviewer's stronger condition: each follower's confirmed hash equals the sequencer's at the sequencer's first new `seq`, not only after a 15 s settle.
   - Prefer this review over a fresh full review, which so far has produced new findings every round. Do not widen scope.
3. **Add a sim test that drives a chair move through M1-P5's real `takeSeat` stamping**, with `local-session.ts` on `m1` as the reference, so the lobby and the sequencer cannot drift apart again.
4. **Land the `NetEngine.pending()` contract amendment (M1-C) on `m1` together with this merge.** M1-P2 needs it, and the engine already implements it.
5. **Settle the open items the branch left to the integrator.** List them in the M1 gate report rather than reopening them in review:
   - Only the Nostr strategy is wired. `@trystero-p2p/torrent` would be a new dependency, which needs approval.
   - `pres` runs on Trystero's single reliable channel, not an unreliable one.
   - Ordering of one proposer's actions under loss needs the optional `prev` on `ProposeMessage`, a contract amendment.
   - The M1-C `handshakeText` and WelcomeMessage docs should say the nonce is connection-bound.
   - The shared leak test should gain the two `[M1-P1]` leak scenarios (non-owner hidden-card actions, and the relayed hello and welcome) and run on this engine instead of M1-P2's minimal sequencer.
   - For M1-P8: at seq 0 with nobody seated, a creator's and a fresh joiner's tables are indistinguishable. The session should take its chair before others join.
