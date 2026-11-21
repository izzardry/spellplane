# Gate M8-G, verifier run (21 Nov 2026)

> **Latest:** Round 2 (23:04 to 23:40, on `c2e34bc`) is the last section of this file. Result: red (W1 WebKit down, CI red with N1, N2 and R3, a flaky gate M0 spec, H1).

## Final verifier run, after the fix round (21 Nov 2026, 19:57 to 20:45)

- **Result: red.** Every gate is green in Chromium, but WebKit could not run, two full-e2e tests fail on `m8`, CI is red, and the screenshots show one new blocking layout defect (F17).
- **Branch:** `m8` at `aa89d04`, the same as `origin/m8`. No product code was changed by this run.

### Runs (this Mac, one Playwright run at a time, through the pnpm scripts)

| What | Chromium | WebKit |
| --- | --- | --- |
| `pnpm shots -- M8` (gate M8) | 7 / 7, 29 screenshots | not run. Test 1 failed with `browserType.connect: Timeout 180000ms exceeded`, and I stopped the run by its pid. The exit code 3 that followed came from that stop, not from a prompt. |
| `pnpm shots -- M7 --project=chromium` (gate M7) | 11 / 11, 29 screenshots. The entry check passes (F2 fixed) | not run; the iPad touch smoke is WebKit only |
| `pnpm e2e:gate -- M0 … M5 --project=chromium` | M0 1/1, M1 2/2, M2 1/1, M3 1/1 (F3 fixed), M4 6/6, M5 6/6 | not run |
| `pnpm check` (in oomph, reservation r959) | green. 336 files: 4552 passed, 1 skipped, 9 todo (the keymap's pending M6 actions). `tests/unit/ui/routes.test.ts` asserts that the five leak files of contracts.md Part A hold no `it.todo` | — |
| The specs CI failed on, rerun here (`pnpm e2e -- --project=chromium tests/e2e/offline/update.spec.ts tests/e2e/journey/quick-match.spec.ts`) | 4 passed, **2 failed**: `offline/update.spec.ts:18` and `journey/quick-match.spec.ts:111` | — |
| Full `pnpm e2e` | not rerun locally. CI ran it on `aa89d04` (below) | — |

- **WebKit:** the Mac Studio (192.168.178.80) is at the login window again: `ioreg` reports `kCGSSessionUserNameKey="unknown"` and `kCGSessionLoginDoneKey=No`. Its browser server (pid 43453, since 16:49) accepts connections, but the Playwright WebKit processes it starts stay at about 70 MB and never open a page. This is the same failure as at 13:12 earlier today. I did not touch the Studio's server.
- **oomph:** my run's first reservation (r950, 3 GB, granted but never used) was left behind while the guard queued a second one (r951). I released r950, which belonged to my own run, and r951 was then granted. No exit 4 or 5.

### CI on `aa89d04` (run 44937340703): red, 3 tests

| Test | Browser | Since | Local |
| --- | --- | --- | --- |
| `offline/update.spec.ts:18`: a new version waits mid-game and applies at the lobby | Chromium | Fails on `7347f97` and `aa89d04`; passed on `6f98270`. The fix-round commit `815648a` is the first to fail. | **fails**. The page reaches `#/lobby` and shows "Updating to the new version…" (status `applying`), but it never reloads: `waitForEvent('load')` times out after 30 s. |
| `journey/quick-match.spec.ts:111`: practise while you wait | Chromium (also Linux WebKit before) | Has failed on CI since `8d8fb9d` | **fails**. Both ACCEPT and both hashes reach `#/t/…`, but `table-frame[data-kind=room]` never appears on Ann's page. Her snapshot shows Home with `SEARCHING 0:31` and "You are the only one looking right now." |
| `touch/gestures.spec.ts:247`: a second finger after a long-press makes it a camera gesture | Linux WebKit | Fails on `7347f97` and `aa89d04` | not run (no WebKit) |

The Linux WebKit failures of earlier runs pass in this run: the axe audit panel, the private-table versus, the frame meter, the avatar tap, mouse-turn, captions and voice/hold. Captions and voice/hold had failed on `7347f97`, so those shards are still flaky.

### Screenshot review (Chromium; `artifacts/shots/M8/`, `artifacts/shots/M7/`)

I judged each of the 29 M8 screenshots, and the M7 set, against `mock.html` (board 1 and the system board from an earlier render; boards 5 and 7 from their markup), `visual.md` and `journey.md`.

| Screen | Verdict |
| --- | --- |
| 01 Home, first run | Good. Board 1's centred column: the empty deck slot, four mode cards, the option row, the 56 px primary and the status line. The arena behind is a pale, very soft shape. |
| 02a New deck chooser | Good. Four cards, one filled primary. |
| 02 Deck page (custom) | F7 still open. The document has scrolled sideways and down, so the top bar and the left gutter are off screen, and the found card is cut at the left edge. |
| 02b, 10, 13c Decks library | Good. The cover fans, strength pips, sparklines and the seal band are there, and the copy reads "M19 boo… (custom)" (F14 fixed). The queue bar is board 2's ink pill. |
| 03, 05 Home with the deck as hero | Good column and facts, the `CONTINUE` strip and the saved toast. **F18:** the fan sits on a white rectangle the width of the fan (about 400 × 280 px), with pile edges under it. Board 1 has no box: its cards stand on the page over the arena. The fan shows card backs because `?faces=placeholder` has no image URL (`ui/home/deps.ts` `pageFaces`, by design). |
| 04 Sparring table | No hint over Sparring's side (F2 fixed). **F17:** the own plate (x 16 to 430) covers the middle of the first hand card. |
| 06, 21 History | Good. The rows have thumbnails. There is still no board-6 detail column and no `TODAY` grouping (both later). 21 reads "TAWNY WREN AND PLAYER" (F9). |
| 07, 07b Waiting room (1280 × 800) | F5 still open. The legacy "Game settings" form (native selects, "Constructed de▾") sits on a white strip at the right. The page has scrolled, so the header and `← HOME` are off screen and the open seat is cut at the top. Seat names truncate ("Silver Panda (y…") and their status wraps. The presence line runs past the invite sheet's edge. |
| 08, 12, 12b, 20 Private, matched and 4 FFA tables (1280 × 800) | Seven cards each, and no hint at the top. **F17:** the plate covers the first two hand cards. The voice row floats over the faces of cards 5 to 7, and its ⚙ overlaps `MUTE`. The evening bar (F6) covers card 1, matched tables included. A "Your turn · UNTAP ALL AND DRAW" toast repeats the primary's action just above the hand. The seat's name tag is half hidden behind the hand. |
| 09 Game over | Good overlay. |
| 11 Match found | Good. |
| 13a Booster setup, 14 Draft night | Good. Board 0's boosters and board 5's hero. |
| 13, 13b Booster deck and its copy | The lock and the conversion work. F8 still open: the name field shows "M19 boosters · 21 No", and "40 / 40 39 Casual ▮ 39 CASUAL" still shows the strength twice. |
| 15 Draft waiting room (1440 × 900) | The header is right. F5 is still open: the left chair runs off the left edge, and the settings form is legacy (an unlabelled checkbox, a Timers fieldset). |
| 16 Gathering | F1 and F13 fixed: a rounded card reading "4 FFA · TURN 3 · TULIP COAST BEACH 31". Both absent players are "Player" (F9). |
| 17, 18 Plate menu and Bring back | Good. The volume slider wears ink (F12 fixed), the menu fits the 800 px window (F11 fixed), and the QR code, the link and `COPY LINK` are there. The sheet's body runs below the window at 1280 × 800 ("This link works once…" is cut), but the popover scrolls. |
| 19, 19b Claim page and recovery | F1 fixed: rounded cards. **F19:** the recovery panel ("This browser lost your hidden cards…") opens over the claim card before `SIT DOWN`, hiding its title. It stays over the opponent's plate afterwards. |
| M7 goldfish (Plain, Graphite), smoke (Kitchen Table, Codex) | The four looks render. The coach mark is whole, and `GOT IT` shows in the dark looks (F4 fixed). **F17** appears in every look: the plate covers the lower half of the first hand card at 1440 × 900. |
| M7 tilt (four looks × three poses) | One continuous tilt. **F15** is still open: at first person the own graveyard and library sit half off the right edge (Plain, Kitchen Table, Codex). At mid-tilt and bird's-eye the coach mark covers the own battlefield cards. |
| M7 feel, entry, HUD menu, plate menu | The lift, the squared snap and the draw show. The pile popover is a rounded rectangle (F1 fixed). The HUD menu fills the window height and scrolls, cutting its last row ("Settings…"). The sandbox menu still offers `Import deck…` under DECK, which journey 4.10 removes from the in-game menu. |

### Findings after the fix round

| # | Severity | Status | Finding | Design | Fix |
| --- | --- | --- | --- | --- | --- |
| W1 | blocking | open (environment) | WebKit unverified: the Studio's console is at the login window, so no WebKit gate (M0 to M5, M7, M8) and no WebKit e2e could run. F16 cannot be checked. | PLAN Gate M8-G (Chromium and WebKit) | Log in at the Studio's console, then run `pnpm shots -- M8`, `pnpm shots -- M7` and `pnpm e2e:gate -- M0 … M5` in WebKit. |
| R1 | blocking | new since `815648a` | The update never applies: at `#/lobby` the status stays "Updating to the new version…" and the page does not reload (`offline/update.spec.ts:18`, here and on CI). | DESIGN offline/update; PLAN quality gates (full e2e green) | Bisect `815648a`: the BroadcastChannel and engine stall changes, the scene's context listeners, the hint changes. Check that `controllerchange` arrives and that `reload()` runs once the status is `applying` (`src/ui/storage/worker.ts`). |
| R2 | blocking | open | Practice-to-match handoff: after ACCEPT over a practice table, the matched room's table never mounts. The page falls back to Home with the search still running (`journey/quick-match.spec.ts:111`, here and on CI). | journey.md 4.5 / 4.6 (practise while you wait) | Follow what M8-P8's TableFrame and M8-P7's MatchHost do on accept from `#/p/…`. The single host from `99a33cc` is the first suspect. |
| R3 | blocking | open (CI only) | `touch/gestures.spec.ts:247` fails on Linux WebKit, twice in a row since the fix round. | PLAN quality gates (CI green) | Rerun when WebKit is back. The fix round changed the tap handling in `Avatar.svelte` and `touch/gestures` timing. |
| F17 | blocking | new | The HUD's bottom row collides with the own hand on every table. The plate covers one card at 1440 × 900 and two at 1280 × 800. The voice row sits on the right cards' faces, with its ⚙ over `MUTE`. The evening bar covers card 1. | visual.md 2.9 board 7 (a 760 px hand fan, centred, with the plate at the bottom left), O-1 to O-7; owner O1 ("placed buttons … ordering absent of design") | Narrow the fan, or offset it past the plate (the fan's left edge at least 16 px right of the plate). Move the voice row into the talk button (board 7: talk beside the primary). Drop the evening bar in matches (F6). |
| F18 | minor | new | A white box the width of the fan, with pile edges, sits behind Home's deck hero. | visual.md 2.8 "Deck hero", board 1 | Remove the surface behind `.ds-fan` on Home. The stack edges belong under the cover card only. |
| F19 | minor | open since run 1 (was noted under F1) | The recovery panel covers the claim card before `SIT DOWN`. | journey.md 4.11 | Show the recovery panel only after the seat is claimed, or stack it below the claim card. |
| F5 to F9, F15 | minor | open | As in the first run (below). | — | — |
| F1 to F4, F10 to F14 | — | fixed and seen in screenshots or gates | — | — | — |
| F16 | needs triage | unverified (WebKit) | — | — | — |

---

## First verifier run (21 Nov 2026)

- **Result: red.** The owner-facing summary is in `docs/gates/M8.md`. This file is the run record: what ran, what failed and why, the screenshot review, and the findings with their fixes.
- **Branch:** `m8`. The gate ran on `561d93a`, the integration result with all eleven packages merged. The gate spec and the harness fixes are commit `8d8fb9d`.
- **Specs:**
  - `tests/e2e/m8.gate.spec.ts`: the owner's walk, 7 tests.
  - `tests/e2e/m7.gate.spec.ts`: new, M7's table checks, 11 desktop tests and 1 iPad test.

## Why the gate is red

1. **WebKit ran late.** At first it could not run: the Mac Studio at 192.168.178.80, which runs Playwright's WebKit for this Mac, had nobody logged in at its console.
   - **Studio state:** WindowServer and loginwindow restarted at 13:12. `ioreg` reported the login window ("Unknown User").
   - **Effect:** WebKit launches stayed at 11 MB, and Playwright.app logged `SkyLight: Conn 0x0 is not a valid connection ID`. One probe of `smoke.spec.ts` timed out after 180 s, and I stopped the two processes it had left, by pid.
   - **Recovery:** at 16:50 the owner logged in and the coordinator restarted serve.sh. I then ran gate M8, gate M7 and gates M0 to M5 in WebKit through the scripts.
   - **WebKit results:**
     - gate M8: 7 / 7;
     - gate M7: 11 / 12, with the iPad touch smoke passing and the entry check failing on F2;
     - M0 1/1, M1 2/2, M2 1/1, M5 6/6;
     - M3 0/1 (F3);
     - M4 5/6 (F16).
   - The full `pnpm e2e` was not rerun in WebKit by the gate.
2. **Gate M7 fails in Chromium and WebKit,** on the entry check of m7-adjustments section 7 ("no dialog or hint covers the opponent's side"). This is a product defect: finding F2.
3. **Gate M3 fails in Chromium and WebKit,** with the same failure in three runs. Dan's "Reveal to" menu runs off the bottom of the window, and Playwright reports `element is outside of the viewport` for the team choice. This is a product defect: finding F3.
4. **CI was red on `m8` at `561d93a`** (run 44913632569, 7 tests).
   - **Chromium (3): harness timing races, with fixes in `8d8fb9d`.** All three pass here; on CI two are fixed (below):
     - `feel/grab-in-flight.spec.ts`: "Cannot fast-forward to the past".
     - `resume/gather-harness.spec.ts`: the 8 s count included the real time the audit took.
     - `signals.spec.ts` theme switch: the start's own actions were still going out.
   - **WebKit on Linux (4): not fixed.** none of them fails on the Mac's WebKit through the Studio:
     - `a11y/axe.spec.ts:169`: test timeout, 180 s.
     - `lobby/private.spec.ts:61`: page B's versus screen was gone before it was checked. B has no page clock, so this is a harness race.
     - `settings/frame-meter.spec.ts:15`: 0 rAF callbacks in the measured window.
     - `touch/gestures.spec.ts:403`: tapping an avatar did not move the camera.
   - **CI on `8d8fb9d`** (run 44918800616) is still red.
     - **Chromium:** `grab-in-flight` and `gather-harness` now pass. `signals.spec.ts` fails again, 7 → 9, though the count now starts from a settled table. It passes here, also with SwiftShader. The assertion now names the extra messages, so the next CI run shows whether a timer or the switch sends them.
     - **Linux WebKit (6):** `a11y/axe.spec.ts:169` (timeout), `journey/quick-match.spec.ts:111` (practice table frame not found in 30 s), `lobby/private.spec.ts:61` (versus race), `nokeys/mouse-turn.spec.ts:17` (pile affordance `via`), `settings/frame-meter.spec.ts:15` (0 rAF callbacks), `touch/gestures.spec.ts:403` (avatar tap). Two of these were not failing in the run before, so the Linux WebKit shards are flaky as well as failing.
5. **One blocking visual defect** (F1): the Gathering card, the claim page and the recovery panel draw as ellipses in Plain, which clips their titles and buttons.

## Runs (all on this Mac, one Playwright run at a time, through the pnpm scripts)

| What | Chromium | WebKit (Studio, after 16:50) |
| --- | --- | --- |
| `pnpm shots -- M8` (gate M8) | 7 / 7 passed, 29 screenshots | 7 / 7 (the chat went through the chat field) |
| `pnpm shots -- M7` (gate M7) | 10 / 11 passed. The entry test fails on the welcome hint (F2). The iPad test is WebKit-only and was skipped | 11 / 12: the iPad touch smoke passes; the entry test fails on F2 |
| `pnpm e2e:gate -- M0` | 1 / 1 | 1 / 1 |
| `-- M1` | 2 / 2 | 2 / 2 |
| `-- M2` | 1 / 1 | 1 / 1 |
| `-- M3` | 0 / 1, the same failure twice (F3) | 0 / 1, the same failure (F3) |
| `-- M4` | 2 / 6 at first. The four scripted games failed at the lobby's look picker: the waiting room reads `Look: Paper`, the spec expected `Theme: Paper`. After the harness fix: 6 / 6 (2 + 4 rerun) | 5 / 6: the Dusk game logged "WebGL: context lost." twice on Ben's page (F16) |
| `-- M5` | 6 / 6 | 6 / 6 |
| Touched specs (`feel/`, `resume/gather-harness`, `signals`) | 129 / 129 | not rerun |
| `pnpm check` (in oomph) | green: 334 files, 4548 passed, 1 skipped, 9 todo. The todos are the keymap's pending M6 actions | — |
| Leak test files of contracts.md Part A | all five exist with no `it.todo` (asserted in `tests/unit/ui/routes.test.ts`) | — |
| Full `pnpm e2e` | not rerun. The integrator's run on `561d93a` reached 934 passed and 3 failed in Chromium, all 3 fixed in `99a33cc` and `561d93a`. My commit changes only tests: its touched specs are in the row above | the integrator's run hung on the Studio as well |

## What the gate spec walks, and where it still uses the debug hook

**No action in the M8 walk goes through `__spellplane.dispatch`.**

- **Every step takes the player's route:**
  - Home's mode cards and options, Decks, and the deck page's search and land helper;
  - the waiting room's READY and START, and Quick match's accept;
  - the HUD's primary button for every turn change, and the plate buttons for life;
  - the back arrow to leave, and History's rows to return;
  - the log's chat field for the four chat lines (the spec logs which route ran: "the chat field");
  - Cy's plate menu `BRING … BACK`, the claim page, and the recovery panel with its re-import dialog and the others' `OK`.
- **The debug hook only reads state or drives timers:**
  - state, hashes, secrets, `net.messages`, `muster()`, `games.list()` and the decks;
  - Sparring's manual clock (`bot.setClock`, `bot.tick`);
  - the sequencer's clock for the 30 s absence rule (`net.setClock`), moved on twice. A new sequencer that activates in between restarts the 30 s, and that race made the first run flaky;
  - `decks.nextSeed` (the pinned seed), and `decks.edit` for the `notInPool` refusal, which the gate asks for;
  - `session.saved()`, awaited before each leave so that the saved copy is complete.
- **The M7 checks set the table up through the debug hook:** importing the deck, shuffling, the opening hand, and the cards placed for the tilt and feel tests. That is setup, not play. Everything they then play goes through the mouse (or fingers), with `input.keydowns()` asserted 0.

## Screenshot review (Chromium, 1440 × 900 and 1280 × 800; `artifacts/shots/M8/`, `artifacts/shots/M7/`)

Judged against `docs/design/m8/mock.html`, `visual.md`, `journey.md` and the owner's words. My first screenshot run caught route cross-fades: half-transparent pages, and a blank waiting room. The gate now waits for the screen to settle (`settleAnimations`, then the table cover lifting) before each shot. The table below is the settled set.

| Screen | Verdict |
| --- | --- |
| 01 Home, first run | Good. Board 1's single centred column: the empty deck slot, four mode cards, the option row, one 56 px primary and the status line. The arena behind is a soft, very light shape. Depth is modest: it reads as paper with soft shadows, not boxy. |
| 02a New deck chooser | Good. Four cards with one filled primary (`OPEN BOOSTERS`); the others are ghost pills. |
| 02 Deck page (custom) | Mixed. The curve, lands helper and list rail match board 3. But the document scrolled sideways and down while cards were added: the shell's top bar and the left gutter are off screen (F7). |
| 02b / 13c Decks library | Good. The tiles have cover fans, strength pips and curve sparklines; the booster deck has its seal band. Both decks read "M19 boosters · …": the tile truncates the copy's "(custom)" (F14). |
| 03 / 05 Home with the deck as hero | Good. Fan, name, the fact row with the curve and strength, the `CONTINUE` strip under the primary, and the saved toast. The fan shows card backs, not the cover card. |
| 04 Sparring table | Calm HUD, log closed, seven cards, `TO MAIN ▸`. But the first-run **Welcome** hint sits over the opponent's plate. Its M5 copy ("Import a deck … open the lobby") does not fit a table opened from Home (F2). |
| 06 / 21 History | Good. A row with a thumbnail, title, format line, turn line, code and remove button. Board 6's detail column is not built. |
| 07 / 07b Waiting room, 15 Draft waiting room | Weakest screens. The settings column is the legacy form: native selects, truncated ("Constructed de…", "Free-for-all, '"), on a separate white strip; the draft's Timers fieldset is drawn as an ellipse. Chair labels truncate ("Saffron Crow (you)…") and their status wraps. In the draft room the chairs run off the left edge. This is the owner's "technical and boxy" (F5). |
| 08 / 12 Private and matched tables | Seven cards each. Over the opponent: the **Talk** hint, "Hold Ctrl to talk", which teaches a key (F2). The evening bar (`NEXT GAME`, `NEW DRAFT`) shows on every networked table from turn 1, matched tables included (F6, a known not-done of M8-P8). |
| 09 Game over | Good overlay: `VICTORY`, the line, both lives, `REMATCH` filled, `HOME` and `LOOK AT THE TABLE` as ghosts. |
| 10 Queue bar | Good. The black pill under the nav reads "SEARCHING · 1V1 CASUAL · 0:00 · 0 LOOKING · CANCEL" over Decks. |
| 11 Match found | Good. A centred card on the scrim with both players and their bands, the 20 s ring, `ACCEPT` and `DECLINE`. |
| 12b 4 FFA versus | Clean cards, but a stray "VS" follows the third card of the first row (F10). |
| 13a Booster setup, 13 / 13b deck pages | The sheet matches board 0's boosters. The deck page's header crowds at 1440: the name field truncates ("21 No"), and CARDS and STRENGTH run together with the strength shown twice ("40 / 40 39 Casual ▮▮ 39 CASUAL") (F8). |
| 14 Draft night Home | Good. Three closed M19 boosters replace the deck, with `OPEN DRAFT TABLE`. |
| 16 Gathering | **Broken.** The card is a circle that clips its title ("…TING EVERYONE BACK"), its game line ("FA4") and `LOOK AT THE TABLE` (F1). The game line also shows the raw format id "FFA4" (F13). |
| 17 / 18 Plate menu, Bring back | Content is right: away for 8 s, `BRING PLAYER BACK`, the QR code, the link and the waiting line. The plate menu's volume slider is the browser's blue default control (F12). The popover runs past the bottom of a 1280 × 800 window (F11). |
| 19 / 19b Claim page, recovery | **Broken.** The claim card and the recovery panel are ellipses whose text spills past their edge (F1). The recovery panel already shows above the claim card before SIT DOWN, and the two overlap. |
| 20 4 FFA, turn 3 | Readable. Both guests are named "Player", because a fresh browser that opens a link sits down as "Player" (F9). The Talk hint covers the top plate (F2). |
| M7 goldfish (Plain, Graphite), smoke (Kitchen Table, Codex) | The four looks render. The selection strip, counter chip, attach tuck and attack slide all read well. The **Welcome** hint stays over the opponent's half the whole game. The coach bar clips its first letter ("ꓷrag", "ouble-click"). In Graphite and Codex its `GOT IT` label is invisible, an empty pill (F4). |
| M7 tilt (four looks × first person, mid-tilt, bird's-eye) | One continuous tilt: the drag tilt rises monotonically, with more than 8 distinct values. At first person the own library and graveyard sit at the right edge, half cut off, in Plain, Kitchen Table and Codex (F15). |
| M7 feel (mid-lift, mid-snap, mid-draw) | Lift and the squared-snap preview show. The library's pile-action popover (`DRAW · SHUFFLE · SEARCH`) is a circle in Plain (F1, same cause). |
| M7 HUD menu, plate menu | Grouped, labelled menu, but it runs past the bottom of a 900 px window ("Settings…" is cut) (F11). The plate menu is good. |

## Findings (product), with design references and fixes

| # | Severity | Finding | Design | Fix |
| --- | --- | --- | --- | --- |
| F1 | blocking | Panels use `--ds-radius-md`, which since M8-C is the **button** radius (9999 px in Plain). In Plain they become ellipses that clip their content: the Gathering card, the claim page, the recovery panel, the matched-entry card, the team prompt, the HUD's inline popovers (reveal-to, draw N), the pile-action popover and the builder list's file row. | visual.md 2.3 ("round buttons, 16 px sheets"), contracts.md Part B; owner O1 | Use `--ds-radius-panel` (or `-card`, `-sheet`) in `src/ui/gather/Gathering.svelte` `.card`, `gather/ClaimPage.svelte` `.claim`, `recovery/RecoveryPanel.svelte`, `play/MatchedEntry.svelte` `.mm-entry`, `seat/TeamPrompt.svelte` `.prompt`, `Hud.svelte` `.inline`, `touch/PileActions.svelte`, `builder/list/Library.svelte` `.file`. Add a unit test that no panel selector uses `--ds-radius-md`. |
| F2 | blocking (fails gate M7) | First-run hints on entering a table from the journey: **Welcome** ("Import a deck … open the lobby") and **Talk** ("Hold Ctrl…"). Both sit at the top centre over the opponent's side and stay until dismissed. Talk teaches a key. | m7-adjustments.md section 7 (entering a table); PLAN M7 owner decisions ("Keys stay as optional accelerators and leave the primary UI"); owner ("thrown into an arena") | `src/ui/hints/hints.ts`: do not show `welcome` at tables (Home introduces the game). Place hints by the own hand. Word `talkKey` around the Talk button, or show it only after JOIN VOICE. |
| F3 | blocking (fails gate M3) | The HUD's "Reveal to" menu (`W` over a hand card) opens at the pointer with `top = y − 20` and no bottom clamp. Over the hand it runs off the window, so its lower choices (team, Everyone, Cancel) cannot be reached. | DESIGN "Hidden information" reveal paths; gate M3 | `Hud.svelte` `.inline`: clamp `top` to `vh − height − 8`, or open upward from the hand. |
| F4 | minor | Coach bar: the first glyph of its text is clipped. In Graphite and Codex the bar stays light and its `GOT IT` label is invisible. | visual.md 2.8 (coach recipe), 2.2 (looks) | `src/ui/hints/CoachMark.svelte`: padding on the text; use the look's coach tokens for the bar and the label. |
| F5 | minor | Waiting room and draft room: legacy settings form (native selects with truncated labels, a separate white strip, an elliptic Timers fieldset); chair labels truncate and their status wraps; the draft room's chairs run off the left edge. | journey.md 4.8, mock board 5, visual.md 2.5; owner O1 | `src/ui/lobby/WaitingRoom.svelte` / `ui/flow/LobbyDraft.svelte`: kit Segmented and Stepper for the settings in the sheet column. Wrap chair labels on two lines. Fit the seat diagram to its column. |
| F6 | minor | The evening bar (`NEXT GAME`, `NEW DRAFT`) shows on every private and matched table from turn 1. | journey.md 4.10; M8-P8's "not done tonight" (DECISIONS) | Pass `evening` to the HUD and drop the in-match bar, as M7-P2 reported. Gates M2 and M5 and three specs then click the HUD route. |
| F7 | minor | The deck page overflows horizontally at 1440 × 900: the document scrolls sideways and the top bar scrolls away. | mock board 3, visual.md 2.5 | `src/ui/decks/DeckPage.svelte`: make the left pane `minmax(0, 1fr)` and clip the page width. |
| F8 | minor | The deck page header crowds: the name truncates and the strength figure repeats and runs into CARDS. | mock board 3 | Give the name field room; show strength once, beside a divider. |
| F9 | minor | A fresh browser that opens an invite link sits down as "Player", so two guests are both "Player": "BRING PLAYER BACK", "HAZEL STAG AND PLAYER". | journey.md 4.9 and 6 (generated names) | Give a fresh profile its generated nickname on the room route too, as Home does. |
| F10 | minor | 4 FFA versus: a stray "VS" after the last card of a row. | journey.md 4.7 | Put separators between cards only within a row. |
| F11 | minor | The BRING BACK popover (1280 × 800) and the HUD menu (1440 × 900) run past the bottom of the window. | visual.md 2.13 | `max-height: calc(100vh − top − 16px)` with scrolling. |
| F12 | minor | The plate menu's volume slider is the browser's default (blue). | visual.md 2.8, "one design system" | A kit range style. |
| F13 | minor | The Gathering game line shows the raw format id ("FFA4"). | journey.md 4.12 (`1V1 · TURN 6`) | Use the format label ("4 FFA"). |
| F14 | minor | Library tiles truncate the name, so a converted copy ("… (custom)") reads the same as its original. | decks.md D4 | Ellipsize the middle, or show "CUSTOM COPY" on the tile. |
| F16 | needs triage | M4 gate in WebKit: Ben's page logged "WebGL: context lost." twice during the Dusk game (mid-game switch to Wyrm), which the gate counts as a console error. The scene's dispose calls `renderer.forceContextLoss()` (`table-scene.ts`, `still.ts`, `stage.ts`), and WebKit logs that as a console message. Unclear whether a scene was remounted mid-game or the context was really lost. | M7-P1 lifecycle; gate M4 | Find which dispose ran on Ben's page; if it is an intended remount, leave out the forced loss for a scene replaced within the same page, or make gate M4 tell an intended loss from a real one. |
| F15 | minor | At first person the own library and graveyard sit half off the right edge (Plain, Kitchen Table, Codex). | PLAN M7 owner decisions (one tilt, "hand kept in reach throughout") | Pull the first-person pose back, or narrow its framing, so the own piles stay on screen. |

## Harness fixes made by the gate (commit `8d8fb9d`)

- `tests/e2e/m8.gate.spec.ts`:
  - reuses the journey helpers;
  - every route goes through the UI, as described above;
  - the sealed deck's lock is checked on the deck page's kind chip (the spec had asked for the library tile's `seal-band`, which is not on the deck page);
  - `before` is read once the built booster deck is saved (the page saves a moment after it shows);
  - the screenshots wait for the screen to settle.
- `tests/e2e/m7.gate.spec.ts`: new.
- `tests/e2e/m4.gate.spec.ts`: accepts `Look: <theme>` (M8's waiting room) as well as `Theme: <theme>` (the M1 lobby).
- `tests/e2e/feel/helpers.ts`, `tests/e2e/resume/gather-harness.spec.ts`, `tests/e2e/signals.spec.ts`: the CI races described above.

## Real Safari

**Not measured.** This Mac's screen was locked (`CGSSessionScreenIsLocked=Yes`), and other agents were busy on it. The task allows a measurement only with the screen unlocked and the machine quiet, so `pnpm perf -- --safari` was not started. There is no `docs/gates/M7-P6.md` to add numbers to.

## Fix round (gate fixer, 21 Nov 2026 evening)

Fixed in the product, each with a test:

| Finding | Fix | Test |
| --- | --- | --- |
| F1 | Every panel, card, popover and sheet that used `--ds-radius-md` or `--sp-radius-md` (the button radius) now uses `--ds-radius-panel`, `-card` or `-sheet` (`--sp-radius-lg` for legacy panels). | `tests/unit/design/no-pill-panels.test.ts`; the Gathering card's radius in `resume/gather-harness.spec.ts` |
| F2 | The welcome shows only on the start page, with current copy. The talk hint waits for JOIN VOICE and leads with "Talk while I hold or drag". Hints sit bottom left by the own hand, and above the own plate on a touch screen. | `unit/settings/hints.test.ts`, `settings/states.spec.ts`, `settings/touch.spec.ts`, gate M5's touch step, gate M7's entry check |
| F3 | The reveal-to menu is moved inside the window by its measured size. | `ui/hud.spec.ts` "reveal to"; gate M3 green in Chromium and WebKit |
| F4 | The coach bar has no pointer square over its first glyph, and GOT IT uses the coach ink. | `nokeys/coach.spec.ts` |
| F10 | The versus screen shows "vs" only between two players. | `lobby/harness.spec.ts` |
| F11 | The HUD menu fits itself into the window when it opens and when it grows. The plate menu is capped at the window height and scrolls. | `ui/hud.spec.ts` "menu in a short window" |
| F12 | The plate menu's volume slider uses the look's ink. | — |
| F13 | The Gathering line shows "4 FFA". | `resume/gather-harness.spec.ts` |
| F14 | A deck tile cuts only the name before " (custom)". | `decks/library.spec.ts` |
| F16 | The scene redraws after a WebGL context restore and warns on any loss while it lives, naming the live contexts. The cause is not proven: only one of four games lost its context, so it was not a remount. | — (WebKit unavailable; see below) |
| CI theme switch | The BroadcastChannel transport and the net engine mark nobody gone on a beat or tick that follows a stall of the page's own main thread. CI named the stray messages as `sequencerClaim` and `away`: the switching page had stalled and taken over the table. | `sim/net/protocol.test.ts` (fails without the fix), `unit/net/broadcast-stall.test.ts` |
| CI harness races | `nokeys/mouse-turn` (hover before click), `design/kit` (entrance fade), `touch/gestures` avatar tap (tap told from double-tap late), `settings/frame-meter` (no rAF in one short phase), `lobby/private` (versus already gone), `a11y/axe` audit panel (the round's own timer outlasted the scan). | the specs themselves |

Left open: F5 (waiting room's legacy settings form), F6 (evening bar from turn 1), F7/F8 (deck page overflow and header), F9 (a fresh browser joins as "Player"), F15 (first-person piles off the right edge), the full `pnpm e2e` in WebKit, and real Safari. `journey/quick-match.spec.ts:111` failed on CI twice: Ann's join of the matched room timed out ("Timed out waiting for the table to sync") while Ben waited at DEALING. It passes locally in Chromium. The stall fix may cover it (a table mount stalls the page like a theme switch does), but that is unproven until CI runs.

---

## Round 2: verifier run after the regression and layout rounds (21 Nov 2026, 23:04 to 23:40)

- **Result: red.** `pnpm check` and every gate pass in Chromium, apart from one gate M0 run that failed on a random shuffle (H1). WebKit could not run, and CI is red with 5 tests.
- **Branch:** `m8` at `c2e34bc` (the integrator's merge of `m8-regress` and `m8-layout`), the same as `origin/m8`. This run changed no product code and no test.
- **What the two rounds fixed:** R1, R2, F6, F7, F9, F15, F17, F18 and F19, as the screenshots, the gates and CI show. F8 is fixed apart from one leftover. F5 is partly fixed. R3 is still open.
- **New:** three CI failures (N1 to N3, blocking), a gate M0 spec that depends on an unseeded shuffle (H1), and minor layout defects (N4 to N11).

### Runs (this Mac, one Playwright run at a time, through the pnpm scripts)

| What | Chromium | WebKit |
| --- | --- | --- |
| `pnpm check` (oomph reservation r1025, peak 1.9 GB, 150 s) | green. tsc; svelte-check: 2028 files, 0 errors, 0 warnings; eslint clean (module boundaries included); vitest: 337 files, 4563 passed, 1 skipped, 9 todo | — |
| `pnpm shots -- M8` (gate M8) | 7 / 7, 29 screenshots | not run (W1) |
| `pnpm shots -- M7` (gate M7) | 11 / 11, 29 screenshots. The iPad touch smoke is WebKit only and was skipped | not run (W1) |
| `pnpm e2e:gate -- M0` | **first run failed** (H1). It then passed 6 / 6 with `--repeat-each=6` | **hung at connect** (W1) |
| `-- M1` / `M2` / `M3` | 2 / 2, 1 / 1, 1 / 1 | not run (W1) |
| `-- M4` | 6 / 6 (the four scripted games, the screenshot matrix, the 300-card perf) | not run (W1) |
| `-- M5` | 6 / 6 | not run (W1) |
| The CI failures of this round and the last, rerun here (`a11y/keyboard`, `offline/update`, `journey/quick-match`, `nokeys/coach`, `signals`) | 135 passed, 1 skipped (the iPad coach test is WebKit only). `keyboard.spec.ts:219` **passes here** but fails on CI (N2) | — |
| Full `pnpm e2e` | not run locally. CI ran it on `c2e34bc` (below) | — |

- **WebKit (W1):** the Mac Studio is at the login window again. Over SSH, `ioreg` reports `kCGSSessionUserNameKey = unknown` and `kCGSessionLoginDoneKey = false`, and its browser server (`serve.sh`, pid 43450) has been running since before the last run.
  - I started one probe, `pnpm e2e:gate -- M0 --project=webkit`, at 23:22. The Studio launched `Playwright.app` (pid 88516), which stayed at 72 MB and never opened a page, the same failure as at 13:12 and 20:20.
  - At 23:23 I stopped the probe on this Mac by its pids: the Playwright runner and worker, then the test build's preview server it left. The guard then closed its SSH tunnel. The Studio's own WebKit process was gone by 23:26, so its server cleaned up.
  - I did not touch the Studio, its server or `pw-remote.json`, and I did not wait or retry. No WebKit gate ran, and F16 is still unverified.
- **No exit 3, 4 or 5** from the guard in any run.

### CI on `c2e34bc` (run 44954804379): red, 5 failing tests

`check` is green. Chromium: 942 passed, 1 failed. WebKit (Linux): 952 passed, 4 failed. No test is reported flaky.

| Test | Browser | Failure | Local |
| --- | --- | --- | --- |
| `a11y/keyboard.spec.ts:219`: a keyboard-opened menu stands beside the hand card, not beside a log line that names the same card | Chromium **and** Linux WebKit | `expect(19.95).toBeLessThan(12.59)`: the menu's left edge is 20 px from the hand card's right edge but 12.6 px from the log line's. New in this round: it passed on `aa89d04` and on `a7de235`. | passes (Chromium) |
| `nokeys/coach.spec.ts:118`: on an iPad, the first coach mark stays clear of the piles | Linux WebKit (WebKit only) | `clearOfThePlayArea`: the mark's top is at y 383 of 834, above the 55 % line (459), so it covers the near play area. New in this round. | WebKit only; not run |
| `touch/gestures.spec.ts:250` (was `:247`): a second finger after a long-press makes it a camera gesture | Linux WebKit | The R3 fix's new check in `emptyTable` fails: the element at the empty-table point is a `BUTTON`, not the `CANVAS`. **R3 is still open.** | not run (no WebKit) |
| `touch/gestures.spec.ts:121`: double-tap on empty space beside a card zooms to that card | Linux WebKit | The card ends 329 px from the window centre (limit 278). New on this run; the last run failed `:109` and `:383` of the same file instead. | not run (no WebKit) |

Fixed on CI, compared with run 44941931782 on `a7de235`, all passing on `c2e34bc`:

- **R1:** `offline/update.spec.ts:18`, in Chromium and WebKit.
- **R2:** `journey/quick-match.spec.ts:111`, in both.
- `signals.spec.ts:841`, in Chromium.
- `offline/storage.spec.ts:46`, `nokeys/piles.spec.ts:85` and `voice/hold.spec.ts:279`, in WebKit.

The new specs `layout/hand-clear` (F17) and `decks/page-fit` (F7/F8) pass in both browsers.

### H1: the gate M0 spec depends on an unseeded shuffle

- **The failure:** the first gate M0 run failed at `m0.gate.spec.ts:202` with `expect(warleader).toBeTruthy()` (received `undefined`). No library card was a Leonin Warleader.
- **Why it can happen:** the spec imports `gw-m19-60.txt`, which has 2 Leonin Warleaders. It shuffles with the product's random shuffle, draws seven, mulligans, and puts one card on the bottom. Then it searches the library for a Warleader. When both copies are in the six-card hand, the library has none: about 0.9 % of runs.
- **Evidence:** the six reruns passed. The next gate run overwrote the trace, so the hand at the failure is not on record. The failure fits the both-in-hand case, but that is not proven.
- **What it is:** a test defect, not a product one. But a flaky test is a failing test, so gate M0 is not reliably green.
- **Fix:** in `tests/e2e/m0.gate.spec.ts`, take the Warleader from the hand when the library has none. Otherwise, fetch a card the 6-card hand cannot hold every copy of (any 4-of), or pin the shuffle through the debug hook.

### Screenshot review (Chromium; `artifacts/shots/M8/` at 1440 × 900 and 1280 × 800, `artifacts/shots/M7/` at 1440 × 900)

I judged each screenshot against `mock.html` (boards 1, 2, 3, 5 and 7 from their markup and the earlier render), `visual.md` 2.4 to 2.9, `journey.md` 4.8, 4.10 and 4.11, the owner's request, and the findings.

| Screen | Verdict |
| --- | --- |
| 01 Home, first run; 02a New deck | Good, as before. |
| 03, 05 Home with the deck as hero | **F18 fixed.** The fan stands on the page over the arena, with no white box behind it. The pile edges sit under the cover only. The `CONTINUE` strip and the saved toast are right. |
| 02 Deck page (1440 × 900) | **F7 fixed.** The shell's top bar and the left gutter stay put, and the found card is whole. **F8 fixed:** the name field is whole, and `CARDS 34 / 60` and `STRENGTH 29 CASUAL` each show once. Undo and redo are round buttons. The copy reads "1 cards" (minor). The found card's `×4` badge is cut at the card's top-right corner (minor). |
| 13, 13b Booster deck and its copy | The lock, the pool row (`PLAINS + 6 …`) and `CONVERT TO CUSTOM DECK` are there. The original's header fits. The copy's name still truncates in the field: "M19 boosters · 21 Nov (cus…" (F8 leftover, minor). |
| 02b, 10, 13c Decks library | The tiles are right in structure. **N6:** the `SIMPLE DECK` chip and the sparkline are clipped by the tile's bottom edge (10, 13c). "40 BOOSTER ▮▮ 39 CASUAL" runs past the booster tile's right edge (13c). The selected tile cuts its name to "Importe…" beside the ✓ and the `SELECTED` chip (10). The queue bar is board 2's ink pill. The seal band is flat across the well's foot, not board 0's band at −3° (minor). |
| 06, 21 History | Good. **F9 fixed:** 21 reads "BRIGHT SPARROW AND AMBER LARK", and the profile chip of the blank browser shows its made-up name, "Fern Bison". There is still no detail column and no `TODAY` group (later, as before). |
| 04 Sparring table (1440 × 900) | **F17 fixed.** The fan (x 455 to 1207) rests between the plate (to 437) and the primary (from 1224), clear of both. The log is closed, and no hint shows. The own seat's name tag is half hidden under the top edge of the hand (N9). |
| 08, 12 Private and matched tables (1280 × 800) | **F17 fixed:** seven cards between the plate and a single round 56 px Talk button beside the primary. The voice row and its ⚙ are gone. **F6 fixed:** no evening bar, matched tables included. The coach mark (12) sits bottom left over the own plate. N9: in 08 the "Your turn. · UNTAP ALL AND DRAW" toast still repeats the primary's label just above the hand, and the name tag hides under the hand. |
| 12b, 20 4 FFA tables (1280 × 800) | F17 fixed for the own hand. **N4:** the side seats' plates stand over those seats' battlefields and over the left seat's library column, and the top plate covers the top seat's graveyard label. Plate size is inconsistent: in 12b the side plates are compact 46 px pills, in 20 Amber Lark's is a full 72 px plate with the 40 px life. |
| 07, 07b Waiting room (1280 × 800) | **F5 partly fixed.** The header stays (`← HOME`, title, `SETUP ✎`, `INVITE ⇪`) and only the body scrolls. Names no longer truncate ("Fern Jay you · host"). The rules panel moved from the white strip into the side column as a kit sheet. **Still open:** its controls are native selects (no kit select). **N11:** the invite sheet's presence line repeats the word ("WAITING · WAITING FOR PLAYERS · 1 OF 2 HERE") and runs to the sheet's edge. The seat status runs together ("here CHOOSING A DECK"). |
| 15 Draft waiting room (1440 × 900) | F5: the left chair is on screen now (fixed). **Still open:** the "Table" select ("Free-for-all, four players ▾") runs about 14 px past the TABLE RULES card's right edge. The 4 FFA seat diagram puts the left and right open seats across the table, not around it, 23 px apart. One "INVITE A PLAYER" label sits below its seat while the others sit above. Board 5's centre (boosters, set buttons, pick timer, the `lg` primary) is a smaller ghost status pill here. |
| 09 Game over, 11 Match found, 13a Booster setup, 14 Draft night | Good, as before. |
| 16 Gathering | Good. "4 FFA · TURN 3 · FIELD FINCH CIDER 94", and the absent players have names (F9 fixed). |
| 17 Plate menu (away) | Good content: away for 8 s, `BRING SAFFRON MARTEN BACK`, and the ink slider. **N7:** with the activity drawer open at 1280, the drawer's eye button and the drawer cover the tracker's last steps (`MAIN 2`, `END`). |
| 18 Bring back | The QR code, the link and `COPY LINK` are there. The sheet still runs below an 800 px window ("Works once…" is cut), but the popover scrolls. It is the whole invite sheet nested in the plate popover, not board 7's compact 124 px QR block beside the title (minor). N11: "WAITING · WAITING FOR SAFFRON MARTEN". |
| 19 Claim page | **F19 fixed:** the claim card stands alone; there is no recovery panel before `SIT DOWN`. **N8:** the card has no filled primary. `SIT DOWN HERE AS SAFFRON MARTEN` is a ghost pill, and `NOT NOW` stacks under it, left-aligned. Journey 4.11 asks for `SIT DOWN AS BEN` filled with `WATCH INSTEAD`, and A2 puts the primary last, at the right. |
| 19b Recovery | F19 fixed: the panel sits top left under the tools, clear of the opponent's plate. In 4 FFA its bottom edge covers the top of the left seat's glyph (Amber Lark) by about 17 px (minor; the integrator reported it). |
| M7 goldfish, smoke (four looks, 1440 × 900) | **F17 fixed in every look:** the fan clears the plate and the primary. The coach mark sits over the plate, and `GOT IT` shows in Graphite and Codex. N9: in Kitchen Table and Codex the "Your turn · Untap all and draw" toast repeats the primary above the hand. |
| M7 tilt (four looks × three poses) | **F15 fixed:** at first person, the own graveyard and library are inside the window in Plain, Kitchen Table and Codex. The coach mark no longer covers the battlefield at mid-tilt or bird's-eye. At bird's-eye the hovered hand card is raised over the fan; that is pointer state, not a defect. |
| M7 feel, entry, plate menu | Good. The lift, the squared snap, the draw flight and the `DRAW · SHUFFLE · SEARCH` popover are right. |
| M7 HUD menu | As before: the menu fits the window and scrolls, so its last row ("Settings…") is cut at 900 px. The GAME group holds ten rows (O-7 says at most seven), and the sandbox menu still offers `Import deck…` under DECK (journey 4.10). Minor (N10). |

### Findings, round 2

| # | Severity | Status | Finding | Design | Fix |
| --- | --- | --- | --- | --- | --- |
| W1 | blocking | open (environment) | WebKit unverified. The Studio is at the login window and its WebKit never opens a page, so no WebKit gate ran (M0 to M5, M7, M8). F16 and the iPad smoke are unverified. | PLAN Gate M8-G (Chromium and WebKit) | Log in at the Studio's console, then run `pnpm shots -- M8`, `pnpm shots -- M7` and `pnpm e2e:gate -- M0 … M5` in WebKit. |
| N1 | blocking (CI) | new in `m8-layout` (`8f2c29a`, `a2bd0ee`) | On a touch screen the first coach mark is stacked above `KEEP` and `MULLIGAN`. On the iPad that puts it at y 383 of 834, over the near play area (`nokeys/coach.spec.ts:118`, Linux WebKit). | M7 coach recipe (clear of the play area); visual.md 2.8 coach mark; `[M8-R2]` coach line | On touch, give the coach mark the desktop's place over the own plate, or put it in one row with `KEEP` and `MULLIGAN`. It must stay below 55 % of the height and off battlefield cards. |
| N2 | blocking (CI) | new in this round | `a11y/keyboard.spec.ts:219` fails on CI in Chromium and WebKit, and passes here. The keyboard menu opens 20 px from the hand card's edge, which is farther than the log line's edge (12.6 px), probably because the hand fan moved into its new band (F17). The cause is not proven on Linux. | DESIGN keyboard focus (M5-P4) | Reproduce at CI's viewport. Assert the menu's anchor (the hand card's rect against the menu's, through the hook) rather than comparing two edge distances. If the menu really stands off the card, fix its placement. |
| R3 | blocking (CI) | open | The touch gesture specs fail on Linux WebKit. `gestures.spec.ts:250` now fails at the R3 fix's own check, because a `BUTTON` covers the empty-table point after the pinch. `gestures.spec.ts:121` (double-tap zoom to a card) is new; the card ends 329 px from the centre. Each CI run fails a different subset of this file. | PLAN quality gates (CI green) | Name the button at that point in the assertion message (probably the coach mark's `GOT IT` or the Talk control). Check whether F15's anchored zoom-out changes the double-tap zoom. Run the file under Linux WebKit, not just Chromium's iPad emulation. |
| H1 | blocking (flaky gate) | new (harness) | Gate M0 failed once in seven Chromium runs, because the spec's Leonin Warleader can be in the hand after an unseeded shuffle. | PLAN quality gates ("a flaky test is a failing test") | `tests/e2e/m0.gate.spec.ts`: take the Warleader from the hand when the library has none, or fetch a 4-of. |
| F5 | minor | partly fixed | The header and seats are fixed, and the rules moved into the side column. Native selects remain, and in the draft room the "Table" select overflows its card. The 4 FFA seat diagram is cramped and its labels are inconsistent. | journey.md 4.8, board 5 | Kit Segmented controls for table and mode (as the setup sheet has). `min-width: 0` on the select's row. Seats around the table outline, labels on the outer side. |
| F8 | minor | leftover | A converted copy's name truncates in the deck page's name field ("… (cus…"). | board 3 | Let the field grow with the name up to the stat group, or show the full name in its title. |
| N4 | minor | new | 4 FFA at 1280 × 800: the side plates cover the side seats' battlefields and piles, and the plate size differs between two screenshots of the same table size. | visual.md 2.8 player plate; board 7 | Pin the side plates to the window edge outside the table's rectangle, at one size. |
| N5 | minor | known (integrator) | In 4 FFA the recovery panel's bottom edge covers the left seat's plate glyph. | journey.md 4.11 | Cap the panel's height above the left plate's top, or stack it under the tools with the plates' clamp. |
| N6 | minor | new | Deck tiles: the `SIMPLE DECK` chip and the sparkline are clipped by the tile's foot, the fact row runs past the tile's right edge, and the selected tile's name is cut to seven letters. | visual.md 2.8 deck tile (220 × 268) | Put the chip on the meta line's place only when it fits, or drop the strength name on the tile. Shorten the `SELECTED` chip to a check. |
| N7 | minor | new | With the activity drawer open at 1280 × 800, the drawer and its eye button cover the tracker's `MAIN 2` and `END`. | board 7 (tracker centred, free) | Centre the tracker in the room left of the drawer, or shrink its step labels when the drawer is open. |
| N8 | minor | new | The claim card has no filled primary, and its actions stack left-aligned. | journey.md 4.11; visual.md A2, one filled button per layer | `SIT DOWN AS …` primary, `WATCH INSTEAD` ghost, in one row, primary last. |
| N9 | minor | carried | A "Your turn · UNTAP ALL AND DRAW" toast repeats the primary just above the hand, and the own seat's name tag sits half under the hand's top edge. | visual.md 2.8 status slot; owner O1 | Drop the toast when the primary already shows the step. Hide the own name tag while the hand rests. |
| N10 | minor | carried | The HUD menu cuts its last row at 900 px (it scrolls). The GAME group has ten rows. The sandbox menu still offers `Import deck…`. | visual.md O-7; journey.md 4.10 | Split GAME into two groups. Move `Import deck…` to the sandbox's "No deck on this table" line. |
| N11 | minor | carried | The invite sheet's presence line repeats "WAITING" and runs to the sheet's edge, and the seat status reads "here CHOOSING A DECK" without a separator. | journey.md 4.8 invite sheet | One status word, and a wrapping line inside the padding. A dot between presence and deck state. |
| R1, R2, F6, F7, F9, F15, F17, F18, F19 | — | fixed and seen (screenshots, gates, CI) | — | — | — |
| F16 | needs triage | unverified (WebKit) | — | — | — |

**Real Safari:** not measured (the task did not ask for it this round, and the Studio is down).
