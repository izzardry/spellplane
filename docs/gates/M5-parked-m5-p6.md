# M5-P6 Hardening: parked

- **Status:** parked, not merged into `m5`. The pipeline stopped after three review rounds without a clean review. The round-3 review left one blocking finding (quoted below), raised against the round-2 code (`6d045f1`). The implementer's round-3 commit (`ed66236`) targets that finding, but no review round has checked it.
- **Branch:** `m5-p6` (worktree `spellplane-wt/m5-p6`), head `ed66236 fix(m5-p6): hardening round 3 — solo stretch across a stored snapshot, version notice edges`. It has 12 commits on top of merge base `7767675`. There is no remote copy (`origin/m5-p6` does not exist). The working tree is clean.
- **Behind `m5`:** M5-P5 (Finish), M5-P3 (Offline and storage) and M5-P1 (Touch) were merged into `m5` after the branch was cut. `git merge-tree m5 m5-p6` reports conflicts in three files:
  - `docs/DECISIONS.md`: both sides append lines at the end.
  - `src/scene/table-scene.ts`: M5-P6's texture-eviction lines against M5-P1, M5-P3 and M5-P5 changes.
  - `src/ui/lobby/TableRoom.svelte`: M5-P6's version notice against M5-P3's lobby changes.
  - `tests/unit/m5-contracts.test.ts` merges cleanly.
- **Checked by the integrator at parking (13 Nov 2026), at `ed66236` in the worktree:**
  - `pnpm check` is green: tsc, svelte-check, eslint, and vitest with 2728 tests in 197 files.
  - The reviewer's scratch test still fails at `ed66236`: variant `xtrue` fails (`alone-1: expected +0 to be 1`) and `xfalse` passes. This is expected, because the test writes the save directly (snapshot inside the stretch) and so bypasses the round-3 fix, which works by keeping the stored snapshot out of the stretch. The test still shows that the engine cannot recover own actions that a stored snapshot has absorbed.
  - `pnpm e2e` was not run at parking. The branch's browser specs, `tests/e2e/hardening/version.spec.ts` and `tests/e2e/hardening/undo-reload.spec.ts`, still have to pass on Chromium and WebKit after the merge with `m5`.

## What the package was supposed to do

docs/PLAN.md, M5 package table:

> | M5-P6 Hardening | Undo edge cases, protocol version check with a clear mismatch message, long-session soak test, performance pass on texture eviction. | `core/undo.ts`, `net/version.ts`, `tests/sim/soak.test.ts` | M4 |

docs/PLAN.md, ownership: M5-P6 owns
- `core/undo.ts` and `net/version.ts`.
- `NetEngine.versionMismatch` and the mismatch notice.
- Writing `TableRecord.protocol`, and the `PROTOCOL_VERSION` bump to 2 with the tests that write `v: 1`.
- `tests/sim/soak*` and the texture-eviction pass.
- Solo actions that survive a reload after a disconnect.
- A pass-draft driver that ignores abandoned history.

docs/PLAN.md, owner decisions for M5:
- "A room records its protocol version. A peer on a different protocol version gets a clear message naming both versions and what to do (reload after the game, or wait for the table to update), never a silent failure."
- "M5-P6 makes solo actions survive a reload after a disconnect (M4 gate) and stops the pass-draft driver acting on abandoned history (M2 gate)."

The M5 acceptance tests include: "a 5,000-action soak on four simulated peers ends with equal hashes and bounded memory."

The M4 gate (`docs/gates/M4.md`, "Solo actions after a reload") describes the problem. A page that played alone after a real disconnect, and was then reloaded instead of reconnected, lost its solo actions when the room's history won.

## What the branch contains

`git diff m5...m5-p6 --stat` lists 58 files, +3418/−201. There are 21 `[M5-P6]` lines in `docs/DECISIONS.md`.

- **Version check:** `PROTOCOL_VERSION` 2 (`net/messages.ts`) and `net/version.ts`. `NetEngine.versionMismatch` and `src/ui/version/VersionNotice.svelte` name the other player, both versions and what to do. The table record stores the highest protocol version the room was played with. A solo save that a newer version wrote shows the notice too. One change falls outside the package's files: `Message.v` in `net/transport.ts`, an M0-C contract file, becomes a number as part of the version bump (recorded in DECISIONS).
- **Undo edge cases** (`core/undo.ts`):
  - Undo is refused, with the reason, when another player has already built on the action.
  - Undo works after a reload, rebuilt from the stored log since the snapshot.
  - Mulligan draws are owed across a settling shuffle.
  - Refused networked steps are handled.
- **Soak:** `tests/sim/soak.test.ts` and `tests/sim/soak/harness.ts`. Four engines run 5,000 actions with delay, drop, reordering and a kill/revive.
- **Texture eviction:** `TextureLru` in `scene/textures.ts` keeps textures in draw order, so eviction takes constant time.
- **Pass draft:** `draft/pass.ts` keeps every handed-on pack copy while a draft runs and recovers from abandoned history (`tests/sim/net/pass-fork.test.ts`).
- **Solo actions after a reload** (`net/engine.ts`, `session/persist.ts`, `session/net.ts`, `tests/sim/net/solo-reload.test.ts`):
  - On start, the engine marks the stored tail's own actions (`ownOfTail`) as its own again, so it proposes again those that the room's history abandons.
  - Round 3 added `holdSnapshot`/`aloneInRoom`: the networked save skips its every-200 snapshot while no other peer is connected, up to `SNAPSHOT_HOLD_LIMIT` = 600 actions.
  - Round 3 also made an engine started from a stored tail treat its restored snapshot as unverified, so a fork right after the snapshot is found there and not later as a "reducer bug" hash mismatch.
