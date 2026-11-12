# M1-P2 Secrecy: parked (retry)

> **Resolved:** merged into `m1` (`e5f0476`) in the second retry after one focused review of the seatLeave fix. See `docs/gates/M1.md`.

- **Status:** parked again, not merged into `m1`. The retry pipeline did not converge after 2 review rounds (overall rounds 4 and 5; the first run's rounds 1 to 3 parked it once already, see the history at the end).
- **Branch:** `m1-p2` (worktree `spellplane-wt/m1-p2`), head `4253d05 fix(m1-p2): only a seat itself, or anyone once it is away, empties its chair`. It contains all of `m1` up to `54e4eae` (the M1-C retry amendment) and `git merge-tree` against `m1` reports no conflicts. The branch has no remote copy (`origin/m1-p2` does not exist).
- **State of the branch (11 Nov 2026, at parking, checked by the integrator):**
  - `pnpm check` is green in the worktree: tsc, svelte-check, eslint, 1117 vitest tests in 67 files.
  - `pnpm e2e` is green: 319 passed, 9 skipped, Chromium and WebKit.
  - The diff against `m1` touches 27 files, +5008/−78. It no longer touches any contract file: M1-C landed `Reissue`/`ReissueRecord` and `NetEngine.pending()` on `m1` (`54e4eae`).
  - Files outside the package's list are touched for wiring: `src/core/reducer/index.ts`, `draft.ts`, `restore.ts`, `src/core/undo.ts`, `src/session/solo.ts`, and tests under `tests/unit/core` and `tests/unit/stack`. The DECISIONS line `[M1-P2 retry] Files outside the package's list …` asks the integrator to accept them.

## What the package was supposed to do

docs/PLAN.md, M1 package table:

> | M1-P2 Secrecy | Deck commitments, reveal and verification, shuffle protocol with owner commitment and peer nonces, private looks (scry, search, peek), targeted reveal on the pair channel, face-down cards, dice and coins by commit-and-reveal, audit records. | `core/commit.ts`, `core/rng.ts`, `core/secrets.ts`, `net/private.ts` | M1-C |

docs/PLAN.md, M1 acceptance tests:

> **M1-P2.** A revealed card that does not match its commitment is flagged on every peer. The shuffle order cannot be reproduced from public messages alone, and can be reproduced from public messages plus the owner's nonce. The owner cannot change its nonce after peers' nonces arrive (test attempts it and expects rejection). **Leak test:** after a scripted game, no message received by peer B and no field in B's state or stores contains the card id of any card that stayed in A's hand or library.

Ownership (PLAN, M1-C note): M1-P2 owns `net/private.ts` and the commit-window deadlines in `core/rng.ts`. DECISIONS also handed it the M0-P1 restore-identity check, the M0-G opaque-id re-issue, and the M1-C stubs `expectedParticipants`, `commitWindowDeadlines`, `receiveIdentity`, `pruneReceived` and `secretTokens`.

## What the branch contains

- **Reducer, `src/core/reducer/secret.ts`:** `shuffleCommit`/`shuffleNonce`/`shuffleDone`, `rngCommit`/`rngReveal`, `commitClose` (refused from the round's own owner or initiator), `sealCompleteRounds`, the zone freeze `checkFrozenZones`, `checkRoundParticipants`, `checkSeatLeave`, reveal verification (mismatch marks the card `suspect`), id re-issue on `shuffleDone` and `reorder`.
- **Owner side, `src/core/secrets.ts`:** `commitDeck`, `beginShuffle`, `finishShuffle`, `reissueZone`, `privateReorder`, `revealedCard`, `disclosedBy`, `lookAnswer`, the post-game audit `auditSeat`.
- **Pair channel, `src/net/private.ts`:** targeted reveals, looks bound to their sequenced `lookAt`, refusal of a zone look while a pending own action may change the zone (uses `NetEngine.pending()`), expiry of waiting requests, pruning of received identities.
- **Undo, `src/core/undo.ts`:** `undoPlan`; a restore never puts an identity on a non-token card, the card comes back face down and its owner re-reveals it verified. An undo's inverse must carry the sender's `by`.
- **Tests:** the shared leak scanner (`tests/leak/`), a scripted leak game on a minimal sequencer (`tests/sim/secrecy/leak.test.ts`), acceptance tests (`tests/sim/secrecy/acceptance.test.ts`), unit tests in `tests/unit/secrecy/`, including every review probe from rounds 3 to 5 as regression tests (`review-probes.test.ts`, `participants.test.ts`).
- **Docs:** the `[M1-P2]` and `[M1-P2 retry]` lines in `docs/DECISIONS.md`. They live only on the branch.

## What fails and why

Nothing fails in the test suites. The package is parked because the review never came back clean: every round so far found a new way for one browser to decide a shuffle order or a die result, each a sibling of the last.

- **Round 4** found that the owner (the 1v1 sequencer) could mark the peer `away` before or after committing, so the round waited for nobody. Fixed in `d8ebbcd`: `away` seats are still waited for, and `checkRoundParticipants` refuses a step by a round's owner that stops it waiting for a seat that has not contributed. Round 5 reviewed this.
- **Round 5** found the `seatLeave` sibling (below). The fix, `4253d05`, landed after the last review round, so the pipeline had no round left to check it. It is **unreviewed**.

The integrator checked `4253d05` against the finding only, not as a review:

- It implements the reviewer's suggested fix as written: `checkSeatLeave` in `secret.ts`, called from the step in `src/core/reducer/index.ts:162`, refuses a `seatLeave` whose `seat` is not the sender's `by` unless that seat is `away`.
- The reviewer's scratch probe (`p.test.ts`, run from the worktree with the reviewer's vitest config) now fails at the `seatLeave` step in all three cases (1v1 shuffle, ffa3 non-sequencer owner, dice), with "s0 cannot empty s1's chair; only a seat marked away can be cleared by another seat". That is the expected outcome: the exploit is refused.
- Regression tests for the three cases are in `tests/unit/secrecy/participants.test.ts`, and the DECISIONS lines were corrected (the round-4 line now points to the round-5 line and no longer claims the owner can shut the peer out "neither before nor after committing" without qualification).
- Still open by design, recorded in the round-5 DECISIONS line: the sequencer can mark a peer `away` and then empty its chair before committing. That is the sequencer-forgery class (actions are unsigned, DESIGN Handshake), which the design does not cover; the log shows both steps.

## Open review finding (round 5, blocking)

The reviewer's text, as handed to the integrator:

### `src/core/reducer/secret.ts:358`: an owner or initiator can still empty the peers' chairs before committing

- **Design reference:** DESIGN "Multiplayer architecture", Hidden information 3: "The owner cannot choose the order"; "Dice and coin flips use the same commit-then-reveal exchange, so no single browser picks the result"; "Specification: network protocol and secrecy", Secret shuffle 3: "the owner could not choose it, having committed first".
- **Issue:** The round-3 finding 2 still has a sibling. An owner or initiator can still choose the shuffle order or a die result: before it commits, it empties the peers' chairs. `checkRoundParticipants` only blocks a `seatLeave` while a round is already open and still waiting. `seatLeave` has no check on who sends it, and the reducer, the sequencer family table ('players') and local-session all accept it. The steps:
  1. 1v1, stage match. s0 grinds an owner nonce offline that puts the card it wants on top. s0 sends `seatLeave {seat:'s1'}`, then `shuffleCommit`. `expectedParticipants` is [] and the round is sealed at once. s0 sends `shuffleDone`, and s1 sits back down with `seatTake`, its peer and commitment kept. s0 draws the card it chose, and s1 keeps playing.
  2. ffa3: the non-sequencer owner s2 proposes `seatLeave` for s0 and for s1, both ordinary proposals that an honest structure-only sequencer sequences. It then commits and finishes a shuffle alone, and both seats re-sit.
  3. Dice: s0 sends `seatLeave s1`, then `rngCommit` and `rngReveal`, and gets a result from its nonce alone.

  The package's own DECISIONS line ([M1-P2 retry]) and the comment on secret.ts lines 17-19 said the owner can no longer shut the peer out "before or after committing". That holds for `away`, not for `seatLeave`. Case 2 needs no sequencer powers, so the accepted "a sequencer can forge actions" limit does not cover it.
- **Suggested fix:** Add a check in secret.ts's step hook, next to `checkRoundParticipants`, so it stays inside M1-P2's files and needs no contract change. Refuse a `seatLeave` whose `seat` differs from the sender's `by` unless that seat is `away`. That leaves the seat itself free to leave, and leaves M1-P7's way of clearing a gone player through the sequencer's away mark. With this check, emptying a peer's chair needs the sequencer's `away`, which narrows the hole to the sequencer-forgery class already listed as uncovered. Add regression tests for the 1v1 shuffle, the ffa3 non-sequencer owner and the dice cases, and correct the DECISIONS line.
- **Response on the branch (`4253d05`, unreviewed):** done as suggested, see "What fails and why".

## What a retry should do first

1. **Do not start a fresh full review.** Five rounds have each found a sibling of the previous hole; a broad review will likely find another. Run one focused review of `d8ebbcd` and `4253d05` only, scoped to one question: can any seat other than the sequencer make a shuffle or a randomness round depend on fewer peers than are seated, before or after the commit? Enumerate every action that changes `seats` or `expectedParticipants` (`seatLeave`, `seatTake`, `away`, `commitClose`, `ready`, `recover` once M1-P7 lands, undo of any of these) and check each one against `checkSeatLeave` and `checkRoundParticipants`.
2. **Make the integrator, not the reviewer, decide the accepted residual risks**, and record them in the M1 gate report rather than reopening them in review:
   - The sequencer can forge unsigned actions, and in particular can mark a peer `away` and clear its chair before committing (DESIGN Handshake: actions are unsigned).
   - A seat that sits down while a shuffle is open joins it and may send the last nonce (DECISIONS `[M1-P2 retry] Not changed: …`).
   - A re-issue is tied back to the deck commitment only by the post-game `auditSeat`.
   - Opponent-started zone looks need a standing owner permission (`allowZoneLook`).
   - A randomness round has no reveal timeout, and a sequencer owner's round with an absent peer waits until the peer returns or M1-P7's recovery runs.
   - The leak test runs on a minimal sequencer (`tests/leak/minitable.ts`), not M1-P1's engine.
3. **If the focused review is clean, merge `m1-p2` into `m1`** (clean merge today), accept the wiring files outside the package list, then run `pnpm check` and `pnpm e2e` on `m1`.
4. **Hand the client-side duties to M1-P8**, which depends on this package (DECISIONS `[M1-P2 retry] Hand-overs for M1-P8` and the round-4 line):
   - Call `undoPlan` and send the re-reveals; call `reissueZone` after a return to the hand; keep the `disclosed` set and rebuild it from the log on reload.
   - Keep one `shuffleNonce` per sid and the pending rng nonce in local storage, reuse them on every re-propose after a nack, and compare a sequenced own payload against the pending copy.
   - Contribute to every round still waiting for the own seat on return, driven by state, not only on seeing the commit.
   - Answer looks from `engine.confirmedState()` with `engine.pending()`.

## History

- **First park (rounds 1 to 3, commit `b84adfc`):** three blocking findings (an undo restore made an identity public unverified; a sequencer owner could choose the shuffle order after seeing the peer nonce by recommitting or changing the zone's ids; a look was answered from the order after an unsequenced private reorder), plus contract edits outside a contracts package. The retry plan landed the contract amendment first (`54e4eae`), then `8b4b89d` turned the round-3 probes into regression tests and took `pending()` from `NetEngine`. The only finding handed to this integrator is the round-5 one above; whether rounds 4 and 5 re-checked the three round-3 fixes is not recorded in the hand-over, so the focused review in step 1 should rerun `tests/unit/secrecy/review-probes.test.ts` too.
