# M1-P2 Secrecy: parked

- **Status:** parked, not merged into `m1`. The pipeline ran out of rounds: it did not converge after 3 review rounds.
- **Branch:** `m1-p2` (worktree `spellplane-wt/m1-p2`), head `3fe13a2 fix(m1-p2): secrecy review round 3`. It is 2 commits behind `m1` (`7b61414`, `9a6e25d`, the JWK identity-key fix) and `git merge-tree` reports no conflicts.
- **State of the branch (11 Nov 2026, at parking):** `pnpm check` is green in the worktree, with tsc, svelte-check, eslint and 1075 vitest tests in 65 files. `pnpm e2e` was not run for this note. The diff against `m1` touches 27 files, +4458/−77.

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P2 Secrecy | Deck commitments, reveal and verification, shuffle protocol with owner commitment and peer nonces, private looks (scry, search, peek), targeted reveal on the pair channel, face-down cards, dice and coins by commit-and-reveal, audit records. | `core/commit.ts`, `core/rng.ts`, `core/secrets.ts`, `net/private.ts` | M1-C |

docs/PLAN.md, M1 acceptance tests:

> **M1-P2.** A revealed card that does not match its commitment is flagged on every peer. The shuffle order cannot be reproduced from public messages alone, and can be reproduced from public messages plus the owner's nonce. The owner cannot change its nonce after peers' nonces arrive (test attempts it and expects rejection). **Leak test:** after a scripted game, no message received by peer B and no field in B's state or stores contains the card id of any card that stayed in A's hand or library.

Ownership (PLAN, M1-C note): M1-P2 owns `net/private.ts` and the commit-window deadlines in `core/rng.ts`. DECISIONS also gave it these items:
- [M0-P1]: checking an identity that a restore patch puts back against the commitment.
- [M0-G]: re-issuing opaque ids when a card returns to a hidden zone.
- [M1-C]: the stubs `expectedParticipants`, `commitWindowDeadlines`, `receiveIdentity`, `pruneReceived` and `secretTokens`.

## What the branch contains

- **Reducer, `src/core/reducer/secret.ts`:**
  - `shuffleCommit`, `shuffleNonce` and `shuffleDone`, plus `rngCommit` and `rngReveal`.
  - `commitClose`, which is refused when the round's own owner or initiator sends it.
  - `sealCompleteRounds`, and the zone freeze `checkFrozenZones`.
  - Reveal verification, which marks a mismatched card `suspect` and does not refuse it.
  - Id re-issue (`Reissue`) on `shuffleDone` and `reorder`.
- **Owner side, `src/core/secrets.ts`:** pure helpers `commitDeck`, `beginShuffle`, `finishShuffle`, `reissueZone`, `privateReorder`, `revealedCard`, `disclosedBy`, `lookAnswer` and the post-game audit `auditSeat`.
- **Pair channel, `src/net/private.ts`:** targeted reveals, private looks bound to their sequenced `lookAt`, expiry of waiting requests, and pruning of received identities.
- **Undo, `src/core/undo.ts`:** `undoPlan`. A card whose identity an undo would restore comes back face down, and its owner then sends a verified re-reveal.
- **Tests:**
  - The shared leak scanner (`tests/leak/`) and a scripted leak game on a minimal sequencer over `LoopbackNetwork` (`tests/sim/secrecy/leak.test.ts`).
  - Acceptance tests (`tests/sim/secrecy/acceptance.test.ts`).
  - Unit tests in `tests/unit/secrecy/`.
- **Docs:** 20 DECISIONS lines tagged `[M1-P2]`. They live only on the branch.

## Why it is parked

1. **The review did not converge.** Each review round found new blocking holes in the secrecy model. Round 3 found the three findings below. Commit `3fe13a2` attempts a fix for each of them, but the pipeline had no round left to review those fixes, so none of them is verified.
2. **Contract files were edited outside a contracts package.** This breaks a CLAUDE.md hard rule. The branch changes:
   - `src/core/actions.ts`: `Reissue`, and the optional `reissue` on `ShuffleDoneAction` and `ReorderAction`.
   - `src/core/types.ts`: `ReissueRecord`, and the optional `reissue` on `ShuffleRecord` and `ReorderRecord`.

   The package's own DECISIONS line says these "need landing on m1 as an M1-C amendment before this package merges". That has not happened.
3. **Another amendment is still open.** The look-binding fix needs `pending(): readonly Action[]` on `NetEngine` (`src/net/types.ts`; `SyncEngine` already has it). Until it exists, `net/private.ts` refuses every zone look: it fails closed. Peeks of a face-down card still work. The package also asks, as an open option, for a contract change that passes the state to the answerer.

## Open review findings (round 3, all blocking)

The text below is the reviewer's as handed to the integrator. The third finding was cut off in the hand-over. Under **Round-3 response** I note what `3fe13a2` claims to do about each one. That response has not been reviewed.

### 1. `src/core/reducer/restore.ts:74`: an undo restore patch makes a card identity public unverified

- **Design reference:** DESIGN "Specification: network protocol and secrecy", Commitments ("every peer recomputes the hash and, on mismatch, logs a table-wide integrity warning and keeps the card marked suspect"). Also "Multiplayer architecture", Hidden information 2, and DECISIONS [M0-P1] restore patch: "checking it against the commitment is M1-P2's, as for reveals".
- **Issue:** An undo's restore patch could set `identity` on any card in a public zone. Neither `secret.ts` nor `applyUndo` (`src/core/reducer/index.ts:120-127`) verified that identity or marked the card suspect. The reviewer's probe on `readySecretTable`:
  1. s0 moves a library card to `battlefield:s0`. It lands face down with no identity.
  2. s1 sends `undo {of:'zzz', inverse:{type:'tap', card:id, tapped:false, restore:{cards:{[id]:{identity:{expect:null, put:{sid:'black-lotus'}}}}}}}`.
  3. s0 sends a plain `flip {face:'up'}`.

  Result: the card shows as `black-lotus` and no peer marks it suspect. This defeats the first acceptance test.