- **Leak test:** new scenarios in `tests/sim/flow/leak.test.ts` and `tests/sim/session/leak.test.ts`.

## Open review finding (round 3, against `6d045f1`)

**Blocking.** `src/net/engine.ts:317` (round-2 numbering; the same loop is at line 337 in `ed66236`). Design references: PLAN Milestone 5 owner decisions, "M5-P6 makes solo actions survive a reload after a disconnect (M4 gate)"; `docs/gates/M4.md` "Solo actions after a reload"; DESIGN "Multiplayer architecture" (no acknowledged action is lost).

> Solo actions still get lost after a reload when the stored snapshot falls inside the solo stretch. The engine only marks the stored tail after the snapshot as its own (`for (const a of opts.start.tail) ... noteOwn`). Solo actions sequenced before the stored snapshot are baked into the snapshot state and cannot be proposed again. `session/persist.ts:89` moves the record's snapshot forward at every `seq % SNAPSHOT_EVERY === 0` (200), so this happens whenever a solo stretch crosses a multiple of 200. That is likely in real play: about L/200 for a stretch of L actions.
>
> Reproduced with a scratch test, which copies `tests/sim/net/solo-reload.test.ts` but builds the save as persist leaves it when the snapshot lands right after `alone-1`. The reloaded page reports "history diverged at seq 35", although the real fork is at 31 (the sequencerClaim). It sits at the same seq with a different hash and never converges until more actions trigger the hash check. It then logs the misleading "State hash mismatch at seq 50 (a reducer bug): resyncing from the sequencer's snapshot". After the resync, `alone-1` is missing from the room's history: the seat's life is 10 instead of 8. The same test passes when the snapshot is before the stretch. Base `m5` fails the stretch-inside-snapshot case the same way, so the existing test only covers the easy half of the requirement.
>
> Scratch test: `/private/tmp/claude-501/-Users-holzschneider-Workspace-spellplane/2e63b412-9733-428d-b047-164292c08ec6/scratchpad/rev-m5p6-r3/snapreload.scratch.test.ts`, with config `vitest.scratch.config.mts` in the same folder. Run it from the worktree with `npx vitest run --config <that config>`. Variant `xtrue` fails and `xfalse` passes. The scratchpad is session-local and may be gone; the test is easy to rebuild from `crossing(…, false)` in `tests/sim/net/solo-reload.test.ts`.

Suggested fix (reviewer):
- **(a)** Give the engine the own actions from the stored log before the snapshot as well, in a bounded window (for example, since the last seq this page saw sequenced by another peer). Make them lost-own candidates when a fork lies below the replica's start or a snapshot is adopted. `requeueLost` already drops cids the adopted history holds, and the sequencer nacks duplicates.
- **(b)** Keep the stored snapshot below a stretch this page sequenced alone. Also detect the fork at the replica's start, and add the snapshot-inside-stretch case to the test.

## State of the finding after round 3 (not reviewed)

`ed66236` takes route (b) and its second half:
- The hold keeps the snapshot below the stretch.
- The fork right after a restored snapshot is found at once ("diverged at or before seq"), with no hash-mismatch message.
- `solo-reload.test.ts` now covers both halves:
  - With the hold, every solo action reaches the room, for both the follower and the sequencer page.
  - Without the hold, the fork is found at the snapshot, and the actions after the snapshot still reach the room.

Gaps that still need a review:
1. **Own actions inside a snapshot are still dropped.** That test only asserts the actions after the snapshot; those inside it are still lost. Route (b) leaves this case open whenever the snapshot still ends up inside a stretch:
   - a stretch longer than `SNAPSHOT_HOLD_LIMIT` (600);
   - a forced rebase, after a failed write, a catch-up from a snapshot, or several actions applied in one step (`persist.ts` `forced`/`broken`);
   - a save made before the page noticed the cut-off. `aloneInRoom` is true only once every peer's status has left `connected`, so the actions sequenced between the real cut and the heartbeat timeout may not hold the snapshot (not verified at parking).
2. **Is losing them acceptable?** It is a judgement call against "no acknowledged action is lost". It needs a review verdict, or an explicit owner decision in DECISIONS.
3. **Unreviewed changes:** `ownOfTail` (seat-holder tracking), the solo-session version notice, and the `versionMismatch` stability change were also new in round 3.

## What a retry should do first

1. **Merge `m5` into `m5-p6`.**
   - Resolve the three conflicts: append both sides in DECISIONS; in `table-scene.ts` and `TableRoom.svelte`, keep the merged packages' lines and add only M5-P6's own lines.
   - Rerun `pnpm check`, then `pnpm e2e`, including `tests/e2e/hardening/*`.
2. **Close the snapshot-inside-stretch case with route (a), on top of the hold.**
   - Hand the engine the stored log's own actions from a bounded window before the snapshot (since the last seq another peer sequenced, at most the rewind window).
   - Make them lost-own candidates when the fork lies at or below the replica's start or a snapshot is adopted.
   - Turn the reviewer's scratch case (save built with the snapshot right after `alone-1`) into a test in `tests/sim/net/solo-reload.test.ts`. It must assert that every solo action, before and after the snapshot, is sequenced exactly once and that life ends at `20 - alone.length`.
3. **Add a test for the window before `aloneInRoom` turns true:** a cut whose first solo actions are sequenced while peers still show as `connected`.
4. **Run one fresh review round** on the result, including the round-3 changes listed above, before merging into `m5`.
