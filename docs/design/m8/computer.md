# M8 design: play against the computer, and practice alone

*Topic "computer" of Milestone 8. Written 20 Nov 2026 for the owner request in `docs/design/m8/owner-request.md`. Everything here is designed against the code on branch `m8` (sessions, net engine, reducer, stores, card data) and changes no reducer rule and no wire message.*

Two modes come out of this document:

- **Computer**: a 1v1 game against **Sparring**, a computer opponent that sits in the second chair, plays a simple deck by fixed heuristics, and leaves every rules question to the human.
- **Practice**: the player alone at the table with one of their decks and a **Dummy** life total to beat down (goldfishing).

Both start from the landing page with one press, need no connection and no invitation, are saved like every other game, and can be left and re-entered at any moment.

Owner sentences this topic serves (quoted in the decisions as S1–S9):

| Tag | Owner sentence |
| --- | --- |
| S1 | "options to play against computer or other players." |
| S2 | "Instant access to a new game or access to old games." |
| S3 | "the visitor is directly thrown into an arena, with manual configurations to be made and a blocky log being open. that has to be changed." |
| S4 | "Deck building should prioritize simple decks with clear mana curves" |
| S5 | "the game itself is something that can be played as a game between waiting in the landing page." |
| S6 | "leaving a game would not stop it, the state should be saved by everybody in a timed way. so when the game is left, it lands on the history, and can be re-entered." |
| S7 | "a measure of the selected deck's strength to preferably match against other players of comparable decks." |
| S8 | "complete the hole with standard game practices like in Heartstone or Heroes of the Storm" |
| S9 | "make sure to not mess up the system with memory leaks." and "Target is Safari and Chrome." |

## Rulings of the lead planner (20 Nov 2026)

Where this file and a sibling differed, the lead planner decided. These rulings override the text below; the decisions are recorded in `docs/DECISIONS.md` (`[M8 plan]`).