- **Suggested fix:** Refuse a restore step that puts a non-null `identity`, or mark the card suspect when it applies. Add tests for the undo path.
- **Round-3 response:** `restore.ts` now refuses a restore identity on any non-token card. `undoPlan` returns `reveals`, the undo brings such cards back face down, and the owner re-reveals with ref and salt. `solo.ts` does this, and M1-P8 must do the same. New tests are in `tests/unit/core/undo.test.ts`, `tests/unit/secrecy/reducer.test.ts` and `tests/unit/session/acceptance.test.ts`.

### 2. `src/core/reducer/secret.ts:160`: a sequencer owner can choose the shuffle order after seeing the peer nonce

- **Design reference:** DESIGN "Secret shuffle" 3 and "Multiplayer architecture", Hidden information 3 ("The owner cannot choose the order"). Also Sequencing 2-3, and PLAN: "The owner cannot change its nonce after peers' nonces arrive".
- **Issue:** In 1v1, seat 0 is the sequencer. It receives B's `shuffleNonce` proposal before it sequences it. The round counted as seed-fixed only from the first *sequenced* nonce, which left the owner two ways to choose the order:
  - (a) Commit a new round, which dropped the open one, and retry until it gets an order it likes.
  - (b) Change the zone's id set, through `draw` or `toZone` into the library, before sequencing B's nonce. With 0 to 3 hand cards added, the probe got four different top cards.
- **Suggested fix:** Freeze the zone and make the round irreplaceable from `shuffleCommit` on. Update the DECISIONS line, and add tests that refuse a draw, a `toZone` or a new `shuffleCommit` between the commit and the first nonce.
- **Round-3 response:** `isOpen(r) = r.orderHash === null`. A zone with an open round refuses a new `shuffleCommit`, and `checkFrozenZones` applies from the commit on. The DECISIONS line was rewritten, and new tests are in `tests/unit/secrecy/reducer.test.ts`. One consequence is not covered by any test: an owner that lost its nonce mid-round can leave the zone only through M1-P7's recovery flow. A sequencer owner whose peer is silent depends on M1-P7 `away`.

### 3. `src/net/private.ts:216`: a look is answered from the order after an unsequenced private reorder

- **Issue:** Suppose the owner has a private reorder (scry) that is not sequenced yet. Another seat's look at that zone is then answered from the order after the reorder, not from the order at the `lookAt`. The cause is that `settled()` compares only public ids and order hashes, and a plain `reorder` changes neither. The reviewer's probe:
  1. s0's x1 is on top, and s0 scries it to the bottom. The store is updated, but the `reorder` is still pending.
  2. s1's `lookAt library:s0 count 1` is sequenced first.
  3. s1 receives x2, a card that was second at the logged look.

  The audit cannot catch this. It breaks DESIGN "Multiplayer architecture", Hidden information 4, and the package's own decision line. Hidden information leaves the owner's browser outside the design's reveal paths. (The finding's text ends here in the hand-over.)
- **Round-3 response:** The pair channel refuses a zone look while the owner has a pending own action that may change that zone (`touches()`: reorder, shuffleCommit or shuffleDone of it, draw, move or toZone in or out, mulligan, ready, any undo). It needs `pending()` from the host and fails closed without it. `lookAnswer` also answers another seat's zone look only with `{allowZoneLook: true}`, because the design has no look at a hidden zone that an opponent starts. New tests are in `tests/unit/secrecy/private.test.ts`.

## What a retry should do first

1. **Land the contract amendments on `m1` as an M1-C amendment, before any further package work.** These are `Reissue` and `reissue?` in `core/actions.ts`, `ReissueRecord` and `reissue?` in `core/types.ts`, and `NetEngine.pending()` in `net/types.ts`, which M1-P1 implements. Decide too whether the answerer gets the state passed in, so the channel no longer relies on `confirmedState()`. With these in place the package diff no longer touches contract files, and zone looks stop failing closed.
2. **Merge `m1` into `m1-p2`.** It is clean, 2 commits. Then run `pnpm check` and `pnpm e2e`.
3. **Run one focused review of `3fe13a2` against the three findings above, and turn each reviewer probe into a regression test.** Rerun the scratch probes verbatim: the forged undo by s1, the shuffle-commit replacement and the id-set change before the first nonce, and the pending scry before a sequenced `lookAt`. Prefer that review over a fresh full review, which so far has produced new findings every round. Do not widen scope.
4. **Settle the design questions the branch left to the integrator.** List them in the M1 gate report rather than reopening them in review:
   - The re-issue residual risk: a re-issue is tied back to the deck commitment only by the post-game `auditSeat`.
   - Opponent-started zone looks need a standing owner permission (`allowZoneLook`).
   - A randomness round has no reveal timeout ("roll abandoned by sN").
   - The leak test runs on a minimal sequencer (`tests/leak/minitable.ts`), not M1-P1's engine.
5. **Note the downstream work this package hands to M1-P8, which depends on M1-P2:**
   - Call `undoPlan` and send the re-reveals.
   - Call `reissueZone` after a return to the hand.
   - Keep the `disclosed` set and rebuild it from the log on reload.
   - Keep a pending rng nonce in local storage.
   - Answer looks from `engine.confirmedState()`.

   M1-P8 cannot finish until M1-P2 is merged.
