# M8 — User journey and information architecture

*Topic "journey" of the M8 design round, 20 Nov 2026. Written for the owner and for the agents who build it.*
*Source of every requirement: `docs/design/m8/owner-request.md`. Owner sentences are quoted as O1–O22 (table in section 1.1).*

This document covers where a player is, what they see there and how they get to the next place: from the first visit to a returning player with decks and unfinished games. It names the screens, their states, routes, copy and data shapes, and the code that has to change.

The neighbouring topics have their own designs in this folder, written in the same night: `computer.md` (the computer opponent and practice alone), `matchmaking.md` (the lobby, queues, rating, the private-game waiting room), `persistence.md` (save, leave, History, coming back, re-invite), `decks.md` (the deck library's contents and the deck page), `visual.md` (how everything looks: tokens, sizes, component recipes, motion) and `m7-adjustments.md` (the table, the HUD, the looks, who owns which file). The documents were revised against each other while they were written. Section 1.6 is the settled state: which document decides what, and what is built where two texts still differ.

**Scope marks used throughout**

| Mark | Meaning |
| --- | --- |
| **Core** | Must be built in the M8 overnight run. The owner reviews it in the morning. |
| **Stretch** | Built in the same run if the core is green; designed here in full. |
| **Later** | Designed far enough to leave room for it; not built in this run. |

## Rulings of the lead planner (20 Nov 2026)

Where this file and a sibling differed, the lead planner decided. These rulings override the text below; the decisions are recorded in `docs/DECISIONS.md` (`[M8 plan]`).

- **Who builds what** is decided by `docs/PLAN.md`, "Milestone 8: Journey, decks and matchmaking" (eleven packages M7-P1, P2, P3, P5 and M8-P1 … M8-P7 after one contracts agent M8-C). The chunk ids in this file (J…, MM-…, PS-…, DK-…, C…, DS-…) name pieces of work, not packages; its build plan is a checklist for the package that PLAN names, and whatever PLAN lists under "later" is not built in the overnight run.
- **Game code:** the existing room id, three words and a number (`amber-fox-93`, shown as `AMBER FOX 93`). No six-character code in M8; no stored id changes.
- **No blur in CSS anywhere:** no `backdrop-filter` and no `filter: blur()` in the shell or over a table. The arena behind Home is a still that `src/scene/still.ts` delivers already soft; a saved table behind the Gathering card is dimmed by the flat `overlay` scrim, never blurred (card faces are on it).
- **Control heights** are the kit's four: 28, 36, 44, 56 px (`visual.md` V4).
- **Deck strength** is the one formula of `decks.md` section 5, in `src/data/deck/strength.ts`; the lobby's `Band` 1 to 5 is its five bands in order.
- **Leaving** has no confirmation and no first-time dialog; the table shows a back arrow top left.
- **The primary button** always starts the selected mode; it never reads `RESUME` or `CONTINUE`. The `CONTINUE` strip under it reopens the last unfinished game.
- **The library has no summary panel** (section 4.2): tiles carry their own actions, as in `mock.html` board 2.
- **The arena still** is built by M7-P3, not with the Home chunk; Home shows it and falls back to the look's gradient.
- **History thumbnails** are drawn from the summary alone: `GameSummary.thumb` (outlines of the public battlefield cards) under one disc per seat with its life total (the kit's `TableThumb`).
- **Bringing a player back** starts from the plate menu's `BRING BEN BACK` button; pressing it makes the link and shows the QR code and link in the popover on a wide window, in a sheet on a narrow one and from Gathering. Opening the menu alone makes nothing.
- **End of a game tonight** is `Concede` (and the quiet 0-life offer) with the game-over overlay; `Declare result…`, draws by consent and the absence claim are later.
- **Core tonight / later** for every screen of this file is the table "M8 core tonight and later" in PLAN; this file's Core / Stretch marks are the design's, not the run's.

---

## 1. Decisions

Each decision has its reason and the owner sentence it serves. The lines are written so they can be appended to `docs/DECISIONS.md` as `- [M8-J] …`.

### 1.1 The owner's sentences, numbered

| # | Owner sentence (shortened) |
| --- | --- |
| O1 | "placed buttons and functions of different sizes, the panels are technical and boxy and the internal ordering of components looks like absent of design" |
| O2 | "the white design lacks depth and tactileness. look into Ztyle and adopt portions of it" |
| O3 | "the visitor is directly thrown into an arena, with manual configurations to be made and a blocky log being open. that has to be changed" |
| O4 | "a landingscreen is the right way to start, similar to Zhess. Instant access to a new game or access to old games" |
| O5 | "options to play against computer or other players" |
| O6 | "creating a game with multiple players requires first connection and sharing" |
| O7 | "the deck building and deck picking is the core activity that happens outside of an active game" |
| O8 | "the landing page needs to have access to deck building mode with a library of decks and an individual deck creation and modification page" |
| O9 | "returning to the landing page, a deck can be selected and should be as present as a blurred-out arena in the background" |
| O10 | "simple decks with clear mana curves and a custom mode where any card can be looked up and picked, or a booster draft mode … the boosters pack configuration seals the deck building … unless it's converted into a custom deck" |
| O11 | "match making from a queue of players waiting for a matchup that matches the configured setup (1on1, 3 FFA, 2v2 or 4 FFA, and whatever other mode is in order), or a private game is started and shared" |
| O12 | "a match making ranking and a measure of the selected deck's strength" |
| O13 | "custom with either booster drafted decks that have been created in advance or live booster draft as a round among the players before the game" |
| O14 | "the deck that is picked is replaced by just an illustration of mysterious and closed boosters. by default from the latest core set, but … configurable, same as the booster-drafted decks that can be pre-built" |
| O15 | "live booster draft games are always custom games, while playing ranked games with booster drafted decks that have been pre-built can be done with open match making" |
| O16 | "match making basically happens by announcing and having all others who are currently connected, respond … forget the centralized service" |
| O17 | "standard game practices like in Heartstone or Heroes of the Storm, where character selection, configuration and matchmaking are part of the core concept and the landing page or lobby. while the game itself is something that can be played as a game between waiting in the landing page" |
| O18 | "leaving a game would not stop it, the state should be saved by everybody in a timed way. so when the game is left, it lands on the history, and can be re-entered" |
| O19 | "but only if all players reconnect and … the saved state has been synced up (where the newest overrides the older states …)" |
| O20 | "states are saved locally in the browser. and game codes will provide the game's unique identity to reconnect directly … no new invitation needed" |
| O21 | "re-inviting him via a link or QR code should work from ingame in a special menu present in each the player state in the respective panel. and if the player rejoins with that link the state is synced by the newest other player joining" |
| O22 | "Target is Safari and Chrome. later also a mobile or tablet version, but that can go into M8" |

### 1.2 Structure

| Id | Decision | Reason | Serves |
| --- | --- | --- | --- |
| J1 | **The app opens on Home (`#/`), never on a table.** The old solo table moves to `#/solo` and stays as a developer sandbox and test target. | The table is a place you go to with a deck and a mode already chosen. Tests keep their solo table through a change in the e2e URL builders. | O3, O4 |
| J2 | **Three top-level places and one table:** `PLAY` (Home), `DECKS`, `HISTORY`, shown as one segmented control that is always in the same spot; the table is a fourth place with no top-level nav. Settings and About hang off a gear. | Hearthstone and Heroes of the Storm both keep "play" and "collection" one tap apart at all times. Three items fit a phone. A fixed nav is what lets a player browse decks while a search runs. | O7, O8, O17 |
| J3 | **One stage.** Home, Decks and History share one backdrop: a blurred still of the empty arena in the current look. Navigating between them changes the content, not the page. Entering a table un-blurs the arena over 500 ms (Ztyle's start ⇄ game transition). | Ztyle rule 1 (the board is the hero and never moves) and its signature transition. It makes the app feel like one room instead of a set of forms. | O2, O9 |
| J4 | **The backdrop is a still image, not a live scene.** The arena is rendered once per look to a 960 px wide bitmap by a throw-away renderer (`src/scene/still.ts`, built by M7-P3), softened by the renderer itself (scaled down to a quarter and up again on a 2D canvas) and drawn as an `<img>` under the look's veil. No CSS blur is applied (ruling above). It contains no cards. Until it is ready, a CSS gradient from the look's tokens stands in. | Safari: a blur over a live WebGL canvas was the slow path in M7-A0. A still costs nothing per frame, and no WebGL context lives outside a table (memory). An empty arena means no card face is ever blurred (Scryfall's image rule, CLAUDE.md hard rule). | O9, O22 |
| J5 | **The selected deck is the hero of Home:** the deck's cover card, whole and upright, 240 × 336 px on desktop, on top of a drawn pile, with name, kind, size, colours, mana curve and strength beside it. Arrows and swipe step through the library in place; a click opens Decks. | Hearthstone shows the chosen deck as the largest thing on the Play screen; Heroes of the Storm puts the hero in the centre. The card is never cropped (hard rule), so the hero is the whole card, not an art crop. | O7, O9 |
| J6 | **One filled button per screen.** Its label is the next step for the chosen mode: `PLAY`, `FIND MATCH`, `CREATE TABLE`, `OPEN DRAFT TABLE`. Everything else is a ghost pill, a chip or a link. Control heights come only from the design kit's ladder (`LAYOUT.control`): the large step for the primary pill, the medium step for pills and segmented controls, the small step for chips. | The critique's root finding: "nothing is ranked". Ztyle has exactly one primary action per state. | O1 |
| J7 | **Old games are one tap away too, and the primary button never turns into "Resume".** Under the primary button a `CONTINUE` strip shows the most recent unfinished game. The five most recent games sit below the fold of Home (scroll, as in Zhess); `HISTORY` shows all. | "Instant access to a new game or access to old games": two targets, both on the first screen, neither hidden behind the other. Zhess merges them into one pill; a card table starts new games as often as it resumes, and a pill that changes its meaning between visits is a surprise. | O4 |

### 1.3 Modes

| Id | Decision | Reason | Serves |
| --- | --- | --- | --- |
| J8 | **Four modes, in this order:** `SOLO` (against the computer, or alone), `QUICK MATCH` (open matchmaking, unranked or ranked), `PRIVATE GAME` (a table you share by link or QR), `DRAFT NIGHT` (a private table that opens boosters live before the game). | The owner names exactly these four needs. Private Game and Draft Night are the same custom table with different presets, shown as two entries because their hero and their first step differ. | O5, O11, O13 |
| J9 | **Formats:** `1V1`, `2V2` (Two-Headed Giant), `3 FFA`, `4 FFA`. A Commander pod (4 FFA, 40 life, command zone) is **Later**: it needs a new `Format` value in a contract file. | These are the engine's four formats (`core/types.ts` `Format`). Nothing is shown that cannot be played. | O11 |
| J10 | **Ranked exists for 1v1 only in M8** and is labelled as an honour system: a result counts when the players sign it. Unranked exists for all four formats. | There is no rules engine and no server, so a result is a statement the players sign. Team and free-for-all ratings need a design of their own (matchmaking MM-9). | O12, O15 |
| J11 | **Live draft is only reachable through Draft Night** (a private table). A deck built from boosters in advance is an ordinary deck with a seal, and can be taken into Quick Match, ranked included. | The owner's rule, word for word. | O13, O15 |
| J12 | **In Draft Night the deck hero becomes three closed boosters** (our own drawing: a foil pack shape with the set code as text and no logo or set symbol). Default: three boosters of the latest core set that has booster data (`FDN`, Foundations; else `M21`). `CHANGE BOOSTERS` opens the same booster setup sheet that Decks uses for a booster deck. | The owner's sentence. One setup sheet for both uses keeps "same as the booster-drafted decks that can be pre-built" literally true. No Wizards material is bundled. | O14 |
| J13 | **Solo has two opponents:** `SPARRING`, the computer opponent of `computer.md` (plays lands and creatures, attacks and blocks, does not know the rules, always labelled `COMPUTER`), and `ALONE`, a practice table with a Dummy life total. Home works with `ALONE` from its first chunk and gains `SPARRING` when the computer topic's packages land. | Without a rules engine a real AI is impossible; an honest sparring partner gives a newcomer something across the table. The landing must not wait for the bot. | O5 |
| J14 | **A game that comes from matchmaking never shows a setup lobby.** Seats, colours, decks, shuffle, the opening seven and who goes first are all done by the app; the player sees *match found → accept → versus screen → table*. Only private tables have a lobby. | "Thrown into an arena with manual configurations" is the complaint. Shuffling and drawing seven are setup conveniences every player can undo, not rules enforcement. | O3, O17 |

### 1.4 Waiting, leaving, returning

| Id | Decision | Reason | Serves |
| --- | --- | --- | --- |
| J15 | **A search is a bar, not a screen.** While searching, a queue bar stays under the nav on Home, Decks, History and Settings, with the mode, a timer, how many players are looking and `CANCEL`. Editing the deck you queued with asks before it stops the search. | Heroes of the Storm's queue timer: you keep browsing your collection while it runs. | O17 |
| J16 | **Match found is a full-screen moment with a 20-second accept.** All players must accept. A player who does not is removed from the search; the others go back in with their old waiting time. | Players wander off to the deck builder while they wait; a peer-to-peer table that starts with an absent player is worse than a short check. | O11, O17 |
| J17 | **Leaving never ends a game, and is never confirmed.** The back arrow at the table's top left, `Menu → Leave to home` and the browser's Back button all save and go Home; the game is the first card in History and in the `CONTINUE` strip, and a toast offers `REJOIN`. Conceding is a separate, explicit action. | The owner's sentence. Nothing is lost by leaving, so there is nothing to confirm; the toast explains what happened. | O18 |
| J18 | **Leaving disconnects.** The table's scene and its connections are released when the player leaves; the others see the seat as away and may go on. The one exception is a game that is gathering its players (J20): it may wait in the background (Stretch). | One WebGL scene and one mesh at a time keeps memory flat (the owner's worry about leaks). The engine already marks a seat away and takes it back. | O18 |
| J19 | **Saving is per action, with a timer on top** (persistence D2): every action is written as today; a checkpoint every 20 s while something changed, and at once on turn pass, tab hidden and leave, writes the History summary and the save state. | "Saved by everybody in a timed way." A tab that is killed loses nothing that was sequenced. | O18, O20 |
| J20 | **Re-entering goes through Gathering.** A game opened from History shows the seats and who is here, and the table is on standby until the muster rule of `persistence.md` holds: this browser is in sync with a player who stayed, or everybody who was present in the newest copy is back, or the gathered players choose `PLAY ON WITHOUT …`. The newest copy wins. | The newest state may sit in the browser of a player who is not here yet; acting on an older copy would fork the game. The third way keeps one absent player from ending the game for all. | O19 |
| J21 | **The game is its own address.** A game keeps its room for life: History opens `#/t/<room>/<key>` from the saved record, and every player's browser does the same. No link has to be sent again. The room id is the **game code**, shown as three words and a number (`AMBER FOX 93`). | The owner's sentence. The existing room id is already unique, speakable and stored with the table, and keeping it changes no saved data. | O20 |
| J22 | **Each player plate has a menu, and for an absent player it offers `Bring Ben back…`:** a sheet with a QR code and a link that lets the holder take that seat from any browser. A present player makes it; it works once and for 24 hours (persistence D9). A browser that arrives without the hidden cards goes through the existing recovery step. | The owner's sentence. Making the link is the approval, so no second confirmation is needed. | O21 |
| J23 | **A game ends when the players say so.** `Concede` and `Declare result` are in the menu; a player at 0 life gets a quiet offer to concede. Then a result overlay offers a rematch, another search, or Home. | No rules enforcement: the app never decides a winner. The critique: "the real end has no moment". | O17 |

### 1.5 Sharing and first run

| Id | Decision | Reason | Serves |
| --- | --- | --- | --- |
| J24 | **Sharing is link first, QR second; the code names the game.** The invite sheet opens by itself when a private table is created. The code is shown small, for saying which game is meant. A typed bare code is answered with "Paste the whole link" in M8; joining by code as a "knock" that someone at the table lets in is **Stretch**. | Zhess's owner feedback was that nobody types codes. A typed code carries less secret than a link, so it must ask instead of entering. | O6, O20 |
| J25 | **Connect first, then play.** A private table's primary button is `READY`. When everyone seated is ready and connected to everyone else, the creator's pill becomes `START` and presses itself after three seconds. A pair that cannot connect is named on the seat, calmly. | "Creating a game with multiple players requires first connection and sharing." The countdown removes the question of who has to act. | O6 |
| J26 | **First visit: one press to a table with cards.** With no deck, `PLAY` makes a starter deck (the generator of computer.md D10: 17 basic lands and 23 simple creatures of one colour, fetched at runtime), saves it to Decks, and opens a game against Sparring (alone, until the bot has landed) in about three seconds. Opening six boosters is the first offer in Decks and for a guest without a deck. | "Instant access to a new game." Nothing is bundled, and the newcomer learns the table before the builder. A starter deck loads faster than a whole set. | O4, O10 |
| J27 | **Nobody is asked for a name before playing.** A nickname is made up on first visit (`Amber Fox`) and can be changed from the profile chip and in any lobby. | The critique: "there is only one way in, and it starts locked". | O3 |
| J28 | **The log is closed when a table opens**, on every screen size; the activity button shows a count and the last events as a ticker (M7 HUD proposal). No panel, dialog or hint is open on entry except one coach mark. | The owner's sentence. | O3 |
| J29 | **Phone layouts are designed now and must not break; polish is later.** Core targets Safari and Chrome at 1024 px and wider. Every screen has a single-column layout from 360 px, with the nav as a bottom tab bar. | The owner's sentence. Designing both widths now prevents a desktop-only structure. | O22 |

### 1.6 Alignment with the sibling designs

One rule: **this document decides where things are and what they are called on screen; the sibling documents decide how their part works.** The table is the settled state. Where a sibling's text still says something else, the right-hand column is what gets built.

| Subject | Decided by | Built |
| --- | --- | --- |
| The selector on Home | journey | The four-mode picker of 4.1. `computer.md` 2.1 and `matchmaking.md` 2.8 draw a single Zhess-style opponent stepper; their option pills, status lines and searching states move into each mode's option row unchanged. |
| The primary pill | journey | It always starts the selected mode. It never reads `RESUME` (computer.md 2.1 and persistence.md section 3 suggest it); the `CONTINUE` strip is the way back (J7). |
| The first deck | journey | A starter deck on the first `PLAY` (computer.md D16). `decks.md`'s `quickBoosterDeck` is what `OPEN SIX BOOSTERS` runs in a waiting room's deck slot and in Decks' empty state. |
| Computer opponent, practice alone | `computer.md` | As written there; placed in 4.1 and section 6. |
| Lobby, queues, tickets, ready check, rating, notices, "looking now" board | `matchmaking.md` | As written there (`Matchmaker`, `MatchmakerStatus`); placed in 4.5 and 4.6. No test flag: the lobby runs on the page transport. |
| The queue indicator | journey | The bar of 4.5 under the nav; `QueueChip.svelte` is its content. |
| The private-game waiting room | layout: journey; rules and plate states: `matchmaking.md` 2.12 | The layout of 4.8, built once as `WaitingRoom.svelte` (MM-10). `START` presses itself after three seconds (J25). |
| Game code | journey J21, matchmaking MM-18 | The existing three words and a number. `persistence.md` D3 proposed six characters for new games; ruled out for M8, kept as an open question for the owner. |
| History: the record, the card's content, removal, export | `persistence.md` section 3 | `GameSummary` in the `games` store and the `History` component (PS-4). An earlier draft of this document had its own `meta` record; it is withdrawn. Placement and the `CONTINUE` strip: 4.1 and 4.14. |
| Saving on a timer | `persistence.md` D2 | The 20 s checkpoint; no timed snapshot. |
| Coming back to a game | `persistence.md` section 5 | Gathering and the muster rule, with `PLAY ON WITHOUT …`. An earlier draft of this document required everyone to be back; it is withdrawn (J20). |
| Bringing a player back | `persistence.md` section 7 | The one-time seat link, `#/t/<room>/<key>/rejoin/<seat>/<token>`; only the teammate may make it in team games. |
| Leaving | journey J17, `persistence.md` section 5 | No confirmation and no first-time dialog. `m7-adjustments.md` mentions a one-time dialog of the shell (`LeaveDialog.svelte`); there is none. |
| The arena still | lead planner | `src/scene/still.ts`, built by M7-P3; Home (M8-P2) only shows it. |
| The sandbox table | journey | `#/solo` (m7-adjustments D18). |
| Routes for solo games and the party | journey | `#/c/<room>` computer game, `#/p/<room>` practice, `#/party/<code>/<key>` party. |
| Files inside a table (`Hud.svelte`, `menu.ts`, plates) | `m7-adjustments.md` | M7-P2's. The shell passes `HudShellProps` (`onleave`, `menuTop`, `sandbox`, `plateMenuTop`, `plateBadge`, `seatPresence`, `notice`); section 8. |
| A deck's contents, seal, strength, the deck page | `decks.md` | As written there (D30). Home's hero is composed from its parts (`DeckBox`, `KindBadge`, `ManaPips`, `Sparkline`, `StrengthChip`, `BoosterPackArt`) and reads the record's `summary`. |
| Control sizes | the design kit | `LAYOUT.control`; no screen defines its own heights (J6). |
| How things look | `visual.md` | As written there: the deck hero as a fan of cards, mode cards on wide windows, the queue bar drawn as a floating pill, the size of the booster art, codes as small meta text, no blur where the still is already soft. The wireframes in section 4 fix position, content, order and copy, not appearance. |
| The file that renders the arena still | lead planner | One renderer, `src/scene/still.ts`, built by M7-P3 (it owns the camera and `poseAt`); the contracts stub resolves `null` and Home then shows the look's gradient. It delivers an image that is already soft; Home applies no CSS blur. |

---

## 2. The journey in one picture

```
 first visit ─────────────────────────────────────────────────────────────────────────────────┐
                                                                                              ▼
                          ┌──────────────── HOME  #/ ────────────────┐
     DECKS  #/decks ◄────►│ deck hero · mode · options · [primary]   │◄────► HISTORY  #/history
      │  ▲                │ CONTINUE strip · recent games below fold │              │
      ▼  │                └──┬──────────┬───────────┬────────────┬───┘              │ open a game
  deck page #/decks/<id>     │SOLO      │QUICK MATCH│PRIVATE GAME│DRAFT NIGHT       │
                             │          ▼           ▼            ▼                  │
                             │   queue bar (browse  WAITING ROOM + invite sheet     │
                             │   anywhere)          (seats, deck slot, READY)       │
                             │          ▼           │            ▼                  │
                             │   MATCH FOUND        │       DRAFT → BUILD           │
                             │   accept in 20 s     │            │                  │
                             │          ▼           ▼            ▼                  ▼
                             │   VERSUS / loading ──┴────────────┘             GATHERING
                             ▼          ▼                                   (muster rule holds)
                        ┌──────── TABLE  #/t/<room>/<key>  ·  #/c/<room>  ·  #/p/<room> ────┐
                        │ calm HUD · log closed · plate menus (Bring Ben back…) · Menu      │
                        └──────┬───────────────────────────────┬────────────────────────────┘
                               │ Leave (arrow, menu, Back)     │ Concede / Declare result
                               ▼                               ▼
                        HOME (game in CONTINUE              GAME OVER overlay
                        and first in History)               REMATCH · FIND ANOTHER · HOME
```

---

## 3. Routes

Static hosting, so everything stays in the URL fragment (`src/ui/routes.ts`). The fragment never reaches the host. Screens are routes, so the browser's Back button works; sheets, overlays and the queue are states, not routes.

| Route | Screen | Scope | Notes |
| --- | --- | --- | --- |
| `#/` (also empty) | Home | Core | Was the solo table. |
| `#/decks` | Deck library | Core | |
| `#/decks/new` | New deck chooser | Core | `#/decks/new/custom`, `#/decks/new/boosters`, `#/decks/new/import` open the chosen path directly. |
| `#/decks/<deckId>` | Deck page | Core | Its inside is `decks.md`'s. |
| `#/history` | All games | Core | |
| `#/c/<room>` | Computer game (against Sparring) | Core (computer topic) | Two in-page sessions; saved and listed like any game. |
| `#/p/<room>` | Practice table (alone, with the Dummy) | Core | A solo session with its own room id, so it is saved and listed like any game. |
| `#/t/<room>/<key>` | Table: waiting room, draft, build, match, by stage | Core (exists) | Unchanged, so every old link and saved table keeps working. |
| `#/t/<room>/<key>/watch` | Spectator | exists | Unchanged. |
| `#/t/<room>/<key>/rejoin/<seat>/<token>` | Re-invite link: take a seat | Core | The token is removed from the address bar (`history.replaceState`) once read (persistence section 7). |
| `#/g/<code>` | Join by code (knock) | Stretch | `code` is the room id; see 4.9. |
| `#/party/<code>/<key>` | Party for 2v2 (matchmaking 2.11) | Later | |
| `#/solo` | Sandbox solo table | Core (moved) | Not linked from the UI. The e2e URL builders that opened the table through an empty hash open it. |
| `#/settings`, `#/about`, `#/diag`, `#/diag/<room>/<key>` | as today | exists | Rendered on the shared stage. |
| `#/lobby` | redirects to `#/` | Core | Old bookmarks. |

**Back behaviour, one rule per kind of place**

| From | Back goes to | What happens |
| --- | --- | --- |
| Decks, History, Settings, About | the previous route (normally Home) | Nothing is lost; a running search keeps running. |
| Deck page | Decks | Edits are saved as they happen (no "discard?" dialog). |
| A sheet or overlay (invite, bring back, booster setup, deck picker, menu) | closes the sheet | Opening a sheet pushes one history entry (`history.pushState` with the same hash), so Back and `Escape` both close it. |
| Waiting room (private, not started) | Home | The table stays in History as `Not started`. The player's chair is kept for their key. |
| Table in play | Home | Same as the table's back arrow: saved, first in History, toast `You left the table. The game goes on; your seat is kept.` with `REJOIN` for 6 s. No confirmation. |
| Gathering | Home | The game stays in History. |
| Match found overlay | stays | Back is ignored while the overlay is up (at most 20 s); `DECLINE` is the way out. |
| Game over overlay | Home | |

**Query flags** stay as they are (`?profile=`, `?transport=local`, `?faces=placeholder`, `?speech=fake`, `?fps`). None is added: with `?transport=local` the matchmaking lobby runs over `BroadcastChannel` like every room, so tests need no network.

---

## 4. Screens

Common frame for Home, Decks, History, Settings and About (the **shell**):

- **Backdrop:** the blurred arena still (J4), full window, fixed.
- **Top bar (desktop), 56 px:** wordmark `S P E L L P L A N E` left; the nav `( PLAY │ DECKS │ HISTORY )` centred; profile chip and gear right.
- **Phone:** wordmark, profile chip and gear in a 48 px top bar; the nav is a bottom tab bar, 56 px plus the safe area.
- **Queue bar:** directly under the top bar on desktop, directly above the tab bar on phone; only while a search, a match offer or a background gathering is active.
- **Toasts:** one slot, bottom centre above the tab bar; never over the primary button.
- **Content column:** max 1120 px wide, centred, 24 px gutters (16 px on phone).

Controls take their heights from the kit's ladder (J6). Touch targets are at least 44 px even where a chip is drawn smaller. Outside a table, panels may use Ztyle's glass (a 4 px blur over the still); over a live table nothing uses `backdrop-filter` (m7-adjustments D11).

### 4.1 Home

**Purpose.** Choose a deck and a way to play, and start; or pick up an old game.

**Contents in priority order**

1. The deck hero (or the boosters in Draft Night).
2. The primary button.
3. The mode picker, and the options that belong to the chosen mode.
4. The `CONTINUE` strip (only if an unfinished game exists).
5. Recent games, below the fold.
6. Nav, profile chip, gear.

**Desktop (1280 × 800)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ S P E L L P L A N E            ( PLAY │ DECKS │ HISTORY )                (◆ Amber Fox) ( ⚙ ) │
│                                                                                              │
│ ░░░░░░░░░░░░░░░░░░░░░░░ blurred still of the empty arena, full window ░░░░░░░░░░░░░░░░░░░░░░ │
│                                                                                              │
│                         ┌────────────┐                                                       │
│                         │            │    GRUUL STOMPY                                       │
│                    ‹    │   cover    │    CUSTOM DECK · 60 CARDS · ● R ● G             ›     │
│                         │   card,    │    ▁ ▃ ▇ █ ▅ ▂ ▁ ▁   mana curve 0 … 7+                │
│                         │   whole    │    STRENGTH ◆ ◆ ◆ ◇ ◇                                 │
│                         │            │    ( CHANGE DECK )  ( EDIT )                          │
│                         └────────────┘                                                       │
│                         ▔▔▔▔ pile ▔▔▔▔                                                       │
│                                                                                              │
│                 ( SOLO │ QUICK MATCH │ PRIVATE GAME │ DRAFT NIGHT )                          │
│                      ( 1V1 │ 2V2 │ 3 FFA │ 4 FFA )   ( UNRANKED │ RANKED )                   │
│                                                                                              │
│                              ┌────────────────────────┐                                      │
│                              │       FIND MATCH       │                                      │
│                              └────────────────────────┘                                      │
│                   ↩ CONTINUE   vs Ben · 1v1 · turn 6 · your turn · 12 min ago                │
│                                            ⌄                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
   below the fold:   ⌄ YOUR GAMES ⌄   five history cards (4.14)   [ 12 MORE GAMES ]
```

**Phone (390 × 844)**

```
┌────────────────────────────────┐
│ S P E L L P L A N E    (◆)(⚙) │
│ ░░░░░░ blurred arena ░░░░░░░░░ │
│                                │
│          ┌──────────┐          │
│      ‹   │  cover   │   ›      │
│          │  card    │          │
│          └──────────┘          │
│          GRUUL STOMPY          │
│   CUSTOM · 60 CARDS · ●R ●G    │
│   ▁▃▇█▅▂▁▁      ◆◆◆◇◇          │
│                                │
│       ‹  QUICK MATCH  ›        │
│  ( 1V1 │ 2V2 │ 3 FFA │ 4 FFA ) │
│     ( UNRANKED │ RANKED )      │
│                                │
│  ┌──────────────────────────┐  │
│  │        FIND MATCH        │  │
│  └──────────────────────────┘  │
│  ↩ vs Ben · turn 6 · 12 min    │
│               ⌄                │
│ ( PLAY  │  DECKS  │  HISTORY ) │
└────────────────────────────────┘
```

On a phone the mode picker is a stepper (`‹ QUICK MATCH ›`, swipe or arrows, ends do not wrap), as Zhess's opponent stepper; the cover card is 150 × 210 px; tapping the deck's name opens Decks.

**The option row per mode** (the row under the mode picker; everything is remembered per mode in `Settings.home`)

| Mode | Options shown | Primary | What the primary does |
| --- | --- | --- | --- |
| `SOLO` | `( SPARRING │ ALONE )` (hidden until the bot exists; `ALONE` then applies). With `SPARRING`, the computer topic's pills: level `gentle · steady · keen`, Sparring's deck `auto · white · … · mirror`, pace `calm · normal · brisk`, and its status line (`✓ SPARRING READY OFFLINE`) | `PLAY` | `SPARRING`: creates `#/c/<room>`. `ALONE`: creates `#/p/<room>`. Either way the selected deck is imported, shuffled, seven cards are dealt and the table opens. |
| `QUICK MATCH` | format `( 1V1 │ 2V2 │ 3 FFA │ 4 FFA )`; `( UNRANKED │ RANKED )` (ranked with 1V1 only); the matchmaking topic's pills `also casual` and `tell me when someone is looking`; its status line `● 3 LOOKING NOW · 1 IN YOUR QUEUE` (a tap opens the "looking now" board) | `FIND MATCH` | Starts the search (4.5). The pill becomes `◌ SEARCHING 0:42`. |
| `PRIVATE GAME` | format; `( ANY DECK │ BOOSTER DECKS ONLY )`; a link `JOIN A GAME…` | `CREATE TABLE` | Creates a room, opens the waiting room with the invite sheet open (4.8). |
| `DRAFT NIGHT` | players `( 2 │ 3 │ 4 │ 2V2 )`; chip `BOOSTER DRAFT · 3 × FDN ✎` | `OPEN DRAFT TABLE` | Creates a room with these lobby settings, opens the waiting room with the invite sheet open. |

**Draft Night hero** (replaces the deck hero; the deck arrows are hidden):

```
            ┌─────┐ ┌─────┐ ┌─────┐
            │  ?  │ │  ?  │ │  ?  │      THREE BOOSTERS · FOUNDATIONS
            │ FDN │ │ FDN │ │ FDN │      BOOSTER DRAFT · PICK 1 · NO TIMER
            │     │ │     │ │     │      Your deck is drafted at the table.
            └─────┘ └─────┘ └─────┘      ( CHANGE BOOSTERS )
```

The packs are `decks.md`'s `BoosterPackArt`: drawn in CSS or SVG in the look's material, 120 × 190 px each, slightly fanned (−6°, 0°, +6°), closed, with a `?` and the set code as text. One pack per round of the draft (six small packs for sealed). No logo, no set symbol, no card art.

**The deck hero in detail** (composed from `decks.md`'s parts; reads the deck record's `summary`, so it needs no card data except the cover image)

| Part | Content | Behaviour |
| --- | --- | --- |
| Cover | The deck's cover card (the player's choice, else the automatic one). Whole face, uniform scale. A pile of 6 offset edges and a soft shadow under it. | Hover lifts it 4 px. Click opens Decks with this deck selected. |
| Name | Uppercase, one line, ellipsis. | |
| Kind line | `CUSTOM DECK` or `BOOSTER DECK 🔒 · 6 × FDN`; card count; colour dots with letters (never colour alone). | The lock has the tooltip `Built from boosters. Convert it to a custom deck to add other cards.` |
| Curve | Eight bars (0 … 7+), 64 × 24 px. | |
| Strength | The strength chip of `decks.md` (number, band, five pips); beside it the goldfish clock `CLOCK 6.2` once the deck has three practice runs (computer.md D18). | Tooltip: `Used to find opponents with comparable decks.` |
| Actions | `CHANGE DECK` (opens Decks), `EDIT` (opens the deck page). | |
| Arrows | `‹ ›` step to the previous or next deck by last use; swipe on touch; Left and Right keys when the hero has focus. | The hero cross-fades (200 ms). |

**The primary button's states**

| State | Label | Line under it |
| --- | --- | --- |
| Ready | per mode (table above) | — |
| No deck, mode Solo | `PLAY` | `No deck yet: you get a starter deck.` |
| No deck, other modes | `FIND MATCH` etc., disabled | `Pick or build a deck first.` with links `STARTER DECK` and `OPEN BOOSTERS` |
| Deck has 0 cards | disabled | `This deck is empty.` |
| Ranked, deck under 40 (booster) or 60 (custom) cards | disabled | `Ranked needs at least 40 cards (booster deck) or 60 (custom deck).` Unranked only warns: `38 cards. Most decks have 40 or more.` |
| Ranked chosen with a format other than 1V1 | the toggle snaps to `UNRANKED` | `Ranked is 1v1 for now.` shown for 4 s |
| Offline, mode needs the network | `OFFLINE`, disabled | `You are offline. Solo works with decks you have opened before.` |
| Storage blocked | `PLAY` (Solo only) | `This browser blocks storage. You can play solo; nothing will be saved.` |
| Searching | `◌ SEARCHING 0:42` (outlined, not filled; a tap cancels) + ghost `CANCEL` | `● 3 LOOKING NOW · 1 IN YOUR QUEUE` |
| Searching in another tab | `SEARCHING IN ANOTHER TAB` + `USE HERE` | (matchmaking 2.8) |

**The `CONTINUE` strip.** One line, a ghost pill of the medium control height, max 560 px wide: `↩ CONTINUE`, then the game's title, format, turn and state, then the relative time. It shows `GameStore.list()[0]` when that game has not ended. Click opens it (4.12 decides whether Gathering shows). With no unfinished game the strip is absent, not disabled.

**Other states**

| State | What shows |
| --- | --- |
| Loading (stores, identity, decks; normally under 100 ms) | The shell and backdrop at once; the hero slot is an empty pile outline; the primary button is disabled without a spinner. After 400 ms a status line `Loading your decks…`. |
| First run | See section 6. |
| Deck missing (the selected deck was deleted) | The most recently used deck is selected instead; none left → first-run hero. |
| Error opening storage | Hero slot: `Your decks could not be loaded.` + `TRY AGAIN`; a solo game with a starter deck stays possible. |

**Transitions.** Mode change: the option row cross-fades (150 ms); changing to or from Draft Night swaps the hero with a 200 ms scale-in. Primary press into a table: Home's content fades and slides out (top bar up 32 px, lower block down 32 px), the backdrop un-blurs to 0 and rises to full opacity over 500 ms while the real scene mounts under it, starting from the still's camera pose (M7-P3's `enterFrom`); the still is removed when the scene has drawn its first frame. Reduced motion: a 150 ms cross-fade.

### 4.2 Decks (library)

**Purpose.** See all decks, choose the one to play, start a new one, open one to edit. The owner's "library of decks". Layout and flow are this section's; what a tile and the summary hold, sorting, search and storage states are `decks.md`'s.

**Contents in priority order:** the deck grid; `NEW DECK`; filter chips (`ALL`, `CUSTOM`, `BOOSTER`); import and export in an overflow menu. *Ruling:* there is no summary panel in M8. The grid spans the sheet (five tiles per row at 1440 px, `visual.md` board 2 and `mock.html`). A click on a tile selects it as the deck Home plays with (ring and `SELECTED` chip); the tile's action row (`PLAY`, `EDIT`, `⋯`; on hover, and always on the selected tile on touch) replaces the panel: `PLAY` selects and goes Home, `EDIT`, a double-click or `Enter` opens the deck page. The drawing below still shows the panel; ignore its right-hand box.

**Desktop**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ S P E L L P L A N E            ( PLAY │ DECKS │ HISTORY )                (◆ Amber Fox) ( ⚙ ) │
│ [◌ SEARCHING · QUICK MATCH 1V1 UNRANKED · 0:42 · 3 LOOKING                      ( CANCEL ) ] │
│                                                                                              │
│  YOUR DECKS   ( ALL │ CUSTOM │ BOOSTER )                              ( ⋯ )   [ + NEW DECK ] │
│                                                                                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐      ┌────────────────────────────────────┐  │
│  │ cover  │  │ cover  │  │ cover  │  │   +    │      │  GRUUL STOMPY             selected │  │
│  │        │  │     🔒 │  │        │  │  NEW   │      │  CUSTOM DECK · 60 · ●R ●G          │  │
│  └────────┘  └────────┘  └────────┘  │  DECK  │      │  ▁▃▇█▅▂▁▁    STRENGTH ◆◆◆◇◇        │  │
│  GRUUL       SIX         ESPER       └────────┘      │  24 lands · 28 creatures · 8 other │  │
│  STOMPY ✓    BOOSTERS    CONTROL                     │  Last played 12 min ago            │  │
│  60 ●R●G     40 ●W●U     60 ●W●U●B                   │                                    │  │
│                                                      │  [ PLAY WITH THIS DECK ]           │  │
│                                                      │  ( EDIT ) ( DUPLICATE ) ( ⋯ )      │  │
│                                                      └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone**

```
┌────────────────────────────────┐
│ S P E L L P L A N E    (◆)(⚙) │
│ YOUR DECKS          [ + NEW ]  │
│ ( ALL │ CUSTOM │ BOOSTER )     │
│ ┌──────┐ ┌──────┐ ┌──────┐     │
│ │cover │ │cover🔒│ │cover │     │
│ └──────┘ └──────┘ └──────┘     │
│ GRUUL ✓  SIX      ESPER        │
│ 60 ●R●G  40 ●W●U  60 ●W●U●B    │
│                                │
│ ┌────────────────────────────┐ │
│ │ GRUUL STOMPY · 60 · ◆◆◆◇◇  │ │
│ │ ▁▃▇█▅▂▁▁                   │ │
│ │ [ PLAY WITH THIS DECK ]    │ │
│ │ ( EDIT ) ( DUPLICATE ) (⋯) │ │
│ └────────────────────────────┘ │
│ [◌ SEARCHING 0:42   CANCEL ]   │
│ ( PLAY  │  DECKS  │  HISTORY ) │
└────────────────────────────────┘
```

- **Deck tile:** the cover card whole, 150 × 210 px (phone 104 × 146), on a pile; name, count and colour dots under it; a lock on booster decks; a check on the selected deck. Click selects (the summary updates); double-click or `Enter` opens the deck page.
- **Primary:** `PLAY WITH THIS DECK` sets `Settings.home.deckId` and goes Home. With no deck selected there is no filled button; `+ NEW DECK` is then the filled one.
- **`⋯` on a deck:** `Rename`, `Choose cover`, `Export`, `Convert to custom deck` (booster decks only: makes an unsealed copy and keeps the sealed original), `Try this deck` (a practice table), `Delete` (undo toast, 6 s).
- **`⋯` on the page:** `Import decks from a file`, `Export all decks`.
- **Empty:** the grid shows only the `+ NEW DECK` tile and the line `No decks yet. Open boosters for a quick one, or build from all cards.` with the paths of 4.3 as pills.
- **Loading:** tile outlines without shimmer. **Error:** `Your decks could not be loaded.` + `TRY AGAIN`.
- **A cover that cannot be loaded** (offline, never cached) shows the app's neutral card back with the deck's name on a label below it; the face is never replaced by a stretched or cropped stand-in.
- **While searching:** the deck that is queued shows `IN THE QUEUE`; `EDIT` on it asks `Editing this deck stops the search.` with `STOP AND EDIT` and `KEEP SEARCHING`.
- **Back:** Home.

### 4.3 New deck chooser

**Purpose.** Pick how a deck comes to be. Three ways, the one for a newcomer first. What each path creates is `decks.md`'s.

```
 desktop                                                        phone
┌───────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐
│ ←  NEW DECK                                               │  │ ←  NEW DECK                  │
│                                                           │  │ ┌──────────────────────────┐ │
│ ┌─────────────────┐ ┌─────────────────┐ ┌───────────────┐ │  │ │ ▯▯▯ FROM BOOSTERS        │ │
│ │  ▯ ▯ ▯          │ │  ⌕              │ │  ≡            │ │  │ │ Open 6, build 40. Sealed.│ │
│ │ FROM BOOSTERS   │ │ CUSTOM DECK     │ │ IMPORT A LIST │ │  │ │ [ OPEN BOOSTERS ]        │ │
│ │ Open six packs  │ │ Look up any     │ │ Paste a deck  │ │  │ └──────────────────────────┘ │
│ │ and build 40    │ │ card and build  │ │ list or open  │ │  │ ┌──────────────────────────┐ │
│ │ cards from them.│ │ what you like.  │ │ a deck file.  │ │  │ │ ⌕ CUSTOM DECK            │ │
│ │ The pool is     │ │                 │ │               │ │  │ │ Any card.   ( BUILD )    │ │
│ │ sealed.         │ │                 │ │               │ │  │ └──────────────────────────┘ │
│ │ 6 × FDN  ✎      │ │                 │ │               │ │  │ ┌──────────────────────────┐ │
│ │ [OPEN BOOSTERS] │ │ ( BUILD )       │ │ ( IMPORT )    │ │  │ │ ≡ IMPORT A LIST (IMPORT) │ │
│ └─────────────────┘ └─────────────────┘ └───────────────┘ │  │ └──────────────────────────┘ │
│              or take a starter deck                       │  │    or take a starter deck    │
└───────────────────────────────────────────────────────────┘  └──────────────────────────────┘
```

- `FROM BOOSTERS` is the filled action. `✎` opens the booster setup sheet (4.4). `OPEN BOOSTERS` generates the pool in this browser, shows the packs opening, then lands in the deck page in pool mode with a suggested build already applied (two colours, 17 lands, a curve), which the player can change.
- `CUSTOM DECK` opens the deck page empty, search focused.
- `IMPORT A LIST` opens the paste dialog and then the deck page.
- `or take a starter deck` (a quiet link) makes the computer topic's starter deck in a colour the player picks and returns to Decks.
- **Loading (boosters):** a full-stage status with three lines that tick: `Fetching Foundations…`, `Opening six boosters…`, `Building a first deck…`. **Error:** `The booster data could not be loaded. Check your connection.` + `TRY AGAIN` + `BUILD A CUSTOM DECK INSTEAD`.
- **Back:** Decks.

### 4.4 Booster setup sheet

One sheet, used from Home (Draft Night: `CHANGE BOOSTERS`), from the new deck chooser (`✎`) and from the waiting room (creator). A bottom sheet on phone, a 480 px dialog on desktop.

```
┌──────────────────────────────────────────────┐
│ BOOSTERS                                  ✕  │
│                                              │
│ HOW      ( BOOSTER DRAFT │ SEALED │ MORE ▾ ) │   MORE: Rochester, Winston (2), Grid (2)
│ PACKS    ‹ 3 ›  per player                   │
│ SET      [ Foundations (FDN)            ▾ ]  │   core sets first, then all others by date
│          ☐ a different set per pack          │
│ PICKS    ‹ 1 ›  per pass                     │   draft only
│ TIMER    ( OFF │ ON )                        │   draft only
│                                              │
│ [ DONE ]                                     │
└──────────────────────────────────────────────┘
```

For a booster deck built alone only the set and the number of packs are asked (default 6, range 3 to 12; decks.md D8); the other rows are hidden. Data shape: `BoosterSetup` in section 7. The existing controls of `ui/draft/LobbySettings.svelte` are reused inside this sheet.

- **Loading the set list:** the ten featured core sets and FDN are listed at once from `data/sets.ts`; the rest appear when MTGJSON's list arrives. **Error:** the list stays at the built-in names with the note `Other sets need a connection.`

### 4.5 Searching (the queue)

**Purpose.** Wait for a match without being held on a screen.

The search has no screen of its own. It is a state of Home plus the queue bar everywhere else. The machine behind it is the matchmaking topic's.

**Home while searching (desktop)**

```
│                         ┌────────────┐                                                       │
│                         │   cover    │    GRUUL STOMPY            IN THE QUEUE               │
│                         │   card     │    CUSTOM DECK · 60 CARDS · ● R ● G                   │
│                         └────────────┘                                                       │
│                                                                                              │
│                    QUICK MATCH · 1V1 · UNRANKED                                              │
│                              ┌────────────────────────┐                                      │
│                              │ ◌  SEARCHING    0:42   │   ( CANCEL )                         │
│                              └────────────────────────┘                                      │
│                          ● 3 LOOKING NOW · 1 IN YOUR QUEUE                                   │
│              Browse your decks while you wait. We call you when a match is found.            │
```

**Queue bar (every other shell screen)**

```
 desktop  [ ◌ SEARCHING · QUICK MATCH 1V1 UNRANKED · 0:42 · 3 LOOKING               ( CANCEL ) ]
 phone    [ ◌ SEARCHING 1V1 · 0:42                                         CANCEL ]
```

Clicking the bar goes Home. The dot pulses (1.5 s, ease-in-out; static under reduced motion). The mode picker and option row are locked while searching and show the queued setup as text.

**States.** This table says what Home and the bar show for each phase of `MatchmakerStatus` (matchmaking 2.13).

| Phase | Home shows | Bar shows |
| --- | --- | --- |
| `connecting` | pill `◌ CONNECTING…`; status line `CONNECTING TO THE LOBBY…` | `◌ CONNECTING…` |
| `seeking` | timer from 0:00; the status line cycles the facts: `3 LOOKING NOW · 1 IN YOUR QUEUE`, `RANGE ±300 · DECKS ±1` | queue, timer, count |
| `seeking`, alone for 10 s | under the pill: `You are the only one looking right now.` and three quiet actions, `PRACTISE WHILE YOU WAIT`, `INVITE A FRIEND`, `NOTIFY ME`; the search goes on | `· ONLY YOU SO FAR` |
| `seeking`, 90 s | status line `RANGE: ANYONE` | — |
| `check` | the match found overlay (4.6) | hidden |
| `moving` | the versus screen (4.7) | hidden |
| `failed` | pill back to `FIND MATCH`; the matchmaking topic's text for the problem, with the link `CONNECTION CHECK` (`#/diag`) | toast, bar closes |
| `watching`, `off` (cancelled) | pill back to `FIND MATCH` | closes |
| Reload or tab close while searching | the search ends; on the next load Home says nothing (a search is not a commitment) | — |

- **Before the first search** the matchmaking topic's two one-time notices appear as sheets: who sees what in the lobby, and that ranked is an honour system.
- **One tab searches.** A second tab shows `SEARCHING IN ANOTHER TAB` with `USE HERE`.
- **Practise while you wait.** A solo game (against Sparring or alone) can be opened while the bar runs. The bar is drawn by the shell at the table's top edge, not by the HUD; the match found overlay opens over the table, and `ACCEPT` saves the solo game to History first (computer.md D15). Built last among the core.

### 4.6 Match found and ready check

**Purpose.** Make sure everyone is at the screen before a table is created.

```
 desktop                                                        phone
┌───────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ dim scrim over the shell ▒▒▒▒▒▒▒▒▒▒▒▒ │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│                                                           │  │                              │
│                     M A T C H   F O U N D                 │  │    M A T C H   F O U N D     │
│                     1V1 · UNRANKED                        │  │    1V1 · UNRANKED            │
│                                                           │  │                              │
│                ◆ Amber Fox   ✓        ▲ Ben   …           │  │   ◆ Amber Fox  ✓             │
│                                                           │  │   ▲ Ben        …             │
│                          ( 17 )                           │  │           ( 17 )             │
│                    ┌──────────────────┐                   │  │  ┌────────────────────────┐  │
│                    │      ACCEPT      │                   │  │  │         ACCEPT         │  │
│                    └──────────────────┘                   │  │  └────────────────────────┘  │
│                        ( DECLINE )                        │  │         ( DECLINE )          │
└───────────────────────────────────────────────────────────┘  └──────────────────────────────┘
```

- The countdown is a ring with the seconds in it, 20 s. `Enter` accepts, `Escape` does nothing (too easy to hit).
- A sound cue plays (if sound is on) and the tab title becomes `● Match found · Spellplane` until answered, so a player in another tab notices. With `NOTIFY ME` granted, a system notification is raised when the tab is hidden.
- Seats show the seat glyph and nickname, the rating in ranked, the deck strength pips, and `played 3 · you won 2` for a player met before. A check appears as each player accepts.

| State | What shows | Then |
| --- | --- | --- |
| Waiting for me | as drawn | — |
| I accepted, others pending | button becomes `WAITING FOR BEN…` (outlined) | — |
| All accepted | `Everyone is ready.` 600 ms | versus screen (4.7) |
| Someone declined or timed out | toast `Ben did not accept. Back in the queue.` | back to searching with the old timer |
| I declined | overlay closes | Home, not searching |
| I timed out | overlay closes; toast `You missed the match. Search stopped.` | not searching |
| The connection to the lobby dropped | toast `The match was lost. Back in the queue.` | searching, or `failed` |

### 4.7 Versus screen (loading into the table)

**Purpose.** Bridge the seconds in which browsers connect, decks are committed and cards load, and show who is playing. Used for matched games (the matchmaking topic's pairing transition, `Pairing.svelte`) and, in the same form, after a private waiting room starts. A computer game uses the shorter start sequence of computer.md 2.2 instead.

```
 desktop                                                        phone
┌───────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐
│ ░░░░░░░░░░░ arena still, blur easing from 8 px to 4 px ░░ │  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                                           │  │  ▲ BEN                       │
│     ◆ AMBER FOX                        ▲ BEN              │  │  BOOSTER DECK · 40           │
│     CUSTOM DECK · 60          vs       BOOSTER DECK · 40  │  │  ✓ connected  ◌ deck         │
│     ✓ connected                        ✓ connected        │  │                              │
│     ✓ deck shuffled                    ◌ shuffling deck   │  │            vs                │
│     ◌ cards 34 / 60                                       │  │                              │
│                                                           │  │  ◆ AMBER FOX                 │
│                1V1 · UNRANKED                             │  │  CUSTOM DECK · 60            │
│                Ben goes first.                            │  │  ✓ connected ✓ deck ◌ 34/60  │
│                                                           │  │  1V1 · UNRANKED              │
└───────────────────────────────────────────────────────────┘  └──────────────────────────────┘
```

- Four-player games show four columns (phone: four rows); 2v2 groups them as two teams.
- **An opponent's deck name is never shown here**, only its kind and its committed size: a name such as "Mono-red burn" gives away the plan before the first card.
- What the app does by itself here, per player and in this order: join the room, take the assigned seat and colour, commit the selected deck (`importDeck`, which is today's Ready), shuffle, draw seven; then one shared commit-and-reveal roll (`roll('firstPlayer', n)`) picks who goes first and the creator's browser dispatches `start`. Each step ticks a line.
- The table opens when every player is connected and committed, not when images are done; faces keep loading on the table.
- **Minimum time** 1.2 s, so the screen can be read; **typical** 3–8 s.

| Failure | Copy | Actions |
| --- | --- | --- |
| A pair cannot connect within 30 s | `Ben could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.` | `SEARCH AGAIN` (matched) or `BACK TO THE WAITING ROOM` (private), `HOME` |
| A player's deck cannot be loaded (card data offline) | `Your deck's cards could not be loaded. Check your connection.` | `TRY AGAIN`, `HOME` |
| A player leaves during loading | `Ben left before the game started.` | as the first row |

A matched game that never started is not written to History.

### 4.8 Waiting room and invite sheet (private games, draft nights)

**Purpose.** Get the right people connected and ready. This replaces today's `ui/lobby/Lobby.svelte` form (new file `ui/lobby/WaitingRoom.svelte`; the lobby rules in `ui/lobby/seats.ts` and `ready.ts` stay). The rules and the plate states are the matchmaking topic's (2.12); the layout is this section's.

**Contents in priority order:** the seats; the invite sheet (open on arrival for the creator); my deck slot; the primary button; the setup summary; nickname and seat colour; spectators.

**Desktop**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ( ← HOME )       AMBER FOX 93 ●   PRIVATE GAME · 1V1 · ANY DECK   ( ✎ )        ( INVITE ⇪ )  │
│ ░░░░░░░░░░░░░░░░░░░░░░░ arena still, blur 4 px: the table you will play on ░░░░░░░░░░░░░░░░░ │
│                                                                                              │
│                              ┌──────────────────────────┐                                    │
│                              │   +  INVITE A PLAYER     │   seat 2 · open                    │
│                              └──────────────────────────┘                                    │
│                         ╔══════════════════════════════════╗                                 │
│                         ║            the table             ║                                 │
│                         ╚══════════════════════════════════╝                                 │
│                              ┌──────────────────────────┐                                    │
│                              │ ◆ AMBER FOX (you)  ✎     │   seat 1 · choosing a deck         │
│                              │ GRUUL STOMPY · 60        │   ( CHANGE DECK )                  │
│                              └──────────────────────────┘                                    │
│                                                                                              │
│                                   ┌──────────────┐                                           │
│                                   │    READY     │      Waiting for one more player.         │
│                                   └──────────────┘                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone**

```
┌────────────────────────────────┐
│ ←  AMBER FOX 93 ●       ( ⇪ )  │
│ PRIVATE · 1V1 · ANY DECK ( ✎ ) │
│ ┌────────────────────────────┐ │
│ │ +  INVITE A PLAYER         │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ ◆ AMBER FOX (you) ✎        │ │
│ │ GRUUL STOMPY · 60          │ │
│ │ ( CHANGE DECK )            │ │
│ └────────────────────────────┘ │
│                                │
│ Waiting for one more player.   │
│ ┌────────────────────────────┐ │
│ │           READY            │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

- **Seats** are drawn around a table outline in the positions of the format (two across for 1v1; three or four around; 2v2 as two pairs with the team named). A seat card shows glyph and colour, nickname, the deck state (`CHOOSING A DECK`, `DECK READY`; never another player's deck name, and the committed card count only after Ready), a check when ready and a connection dot. An empty seat is an invite button. Clicking another empty seat moves me there; `SHUFFLE SEATS` is in the setup sheet.
- **A pair that cannot connect** shows on both seat cards: hollow dot and `CANNOT CONNECT`. The line under the button explains once: `You and Ben cannot connect directly. Try another network, a phone hotspot or a VPN on one side. Spellplane has no relay server.` The connection check runs by itself; nothing alarms before 15 s have passed.
- **My deck slot** shows the deck selected on Home (my own card shows its name; the others see only the state). `CHANGE DECK` opens the deck picker sheet (the grid of 4.2 in a sheet) without leaving the room. With `BOOSTER DECKS ONLY`, custom decks are dimmed with the reason. In a draft night the slot shows the boosters and no deck.
- **Primary: `READY`.** It commits the deck (as today) and becomes `READY ✓` (a tap takes it back) until the start. The line beside it always says what is missing: `Waiting for one more player.` / `Waiting for Ben to be ready.` / `Starting in 3…`.
- **Start.** When every seat of the format is taken, everyone is ready and every pair is connected, the creator's pill becomes `START · 3` and presses itself when the count reaches zero; the creator can press it sooner, and any player can stop it by un-readying. Before that the creator's pill says why not, from `startProblem`: `WAITING · 1 OPEN SEAT`, `WAITING · 2 OF 3 READY`. If seats stay empty, the creator sees a ghost pill `START WITH 3 PLAYERS` (it changes the format to match the taken seats) once at least two are ready.
- **Setup summary** `( ✎ )`, creator only: table (`1v1`, `3 ffa`, `4 ffa`, `2v2`), decks (`own decks`, `sealed decks`, `live draft`), pass timer, and for a live draft the booster setup sheet (4.4). Others see the summary as text with `Amber Fox chooses the setup`. Switching to `live draft` here turns a private game into a draft night; nothing else differs between the two.
- **Draft night:** after the start the stage goes to draft, then build, then the versus screen, then the table, on the same route. Those screens are restyled with the kit; their flow is unchanged from M2.
- **The log, chat panel and table tools are not shown here;** chat is one collapsed line at the foot.
- **Back:** Home; the table stays in History as `Not started`.

**Invite sheet** (opens by itself for the creator; `INVITE ⇪` and every empty seat reopen it; built once as `InviteSheet.svelte`, MM-9)

```
┌──────────────────────────────────────┐
│ (👤+)  Invite players             ✕  │
│        Send this link, or let them   │
│        scan the code. Whoever opens  │
│        it sits down at your table.   │
│          ┌──────────────────┐        │
│          │                  │        │
│          │     QR code      │        │   dark on a white plate in every look
│          │                  │        │
│          └──────────────────┘        │
│  [ https://…/#/t/amber-fox-93/…  ]   │   read-only, selects on focus
│  [            COPY LINK            ] │   filled; `SHARE` beside it where navigator.share exists
│                                      │
│  Game code:  AMBER FOX 93            │   small, muted: the game's name
│  ○ Waiting for players · 1 of 2 here │   presence line
│  ──────────────────────────────────  │
│  ( SPECTATOR LINK )                  │   ghost, rare
└──────────────────────────────────────┘
```

- `COPY LINK` → the button reads `COPIED ✓` for 2 s. Cancelling the system share sheet copies nothing.
- The QR code is generated in the browser (`qrcode-generator`, the library Zhess uses, loaded when the sheet opens; nothing is sent anywhere). It encodes the full table link. Scanning is the phone camera's job.
- **Error:** if the signalling relays cannot be reached, the presence line reads `Could not reach the connection service. The link still works once you are connected.` with `CONNECTION CHECK`.

### 4.9 Joining: opening an invite link, or typing a code

**Opening a link** (`#/t/<room>/<key>`) lands directly in the waiting room (4.8) with a chair already taken and the last used deck in the slot. For a visitor on their first visit the same room is the first screen they ever see, so:

- the top line says `◆ Ben invites you to a 1v1.` for 6 s;
- the deck slot, when empty, offers `USE A STARTER DECK` (filled), `OPEN SIX BOOSTERS`, `PASTE A LIST`; with sealed decks only, `OPEN SIX BOOSTERS` is the filled one and the others are absent;
- the nickname is the made-up one, with a pencil.

| State of the table when the link is opened | What shows |
| --- | --- |
| Not started, a seat free | The waiting room, seated. |
| Not started, all seats taken | `This table is full.` + `WATCH` + `HOME`. |
| In play, I hold a seat (my key) | Gathering or the table (4.12). |
| In play, I hold no seat | `This game has started and every seat is taken. If one of them is yours, ask a player at the table to bring you back from your name's menu.` + `WATCH` + `HOME` (persistence section 7). |
| Nobody is there and I have no save | The waiting room with me as the only player and `Waiting for the others. The player who invited you may have closed the table.` after 8 s. |
| Joining takes more than 10 s | `Still connecting…`, then the calm connection text of 4.8 with `WATCH INSTEAD` and `HOME`. |
| The link is malformed | `This is not a complete table link. Ask for it again.` + `HOME`. |

**`JOIN A GAME…` on Home** (Private Game) opens a small sheet with one field: `Paste the invite link`. A link, also inside a sentence, navigates to it. A bare code is answered with `Paste the whole link: the code alone does not carry the key.` The Stretch path makes a bare code work:

- **Join by code is a knock.** The code (`amber fox 93`, any case, spaces or dashes) addresses a *door* beside the room: a second room whose key is derived from the code. The joiner's browser sends its nickname and public key there; every player at the table sees a toast `Cleo wants to join.` with `LET IN` and `DECLINE`. `LET IN` sends the table link over the door, and the joiner's browser opens it. Nobody answering within 20 s: `Nobody opened the door. Ask for the link instead.`
- The door exists because a typed code is short: it must not be enough to enter or to listen. The journey needs `knock(code) → 'letIn' | 'declined' | 'timeout'` on the joining side and a `knocked { nickname }` event with `letIn()` and `decline()` at the table.

### 4.10 The table

**Purpose.** Play. The table and its HUD are M7's (`docs/design/m7-hud-proposal.md`, `m7-adjustments.md`); M8 decides how a player arrives, what is open at that moment, and the ways out.

**On entry (J14, J28):** the deck is in the library, shuffled; seven cards are in hand; a banner `Ben goes first` fades after 3 s; two chips over the hand, `KEEP` and `MULLIGAN`, stay until the first card is played or `KEEP` is pressed. The log is closed. No dialog, no settings, no import prompt.

**Desktop**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ (←) (≡ MENU) (↶)        ( BEN'S TURN · TURN 1 │ BEGIN  MAIN  COMBAT  MAIN 2  END )   ( 💬 2 ) │
│                               ▲ BEN  20 · hand 7 ▯  ( ⋯ )                                    │
│  Ben's piles                                                                                 │
│                                                                                              │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                                                              │
│                                                                              my piles        │
│                               ( KEEP )  ( MULLIGAN )                                         │
│ ◆ AMBER FOX 20 ( ⋯ )        [ my hand: seven cards, fanned ]          [ WAITING FOR BEN ] (🎙)│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone (portrait)**

```
┌────────────────────────────────┐
│ (←)(≡)(↶) BEN'S TURN · BEGIN(💬)│
│        ▲ BEN 20 · ▯7 (⋯)       │
│                                │
│        opponent's side         │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│           my side              │
│                                │
│      ( KEEP ) ( MULLIGAN )     │
│   [ my hand, fanned, 7 ]       │
│ ◆ 20 (⋯)   [ WAITING… ]  (🎙)  │
└────────────────────────────────┘
```

**The menu (`≡`).** One group is new, and it comes first; the rest is the M7 proposal's menu. The HUD is M7-P2's file; the shell supplies the first group through `menuTop`.

| Group | Items |
| --- | --- |
| **This game** | `Leave to home` (the game keeps running) · `Invite…` (while a seat is open) · `Concede` · `Declare result…` |
| Game | Mulligan · Draw several · Shuffle · Untap all · Create token… · Roll a die · Flip a coin · Tidy my side |
| Deck | Sideboard (between games) |
| Table | Spectator link · Seats and teams · Audit |
| View | Fit table · Tilt · Look ▸ |
| Voice | Voice and microphone… · Captions |
| Help | How to play · Keyboard shortcuts · Settings… |

`Import deck…` leaves the in-game menu: a deck is chosen before the table. A table without a deck (the sandbox at `#/solo`) shows one line above the hand, `No deck on this table.`, with `Choose a deck` (m7-adjustments D7). A computer table hides Talk, chat, invites, the spectator link and Audit (computer.md D20).

**Leaving**

- The back arrow (top left, tooltip `Leave: the game is kept in your history`), `Menu → Leave to home`, `Leave table` in my plate's menu, the browser's Back button, or closing the tab: the game is saved, the session leaves the room, the scene is disposed, and Home opens with the toast `You left the table. The game goes on; your seat is kept.` + `REJOIN` (6 s).
- There is no confirmation and no dialog.
- The others see a toast `Ben left. The game goes on; Ben can come back.`, Ben's plate dims with `AWAY` within a second, and Ben's hand and library are out of reach as today. They may keep playing.
- A solo game leaves the same way; there is nobody to wait for, so it resumes at once.

**The plate menu (`⋯` on every player plate, or a tap on the plate)** — the owner's "special menu present in each player state in the respective panel". M7-P2 builds the plate and the menu; the shell fills the connection section at its top (`plateMenuTop`) and the badge on the plate (`plateBadge`). The lines are `persistence.md`'s (section 7).

| On | Connection section (top) | Then |
| --- | --- | --- |
| My plate | `Saved · 4 s ago` · `Export this game…` · `Leave table` | `Counters…` · `Seat colour` · `Change name` · `Concede` |
| Another player, here | `● Here` | `Counters…` · `Volume` / `Mute` · `Look at their side` · `Reveal my hand to them` |
| Another player, away | `○ Away for 3 min` · **`Bring Ben back…`** (primary); with an open invite: `Invite open · made by Ann` · `Take the invite back` | `Look at their side` |
| An away player in a team game, seen by an opponent while the teammate is here | `○ Away` · `Only Ben's teammate can bring Ben back.` | `Look at their side` |
| Sparring | — | `Pause Sparring` · `Pace` · `Take back Sparring's last step` · `Skip Sparring's turn` · `Sparring concedes` (computer.md 2.3) |

An away plate also carries the badge `RE-INVITE` directly on the plate, so the path is visible without opening the menu. A browser that cannot save shows the badge `NOT SAVING` on its own plate, to its player and to the others.

### 4.11 Bringing a player back

**Purpose.** Bring back a player who did not show up or whose browser lost the game. The mechanism is `persistence.md` section 7; this section is what the players see.

```
┌──────────────────────────────────────┐
│ (👤↻)  Bring Ben back             ✕  │
│        Send Ben this link, or let    │
│        him scan the code. It opens   │
│        this game at his seat.        │
│          ┌──────────────────┐        │
│          │     QR code      │        │
│          └──────────────────┘        │
│  [ https://…/rejoin/s1/…         ]   │
│  [            COPY LINK            ] │
│  ○ Waiting for Ben                   │
│  Works once, for 24 hours, and only  │
│  for Ben's seat.  ( MAKE A NEW LINK )│
└──────────────────────────────────────┘
```

- Opening the sheet makes the link (the `seatInvite` action; the log says `Ann made a link to bring Ben back.`). Closing and reopening shows the same link until it is used, taken back or expired. `MAKE A NEW LINK` voids the old one.
- The sheet is the invite sheet's component with another title, text and footer. The full text under the title on desktop: `If his browser still has the game, he gets his hand back. If not, he sits down again and rebuilds his library from his deck list.`
- When Ben arrives, the state row turns to `● Ben is here`, the sheet closes after 1.5 s, and a toast says `Ben is back`.

**What the invited player sees**

| Their browser | What happens |
| --- | --- |
| The same browser, game still saved | The token is ignored. The game opens as from History: the key reclaims the seat (4.12). |
| Another browser, or storage was cleared | `Looking for the table…` until a player answers (it never starts a table of its own), then a card: `Sit down as Ben?` with the name prefilled and editable, `SIT DOWN AS BEN` (filled) and `WATCH INSTEAD`. |
| After sitting down | The public table is synced from the newest copy. Everyone sees `Ben is back from a new browser (link made by Ann).` Because this browser has none of Ben's hidden cards, the existing recovery step opens by itself (`ui/recovery/RecoveryPanel.svelte`: pick the deck, the table subtracts Ben's public cards, a new library is shuffled, the hand size is agreed). That panel is restyled, not redesigned. |
| A browser that holds another seat in this game | `This link is for Ben's seat. You are Ann at this table.` + `OPEN MY SEAT`. |
| The old browser, after someone else took the seat | `Your seat was taken over from another browser (link made by Ann, 21 Nov 14:02). Your saved hand for this game can no longer be used.` + `WATCH` + `HOME`; its History card gets the badge `SEAT MOVED`. |

**Errors:** used or taken back → `This link was already used. Ask for a new one.`; past 24 hours → `This link has expired. Ask for a new one.` Each with `WATCH` and `HOME`.

### 4.12 Gathering (re-entering a game)

**Purpose.** Make sure a game continues from its newest state. The rule is `persistence.md`'s muster rule (section 5); this section places and words the screen.

Opening a game from History, the `CONTINUE` strip, its link or a reload always takes the same steps: load the own save and draw the table from it at once, read-only under the flat `overlay` scrim (never blurred: card faces are on it); join the room on standby; when the muster rule holds, the scrim fades (400 ms) and the table is live. No click is needed.

| Situation | Result |
| --- | --- |
| A solo game (computer or practice) | Live at once; no Gathering. |
| A player who stayed is at the table | Sync to them, live within a second; Gathering is never seen. |
| My copy says everybody else had left before me | Live at once, alone; the others show as away with `RE-INVITE`. |
| My copy shows players who were still there when I left, and they are not here | Gathering, as drawn. |

```
 desktop                                                        phone
┌───────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐
│ ( ← HOME )   the saved table, drawn and blurred behind    │  │ ←      (table, blurred)      │
│                                                           │  │ ┌──────────────────────────┐ │
│        ┌─────────────────────────────────────────┐        │  │ │ WAITING FOR BEN          │ │
│        │ WAITING FOR BEN                         │        │  │ │ 1V1 · TURN 6             │ │
│        │ 1V1 · TURN 6 · AMBER FOX 93             │        │  │ │ ◆ AMBER FOX (you) ● Here │ │
│        │                                         │        │  │ │ ▲ BEN        ○ Not here  │ │
│        │ ◆ AMBER FOX (you)            ● Here     │        │  │ │           ( BRING BACK ) │ │
│        │ ▲ BEN       ○ Not here   ( BRING BACK ) │        │  │ │ Newest table: yours ·    │ │
│        │                                         │        │  │ │ turn 6 · saved 12 min    │ │
│        │ Newest table: yours · turn 6 · saved    │        │  │ │ ago                      │ │
│        │ 12 min ago                              │        │  │ │ ( LOOK AT THE TABLE )    │ │
│        │                                         │        │  │ │ ( PLAY ON WITHOUT BEN )  │ │
│        │ ( LOOK AT THE TABLE )                   │        │  │ │ ( HOME )                 │ │
│        │ ( PLAY ON WITHOUT BEN )      ( HOME )   │        │  │ └──────────────────────────┘ │
│        └─────────────────────────────────────────┘        │  │                              │
└───────────────────────────────────────────────────────────┘  └──────────────────────────────┘
```

- **Title:** `Waiting for Ben` with two players; `Getting everyone back` with more.
- **One row per seat,** with its state at the right: `● Here` · `◌ Connecting…` (pulsing) · `○ Not here` with `BRING BACK` (opens 4.11) · `○ Left before you` for seats the newest copy marks away: they are not waited for, and have the same pill.
- **One muted line names the newest copy:** `Newest table: Ann's · turn 7 · saved 2 days ago`. If this browser's copy was replaced: `Your copy was 38 actions behind. It is up to date now.`
- **`LOOK AT THE TABLE`** hides the card and shows the table read-only (cards do not lift) with a banner `Waiting for Ben · Bring back · Play on without Ben`.
- **`PLAY ON WITHOUT BEN`** appears after 8 s of waiting (`… WITHOUT BEN AND CY` with several). Under it: `If they come back with a newer table, theirs replaces this one.` It marks those seats away for everybody gathered, and the table goes live.
- **`HOME`** leaves; the game stays in History.
- **Failure lines** replace the newest-copy line, one at a time: `No connection. Trying again in 8 s.` + `TRY NOW`; `The connection service cannot be reached.` with the remedies of 4.8; the version notice.
- **After a fork was repaired** (two copies that both went on): a toast in plain words, `Continued from Ben's table (turn 7). Your last 3 moves were played again on top.`
- **A second tab** on the same game opens read-only with `This game is open in another tab.` + `USE HERE`.
- **A matched game** adds the matchmaking topic's absence rule: a player away for five minutes can be claimed absent, and the banner then offers `CLAIM THE GAME`.
- **Waiting in the background (Stretch, PS-12).** While gathering, the player may go Home or to Decks; the room stays joined without a scene, and the queue bar's place shows `● 1/2 · WAITING FOR BEN · OPEN`. When the muster completes elsewhere, the bar reads `EVERYONE IS BACK · PLAY` and pulses once. Core: leaving the Gathering screen leaves the room.

### 4.13 End of game

**Purpose.** Give the end a moment, record the result, and offer the next thing.

**Getting there.** Nothing ends by itself.

| Trigger | What happens |
| --- | --- |
| `Menu → Concede` (or my plate's menu) | One confirm (`Concede this game?` `CONCEDE` / `KEEP PLAYING`), then the `concede` action (a contract addition of the matchmaking topic, which also records `TableState.result`). In 1v1 the game ends at once with the other player as winner. In multiplayer the conceding player is out; the game ends when one player or team is left. |
| A life total reaches 0 (or 10 poison) | That player gets a quiet chip above their hand: `You are at 0 life.` `CONCEDE` · `NOT YET`. Nobody else is prompted, nothing is forced. |
| `Menu → Declare result…` | A small sheet: pick the winner (or `DRAW`), `PROPOSE`. The others get the existing OK / Hold prompt: `Amber Fox proposes: Ben wins.` When all OK, the game ends. |
| Solo | Against Sparring: a life total at 0 after a combat cue, `Sparring concedes`, or my `Concede` (computer.md 2.4). Alone: the Dummy at 0 gives `Dummy down on turn N` (computer.md section 11). |

**The overlay.** The table stays visible under a dim scrim (50 % of the look's overlay colour; no blur, because card faces are on the table).

```
 desktop                                                        phone
┌───────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ the table, dimmed ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│                                                           │  │                              │
│                       V I C T O R Y                       │  │       V I C T O R Y          │
│                 Ben conceded on turn 9.                   │  │  Ben conceded on turn 9.     │
│                                                           │  │                              │
│              ◆ AMBER FOX  20        ▲ BEN  3              │  │  ◆ AMBER FOX 20   ▲ BEN 3    │
│              RANK 1512  ▲ +12                             │  │  RANK 1512 ▲ +12             │
│                                                           │  │ ┌──────────────────────────┐ │
│                   ┌────────────────────┐                  │  │ │   FIND ANOTHER MATCH     │ │
│                   │ FIND ANOTHER MATCH │                  │  │ └──────────────────────────┘ │
│                   └────────────────────┘                  │  │  ( REMATCH )  ( HOME )       │
│              ( REMATCH )  ( HOME )  ( LOOK AT THE TABLE ) │  │  ( LOOK AT THE TABLE )       │
└───────────────────────────────────────────────────────────┘  └──────────────────────────────┘
```

| Part | Content |
| --- | --- |
| Headline | `VICTORY`, `DEFEAT`, `DRAW`; for a spectator or a practice game, `GAME OVER`. Wide-tracked, light weight, no box. |
| Reason line | `Ben conceded on turn 9.` / `Agreed by both players.` |
| Rating line | Ranked only: the matchmaking topic's result card (new rating and change) once the result is signed by the players. Until then: `Waiting for Ben to confirm the result.` |
| Primary | By mode: Quick Match → `FIND ANOTHER MATCH` (same setup, back to Home searching); Private → `REMATCH` (the existing next-game proposal; the waiting room is skipped when all accept); Draft Night → `NEXT GAME` (back to the builder to sideboard); Solo → `REMATCH` against Sparring, `AGAIN` alone. |
| Others | `REMATCH` (matched games too: it asks the same opponents), `HOME`, `LOOK AT THE TABLE` (hides the overlay; a `RESULT` chip brings it back). Draft Night adds `NEW DRAFT` and the line `Your drafted deck was saved to Decks.` |

The game's History card then reads `Ended`. An ended game cannot be continued; its room stays usable for a rematch. The overlay is a statement, not a lock: with `LOOK AT THE TABLE` the table stays playable, and if the life totals are corrected so that nobody is at 0 any more, a solo game's result is cleared (computer.md 2.4).

### 4.14 History

**Purpose.** Find an old game and reopen it. On Home below the fold (five most recent) and in full at `#/history`. The record (`GameSummary`), the card's content, its menu, removal and export are `persistence.md`'s (section 3), built once as the `History` component; this section places it.

**Desktop (`#/history`)**

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ S P E L L P L A N E            ( PLAY │ DECKS │ HISTORY )                (◆ Amber Fox) ( ⚙ ) │
│                                                                                              │
│   YOUR GAMES     ( ALL │ UNFINISHED │ FINISHED )                                             │
│                                                                                              │
│   TODAY                                                                                      │
│   ┌──────────────────────────────────────────────────────────────────────────────────────┐   │
│   │  ┌────┐   VS BEN                                                          12 min   ⋯ │   │
│   │  │mini│   1v1 · Constructed · Gruul Stompy                          AMBER FOX 93     │   │
│   │  └────┘   Turn 6 · your turn                                                         │   │
│   └──────────────────────────────────────────────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────────────────────────────────────────────┐   │
│   │  ┌────┐   BEN, CLEO AND DAN                      NEWER ELSEWHERE           2 h     ⋯ │   │
│   │  │mini│   4 free-for-all · Live draft · 3 × FDN                     REED OWL 12      │   │
│   │  └────┘   Turn 11 · Cleo's turn                                                      │   │
│   └──────────────────────────────────────────────────────────────────────────────────────┘   │
│   THIS WEEK                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────────────────┐   │
│   │  ┌────┐   ⬡ SPARRING · STEADY                                              3 d     ⋯ │   │
│   │  │mini│   1v1 · Starter Green                                                        │   │
│   │  └────┘   You won on turn 9                                                          │   │
│   └──────────────────────────────────────────────────────────────────────────────────────┘   │
│   Saved games are protected in this browser.                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Phone**

```
┌────────────────────────────────┐
│ S P E L L P L A N E    (◆)(⚙) │
│ YOUR GAMES                     │
│ ( ALL │ UNFINISHED │ FINISHED )│
│ TODAY                          │
│ ┌────────────────────────────┐ │
│ │ ▣  VS BEN          12 min  │ │
│ │ 1v1 · Gruul Stompy         │ │
│ │ Turn 6 · your turn         │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ ▣  BEN, CLEO AND DAN  2 h  │ │
│ │ 4 FFA · Live draft         │ │
│ │ Turn 11 · Cleo's turn      │ │
│ └────────────────────────────┘ │
│ ( PLAY  │  DECKS  │  HISTORY ) │
└────────────────────────────────┘
```

**A history card** (96 px high on desktop, 72 px on a phone; the whole card is one button)

| Part | Content |
| --- | --- |
| Thumbnail | A drawn mini table, not a card image: one disc per seat at its table edge in the seat colour, the life total inside, my disc ringed, away discs hollow. Inline SVG from the summary. |
| Title | The other players by name (`VS BEN`; `BEN, CLEO AND DAN`; `YOU + ANN VS BEN + CY`); a renamed game shows its title; a computer game `⬡ SPARRING · STEADY`; a game alone `PRACTICE`. Never the code. |
| Line 2 | Format, deck source, own deck name. |
| State line | `Turn 7 · your turn` · `Turn 7 · Ben's turn` · `Drafting` · `Building decks` · `Not started` · `Ended · you 14, Ben 0`. Solo games use the computer topic's lines (`You won on turn 9`, `Dummy down on turn 6`). |
| Right column | Relative time; under it the code in small muted type, so two players can say which game they mean. |
| Badges | `HAND LOST`, `NEWER ELSEWHERE`, `SEAT MOVED`, and `● 2/3` while the game gathers in the background. |
| Menu `⋯` | `Resume` · `Invite link` · `Export this game…` · `Rename` · `Mark as finished` · `Remove` (undo toast, 6 s). |

- **A tap** opens an unfinished game (4.12) and an ended game read-only. An ended computer game offers `REMATCH`, an ended practice `AGAIN`, in the read-only view.
- **Filters** `ALL · UNFINISHED · FINISHED` are this document's addition; **groups** are Today, This week, Earlier. **Kept:** 50 games (persistence D5); at most one unfinished practice table per deck.
- **Empty:** `No games yet. Games you play are kept here, on this device, so you can leave and come back.` + `PLAY` (goes Home). On Home's fold the section is simply absent.
- **Loading:** card outlines. **Error:** `Your games could not be loaded.` + `TRY AGAIN`.
- **The protection line** under the list says whether the browser may delete saved games, with `PROTECT` or `HOW` (persistence section 3). This is where the storage notices live now.
- **Back:** previous route.

### 4.15 Profile chip, settings, about

- **Profile chip** (top right): seat glyph in the preferred colour, nickname, and in ranked context the rating. Click opens a popover: nickname field (saved on blur), seat colour swatches with glyphs, rating with `Ranked is an honour system.`, link `BACK UP MY DATA` (Settings › Storage).
- **Gear:** `Settings`, `About`, `Connection check`. Pages render on the shared stage inside one panel, with `←` to the previous route.
- **Storage notices** (Home Screen hint, keep storage) leave the top of the first screen. They live in History's protection line and Settings › Storage; one toast offers them after the first finished game: `Keep your decks and games safe.` + `HOW`.

---

## 5. Screen inventory

| # | Screen | Route or state | Purpose | Primary action | Scope |
| --- | --- | --- | --- | --- | --- |
| 1 | Home | `#/` | Deck, mode, start; continue | per mode | Core |
| 2 | Decks | `#/decks` | Library, select, new | `PLAY WITH THIS DECK` | Core |
| 3 | New deck chooser | `#/decks/new` | How to make a deck | `OPEN BOOSTERS` | Core |
| 4 | Booster setup sheet | sheet | Sets, packs, draft kind | `DONE` | Core |
| 5 | Deck page | `#/decks/<id>` | Build and edit (`decks.md`) | `DONE` (back to Decks) | Core |
| 6 | Searching | state of Home + queue bar | Wait without being held | `CANCEL` (ghost) | Core |
| 7 | Match found | overlay | Ready check | `ACCEPT` | Core |
| 8 | Versus | state of the table route | Connect, commit, load | none | Core |
| 9 | Waiting room | `#/t/…`, stage `lobby` | Seats, connection, ready | `READY` | Core |
| 10 | Invite sheet | sheet | Link, QR, code as name | `COPY LINK` | Core |
| 11 | Draft, build | `#/t/…`, stages `draft`, `build` | Live draft night | as M2, restyled | Core (flow exists) |
| 12 | Table | `#/t/…`, `#/c/…`, `#/p/…`, stage `match` | Play | context button (M7) | Core |
| 13 | Leave | arrow, menu, Back; toast on Home | Save and go Home | — | Core |
| 14 | Bring-back sheet | sheet from a plate | Bring a player back | `COPY LINK` | Core |
| 15 | Sitting down again | state of the table route | A new browser takes an invited seat | `SIT DOWN AS BEN` | Core |
| 16 | Gathering | state of the table route | Continue from the newest state | none (waits) | Core |
| 17 | Game over | overlay | Result, next | per mode | Core |
| 18 | History | `#/history`, Home fold | Reopen games | card click | Core |
| 19 | Computer game against Sparring | `#/c/<room>` | An opponent that moves | context button | Core (computer topic; Home works without it) |
| 20 | Practise while searching | table + bar | Fill the wait | — | Core, built last |
| 21 | Settings, About, Connection check | `#/settings`, `#/about`, `#/diag` | as today | — | exists |
| 22 | Sandbox table | `#/solo` | Developers and tests | — | moved |
| 23 | Join by code | sheet + `#/g/<code>` | Knock | `KNOCK` | Stretch |
| 24 | Gathering in the background | bar | Wait for players while browsing | `OPEN` | Stretch (PS-12) |
| 25 | Party (queue with a friend), Commander pod, replay of finished games, staying connected to a live game after leaving | — | — | — | Later |

---

## 6. First run and the returning player

**First visit, no link** (nothing stored)

1. Home appears at once: wordmark, the line `A card table for Magic. No rules engine, no account.`, an empty pile outline as the hero with `NO DECK YET`, mode `SOLO`, the filled button `PLAY`, and under it `You get a starter deck and a sparring partner.`
2. `PLAY` → the hero slot fills with `STARTER · GREEN` while the pill reads `FETCHING THE DECKS…` (about two seconds: two small Scryfall searches, cached afterwards), then the blur clears into a table against Sparring on its gentlest level (computer.md 2.2: shuffle, seven cards each, `You go first`, `KEEP` · `MULLIGAN`).
   - The starter deck is saved to Decks as a custom deck, so it can be edited, and becomes the selected deck.
   - Until the computer topic's packages have landed, the same press opens a practice table alone with the starter deck; until the starter generator has landed, it runs `quickBoosterDeck` (six boosters, built automatically) instead.
   - Offline, or the card source unreachable, with nothing cached: a sheet `A first deck needs a connection once.` with `TRY AGAIN`, `PASTE A DECK LIST`, `OPEN AN EMPTY TABLE`.
3. On the table: seven cards in hand, log closed, one coach mark at a time (M7-P5's marks: `Drag a land from your hand onto the table`, and so on), plus the computer topic's one-time mark at Sparring's plate.
4. The back arrow → Home now shows the deck as the hero, the `CONTINUE` strip, and the toast `You left the table. The game goes on; your seat is kept.` A one-time chip by the profile chip: `You are Amber Fox. ✎` (dismissed by any click on it).
5. After the first finished game: the storage toast (4.15).

Nothing asks for a name, a format or a link on the way. The four modes are visible from the first second, so the newcomer sees that playing with others exists; the matchmaking lobby is not joined until they choose Quick Match (matchmaking MM-4).

**First visit, through an invite link:** section 4.9.

**Returning player**

- Home opens with the last deck, mode, format and options (`Settings.home`).
- An unfinished game shows in the `CONTINUE` strip; one click reopens it.
- One click starts the same kind of game as last time.
- If the app updated between visits, the existing update notice applies it on Home, never on a table.

---

## 7. Data shapes the journey needs

The journey adds two shapes of its own. Both are additive and go through the M8 contracts package.

```ts
/** Settings.home (store/types.ts, new key): what Home shows on the next visit. */
interface HomePrefs {
  mode: 'solo' | 'quick' | 'private' | 'draft';
  deckId: string | null;                       // the selected deck (decks.md D29)
  solo:    { opponent: 'sparring' | 'alone' }; // level, Sparring's deck and pace are the computer topic's own keys
  quick:   { format: Format; ranked: boolean };
  private: { format: Format; decks: 'any' | 'booster' };
  draft:   { format: Format; boosters: BoosterSetup };
}

/** The booster setup sheet's value; maps onto core's LobbySettings (draft, sets, pickTimer). */
interface BoosterSetup {
  how: 'pass' | 'sealed' | 'rochester' | 'winston' | 'grid';
  packs: number;        // per player
  picks: number;        // per pass, draft only
  sets: SetCode[];      // per pack; shorter lists repeat their last entry
  pickTimer: boolean;
}
```

Everything else the journey reads belongs to a sibling:

| Shape | Owner | Used by the journey for |
| --- | --- | --- |
| `GameSummary`, `GameStore` (`store/games.ts`) | `persistence.md` section 3 | The `CONTINUE` strip (`list()[0]`), History, and `GameStore.create` when a game is launched. The launcher passes `kind` (`'private'`, `'matched'`, `'solo'`), `format`, `decks` and the deck. |
| `MusterStatus`, `SessionMuster` | `persistence.md` sections 5–7 | Gathering (4.12) and the bring-back sheet (4.11). |
| `Matchmaker`, `MatchmakerStatus`, `LobbyView` | `matchmaking.md` 2.13 | Home's searching state, the queue bar, match found. |
| `DeckRecord.summary`, `DeckKind`, the strength chip | `decks.md` | The deck hero, the tiles, the deck picker sheet's `allow` rule. |
| `HudShellProps` | `m7-adjustments.md` section 2 | The table route (section 8). |
| The computer topic's selector model (values, pills, status line) | `computer.md` 2.1 | The `SOLO` option row. |

How Home's option rows map onto the matchmaking topic's queues: `quick.format` and `quick.ranked` and the selected deck's kind give the `QueueId`s passed to `Matchmaker.seek` (ranked adds the ranked queue for 1v1; `also casual` adds the casual one).

---

## 8. What the journey needs from the table (M7)

`m7-adjustments.md` is the authority on M7. These are the journey's requirements on the seam it defines; no M8 package edits a file under `src/scene/` (except the new `still.ts`) or the HUD's files.

| Need | Seam |
| --- | --- |
| A back arrow at the top left that leaves | The route passes `onleave`; the HUD shows the arrow and never asks "are you sure". |
| The menu's first group `This game` | The route passes `menuTop` with `Leave to home`, `Invite…`, `Concede`, `Declare result…`. |
| No set-up control in the HUD; `Import deck…` only in the sandbox | The route passes `sandbox` only at `#/solo`. |
| The log closed on entry at every size; `KEEP` / `MULLIGAN` chips over the hand | M7-P2 (D6) and the entry sequence of 4.10. |
| The plate menu's connection section and the plate badge | `plateMenuTop`, `plateBadge`, `seatPresence`, filled per 4.10. |
| A read-only table while gathering, with a banner | `notice` and the scene's `readOnly` (PS-7). |
| No game-over banner from the HUD | The route mounts the overlay of 4.13 above the HUD and stops passing `evening`, so "Next game" and "New draft" leave the HUD. |
| The camera starts from the still's pose when a table mounts | M7-P3's `enterFrom` and its pure `poseAt`, which `still.ts` uses too. |
| Every look builds without a table state | M7-P1 (so the still exists for all four looks). |
| The opening seven are dealt 40 ms apart with sound | M7-P4's group stagger. |
| Counters for live WebGL and audio contexts | M7-P6's `RenderDebug.liveContexts()` and `memory()`; the journey's tests assert 0 on Home. |

The M7 start page, the M7 game-over banner and the "Back to the solo table" links are not built or merged; Home, the overlay of 4.13 and the wordmark replace them.

---

## 9. Build plan

Chunks are sized for one agent in two to four hours. Each ends with `pnpm check` green (wrapped in oomph as in M7) and its own focused specs green; the full e2e run is the integrator's. E2E specs use `?transport=local`, `?faces=placeholder` and fixtures only, one Playwright run per worktree. Engine behaviour is asserted on state and the debug hook; screenshots are evidence.

### 9.1 Who builds what

The five documents describe some screens twice. Each is built once. The chunk ids on the left are the ones the sibling documents refer to.

| Chunk | Scope | Built by | The journey's part |
| --- | --- | --- | --- |
| J-C | Routes, `Settings.home`, `BoosterSetup`, app props, e2e URL builders | journey, inside the M8 contracts package | all of it (9.2) |
| J1 | Shell, nav, backdrop still, Home | journey | all of it |
| J2 | Launching a game, the table route, entering and leaving | journey | all of it; the practice table's first half until computer C7 adds the rest |
| J3 | History on Home and at `#/history`, the `CONTINUE` strip | `persistence.md` PS-1, PS-2, PS-4 | placement, the strip and the filter pills (one hour, with J1) |
| J4 | Decks library and new deck chooser | `decks.md` DK-5 | the layout of 4.2 and 4.3 is its specification |
| J5 | Booster setup sheet, quick booster deck, starter deck | `decks.md` DK-8 (sheet, `quickBoosterDeck`), `computer.md` C5 (starter generator) | the first-run wiring (with J2) |
| J6 | Waiting room and invite sheet | `matchmaking.md` MM-9, MM-10 | the layout of 4.8, the self-pressing `START`, the deck slot's offers |
| J7 | Versus screen and the entry sequence | `matchmaking.md` MM-7 (`Pairing.svelte`, matched entry) | `session/entry.ts` and its use after a private start (9.2) |
| J8 | Leave, Gathering, bring back, recovery after a take-over | `persistence.md` PS-5 to PS-9, PS-12 | the layouts and copy of 4.10 to 4.12 are their specification |
| J9 | End of game | journey | all of it; the rating line is MM-8's `ResultCard` |
| J10 | Queue bar and Home's searching state | `matchmaking.md` MM-6 (`FindMatch`, `QueueChip`, `MatchFound`) | the bar in the shell, the locked option row, the deck lock in Decks |
| J11 | Draft night | journey | all of it |
| J12 | Sparring | `computer.md` C1 to C8 | the `SOLO` option row renders its selector model |
| J13 | Phone pass, accessibility, the journey part of the gate | journey | all of it |
| J14 | Join by code (Stretch) | journey | all of it |

**Order:** J-C first; J1 next; J2 as soon as J1's shell exists; J9, J10 and J11 after J2; J13 last. J14 only when the core is green.

### 9.2 The journey's own chunks

#### J-C · Contracts (1–2 h)

| File | Change |
| --- | --- |
| `src/ui/routes.ts` | Routes `home`, `decks`, `deckNew` (with `path?: 'custom' \| 'boosters' \| 'import'`), `deck` (`id`), `history`, `practice` (`room`), `computer` (`room`), `join` (`code`), `party` (`code`, `key`), and `rejoin?: { seat, token }` on `room`. `''` and `#/` parse to `home`; `#/solo` parses to `solo`; `#/lobby` parses to `home`. `routeHash` for each. |
| `src/store/types.ts` | `Settings.home: HomePrefs` with `DEFAULT_SETTINGS.home` (`mode: 'solo'`, `deckId: null`, 1v1, unranked, any deck, booster draft of 3 packs); `HintId` adds `'nameChip' \| 'storageAfterGame'`; backup import accepts the new key. |
| `src/ui/types.ts` | `HomePrefs`, `BoosterSetup`; `AppProps` adds `games` (`GameStore`), `matchmaker`, `openPractice(room)`, `openComputer(room)`. |
| `tests/e2e/helpers/app.ts` and the other URL builders listed in `m7-adjustments.md` section 2 | The table is opened through `#/solo` when no hash is given; a new helper `openHome(page, opts)`. |

*Acceptance:* unit tests for `parseRoute` / `routeHash` round-trips of every route, old `#/t/…` links, a rejoin link and `#/lobby`; backup round-trip with `home`; the existing suites pass with the builders' change.

#### J1 · Shell and Home (3–4 h) — Core

| File | Change |
| --- | --- |
| `src/ui/App.svelte` | Route switch for the new routes; the shell wraps `home`, `decks`, `deckNew`, `history`, `settings`, `about`, `diag`; the page-frame links ("Back to the solo table") go. |
| `src/ui/shell/Shell.svelte`, `TopNav.svelte`, `ProfileChip.svelte`, `Backdrop.svelte`, `QueueBar.svelte` (new) | Top bar, nav (bottom tab bar under 600 px), profile popover, backdrop with the gradient fallback, the bar's slot. |
| `src/scene/still.ts` (new) | `renderArenaStill(theme, { width }) → Promise<Blob>`: builds the look's empty table with a temporary renderer at the pose `poseAt` gives, draws one frame, reads it out, disposes renderer, geometries, materials and textures, and registers with `scene/lifecycle.ts`. One still is kept in memory per look in use. It edits no other scene file. |
| `src/ui/home/Home.svelte`, `DeckHero.svelte`, `BoosterHero.svelte`, `ModePicker.svelte`, `OptionRow.svelte`, `PrimaryButton.svelte`, `ContinueStrip.svelte` (new) | Section 4.1; the hero is composed from `decks.md`'s parts. |
| `src/ui/home/model.ts` (new, pure) | `homeView(prefs, decks, online, storageOk, matchmaking) → { primary: { label, disabled, reason }, options, hero }`: every row of the primary-button table. |
| `src/ui/lobby/names.ts` (new) | `randomNickname()` from `ROOM_WORDS`; set on first visit when the stored nickname is empty (wired in `main.ts`). |

*Acceptance:* unit: `homeView` for every state row of 4.1; `randomNickname` is two capitalised words. E2E (`tests/e2e/home/home.spec.ts`): a fresh profile opens `./` and sees `data-testid="home"`, the nav, the empty hero and `PLAY` enabled; with a fixture deck saved, the hero shows its name, count and curve bars; switching mode changes the primary label and survives a reload; Draft Night shows the boosters and no deck arrows; with an unfinished fixture game the `CONTINUE` strip names it and the pill still reads `PLAY`; at 390 px wide the tab bar is at the bottom and nothing scrolls sideways; on Home `render.liveContexts()` is 0 after the still was made.

#### J2 · Launching, the table route, entering and leaving (4 h) — Core

| File | Change |
| --- | --- |
| `src/ui/play/launch.ts` (new) | One function per mode: make the room id (and key), `GameStore.create` with `kind`, `format`, `decks` and the deck, write `Settings.home`, navigate. For private and draft: `newRoom()`, mark created, the lobby settings from `BoosterSetup`. |
| `src/ui/lobby/RoomRoute.svelte`, `TableRoom.svelte` (kept as the route of `#/t`; the persistence and matchmaking chunks edit them too) | This chunk adds the frame only: which of the joining page, the waiting room, the versus screen, draft, build, Gathering, the HUD and the game-over overlay shows, chosen from stage, summary and muster status, and the `HudShellProps` passed to the HUD. The joining and failure pages get the copy of 4.9 on the stage. |
| `src/ui/play/SoloRoute.svelte` (new) | The same frame for `#/p` and `#/c` (no waiting room, no Gathering). |
| `src/session/entry.ts` (new) | `dealIn(session, deck)`: `importDeck`, `shuffle`, `draw(7)`; skipped when the seat already has a committed deck. `firstPlayer(session)`: `roll('firstPlayer', seats)` and the banner text. Used by practice, private starts, matched entry and the computer game. |
| `src/session/practice.ts` (new, first half of computer C7) | `createPracticeTable(deck)`: a solo session with its own room id, then `dealIn`. |
| `src/main.ts` | `openPractice(room)`; the eager solo session only for `#/solo`. |
| `src/ui/play/leave.ts` (new) | `leave(session)`: the persistence topic's `checkpoint('leave')`, `session.leave()`, dispose, `location.hash = '#/'`, the toast with `REJOIN`. Until PS-2 has landed it calls `whenSaved()`. |
| `src/ui/home/FirstDeck.svelte` (new) | The first-run press (section 6): the starter generator when present, else `quickBoosterDeck`; the ticking status; the error sheet. |

*Acceptance:* unit: `dealIn` on a fixture deck leaves 7 in hand and `deck − 7` in the library and does nothing the second time. E2E (`tests/e2e/journey/solo.spec.ts`): with a fixture deck selected, `PLAY` in `SOLO · ALONE` leads to a table where the hook reports 7 cards in hand, the log is closed and no dialog is open, with no key pressed (`input` counters); the back arrow leads Home without any dialog, the toast offers `REJOIN`, the `CONTINUE` strip names the game, and clicking it restores a table whose state hash equals the hash before leaving; the browser's Back button does the same; after leaving, `render.liveContexts()` is 0. `tests/e2e/journey/first-run.spec.ts`: a fresh profile presses `PLAY` once and arrives at a table with 7 cards in hand, and Decks then lists the new deck; with the card source made unavailable the error sheet offers its three ways out.

#### J7 · Entry after a private start (2 h) — Core

| File | Change |
| --- | --- |
| `src/ui/lobby/TableRoom.svelte` | After `start` from a waiting room, the versus screen (the matchmaking topic's `Pairing.svelte`) shows while every seat runs `dealIn` and the creator rolls the first player. |
| `src/session/entry.ts` | `enterMatch(session, plan)` for a seat plan (used by MM-7 as well): seat, colour, `dealIn`. |

*Acceptance:* unit, over `LoopbackNetwork` with two and four sessions: after `start`, every seat has seven in hand and all peers agree on the first player. E2E, two profiles: after the waiting room starts, both pass the versus screen and sit at a table with 7 cards each; when the second profile never commits, the 30 s copy of 4.7 appears (clock advanced through the hook).

#### J9 · End of game (3 h) — Core

| File | Change |
| --- | --- |
| `src/ui/play/GameOver.svelte`, `DeclareResult.svelte`, `ConcedeChip.svelte` (new) | Section 4.13; the rating line embeds MM-8's `ResultCard`. |
| `src/session/result.ts` (new) | `concede()` (the contract's `concede` action); `declare(result)` as a consent round (`ask` with `consent: true` and the label, answered with `respond`) that ends in the contract's result; `resultOf(state)` for the overlay. |
| `src/ui/flow/EveningBar.svelte` | Removed; its two actions are the overlay's `REMATCH` / `NEXT GAME` and `NEW DRAFT`. |

*Acceptance:* unit, over `LoopbackNetwork`: a concede ends a 1v1 on both peers; in a three-player game it ends only when one player is left; a declared result needs every OK, and one Hold leaves the game running; the 0-life chip is offered only to that seat. E2E (`tests/e2e/journey/end.spec.ts`): A concedes, both see the overlay with `VICTORY` and `DEFEAT`; `REMATCH` accepted by both leads to a new game on the same room with 7 cards each; History shows the game as ended; `HOME` returns to Home with no `CONTINUE` strip; `LOOK AT THE TABLE` hides the overlay and the `RESULT` chip brings it back.

#### J10 · The queue in the shell (2 h) — Core

| File | Change |
| --- | --- |
| `src/ui/shell/QueueBar.svelte` | Renders `QueueChip` full width under the nav (above the tab bar on phone) for the phases of 4.5; also over a solo table. |
| `src/ui/home/Home.svelte`, `OptionRow.svelte` | The searching state; the locked option row; the mapping from `HomePrefs.quick` and the deck's kind to `QueueId`s. |
| `src/ui/decks/DecksPage.svelte` | `IN THE QUEUE` on the queued deck and the `STOP AND EDIT` prompt. |

*Acceptance:* E2E (`tests/e2e/journey/queue.spec.ts`, two profiles): A presses `FIND MATCH`, navigates to Decks and History and the bar is there with a running timer; `EDIT` on the queued deck asks before stopping; B searches the same setup; both see `MATCH FOUND`, accept, pass the versus screen and sit at a table with 7 cards each without ever seeing a waiting room; a ranked search with 3 FFA is impossible (the toggle snaps back with its line).

#### J11 · Draft night (3 h) — Core

| File | Change |
| --- | --- |
| `src/ui/home/BoosterHero.svelte` | The packs (`BoosterPackArt`), the two text lines, `CHANGE BOOSTERS`. |
| `src/ui/play/launch.ts` | `OPEN DRAFT TABLE` writes `LobbySettings` from `BoosterSetup`. |
| `src/ui/lobby/WaitingRoom.svelte` (with MM-10) | The deck slot shows boosters; the setup sheet embeds the booster setup sheet. |
| `src/session/draft.ts` | After the build stage, the built deck is saved to Decks as a booster deck, once per draft. |
| `src/ui/decks/boosters.ts` (new) | `latestCoreSet(summaries)`: the newest of the core list including `FDN`; `M21` as the fallback; the newest fixture set in tests. |

*Acceptance:* unit: `latestCoreSet`; `BoosterSetup` ↔ `LobbySettings` round-trip for each way of drafting. E2E (`tests/e2e/journey/draft-night.spec.ts`, two profiles, fixture set): Home in Draft Night shows three packs labelled with the fixture set; the table's lobby settings equal the setup; after the draft and build (driven through the hook as the M2 gate does) both reach the table, and each profile's Decks lists the drafted deck with the lock.

#### J13 · Phone pass, accessibility and the journey gate (3 h) — Core

- Every screen of section 4 at 390 × 844 and 360 × 640: no sideways scroll, targets at least 44 px, the tab bar clear of the safe area.
- Axe on Home, Decks, History, the waiting room, Gathering and the overlays; focus order; `Escape` and Back close sheets; reduced motion cuts the un-blur.
- **Gate `tests/e2e/m8.gate.spec.ts`, journey part**, Chromium and WebKit, at most four pages, screenshots to `artifacts/shots/M8/`:
  1. Fresh profile: Home → `PLAY` → a table with seven cards, log closed, no key pressed.
  2. Leave by the arrow → Home with the hero and the `CONTINUE` strip → History → continue with an equal state hash.
  3. Two profiles: private table by link, ready, the self-pressing start, versus, table.
  4. Quick match: search, browse Decks with the bar, match found, accept, table.
  5. Concede → overlay → Home.
  6. After each table visit, on Home: `render.liveContexts()` is 0 and no transport is open.
  
  The leave, gather and bring-back scenarios are the persistence part of the same gate.

#### J14 · Join by code (2–3 h) — Stretch

`src/net/door.ts` (a second room `<room>/door` whose key is derived from the code; messages `knock`, `letIn`, `decline`), the toast at the table, the `JOIN A GAME…` sheet's code path, route `#/g/<code>`. *Acceptance:* over `LoopbackNetwork`, a knock that is let in receives the table link and one that is declined receives nothing but the refusal; the door carries no table state (leak test scenario: a browser at the door learns no card, no seat name and no key before `letIn`). E2E: two profiles, the code typed, `LET IN`, both in the waiting room.

---

## 10. Open questions for the owner

Each has the default this design uses until the owner says otherwise.

1. **Game codes.** *Default:* the existing three words and a number (`AMBER FOX 93`), small, as the game's name. Ztyle's own format is six characters (`K7QW2M`), which `persistence.md` prefers; switching is one function. In Zhess you removed codes from the screen altogether; here the code only shows in the invite sheet, the waiting room and History.
2. **Typing a code to join.** *Default:* not in M8; a bare code is answered with "Paste the whole link". The knock (someone at the table lets you in) is designed and marked Stretch.
3. **The primary button never becomes `RESUME`.** In Zhess one pill is `START` or `RESUME`. *Default:* here it always starts a new game of the selected mode, and the `CONTINUE` strip under it reopens the last one. Say if you want Zhess's single pill.
4. **Mode names and count.** *Default:* `SOLO`, `QUICK MATCH`, `PRIVATE GAME`, `DRAFT NIGHT`, with Draft Night as its own entry although it is a private table underneath.
5. **The first press.** *Default:* a generated starter deck and a game against Sparring, in about three seconds. The alternative is to open six boosters first (more exciting, 5–15 s on a first load).
6. **The latest core set.** *Default:* Foundations (`FDN`, 2024), falling back to Core Set 2021 (`M21`) if its booster data cannot be loaded.
7. **Leaving disconnects at once.** *Default:* yes; the others see you as away. Staying connected to a live game in the background (so Home can tell you it is your turn) is Later; only a game that is gathering may wait in the background.
8. **`START` presses itself** three seconds after everyone is ready. *Default:* yes; the creator can press sooner and anyone can stop it by un-readying.
9. **Opponents' deck names are hidden** in waiting rooms and on the versus screen (only the state, kind and size show). *Default:* hidden.
10. **Automatic setup in every game** (shuffle, seven cards, first player by a shared roll), private tables included. *Default:* on, since each step can be undone by hand.
