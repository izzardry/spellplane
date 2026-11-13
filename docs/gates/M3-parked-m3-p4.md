# M3-P4 Dictation and captions: parked

> **Update (M3 gate fix round):** merged into `m3` (`merge(m3): M3-P4 Dictation and captions`). The six conflicts were resolved as step 1 below describes; `pnpm check` and the captions browser specs pass on the merged branch. Step 3 (a review round on `7bcb393` plus the merge) and step 4 (measuring FINAL_GRACE_MS from the owed transcription) have not run. See DECISIONS `[M3-G]`.

- **Status:** parked, not merged into `m3`. The pipeline stopped after three review rounds without a clean review. The last review (of the round-2 code) left one blocking finding, quoted below. The implementer's round-3 commit targets exactly that finding, but no review round checked that commit.
- **Branch:** `m3-p4` (worktree `spellplane-wt/m3-p4`), head `7bcb393 fix(m3-p4): review round 3 — quick presses keep owed finals, seat glyph on captions, unavailable engine statement`. Four commits on top of `f36ef9a feat(m3-c): contracts`. The branch has no remote copy (`origin/m3-p4` does not exist). The working tree is clean.
- **Behind `m3`:** M3-P1, M3-P5, M3-P3 and M3-P2 were merged into `m3` after the branch was cut. `git merge-tree m3 m3-p4` reports conflicts in six files: `docs/DECISIONS.md`, `src/main.ts`, `src/scene/table-scene.ts`, `src/session/net.ts`, `src/ui/Hud.svelte` and `tests/unit/core/m3-contracts.test.ts`. Most of them come from M3-P3 (Voice), which also mounts in `openNetSession` and wires the talk key in the HUD.
- **Checked by the integrator at parking (12 Nov 2026):**
  - `pnpm check` is green in the worktree at `7bcb393`: tsc, svelte-check, eslint and vitest with 1844 tests in 129 files.
  - The speech tests and the captions leak scenario pass on their own (83 tests in 4 files), including the reviewer's reproduction, which round 3 added as a unit test.
  - `pnpm e2e` was not run at parking. The branch's browser specs, `tests/e2e/captions/captions.spec.ts`, still have to pass on Chromium and WebKit after the merge with `m3`.

## What the package was supposed to do

docs/PLAN.md, M3 package table:

> | M3-P4 Dictation and captions | Web Speech engine, optional transformers.js engine loaded on demand, engine and language settings with a plain statement of where audio goes, interim and final captions anchored to the last-touched card or the avatar, caption stored on the action in the log, dictation into note fields. | `voice/speech/*`, `scene/captions.ts`, `ui/settings/Speech.svelte` | M3-C |

docs/PLAN.md, M3 acceptance tests:

> **M3-P4 (fake engine).** A final transcript produces a caption anchored to the last-touched card on every page and a log entry attached to that action; with no card context the caption sits at the avatar; the local-model engine is not downloaded unless chosen.

docs/PLAN.md, ownership: M3-P4 owns
- `voice/speech/*` and `voice/captions.ts`;
- `scene/captions.ts`, plus its call in the table scene's `update`;
- `ui/settings/Speech.svelte`;
- the speech part of the debug hook.

It may add the transformers.js dependency, loaded only by dynamic import. The design source is DESIGN "Chat and voice", Dictation and captions (Engine, Talk modes, Record).

## What the branch contains

`git diff m3...m3-p4 --stat`: 23 files, +4829/−34. One contract-adjacent file is touched: `tests/unit/core/m3-contracts.test.ts` (4 lines). No contract source file is changed. Round 1 reverted an earlier contract edit.

- **Engines:**
  - `src/voice/speech/webspeech.ts`: Web Speech, with restarts and backoff.
  - `src/voice/speech/local.ts`: on-device Whisper base through transformers.js 3.8.1. It is dynamic-imported from jsDelivr, not added as an npm dependency (see DECISIONS). It has its own microphone capture with a downsampler, segment endpointing and interim passes.
  - `src/voice/speech/index.ts`: the factories, which state where audio goes.
- **Controller:** `src/voice/captions.ts`. It holds listening runs per talk-key press, utterances, the anchor and `about` taken from the log or the hover, `caption` actions (split at 500 characters), interim captions over presence, peer captions read from the log, and dictation into note fields.
- **Session and scene:**
  - `src/session/captions.ts` and a mount line in `src/session/net.ts` and `src/main.ts`.
  - `src/scene/captions.ts`: DOM bubbles over the canvas, with the seat glyph, the seat colour and fading. Its call sits in `src/scene/table-scene.ts`.
- **UI:**
  - `src/ui/settings/Speech.svelte` and `captions.ts`: engine and language, the statement of where audio goes, and a confirmation that states the model size before the download.
  - The Dictation row and note-field dictation in `src/ui/Hud.svelte`.