- **Revision 1 (after the plan review) holds over everything in this file:** `docs/design/m8/contracts.md` Part G "Computer opponent": the cue shows whenever an own card is marked attacking, in any phase; one coach mark on the primary button teaches it; Sparring proposes `concede` at 0 life; the starter recipe is section 8.1 in full (class C fills a slot; tests pin green); `ComputerRoute.svelte` renders the table frame (`kind: 'computer'`, `gather: false`, `extraShell`) and builds no shell of its own. Practice alone (`session/practice.ts`) is M8-P2's. Its leak test is `tests/sim/bot/leak.test.ts`. Acceptance runs on `?harness=computer`.
- **Who builds what** is decided by `docs/PLAN.md`, "Milestone 8: Journey, decks and matchmaking" (after revision 1: one contracts agent M8-C, then ten packages in parallel, M7-P1, M7-P2, M7-P5 and M8-P1 … M8-P7, then M8-P8 Journey integration). The chunk ids in this file (J…, MM-…, PS-…, DK-…, C…, DS-…) name pieces of work, not packages; its build plan is a checklist for the package that PLAN names, and whatever PLAN lists under "later" is not built in the overnight run.
- **Game code:** the existing room id, three words and a number (`amber-fox-93`, shown as `AMBER FOX 93`). No six-character code in M8; no stored id changes.
- **No blur in CSS anywhere:** no `backdrop-filter` and no `filter: blur()` in the shell or over a table. The arena behind Home is a still that `src/scene/still.ts` delivers already soft; a saved table behind the Gathering card is dimmed by the flat `overlay` scrim, never blurred (card faces are on it).
- **Control heights** are the kit's four: 28, 36, 44, 56 px (`visual.md` V4).
- **Deck strength** is the one formula of `decks.md` section 5, in `src/data/deck/strength.ts`; the lobby's `Band` 1 to 5 is its five bands in order.
- **Leaving** has no confirmation and no first-time dialog; the table shows a back arrow top left.
- **The primary button** always starts the selected mode; it never reads `RESUME` or `CONTINUE`. The `CONTINUE` strip under it reopens the last unfinished game.
- **Home's selector** is the journey's four-mode picker; this topic's opponent stepper of 2.1 is not built. `SOLO` has the option `( SPARRING │ ALONE )`.
- **Tonight Sparring has one level and one pace** (Steady, Normal), with `Pause Sparring` and `Sparring concedes` in its plate menu. Gentle and Keen, Calm and Brisk, `Take back Sparring's last step`, `Skip Sparring's turn`, Sparring's spoken lines beyond the log, own decks for Sparring, the goldfish clock (D18, C9) and the Dummy banner of section 11 are later. `ALONE` (a practice table with the deck dealt) is built by M8-P2.
- **The starter deck generator** lives in `src/data/starter.ts` (this topic's `data/sparring.ts`) and serves both Sparring's deck and a newcomer's first deck; its fixture pool for tests is derived from the M19 fixture cards, never fetched.
- **The cue button:** the human's cue (`Attack`, `Damage`, `Blocks done`) is shown by the HUD's primary button through `HudShellProps.primaryOverride`; this topic edits no HUD file. The opponent chip, Sparring's menu and the hidden Talk, chat and invite controls come through `plateBadge`, `plateMenuTop` and the absence of voice and `menuTop` entries.
- **The route** is `#/c/<room>`; a computer game is a `GameSummary` of kind `solo` with `opponent: 'sparring'`, always live, never gathering.

---

## 1. Decisions

Each decision has its reason and the owner sentence it serves. Lines to append to `docs/DECISIONS.md` are at the end of this section.

**D1. Spellplane gets a computer opponent; the DESIGN non-goal "No AI opponents" is lifted for one narrow kind.**
The opponent is a *sparring partner*, not a rules engine: it plays lands and creatures, attacks and blocks by power and toughness, and keeps its own book. The human stays the referee. Reason: the owner asks for it, and a table with no rules enforcement cannot host a real AI, but it can host an honest one that says what it does not know. Serves S1.

**D2. The opponent is called "Sparring" and is always labelled COMPUTER.**
Seat name `Sparring`; a `COMPUTER · <LEVEL>` chip on its plate, in the history row and in the game-over banner; a hexagon seat glyph instead of an avatar; its log and ticker lines carry the same glyph. It never has a human-looking name or avatar. Reason: honesty, and the name sets the right expectation (a partner to practise against, not a rival who knows the rules). Serves S1, S8.

**D3. The bot is a second, headless table session in the same browser, joined to the human's session over an in-page transport.**
The human's page opens two `NetSession`s for the same room: its own, and one for the bot with its own key pair, its own `SecretStore` and its own save. They talk over a new `LocalNetwork` (an in-memory `Transport` pair). The bot acts only through the `TableSession` API (`dispatch(ActionDraft)`, `draw`, `shuffle`, `mulligan`, `importDeck`). Reason: zero changes to the reducer, the sequencer, the commitments, the shuffle protocol and the resume logic; the bot is checked by exactly the code that checks a human opponent; the bot's hidden cards are as hidden from the human's HUD as a remote player's; and a later bot in a networked room is the same object on a different transport. The alternative, teaching the 640-line solo session to drive two seats and two secret stores, would duplicate what the net session already does. Serves S1, and "no reducer changes" from the brief.

**D4. The bot reads the public table and its own hand, nothing else, and this is enforced by construction.**
Its decision function takes a `BotView` built from the bot session's `getState()`, `secrets().hand` and cached card data. It never receives the human's session object, and it does not read its own library order. Reason: the hard rule on hidden information, and fairness. Serves S1.

**D5. The table is the truth; the bot never repairs what the human changed.**
Before every step the bot rebuilds its view from the table. If the human moved the bot's creature to the graveyard, changed the bot's life or untapped its lands, that is now the game. Reason: the human is the rules engine, and a bot that fights corrections is unusable on a rules-free table. Serves S1.

**D6. Human and bot coordinate combat through three plain cues: "Attack", "Damage" and "Blocks done".**
Each cue is an ordinary `ask` action with that label, sent by the human's primary button. The bot acts on the cue and answers the round with `respond ok`. Reason: the reducer has no combat steps, so the bot needs a public, logged signal for "my attackers are final", "deal damage now" and "I'm done blocking"; `ask` exists, shows in the log, works from the keyboard, and needs no new action. Serves S1, S3 (one obvious button, no configuration).

**D7. Sparring keeps the score of combat it took part in.**
After a "Damage" or "Blocks done" cue it changes life totals by ordinary `life` actions in its own name (its own life, and the human's life for its unblocked attackers), and moves its own dead creatures to its graveyard. It never moves, taps or removes a card it does not own; creatures of the human that it counts as dead get a ping and a spoken line, and the human moves them. Reason: without it every bot attack ends in bookkeeping homework, and the bot's lethal check goes wrong when the human forgets; a life total is one click to correct, while taking someone's cards off their battlefield is often wrong (tricks, regeneration, text the bot cannot read). Serves S1, S8. (Open question 1.)

**D8. The human tells the bot things through the table, not through settings.**
Life: click the number. A creature's real size: a note of the form `5/5` (absolute) or `+3/+3` (modifier) on the card, or +1/+1 and −1/−1 counters. A creature that should be dead: move it. Reason: these are the gestures the table already has; both players can see them. Serves S1.

**D9. Three levels (Gentle, Steady, Keen) and three paces (Calm, Normal, Brisk), chosen separately.**
Level changes how well it plays (casting order, attack and block thresholds, a deliberate error rate on Gentle). Pace changes only the delay between its steps (1200, 700, 300 ms). Default: Steady, Normal. Reason: Zhess's level stepper is the model the owner knows, and a newcomer wants a slow opponent that is not also a weak one. Serves S8, S1.

**D10. Sparring's decks are built in the browser at start-up from a recipe, not shipped.**
A recipe is counts per mana value plus a set code and a colour; the cards come from Scryfall at runtime and are cached. Default: a mono-coloured 40-card deck of 17 basic lands and 23 creatures with no or keyword-only rules text. Two alternatives in the same picker: **Mirror** (a copy of the human's deck) and **one of your decks**. Reason: the hard rule forbids bundled card data, and a creature-only curve deck is the one kind of deck the bot can play without lying. The same generator gives newcomers a starter deck. Serves S4, S1.

**D11. If a sparring deck cannot be loaded, the game still starts, with Mirror.**
Offline with no cached pool, or a Scryfall error: Sparring plays a copy of the human's deck, whose card data is already local, and a toast says so. Reason: "instant access" must not depend on a fetch. Serves S2.

**D12. Computer games are 1v1 only in M8.**
Bots in three- and four-player tables, Two-Headed Giant, networked rooms and drafts are on the roadmap (section 14). Reason: scope of one night; the architecture of D3 already allows them. Serves S1.

**D13. Seeded and replayable.**
A 32-bit seed, created with the game and stored with it, fixes the sparring deck and every choice the bot makes for a given table history. Decisions use a stateless keyed generator (seed, turn, step index), so nothing has to be saved to resume. The seed is never shown (Zhess: "no codes on screen"). Shuffles stay jointly random as in every game; tests inject entropy to make whole games reproducible. Reason: reproducible bug reports and gate tests asserted on state hashes. Serves the brief.

**D14. A computer game is saved continuously by both of its sessions and can be left at any instant.**
Leaving disposes the bot and both sessions; the game lands in the history as "vs Sparring" and resumes with one press, with no reconnect step, because the other player is always available. Reason: the owner's leave/rejoin rule, in its simplest case. Serves S6, S2.

**D15. Computer and Practice are the games to play while waiting.**
Both can run while the matchmaking queue searches; a found match interrupts with a toast, and the interrupted game is already saved. The queue and its timer belong to the matchmaking design; this design guarantees the "leave without loss" half. Reason: Heroes of the Storm's "browse while you queue", and the owner's sentence. Serves S5, S8.

**D16. On a first visit, the landing page's primary action starts a computer game.**
With no saved game and no deck, the selector stands on `COMPUTER · STEADY` and both sides get generated starter decks, so the first press leads to a dealt hand and a live opponent in about three seconds. Reason: a newcomer has no friends online and no deck yet. Serves S2, S3. (Open question 4; the landing design has the last word on the selector.)

**D17. Practice is the existing solo session with a Dummy.**
One practice table per press, the deck shuffled and seven cards dealt automatically, the empty second chair shown as `DUMMY · 20`. When the Dummy reaches 0 the banner reads "Dummy down on turn N", and N is stored with the deck. Reason: the solo session already does everything else; the missing parts were the entry, the automatic setup and a reason to play it. Serves S2, S3.

**D18. The goldfish clock is the deck's first strength number.**
Per deck: best turn, and the mean of the last ten kill turns. It is shown as a chip on the deck in the picker. A headless version (the bot's own plan run 200 times without a table) is an optional chunk and gives the number without playing. Reason: the owner wants a deck-strength measure for matchmaking; this is one the app can compute without a rules engine. The matchmaking design decides how to use it. Serves S7.

**D19. The bot is lazy-loaded, runs on the main thread, and pauses when the page is hidden.**
`session/computer.ts` and `bot/*` are a separate chunk imported on the first computer game. A decision costs under 2 ms. `dispose()` stops every timer and listener, and a test creates and disposes 50 games and asserts nothing is left. Reason: the landing page stays light, and the owner's warning about leaks. Serves S9.

**D20. No voice, no chat input, no invite links at a computer table.**
The HUD hides Talk, the chat field, "Invite players", "Spectator link" and "Audit". The activity ticker shows the log and Sparring's lines. Reason: nothing on screen that does nothing. Serves S3.

Lines for `docs/DECISIONS.md` (the integrator appends them):

```
- [M8-computer] DESIGN non-goal "No AI opponents" is lifted for a sparring partner: lands, creatures, attacks and blocks by heuristics, the human stays the referee — owner: "options to play against computer or other players"
- [M8-computer] The bot is a second headless NetSession in the page, joined over an in-page LocalNetwork, acting only through TableSession — no reducer, sequencer or message change; the bot's secrets are as hidden from the HUD as a remote player's
- [M8-computer] Combat with the bot runs on three `ask` cues from the human ("Attack", "Damage", "Blocks done"); the bot answers each with `respond ok` — the reducer has no combat steps and `ask` is public and logged
- [M8-computer] Sparring changes life totals after combat it took part in and moves only its own cards; the human's dead creatures are pinged, not moved — a life total is one click to correct, a wrongly removed card is not
- [M8-computer] Sparring decks are generated at runtime from a recipe (set, colour, curve) with Scryfall data; Mirror is the offline fallback — no bundled card data
- [M8-computer] Computer games are 1v1 in M8; levels Gentle/Steady/Keen, paces Calm/Normal/Brisk; seed stored, never shown
- [M8-computer] Practice is the solo session with a Dummy life total; the kill turn is stored per deck as the goldfish clock
```

---

## 2. The journey

### 2.1 On the landing page

The landing design owns the layout. This topic contributes two values to its opponent selector (the Zhess stepper: an uppercase label line, a value line, chevrons that do not wrap) and what Start does for them.

| Selector value | Line 1 (label) | Line 2 (value) | Start does |
| --- | --- | --- | --- |
| Computer | `COMPUTER` | `Sparring · Gentle`, `Sparring · Steady`, `Sparring · Keen` | Starts a computer game with the selected deck |
| Practice | `ALONE` | `Practice` | Starts a practice table with the selected deck |

Under the selector, two small pills in the Zhess position (where Zhess has colour and clock):

- **Opponent deck pill** (Computer only). Cycles `auto` · `white` · `blue` · `black` · `red` · `green` · `mirror`. A 500 ms long-press (or right-click) opens the deck library to pick one of the player's own decks for Sparring. Default `auto`: a colour that is not the main colour of the player's deck, chosen by the seed. Remembered.
- **Pace pill**. Cycles `calm` · `normal` · `brisk`. Default `normal`. Remembered.

A faint status line under the pills, in the place of Zhess's "COMPUTER READY OFFLINE":

| State | Text |
| --- | --- |
| Sparring pool for the default set is cached | `✓ SPARRING READY OFFLINE` |
| Not cached, online | `SPARRING'S DECK LOADS ON START` |
| Not cached, offline | `OFFLINE · SPARRING WILL MIRROR YOUR DECK` |

**Start pill.** One primary action, as in Zhess:

| Context | Label | Action |
| --- | --- | --- |
| No unfinished computer or practice game, or a selector was changed | `START` | New game with the selected settings |
| The last game is an unfinished computer or practice game | `RESUME` | Re-enter it; a ghost pill `NEW GAME` below starts a fresh one and leaves the old one in the history |
| While a sparring deck loads (first time, about 2 s) | spinner, `FETCHING SPARRING'S DECK…` | — |

With no deck selected (first visit), the deck slot shows the generated starter deck "Starter · Green" (same generator as D10, different colour from Sparring's), and Start uses it. The deck is saved to the library on first use with `source: 'built'`, so the player can open and edit it later.

### 2.2 Start sequence (Computer)

From Start to the first decision, about three seconds at Normal pace. The landing blur clears into the table (the stage transition of the landing design); then:

| t | What happens on the table | Text |
| --- | --- | --- |
| 0 ms | Both libraries appear as piles; the opponent plate slides in with `Sparring` and the `COMPUTER · STEADY` chip | — |
| 300 ms | Both libraries shuffle (the M7 shuffle animation and sound) | — |
| 900 ms | Seven cards are dealt to each side; Sparring's as backs at its seat | — |
| 1700 ms | First player is decided by the table's joint coin (`roll('firstPlayer', 2)`) | Banner, 1.5 s: `You go first` or `Sparring goes first` |
| 2000 ms | Mulligan prompt above the hand: `Keep` (filled) · `Mulligan` | Sparring says `I keep.` or `I mulligan.` |
| after Keep | The turn tracker lights; the first coach mark of M7-P5 appears if not seen | — |

On the very first computer game, one extra coach mark sits at the opponent plate for 6 s or until dismissed: **"Sparring plays lands and creatures. It does not know the rules. You are the referee."** (`HintId` `coachSparring`).

### 2.3 At the table

The table and HUD are the M7 ones. Differences at a computer table:

- **Opponent plate.** Name `Sparring`, hexagon glyph in its seat colour, life, hand count, and the chip `COMPUTER · STEADY` (uppercase, tracked label type). While it is acting, three dots pulse beside the name (no spinner). While paused: chip `PAUSED`.
- **Plate menu** (click or tap the plate; this is the "special menu … in the respective panel" the owner describes for re-invites, with bot items instead):

| Item | Does |
| --- | --- |
| `Pause Sparring` / `Resume Sparring` | Stops or restarts the runner. The human can move anything while paused. |
| `Pace ‹ calm · normal · brisk ›` | Changes the delay; applies from the next step |
| `Take back Sparring's last step` | Pauses, then the bot session runs `undo()` once (one action or group). Shown only while `canUndo()` |
| `Skip Sparring's turn` | The bot passes the turn at once. Shown on its turn |
| `Sparring concedes` | Ends the game as a win for the human (game-over banner) |

- **Primary button.** The M7 context button carries the cues (section 5.3): `Attack ▸`, `Damage ▸`, `No blocks ▸`, `Done blocking ▸`. On Sparring's turn outside its combat it reads `Sparring's turn` (disabled, quiet).
- **Sparring's lines** (section 7) appear as ticker entries under the activity button with the hexagon glyph and fade after 6 s; all of them are in the activity drawer.
- **Hidden:** Talk, chat input, Invite players, Spectator link, Audit, Seats and teams.
- **Menu → Table** gains `Leave game` (to the landing page; the game is saved) and `New game, same settings`.

### 2.4 Game over

The M7 game-over banner. Triggered when a life total is 0 or less after a cue was answered, or by `Sparring concedes`, or by the human's `Concede` in the menu.

| Case | Banner | Buttons |
| --- | --- | --- |
| Sparring at 0 or less | `You win` · `Turn 9 · vs Sparring · Steady` | `Rematch` (filled) · `Edit deck` · `Back` |
| Human at 0 or less | `Sparring wins` · same line | `Rematch` (filled) · `Edit deck` · `Back` |

`Rematch` starts a new game with the same decks and settings and a new seed. The banner is a statement, not a lock: closing it (Esc or tapping the table) leaves the table playable, because the life total may have been a mistake; if both totals are above 0 again, the result is cleared.

### 2.5 History

One row per game, in the history list of the landing design:

`⬡ Sparring · Steady   ·   Starter · Green vs Sparring Red   ·   Turn 6, your turn   ·   RESUME`

Finished games read `You won on turn 9` or `Sparring won on turn 7` with `REMATCH`. Practice rows read `Practice · <deck name> · Turn 4` with `RESUME`, or `Dummy down on turn 6` with `AGAIN`. Swipe or the row menu deletes a game; deleting a computer game deletes the human's table, the bot's table and the computer record together, with the undo toast of the history design.

---

## 3. Architecture

```
 Human's page (one browser tab)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  HUD + scene ──► human NetSession ──► NetEngine ─┐                           │
 │   (sees only the     own SecretStore             │   LocalNetwork            │
 │    human session)    store: tables/<roomId>      ├── (in-memory Transport    │
 │                                                  │    pair, no recording)    │
 │  BotRunner ────► bot NetSession ────► NetEngine ─┘                           │
 │   decide(view)       own SecretStore                                         │
 │   Clock, pace        store: tables/bot~<roomId>                              │
 │        ▲             identity: own key pair (JWK in the computer record)     │
 │        └── BotView = public state + bot's hand + cached card data            │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Room.** `roomId` is `c-` plus three random words and a number (the existing room-id generator), `roomKey` is empty. Nothing joins a signalling relay; Trystero is never constructed for a computer game.
- **Human session.** `openNetSession({ game: mtg, cardData, roomId, roomKey: '', transport: () => local.create(humanPeer), identity, store: stores.tables, format: '1v1' }, { createdHere: true, settleMs: 0, loneWaitMs: 0 })`. No `voice` option, so the HUD hides Talk. The human takes seat `s0` and is host and sequencer.
- **Bot session.** The same call with the bot's identity, `transport: () => local.create(botPeer)`, `store: prefixedTableStore(stores.tables, 'bot~')`, and its own nonce store (`localNonces(roomId, botPeerId)` already separates by peer id). It takes seat `s1`.
- **`LocalNetwork`** (`src/net/local.ts`). Implements the `Transport` seam for any number of in-page members. Messages are copied with `JSON.parse(JSON.stringify())` (so the plain-JSON rule is exercised) and delivered one per task through an injectable scheduler: a `MessageChannel` in the browser (not throttled like `setTimeout` in a background tab, and it yields to rendering), `setTimeout(fn, 0)` in Vitest so fake timers drive it. Unlike `LoopbackNetwork` it has no fault injection and keeps **no** `delivered` array; a `tap` callback can be attached by the leak test.
- **`prefixedTableStore(inner, prefix)`** (`src/store/computer.ts`). Wraps a `TableStore`: every `roomId` going in gets the prefix (also inside the `LogRecord` and `TableRecord` it writes), every one coming out loses it. `listTables()` on the wrapper returns only prefixed rows; the history lists tables with `!isBotTable(roomId)`.
- **Bot identity.** An ECDSA P-256 key pair generated when the game is created, exported as JWK and kept in the computer record (never a `CryptoKey` in IndexedDB; CLAUDE.md). Imported as non-extractable on resume.
- **Setup order** (the function `createComputerGame`):
  1. Resolve both decks (section 8). Prefetch their card data into the shared `CardDataSource`.
  2. Write the `ComputerGameRecord`.
  3. Open both sessions; both sit (`s0` human, `s1` bot).
  4. Human session: `evening.setLobby({ draft: null, sets: [...], pickTimer: false })`, `dispatch({ type: 'settings', settings: { passTimerMs: 3000 } })`.
  5. Both `importDeck` (ready and commit), human `evening.start()` (lobby to match), both `shuffle()` and `draw(7)`.
  6. `roll('firstPlayer', 2)` from the human session. If `rngApply` for `firstPlayer` is not in the build yet (M6.3), the human goes first.
  7. Start the `BotRunner`.
- **What the HUD receives.** The human `NetSession` (as every table route does) and a `ComputerHandle`: `{ seat, config, status(), subscribe(), pause(), resume(), setPace(), takeBack(), skipTurn(), concede(), combat(): CombatCue, dispose() }`. It never receives the bot session.
- **Module.** New folder `src/bot/` with its own ESLint element: `allow('bot', ['bot', 'core', 'data', 'games', 'util'])`; `session`, `ui` and `debug` may import `bot`. `bot/` gets the purity rules of `core/` (no DOM, no `Date`, no `performance`, no `fetch`, no Three.js, no Svelte) plus a ban on `Math.random`, and the no-`any` rule. The runner takes its clock and scheduler as arguments. `bot/` does not import `session/`: it declares the slice of `TableSession` it needs as `BotSeatPort`, which `TableSession` satisfies structurally.

### 3.1 Files

| File | Content |
| --- | --- |
| `src/bot/types.ts` | `BotLevel`, `BotPace`, `BotConfig`, `BotProfile`, `BotView`, `BotCard`, `BotPermanent`, `BotStep`, `BotSeatPort`, `Clock`, cue constants, `CombatCue` |
| `src/bot/cards.ts` | Reading a card: kind, mana cost, land colours, keywords, power and toughness |
| `src/bot/mana.ts` | Which lands to tap for a cost, or null |
| `src/bot/view.ts` | `buildView(state, secrets, cardOf, me, log)`: the only code that reads state and secrets |
| `src/bot/plan.ts` | `decide(view, profile, seed): BotStep \| null`: pure, one step at a time |
| `src/bot/combat.ts` | `chooseAttackers`, `chooseBlocks`, `combatResult` (the bookkeeping model) |
| `src/bot/place.ts` | Poses in the bot's territory: land row, creature row, attack and block displacement |
| `src/bot/cues.ts` | `combatCue(state, log, human)`: which cue is due, shared by the HUD and the bot |
| `src/bot/lines.ts` | Sparring's spoken lines (templates) |
| `src/bot/runner.ts` | `createBotRunner(port, config, clock, layout)`: subscribe, schedule, execute, watchdog |
| `src/bot/sim.ts` | Optional: headless goldfish clock |
| `src/net/local.ts` | `LocalNetwork`, `LocalTransport` |
| `src/store/computer.ts` | `ComputerStore`, `prefixedTableStore`, `isBotTable` |
| `src/data/sparring.ts` | Recipes, `buildSparringDeck(pool, recipe, seed)`, `loadSparringPool(source, set)` |
| `src/session/computer.ts` | `createComputerGame`, `resumeComputerGame`, `ComputerHandle` |
| `src/session/practice.ts` | `createPracticeTable`, `restartPractice`, practice result |
| `src/ui/computer/*` | `ComputerRoute.svelte`, `OpponentChip.svelte`, `BotMenu.svelte`, `StartSequence.svelte`, cue wiring for the primary button, `SparringLines.svelte` |
| `src/ui/practice/*` | `PracticeRoute.svelte`, `DummyPlate.svelte`, `PracticeBanner.svelte` |
| `src/debug/bot.ts` | Debug hook part `bot` |

---

## 4. What the bot reads, and what it never does

### 4.1 `BotView`

Built by `buildView` before every decision. Everything in it is either public state or the bot's own hand.

```ts
interface BotView {
  me: SeatId; opp: SeatId;
  turn: { number: number; active: SeatId; phase: PhaseId };
  life: { me: number; opp: number };
  hand: BotCard[];                 // own hand, with identities, from the bot's own SecretStore
  library: number;                 // own library: the count only
  oppHand: number; oppLibrary: number;      // counts only
  mine: BotPermanent[];            // own battlefield
  theirs: BotPermanent[];          // opponent's battlefield; a face-down card is { unknown: true, power: 2, toughness: 2 }
  stack: { id: StackItemId; controller: SeatId; mine: boolean; card?: InstanceId }[];
  round: { id: RoundId; askedBy: SeatId; label: string; about?: StackItemId; answered: boolean; holder?: SeatId } | null;
  blocks: { blocker: InstanceId; attacker: InstanceId }[];     // from block lines
  arrived: Record<InstanceId, number>;       // turn on which each own permanent reached the battlefield (from the log)
  landPlayedThisTurn: boolean;               // from the log
  cue: CombatCue;                            // from bot/cues.ts
}

interface BotCard { id: InstanceId; name: string; kind: 'land' | 'creature' | 'other'; cost: ManaCost | null; mv: number;
                    colours: Colour[]; power: number; toughness: number; keywords: Keyword[] }
interface BotPermanent extends BotCard { tapped: boolean; combat?: 'attack' | 'block'; counters: Record<string, number>;
                                         note?: string; unknown?: true; pose: Pose }
```

| The bot reads | Source |
| --- | --- |
| Zones, cards, poses, taps, counters, notes, lines, stack, turn, phase, life, the open confirmation round | `botSession.getState()` (public state) |
| Its own hand | `botSession.secrets().hand` and `.identities` |
| Card data of its hand and of public face-up cards | `botSession.cardData(ref)` (the shared cache; never a fetch) |
| What happened this turn (land played, arrivals, cues) | `botSession.log()` since the last `turnPass` |
| Level, pace, seed | `BotConfig` |

### 4.2 Never

1. Never reads another seat's secrets. It has no reference to the human session, and the human's hidden identities never reach the bot's engine (the same leak scanner that covers remote peers covers the bot's transport).
2. Never reads its own library order or the identities of cards in its library. `buildView` takes `secrets.libraryOrder.length` only. It does not use `lookAt`.
3. Never uses a card the human revealed to it alone (`revealTo`); the view does not carry those identities.
4. Never moves, taps, flips, attaches, counters, notes or removes a card it does not own, and never touches the human's hand, library, graveyard or exile. Two exceptions, both visible and logged: a `ping` on a human creature it counts as dead, and a `life` change on the human's seat for its own unblocked attackers (D7).
5. Never presses Hold, never starts a timed round to pressure the human, never auto-passes (`autoPass`) on the human's behalf.
6. Never changes the stage, the format, the lobby or the table settings after setup; never proposes "next game" or "new draft".
7. Never undoes on its own. `undo()` runs only from the human's `Take back` menu item.
8. Never restores a state the human changed (D5). It does not move a creature back, re-tap a land or put its life back.
9. Never acts outside its windows: its own turn, and its answers to rounds and cues on the human's turn.
10. Never writes free text. Its `chat` lines come from the fixed templates of section 7, filled with card names and numbers.
11. Never touches the network, the clock or randomness directly: no `fetch`, no `Date`, no `Math.random`, no language model, no analytics. Card data is whatever the session's cache holds.
12. Never claims rules knowledge. It does not say "you can't do that"; it says what it counts and that the human decides.

---

## 5. How Sparring plays

`decide(view, profile, seed)` returns the next single step or null (nothing to do: wait). The runner waits the pace delay, rebuilds the view, calls `decide` again, and executes the result if it is still the same kind of step. One step is one user-visible gesture.

### 5.1 Steps

| `BotStep` | Executed as (all through the bot's `TableSession`) |
| --- | --- |
| `keep` / `mulligan` | Nothing / `mulligan()` then `bottom` |
| `bottom {cards}` | `dispatch({ type: 'toZone', card, to: library, position: 'bottom' })` per card, one `group` |
| `untap {cards}` | `dispatch({ type: 'tap', card, tapped: false })` per card, one `group` |
| `phase {phase}` | `dispatch({ type: 'phaseSet', phase })` |
| `draw` | `draw(1)` |
| `playLand {card, pose}` | `dispatch({ type: 'move', card, to: 'battlefield:s1', pose })` (the session emits the `reveal`) |
| `cast {card, pay}` | `tap` each land in `pay` (one `group`), then `dispatch({ type: 'stackPush', item, kind: 'spell', card })` |
| `resolve {item, pose}` | `dispatch({ type: 'stackResolve', item, to: 'battlefield:s1', pose })` |
| `attack {attackers}` | `dispatch({ type: 'moveTemp', card, pose, combat: 'attack', tap })` per attacker, one `group`; then a spoken line |
| `block {pairs}` | `moveTemp {combat: 'block'}` and `lineAdd {kind: 'block', from: blocker, to: attacker}` per pair, one `group` |
| `answer {round}` | `dispatch({ type: 'respond', round, seat: me, response: 'ok' })` |
| `book {life, bury, pings, line}` | `life` actions, `toZone` of own dead creatures to `graveyard:s1`, `ping` on the human's, one `chat` line; one `group` for the bot's own cards |
| `settle {cards}` | `dispatch({ type: 'settle', cards })` for its own displaced cards |
| `discard {cards}` | `toZone` to `graveyard:s1` |
| `passTurn` | `dispatch({ type: 'turnPass', to: opp })` |
| `say {line}` | `chat(text)` |

### 5.2 Sparring's turn

In order; each row is tried top to bottom and the first that applies is the next step.

| # | Condition | Step |
| --- | --- | --- |
| 1 | Phase is `untap` and it controls tapped cards | `untap` all of them |
| 2 | Phase is before `draw` | `phase draw` |
| 3 | Phase is `draw`, no draw this turn, and not (turn 1 and it is the starting player) | `draw`. Empty library: `say` "I'm out of cards. By the book that's my loss; your call." once, and go on |
| 4 | Phase is `draw` | `phase main1` |
| 5 | Main phase, no land played this turn, a land in hand | `playLand`: the land that adds a colour its hand needs and its lands lack; else any |
| 6 | Main phase, an own item on the stack whose round has passed | `resolve` it to the creature row |
| 7 | Main phase, an own item on the stack, round open | wait (null). The human's Hold is respected without limit; after 20 s a single line: "Take your time. Release the hold when you're done." |
| 8 | Main phase, stack empty, a castable creature in hand | `cast` one, chosen by the level's casting order (5.5) |
| 9 | Phase `main1`, nothing more to cast | `phase combat` |
| 10 | Phase `combat`, no attackers yet, `chooseAttackers` is not empty | `attack`, with the line "I attack with N. Block, then press Done." |
| 11 | Phase `combat`, attackers out, cue "Blocks done" not yet answered | wait (the human blocks and presses the primary button) |
| 12 | Phase `combat`, cue "Blocks done" open | `book` the result, then `answer`, then `settle` its attackers |
| 13 | Phase `combat`, nothing to attack with, or combat done | `phase main2` |
| 14 | Phase `main2`, nothing more to cast | `phase end` |
| 15 | Phase `end`, more than seven cards in hand | `discard` down to seven: cards it cannot play first, then the most expensive |
| 16 | Phase `end` | `passTurn` |

Row 6 before row 8 means a countered spell (the item is gone, the card in the graveyard) is simply skipped: the mana stays spent, and Sparring says "Fair." once per turn.

**Opening hand.** Gentle keeps any seven. Steady and Keen mulligan a seven-card hand with 0, 1, 6 or 7 lands, once; a six-card hand is always kept; the card put on the bottom is a land if it holds five or more, else its most expensive card.

**Watchdog.** A bot turn ends itself (`passTurn`, line "I'll pass.") after 80 steps or after the same step kind was refused by the reducer three times. A step that throws is caught; after three consecutive throws the runner stops, the plate chip reads `STOPPED`, the menu offers `Resume Sparring`, and the human can play on alone.

### 5.3 The human's turn, and the cues

On the human's turn Sparring only answers.

| What the human does | What Sparring does |
| --- | --- |
| Puts a spell or ability on the stack (a round opens) | `answer` OK after `max(300, min(pace, 600))` ms. It never responds with a card. |
| Asks anything else (`Ask`, K) | `answer` OK |
| Cue **Attack** | `block` per `chooseBlocks` (or the line "No blocks."), then `answer` |
| Cue **Damage** | `book` the result of the combat on the table, then `answer` |
| Changes Sparring's life, moves or removes Sparring's cards, adds counters or notes | Nothing; the next view contains it |
| Passes the turn | Row 1 of 5.2 |

The cues are `ask` actions with the labels `Attack`, `Damage` and `Blocks done` (matched trimmed and case-insensitively; constants in `bot/types.ts`). The HUD sends them from the primary button; a keyboard player can type them with Ask.

Primary button at a computer table (`combatCue` decides; everything else is the M7 button):

| Situation | Label | Dispatches |
| --- | --- | --- |
| My combat step, at least one of my cards has `combat: 'attack'`, no Attack cue yet this combat | `Attack ▸` | `ask { label: 'Attack' }` |
| Attack cue answered, no Damage cue yet | `Damage ▸` | `ask { label: 'Damage' }` |
| Damage cue answered | `Main 2 ▸` | `settle`, then `phaseSet main2` |
| Sparring's combat, it has attackers, I have no block line | `No blocks ▸` | `ask { label: 'Blocks done' }` |
| Same, I have at least one block line | `Done blocking ▸` | `ask { label: 'Blocks done' }` |

Between `Attack ▸` and `Damage ▸` the human may cast tricks, add counters or write `+3/+3` notes; `Damage` counts what is on the table at that moment. If the human attacks and leaves combat without the cues, Sparring books nothing and, once per game, says: "Tip: press Attack so I can block and count the damage." The human can always set its life by hand.

### 5.4 Reading cards (`bot/cards.ts`)

| Question | Answer |
| --- | --- |
| Kind | From the current face's `type_line`: contains `Land` → land; contains `Creature` → creature; else other. Sparring casts creatures only; `other` cards stay in its hand ("cards I can't play") and are discarded first. |
| Mana cost | Parsed from `mana_cost`: generic digits, `{W}{U}{B}{R}{G}{C}`. Any other symbol (X, hybrid, Phyrexian, snow) makes the card unplayable for Sparring. |
| Land colours | Basic land types in `type_line` (Plains W, Island U, Swamp B, Mountain R, Forest G); else the symbols after "Add" in `oracle_text`; "any color" is all five; nothing found is colourless. |
| Power, toughness | `power` and `toughness` as integers (`*` and other non-numbers are 0), plus `counters['+1/+1']`, minus `counters['-1/-1']`. A note `N/M` replaces the result; a note `+N/+M` or `-N/-M` is added. A face-down card is 2/2. A token without card data is 1/1. |
| Keywords | Whole words in `oracle_text` outside parentheses: flying, reach, first strike, double strike, deathtouch, trample, vigilance, haste, lifelink, menace, defender, indestructible. Nothing else in the text is read. |
| Summoning sick | An own creature whose `arrived` turn is the current turn, unless it has haste. |

Paying (`bot/mana.ts`): untapped own lands, one mana each. Coloured symbols first, each from the land with the fewest colours that can pay it; then generic from the lands whose colours the rest of the hand needs least. No mana abilities other than lands.

### 5.5 Levels

`BotProfile` is a plain object per level; the code is the same.

| | Gentle | Steady (default) | Keen |
| --- | --- | --- | --- |
| Casting order | Cheapest castable creature first | Most expensive castable first | The set of creatures that spends the most mana this turn; ties by total power |
| Land choice | First land in hand | Colour-aware (5.2 row 5) | Colour-aware |
| Mulligan | Never | 0, 1, 6 or 7 lands | Same |
| Attacks with a creature when | No untapped opposing creature can block it and kill it | Gentle's rule, or every blocker that kills it also dies and costs at least as much mana | Steady's rule; plus all-out when total power minus what the human's blockers can stop is at least the human's life; plus all-out when its clock (turns to kill) is shorter than the human's |
| Holds back | Nothing | Nothing | Enough untapped creatures to survive the human's visible attack next turn, when that attack would be lethal |
| Blocks when | The blocker kills the attacker and survives | Gentle's rule, or both die and the attacker costs at least as much; a chump block only when unblocked damage would be lethal | Steady's rule |
| Deliberate slips | One decision in six (keyed by seed, turn, step) takes the second-best option | None | None |
| Sparring deck | Commons only, picked at random among eligible cards | Commons and uncommons by rate | Commons and uncommons by rate |

One blocker per attacker in M8; Sparring does not block a creature with menace and does not gang-block. A creature with flying is blocked only by flying or reach. Defenders do not attack. Vigilance attackers are not tapped (`tap: false`).

### 5.6 The bookkeeping model (`combatResult`)

Used only to count a combat that is on the table when a cue arrives. Attackers are the cards with `combat: 'attack'`; blocks are the block lines; blockers of one attacker are ordered left to right in the defender's frame (DESIGN: "their left-to-right order is the damage order").

1. First-strike and double-strike creatures deal damage first; creatures killed then deal none.
2. An unblocked attacker deals its power to the defending player.
3. A blocked attacker deals lethal damage to its blockers in order (1 is lethal with deathtouch); with trample the rest goes to the player. Each blocker deals its power to the attacker.
4. A creature with damage of at least its toughness, or any damage from deathtouch, dies, unless indestructible.
5. Lifelink: its controller gains the damage dealt.

What Sparring then does:

| Outcome | Action | Line |
| --- | --- | --- |
| Damage to Sparring | `life { seat: s1, delta: −N }` | "I take N." |
| Damage to the human from Sparring's attackers | `life { seat: s0, delta: −N }` | "N to you." |
| Sparring's lifelink | `life { seat: s1, delta: +N }` | "+N for me." |
| The human's lifelink | Nothing | "Lifelink: +N for you, if I read it right." |
| Sparring's creature dies | `toZone` to its graveyard | "My <name> dies." |
| The human's creature dies | `ping` on it | "I count your <name> as dead. Your move." |
| Nothing happened | — | "No damage." |

All lines of one combat are joined into one chat message of at most 200 characters; beyond that it ends with "… see the log."

---

## 6. Pace and timing

| Pace | Delay before each step | Delay before answering a round |
| --- | --- | --- |
| Calm | 1200 ms | 600 ms |
| Normal (default) | 700 ms | 600 ms |
| Brisk | 300 ms | 300 ms |

- Between tapping lands and the `stackPush` of one `cast`: 250 ms at every pace.
- The table's pass timer is set to 3 s at setup, so Sparring's creature spells resolve after 3 s of silence or at once on OK (Enter).
- The M7 card animations (160–480 ms) run inside the delay; Brisk is the floor at which every move is still seen.
- The runner pauses while `document.hidden` (wired in `ui/computer`, since `bot/` has no DOM) and resumes 500 ms after the page is visible again.
- While both engines sit in a throttled background tab, heartbeats may arrive late and a seat can flip to away and back. That is harmless (away is informational), and the bot is paused anyway. A sim test covers a 60 s timer stall.
- `prefers-reduced-motion` does not change the pace; it changes the animations, as everywhere.

---

## 7. Sparring's lines

Fixed templates in `bot/lines.ts`, English, sentence case, at most 80 characters before card names. Each is a `chat` action by the bot's seat, so it is in the log with attribution.

| Moment | Line |
| --- | --- |
| Start, keeps | "I keep." |
| Start, mulligans | "I mulligan." |
| First game ever (after the coach mark) | "I play lands and creatures. You're the referee." |
| Attack | "I attack with N. Block, then press Done." (N = 1: "I attack with <name>.") |
| No attack on a board with creatures | "No attack." |
| Blocks | "I block <attacker> with <blocker>." (joined for several) |
| No blocks | "No blocks." |
| Combat result | Section 5.6 |
| Spell countered | "Fair." |
| Human holds for 20 s | "Take your time. Release the hold when you're done." |
| Missing cues (once per game) | "Tip: press Attack so I can block and count the damage." |
| Library empty | "I'm out of cards. By the book that's my loss; your call." |
| Watchdog | "I'll pass." |
| Sparring at 0 or less | "Good game." |
| Human at 0 or less | "I think that's the game. Good game." |
| Recovered after a lost save | "I lost track of my hand. I reshuffle and draw N. OK?" (the recovery round's label) |

---

## 8. Decks

### 8.1 Sparring decks (`data/sparring.ts`)

A recipe is data without card names:

```ts
interface SparringRecipe {
  set: SetCode;                       // default: the "latest core set" constant of the draft design (FDN), fallback 'M21'
  colour: 'W' | 'U' | 'B' | 'R' | 'G';
  size: 40 | 60;                      // 60 when the human's main deck has 60 or more cards, else 40
  lands: number;                      // 17 | 24
  curve: Record<1 | 2 | 3 | 4 | 5 | 6, number>;   // 6 means "6 or more"
  maxCopies: number;                  // 2 | 4
}
```

| Size | Lands | MV 1 | MV 2 | MV 3 | MV 4 | MV 5 | MV 6+ | Copies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 17 | 3 | 7 | 6 | 4 | 2 | 1 | up to 2 |
| 60 | 24 | 4 | 11 | 9 | 7 | 3 | 2 | up to 4 |

**Pool.** `CardDataSource.sparringPool(set)`: in production one paged Scryfall search, `e:<set> game:paper (t:creature or t:basic) r<=uncommon -is:digital`, through the shared limiter (two to three requests, about 2 s the first time). The resulting ids are remembered per set in localStorage (`spellplane:sparringPool:<SET>`, about 8 kB, rebuildable), and the cards are in the IndexedDB card cache, so later games and offline play need no request. The fixture source answers from the injected fixture cards.

**Eligible creature.** Layout `normal`; mono-coloured in the recipe's colour; a cost Sparring can parse; numeric power and toughness; no defender; and a text class:

| Class | Rule | Used |
| --- | --- | --- |
| A, vanilla | No `oracle_text` | First |
| B, keywords only | After removing reminder text, every clause is one of: flying, reach, first strike, double strike, deathtouch, trample, vigilance, haste, lifelink, menace, flash, hexproof, ward | First |
| C, other text | Not matching `can't attack`, `can't block`, `enters tapped`, `additional cost`, `sacrifice`, `upkeep`, `{X}` | Only to fill a slot A and B cannot fill |

**Picking.** Per mana-value slot: eligible cards sorted by rate, `(power + toughness) / max(mv, 1)`, ties broken by a seeded shuffle; take from the top, up to `maxCopies` each, until the slot is full. Gentle skips the sort and takes commons at random. An unfillable slot borrows from the nearest slot; if the deck still falls short, generation fails and Mirror is used (D11). Basics: one printing of the colour's basic land from the same set, chosen by the seed; if the set has none, the pool query's newest basic.

**Name.** `Sparring White`, `Sparring Blue`, `Sparring Black`, `Sparring Red`, `Sparring Green`. The starter deck offered to a newcomer is the same generator with the name `Starter · <Colour>`.

The generator uses `mulberry32(seed ^ 0x5eed)` from `util/prng.ts` and is pure: `buildSparringDeck(pool, recipe, seed): { name, main: CardRef[] } | null`.

### 8.2 Mirror and own decks

- **Mirror.** Sparring's `main` is a copy of the human's main deck refs. No sideboard.
- **One of your decks.** Any `DeckRecord` from the library.

In both cases Sparring plays the lands and creatures and holds the rest. Before start, if fewer than a third of the deck's non-land cards are creatures it can cast, the setup shows one line under the pills: `SPARRING CAN PLAY 9 OF THIS DECK'S 36 SPELLS`. It does not block Start.

---

## 9. Determinism and the seed

- `seed`: `crypto.getRandomValues` at game creation (in `session/computer.ts`, not in `bot/`), stored in `BotConfig`, never shown.
- Deck: `buildSparringDeck(pool, recipe, seed)`.
- Decisions: `decide` is pure. Where it needs a random choice (Gentle's slips, tie-breaks) it calls `keyed(seed, turn.number, stepIndex, salt)`, a 32-bit hash to [0, 1), where `stepIndex` counts the bot's own actions this turn in the log. No generator state exists, so a resumed game continues identically.
- Guarantee: the same `BotConfig`, the same sequence of public states and the same own hand give the same `BotStep`s. The shuffles are the table's joint randomness (owner nonce plus peer nonces) and are not derived from the seed.
- In tests, `NetSessionInternals.entropy` and `nonces` are injected for both sessions and the `Clock` is Vitest's fake timers, so a whole game is reproducible and its final `stateHash` is asserted.

---

## 10. Save, leave, resume, failure

### 10.1 Data

```ts
// store 'computer', key roomId (added by the M8 contracts package)
interface ComputerGameRecord {
  roomId: string;
  createdAt: number; updatedAt: number;
  bot: {
    config: BotConfig;                          // { level, pace, seed, name: 'Sparring' }
    identity: ExportedIdentity;                 // JWK pair, peerId, nickname 'Sparring', seatColour
    seat: SeatId;                               // 's1'
    deck: { name: string; choice: OpponentDeckChoice; main: CardRef[] };
  };
  human: { deckId: string | null; deckName: string };
  result?: { winner: 'human' | 'bot'; turn: number; at: number };
}

type OpponentDeckChoice =
  | { kind: 'sparring'; colour: 'W' | 'U' | 'B' | 'R' | 'G'; set: SetCode }
  | { kind: 'mirror' }
  | { kind: 'deck'; deckId: string };

// Settings (new key, contracts package): what the landing selector remembers
interface ComputerPrefs { level: BotLevel; pace: BotPace; deck: 'auto' | 'W' | 'U' | 'B' | 'R' | 'G' | 'mirror' | { deckId: string } }
```

The bot's `main` is stored so the lost-save recovery can re-import it without a fetch.

### 10.2 Saving

Both sessions write through `TablePersistence` as always: every applied action with the table record and the secret store in one transaction, the human's under `roomId`, the bot's under `bot~roomId`. Whatever timed checkpoint the save/rejoin design adds applies to both, because both are ordinary net sessions. `updatedAt` and `result` of the computer record are written by `session/computer.ts` on turn change and at game over.

### 10.3 Leaving and resuming

- **Leave** (Back, `Leave game`, navigating away, a found match): `handle.dispose()` stops the runner, awaits `whenSaved()` of both sessions for at most 500 ms, calls `leave()` on both, and drops the `LocalNetwork`. `pagehide` does the same without waiting.
- **Resume**: `resumeComputerGame(roomId)` reads the computer record, imports the bot's key pair, opens both sessions on a new `LocalNetwork`, lets the engines reconcile (the copy with the highest seq wins, as between any two peers), waits 1 s with the chip `RESUMING`, then starts the runner. Because decisions are stateless, the bot continues from whatever the table shows.

### 10.4 Failure behaviour

| Failure | Behaviour |
| --- | --- |
| Sparring deck cannot be generated (offline, Scryfall error, pool too small) | Toast: "Couldn't load a sparring deck. Sparring mirrors your deck." Game starts with Mirror. |
| The human's own deck has cards without cached data and the network is down | Start is refused with the inline message "This deck's card data isn't on this device yet. Connect once to load it." |
| IndexedDB is blocked | The game runs unsaved; the bot's identity lives in memory; a notice under the turn tracker for 6 s: "This game won't be saved (storage is blocked)." |
| The bot's save is behind the human's after a crash (its secret store misses the last draw) | The net session's lost-save detection (`recoveryStatus`) fires for the bot; the runner calls `recover(deck, hand)` with its stored deck and the hand count public state shows; the human sees the usual recovery round with the label from section 7 and OKs it. |
| The computer record is missing (cleared, or restored from a backup without it) | The history row reads `Sparring is gone`; it offers `Rematch` (new game, same deck) and `Open alone` (the table with Sparring's seat away, for reading the board). |
| The reducer refuses a bot action (the human changed the table in between) | The step is dropped and `decide` runs again on the new state. Three refusals of the same step kind in one turn: that step kind is skipped for the turn. |
| A step throws | Caught and logged to the console; three in a row stop the runner (`STOPPED` chip, `Resume Sparring` in the menu). The table never crashes with it. |
| The human holds a round and walks away | Sparring waits. Nothing times out on the bot's side. |
| State hash mismatch between the two engines | The engines resync as designed and log it; the runner re-reads the state. A mismatch here means a reducer bug and fails the sim tests. |
| Two tabs open the same computer game | The second tab's human session meets no peer (the `LocalNetwork` is per page) and its saved seat is already held by the same key pair. The route detects the open game through a `BroadcastChannel` named `spellplane:computer:<roomId>` and shows "This game is open in another tab." with `Take over here` (the other tab leaves). |

---

## 11. Practice mode

**Entry.** Selector value `ALONE · Practice`, Start. Also from the deck builder: `Try this deck` in the deck's tools, which is the same call.

**Setup** (`createPracticeTable(deck)`), with no prompts:

1. `createSoloSession({ game: mtg, cardData, store, roomId: 'p-' + id })` (the solo session already takes a room id).
2. `importDeck(deck)`, `shuffle()`, `draw(7)`.
3. The route shows the table with the mulligan prompt `Keep` · `Mulligan`.

**The Dummy.** The solo table has an empty second chair with a life total. On a practice table the HUD draws it as a plate at the far edge: a dashed circle glyph, the label `DUMMY`, life `20`. Click or scrub the number to change it, as any life total. The Dummy has no cards and does nothing. Attacks need no cue: the player attacks and takes the Dummy's life down by hand, or uses the one practice-only affordance: with attackers out, the primary button reads `Hit Dummy for N ▸` (N is the summed power of the attacking cards, read with `bot/cards.ts`), which dispatches `life { seat: s1, delta: −N }` and `settle`.

**Tools** (primary button and menu; all existing actions):

| Control | Does |
| --- | --- |
| Primary button | The M7 context button: `Draw`, `To combat ▸`, `Hit Dummy for N ▸`, `End turn ▸`. `End turn ▸` passes the turn to the player again, offers "untap and draw" as M7 does, and increases the turn number |
| `Restart` (menu, and `AGAIN` on the banner) | Deletes this practice table and creates a new one with the same deck |
| `Mulligan`, `Draw several`, `Shuffle`, `Untap all` | As at any table |
| `Edit deck` | Opens the deck builder on this deck; coming back offers `Restart with the changes` |

**Turns.** The solo table's turn passes from the player to the player. If the reducer's `turnPass` insists on a different seat, the practice route passes to the Dummy and immediately back in one group; the turn number shown is the count of the player's own turns.

**Dummy down.** When the Dummy's life is 0 or less: banner `Dummy down on turn N` with `Again` (filled) · `Edit deck` · `Back`. The result is stored with the deck:

```ts
// DeckRecord.practice (new optional field, contracts package)
interface PracticeStats { runs: number; best: number; recent: number[] }   // recent: the last 10 kill turns, newest last
```

The deck picker shows the chip `CLOCK 6.2` (mean of `recent`, one decimal) once there are three runs, and `BEST T5` in the deck's detail. A run counts only if the Dummy started at 20 and its life was only ever lowered.

**History.** At most one unfinished practice table per deck is kept; starting a new one for the same deck replaces it. Finished ones are kept as rows until deleted.

**Headless clock (optional chunk).** `bot/sim.ts`: `goldfishClock(deck: CardData[], seed, games = 200): { mean: number; best: number; fizzle: number }`. It needs no table: a micro-simulation of draw, one land per turn, the Keen casting plan, every non-sick creature attacking, summed power against 20 life, cut off at turn 15 (`fizzle` is the share of games that hit the cut-off). It reads creatures and lands only, so it under-rates spell decks; the chip then reads `CLOCK ~6.4` with the tilde. It runs in chunks of 20 games per idle callback and is cached on the deck by a hash of its main list.

---

## 12. Debug hook and tests

**Debug hook** (dev and test builds, registered with `registerDebug`): `window.__spellplane.bot = { config(), status(), view(), lastStep(), steps(): number, pause(), resume(), stepNow(), setPace(p) }`. `view()` is the bot's own `BotView`; it exists so tests can assert what the bot saw.

**Test layers**

| Layer | Where | What |
| --- | --- | --- |
| Unit | `tests/unit/bot/*.test.ts` | Card reading over every M19 fixture card; mana payment tables; `decide` on hand-written views; attack and block choices per level; `combatResult` cases (first strike, deathtouch, trample over two blockers, lifelink, indestructible, notes and counters) |
| Unit | `tests/unit/data/sparring.test.ts` | Decks from the M19 fixture pool for all five colours and both sizes: counts, curve, copies, eligibility, same seed same deck |
| Sim | `tests/sim/computer.test.ts` | Two sessions on a `LocalNetwork` with fake timers and injected entropy: scripted human against Sparring for 8 turns; final `stateHash` equals a recorded value; resume in the middle gives the same hash |
| Soak | `tests/sim/bot-soak.test.ts` | Bot against bot (the second runner sends the cues itself, `cues: 'self'`), 200 seeds, M19 sparring decks: every game ends with a life total at 0 or less or an empty library before turn 40; no throw; refused actions under 1 % |
| Leak | `tests/leak/computer.test.ts` | Section 12.1 |
| Lifecycle | `tests/unit/session/computer-dispose.test.ts` | Create and dispose 50 games: `vi.getTimerCount()` is 0, the `LocalNetwork` has no members, the runner has no listeners |
| e2e | `tests/e2e/computer/*.spec.ts`, `tests/e2e/practice/*.spec.ts` | From the landing page with fixture cards and `?faces=placeholder`: start, three turns by pointer only, leave, resume; the practice flow to "Dummy down" |

### 12.1 Leak scenarios (shared leak test)

1. **Human to bot.** Play the sim game with the leak scanner tapped on the `LocalNetwork`: no message delivered to the bot's transport contains the Scryfall id or salt of a card that is in the human's hand or library at that moment.
2. **Bot to human.** The same for the bot's hand and library toward the human's transport.
3. **Non-interference.** Run the sim twice with the same seed, the same entropy for the bot and the same human script, but a different human deck order (different human entropy) such that the public history is the same for the first three turns: the bot's `BotStep` sequence over those turns is identical.
4. **Own library.** `buildView` output, serialised, contains no identity of a card in the bot's library (asserted over every view of the sim game).
5. **HUD.** In the e2e test, `__spellplane.secrets()` (the human session) never contains an id of the bot's hand, and no DOM text contains the name of a card in the bot's hand before it is cast.

---

## 13. Build plan

Chunks of two to four hours. `C0` belongs to the M8 contracts package; the rest can go to package agents. Dependencies: C1 → C2 → C3 → C4 → C6; C5 and C7 are independent of the others; C8 needs C4; C9 needs C1 and C2.

### C0. Contracts (inside M8-C, about 1 h of it)

- `eslint.config.js`: element `bot` (`src/bot`), policy `allow('bot', ['bot', 'core', 'data', 'games', 'util'])`; add `bot` to the allow lists of `session`, `ui`, `debug`; apply the `core/` purity rules and the no-`any` rule to `src/bot/**`, plus a restricted property for `Math.random`.
- `src/bot/types.ts`: every type of section 3.1, the cue constants, `BOT_PACE_MS`, `BOT_LEVELS`.
- `src/store/types.ts`: `ComputerGameRecord`, `OpponentDeckChoice`, `ComputerStore { get, put, delete, list }`, store `computer` in `SpellplaneDB` (schema version bump with the other M8 stores), `Settings.computer: ComputerPrefs` with default `{ level: 'steady', pace: 'normal', deck: 'auto' }`, `DeckRecord.practice?: PracticeStats`, `HintId` `coachSparring`, backup file: `computer` rows travel with their tables.
- `src/data/types.ts`: `CardDataSource.sparringPool?(set: SetCode): Promise<CardData[]>`.
- `src/ui/routes.ts`: `{ name: 'computer'; room: string }` as `#/c/<room>` and `{ name: 'practice'; room: string }` as `#/p/<room>` (names follow the journey design if it chooses others).
- `src/debug/types.ts`: the `bot` part of the hook.
- `docs/DESIGN.md`: Non-goals, replace "No AI opponents. Draft bots, if any, exist only to fill seats." with "No rules-playing AI. A sparring partner (M8) plays lands and creatures by heuristics and leaves the rules to the human." Add `bot/` to the module list.

Acceptance: `pnpm check` green with stubs; importing `src/session` from `src/bot` fails lint.

### C1. Card reading and mana (`bot/cards.ts`, `bot/mana.ts`), 2–3 h

Acceptance (unit): every creature and land in `tests/fixtures/scryfall/m19.json` gets a kind, and every creature with a plain cost gets a parsed cost; X and hybrid costs return null; land colours are right for the five basics and for a fixture dual land; notes `5/5` and `+3/+3` and both counter kinds change power and toughness as specified; `pay` finds a payment for `{1}{R}{R}` with Mountain, Mountain, Forest and none with Mountain, Forest, Forest; a face-down card reads 2/2.

### C2. View and own-turn plan (`bot/view.ts`, `bot/plan.ts`, `bot/place.ts`, `bot/lines.ts`), 3–4 h

Rows 1–9 and 13–16 of section 5.2, the opening-hand rule, the three casting orders, poses (land row along the back of the territory, creature row in front, both left to right with `GEOMETRY.gap`, wrapping to a second row at the territory width).

Acceptance (unit, hand-written `BotView`s): turn 1 on the play does not draw; one land per turn; with lands `RRG` and hand {2-drop R, 3-drop RR, 3-drop G}: Gentle casts the 2-drop, Steady a 3-drop, Keen a 3-drop (three mana spent beats two); a stack item of its own with an open round yields null; with the item gone it goes on; eight cards at end yields a discard of an unplayable card; the same view and seed give the same step 1000 times; poses stay inside the seat's territory for 30 permanents.

### C3. Combat (`bot/combat.ts`, `bot/cues.ts`, plan rows 10–12 and section 5.3), 3–4 h

Acceptance (unit): the level table of 5.5 as cases (a 2/2 into an untapped 3/3: no attack at any level; a 3/3 into a 2/2: attack at every level; an even trade: only Steady and Keen; lethal all-out: Keen); flying, reach, defender, vigilance, menace and summoning sickness respected; chump block only at lethal; `combatResult` for each rule of 5.6; `combatCue` returns the right cue for each situation of the primary-button table; a `Damage` cue without `Attack` counts the combat with no blocks.

### C4. Runner, local network, computer session (`bot/runner.ts`, `net/local.ts`, `store/computer.ts`, `session/computer.ts`, `debug/bot.ts`), 4 h

`createComputerGame(opts)` and `resumeComputerGame(roomId, opts)` as in section 3; the `ComputerHandle`; watchdog; pause, pace, take back, skip, concede; `main.ts` gets `openComputer`, shaped like `openRoom`, lazy-importing `session/computer`.

Acceptance (sim, fake timers, M19 fixture decks): a game reaches turn 8 with a scripted human; its final `stateHash` matches the recorded one on every run; the bot's hand in the human session's state is opaque ids only; disposing mid-turn and resuming yields the same final hash as the uninterrupted run; a bot save rolled back by one draw triggers the recovery round and the game continues; a 60 s timer stall produces at most away and back, no stuck state; the dispose test of section 12 passes; no Trystero code is loaded (assert on the module graph of the chunk).

### C5. Sparring decks (`data/sparring.ts`, `ScryfallCardDataSource.sparringPool`, fixture source), 2–3 h

Acceptance (unit): the tests of section 12 for `tests/unit/data/sparring.test.ts`; a pool with too few creatures returns null; the localStorage id cache is read before any request (fake `fetch` asserts zero calls on the second build); the Scryfall query string is exactly the one in 8.1.

### C6. UI (`ui/computer/*`, HUD wiring, landing contribution), 4 h

Needs C4, the landing page of the journey package and the M7-P2 HUD. The selector values and pills of 2.1 (as props and a small model the landing component renders), `ComputerRoute.svelte`, the start sequence of 2.2, the opponent chip and plate menu, the primary-button cues, Sparring's lines in the ticker, the game-over banner cases, the hidden items of D20, pause on `visibilitychange`, the two-tab guard.

Acceptance (e2e, Chromium and WebKit, fixture data, pointer only): from the landing page, Start with `COMPUTER · STEADY` reaches a table with seven cards in hand and the `COMPUTER · STEADY` chip within 5 s; the human plays a land and passes; Sparring plays a land within the Normal pace window (asserted on the debug hook's `steps()` and the state, not on pixels); the human attacks with a creature, presses `Attack ▸` then `Damage ▸`, and Sparring's life drops by the creature's power; `Leave game` returns to the landing page with the Start pill reading `RESUME`; Resume restores the same `stateHash`; Talk, chat input and Invite are absent; axe finds no new violations on the plate menu.

### C7. Practice (`session/practice.ts`, `ui/practice/*`), 3 h

Needs only the landing page. Section 11 without the headless clock.

Acceptance (e2e, pointer only): Start with `ALONE · Practice` shows seven cards and the `DUMMY · 20` plate; `Mulligan` redraws seven; attackers out make the button read `Hit Dummy for N ▸` with the right N; bringing the Dummy to 0 shows `Dummy down on turn N` and writes `DeckRecord.practice`; `Again` deals a new hand; after three runs the deck picker shows the `CLOCK` chip; a practice table left open reads `RESUME` on the landing page.

### C8. Leak, soak, gate (`tests/leak/computer.test.ts`, `tests/sim/bot-soak.test.ts`, the computer part of `tests/e2e/m8.gate.spec.ts`), 2–3 h

Acceptance: the five scenarios of 12.1; the soak of section 12 over 200 seeds in under 60 s of wall time; the gate plays one computer game to "You win" by pointer only in each look with screenshots (start sequence, Sparring attacking with the `Done blocking ▸` button, plate menu, game-over banner) and one practice run to "Dummy down".

### C9. Optional: headless goldfish clock (`bot/sim.ts`, deck picker chip), 3 h

Acceptance (unit): the same deck and seed give the same numbers; a 17-land, 23-creature M19 fixture deck gives a mean between 5 and 9; a deck with no creatures gives `fizzle = 1`; 200 games finish in under 150 ms in Node; in the browser the work is cut into idle callbacks of at most 8 ms.

---

## 14. Roadmap after M8

| Step | What |
| --- | --- |
| Smarter combat | Gang blocks, damage-order choices, holding back by race maths at every level, attacking planeswalkers |
| Simple spells | Burn at the face or at the creature that kills it, pump on an unblocked attacker, removal on the biggest threat, each with a target line and a stack round; a per-card "script" only where the text matches a small set of patterns |
| Reads more | Enters-tapped lands, mana creatures, equipment and Auras it attaches itself |
| More levels | A fourth level that looks one turn ahead with the bookkeeping model; a "Coach" pace that waits for a tap before each step and says why |
| More seats | Bots filling free chairs in three- and four-player tables and Two-Headed Giant; needs a shared `Seat.bot` flag (a contract and reducer change) so every browser labels them |
| Networked rooms | The host's browser runs the bot session on the real transport, so friends can add Sparring to a private table |
| Draft bots | A pick heuristic (rate, colour commitment) to fill a draft pod; DESIGN already allowed bots "to fill seats" |
| Isolation | The bot session and runner in a Web Worker, with a `MessagePort` transport, so its memory is separate from the page's |
| Self-play strength | Bot against bot, headless, to rate a deck against the five sparring decks; a second strength number beside the goldfish clock |
| Watch | Two bots at a table as an attract mode behind the landing page's blur |

---

## 15. Open questions for the owner

Each has the default this design builds with.

1. **Should Sparring change your life total itself after its attacks, or only say "3 to you" and leave the click to you?** Default: it changes it (D7). The alternative is one setting, "Sparring keeps score", off.
2. **Is "Sparring" the right name, and are Gentle, Steady and Keen the right level names?** Default: yes. Zhess's twelve names would also fit if you want one vocabulary across the izzardry games; three levels would then map to Beginner, Medium and Hard.
3. **Which set do sparring and starter decks come from?** Default: the same "latest core set" constant as the booster default (Foundations, `FDN`), with M21 as the fallback when a pool is too small.
4. **Should the first visit default to a computer game (D16)?** Default: yes. The alternative is Practice as the first-run default, which needs no opponent explanation but is less of a game.
5. **May the goldfish clock count as (part of) a deck's strength for matchmaking?** Default: it is stored and shown; the matchmaking design decides whether to use it. It favours creature decks and says nothing about control decks.
6. **Is it acceptable that Sparring plays only lands and creatures from your own decks (Mirror and "one of your decks") and holds every other card?** Default: yes, with the one-line count before Start (8.2). Spells are the first roadmap step.