- **Debug:** the `speech` part, in `src/debug/speech.ts`.
- **Tests:**
  - Unit: `tests/unit/speech/{captions,engines,placement}.test.ts`.
  - Leak: `tests/sim/session/captions-leak.test.ts`, the shared leak scenario for anchors on hidden cards.
  - Browser: `tests/e2e/captions/captions.spec.ts`.
- **Decisions:** 31 `[M3-P4]` lines in `docs/DECISIONS.md`. They include the model choice (Whisper base, about 80 MB on WASM, about 5 % WER on LibriSpeech clean per OpenAI, to be confirmed at the M3 gate) and the decision to keep transformers.js off npm.

## Open review finding (round 3, against the round-2 code)

**Blocking.** `src/voice/captions.ts:382` (round-2 numbering). Design reference: DESIGN "Chat and voice" > Dictation and captions > Record; Talk modes (Dictation: while the talk key is held).

> A short push-to-talk phrase is silently lost with the on-device engine. When the talk key is released, the local engine transcribes the segment asynchronously, which takes hundreds of ms to seconds on WASM. If the player presses the key again before that final arrives, startListening increments `this.run` (line 382), and the run guard (`if (run === this.run) this.onText(...)`, line 388) drops the previous press's final. The fallback at line 381 only helps when interim words exist, and the local engine sends no interim for a phrase under INTERIM_MS (1 s). The phrase then never becomes a caption or a log entry. This breaks DESIGN "Chat and voice", Record: "The final transcript is stored in the log attached to that action". The design's own talk model is quick successive pushes of the key. Reproduced with the real LocalWhisperEngine (FakeCapture, fake transformers, an 800 ms pipeline) and the TestTable host: tap a00, OPEN, 0.6 s of speech, close, wait 200 ms, OPEN again, wait 5 s. Result: `captionsSent()` is `[]` where `['attack with both']` was expected.
>
> Suggested fix: do not let a new press throw away finals still owed by the previous one. Keep a pending utterance for a run that stopped less than FINAL_GRACE_MS ago, with its anchor and `about` captured at its first words or at the release. Route a final carrying the previous run number to it. Keep `utter` state per run. Add a unit test for press, short phrase, release, re-press, late final.

**What round 3 did about it (`7bcb393`, unreviewed):**
- `ListenRun` gives each press its own run. A run stays in `this.runs` for FINAL_GRACE_MS (3 s) after its stop, and `onText(run, …)` routes engine output to that run's own utterance, so a new press no longer drops the old run's final.
- A final that has no interim words is placed at the context captured at the release (`run.context`).
- The local engine already sends a segment's final to the listener of the `start` call that recorded it (the `Listening` object is captured in `finish`).
- Web Speech now leaves a stopping session to deliver its final on the next start. It aborts that session only where the browser refuses a second recognition.
- Round 3 added two unit tests to `tests/unit/speech/captions.test.ts`. The first uses a fake engine whose final arrives after the re-press. The second is the reviewer's exact scenario with the real `LocalWhisperEngine` and an 800 ms pipeline. Both pass.

The finding therefore looks addressed, but a reviewer has not confirmed it. Two risks remain:
- A final that arrives more than 3 s after its release is still dropped. On slow WASM machines this can happen with long phrases, because transcriptions queue behind each other in `busy`.
- Round 3 also changed how captions are placed and how presence switches between two runs, and no review covered those changes.

## What a retry should do first

1. Merge `m3` into `m3-p4` in the worktree and resolve the six conflicts:
   - In `src/session/net.ts` / `src/main.ts`, mount voice before captions (DECISIONS: "the integrator should mount voice before captions in openNetSession").
   - In `Hud.svelte`, keep M3-P3's talk-key wiring and add the Dictation row and note-field dictation on top of it.
   - Then check that dictation follows the merged `session.voice` and not the stored-talk-mode fallback.
2. Run `pnpm check`, then `pnpm e2e` (Chromium and WebKit) on the merged branch.
3. Run one review round on `7bcb393` plus the merge. Ask the reviewer to verify first that the open finding is fixed. Their reproduction is already a unit test ("with the on-device engine, a short phrase transcribed after the release survives the next press").
4. Decide whether FINAL_GRACE_MS should be measured from the end of the transcription the run owes, not from the key release, so a slow on-device transcription cannot drop a final. If so, the local engine could signal "final pending" for each run.
5. Report these items to the M3 gate:
   - the transformers.js-from-CDN trade-off;
   - the model's size and accuracy;
   - the Firefox capture fallback;
   - the requested `ui/describe.ts` change, which would render a caption's log line as "Anna casts Shock: '…'".
