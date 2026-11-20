# M8 design: deck building mode

Topic "decks" of Milestone 8. Written 20 Nov 2026 during the unattended overnight run, from `docs/design/m8/owner-request.md`. It replaces and absorbs PLAN Milestone 7, aspect A7 "Deck builder mode": every A7 item is either kept here or dropped with a reason (decision D24).

Other M8 topics own the landing page, matchmaking, custom and draft games, save and rejoin, and the design system. `journey.md` and `matchmaking.md`, written in the same run, overlap with this document in four places (the library's shell, the new-deck chooser, the booster setup sheet and the strength formula). Decision D30 and section 9 say which document wins where.

**One word.** On screen this kind of deck is called a **booster deck** (the owner's word, and `journey.md`'s). In code and in this document's prose it is a **sealed** deck (`kind: 'sealed'`), because the seal is what defines it.

Owner sentences are quoted by number:

- **S1** "the landing page needs to have access to deck building mode with a library of decks and an individual deck creation and modification page."
- **S2** "then returning to the landing page, a deck can be selected and should be as present as a blurred-out arena in the background."
- **S3** "Deck building should prioritize simple decks with clear mana curves and a custom mode where any card can be looked up and picked, or a booster draft mode, where the deck is pre-made from boosters and cannot be customized outside."
- **S4** "the boosters pack configuration seals the deck building, so it cannot be garnished with custom cards selected from the full library unless it's converted into a custom deck."
- **S5** "the match making […] requires also a match making ranking and a measure of the selected deck's strength to preferably match against other players of comparable decks."
- **S6** "the other mode that's needed is custom with either booster drafted decks that have been created in advance or live booster draft as a round among the players before the game."
- **S7** "the deck that is picked is replaced by just an illustration of mysterious and closed boosters. by default from the latest core set, but actually a set of boosters could be also configurable, same as the booster-drafted decks that can be pre-built."
- **S8** "live booster draft games are always custom games, while playing ranked games with booster drafted decks that have been pre-built can be done with open match making."
- **S9** "the panels are technical and boxy and the internal ordering of components looks like absent of design. the white design lacks depth and tactileness. look into Ztyle and adopt portions of it for the plain design."
- **S10** "the deck building and deck picking is the core activity that happens outside of an active game that is configured without booster draft."
- **S11** "complete the hole with standard game practices like in Heartstone or Heroes of the Storm".
- **S12** "make sure to not mess up the system with memory leaks."
- **S13** "Target is Safari and Chrome. later also a mobile or tablet version".
- **S14** "states are saved locally in the browser."

## Rulings of the lead planner (20 Nov 2026)

Where this file and a sibling differed, the lead planner decided. These rulings override the text below; the decisions are recorded in `docs/DECISIONS.md` (`[M8 plan]`).

- **Who builds what** is decided by `docs/PLAN.md`, "Milestone 8: Journey, decks and matchmaking" (eleven packages M7-P1, P2, P3, P5 and M8-P1 … M8-P7 after one contracts agent M8-C). The chunk ids in this file (J…, MM-…, PS-…, DK-…, C…, DS-…) name pieces of work, not packages; its build plan is a checklist for the package that PLAN names, and whatever PLAN lists under "later" is not built in the overnight run.
- **Game code:** the existing room id, three words and a number (`amber-fox-93`, shown as `AMBER FOX 93`). No six-character code in M8; no stored id changes.
- **No blur in CSS anywhere:** no `backdrop-filter` and no `filter: blur()` in the shell or over a table. The arena behind Home is a still that `src/scene/still.ts` delivers already soft; a saved table behind the Gathering card is dimmed by the flat `overlay` scrim, never blurred (card faces are on it).
- **Control heights** are the kit's four: 28, 36, 44, 56 px (`visual.md` V4).
- **Deck strength** is the one formula of `decks.md` section 5, in `src/data/deck/strength.ts`; the lobby's `Band` 1 to 5 is its five bands in order.
- **Leaving** has no confirmation and no first-time dialog; the table shows a back arrow top left.
- **The primary button** always starts the selected mode; it never reads `RESUME` or `CONTINUE`. The `CONTINUE` strip under it reopens the last unfinished game.
- **The library has no summary panel in M8.** The grid spans the sheet; a click selects the deck Home plays with; the tile's action row (`PLAY`, `EDIT`, `⋯`) does the rest (`mock.html` board 2). Tile size and recipe are `visual.md`'s (220 × 268 px).
- **`DeckSummary` gains `fan: CardRef[]`** (up to four more non-land cards after the cover, best first), so Home's deck hero can draw its fan of five without card data.
- **Typeface and control sizes** are the kit's (Fira Code in Plain; 28, 36, 44, 56 px), not the system mono face and the 44 / 36 px pair of section 2.
- **The starter deck** of a first `PLAY` is the computer topic's generator (`src/data/starter.ts`, M8-P6); `quickBoosterDeck` stays this topic's and serves `OPEN SIX BOOSTERS`.
- **Core tonight** (M8-P3): DK-1, DK-2, DK-3, DK-5, DK-6, the curve, land helper and strength chip of DK-7, DK-8 with a simple reveal instead of the full opening animation, the build-stage seal of DK-10. **Later:** the pack-opening animation, deck check lines and the "Simple deck" mark, the strength popover, sample hand, colour balance, import and export sheets and text export (the existing paste dialog serves `IMPORT A LIST`), printings, Commander and Companion slots, the maybe-board, size 100, notes, library sort and search, DK-11.

---

## Decisions

### Mode and journey

**D1. Deck mode is a full-screen mode of its own at `#/decks`, built from DOM only.** It has no table, no session and no WebGL canvas. It holds three screens: the deck library, the deck page, and the booster screens (setup and opening).
*Why:* Hearthstone's collection manager is a place, not a dialog, and a DOM-only screen costs Safari nothing while idle. The current builder needs a table session and a 3D surface even to edit a list.
*Serves:* S1, S10, S11.

**D2. One library, two deck kinds: `custom` and `sealed`.** Both live in the same `decks` store and show as tiles in one grid. A sealed deck carries a lock glyph, the badge `BOOSTER` and the name of its boosters.
*Why:* the owner names exactly these two ways to make a deck, and picking a deck for a game must not depend on where it came from.
*Serves:* S3, S6.

**D3. The seal is enforced in the pure deck model, not only in the UI.** Every edit goes through `data/deck/edit.ts`. On a sealed deck it accepts only cards of the deck's own pool and the five basic lands. Search, paste, file import and the debug hook all go through the same function and get a refusal (`{ ok: false, reason: 'notInPool' }` or `'sealed'`).
*Why:* a lock that only hides a search box is undone by the next feature that adds cards another way.
*Serves:* S4.

**D4. "Convert to custom deck" makes a copy.** The copy is a custom deck named `<name> (custom)`, with the same main deck and the rest of the pool as its sideboard. The sealed original stays in the library, unchanged and still sealed.
*Why:* the conversion cannot be undone in a way anyone could trust, so the safe form is one that destroys nothing. The player keeps the sealed deck for sealed games and gets a free copy to tinker with.
*Serves:* S4.

**D5. A sealed deck comes from one of two places: boosters opened alone in Deck mode, or the pool of a live draft or sealed round at a table.** There is no solo draft against pick bots in M8.
*Why:* opening packs alone is real sealed play and needs no opponent. A solo draft would need bot drafters, which is a feature of its own (open question Q1). Pools from live drafts already reach the library today; they now arrive locked.
*Serves:* S3, S6, S8.

**D6. The build stage after a live draft loses "search and add" and "open a deck from the library".** Today's in-room list view offers both, so a drafted pool can be garnished from all of Scryfall.
*Why:* the owner's seal applies to drafted pools in the room as much as to pre-built ones.
*Serves:* S4.

**D7. The in-room build stage keeps the M2 builder for now.** Its pool is saved to the library as a sealed deck automatically. Replacing it with the new deck page is a follow-up chunk after the owner's review.
*Why:* the M2 gate and builder specs test that screen; rebuilding it overnight risks green gates for no new function.
*Serves:* S6 (scope control).

### Boosters

**D8. For a booster deck, booster setup asks two things: the set and the number of packs.** The default set is the latest core set that has booster data. The default is 6 packs; the range is 3 to 12. "Mix sets" turns the one set stepper into one per pack. The last choice is remembered. It is the same setup sheet a live draft uses (`journey.md` 4.4), with the draft-only fields hidden.
*Why:* 6 packs is what sealed play uses and gives about 84 cards for a 40-card deck. Fewer than 3 packs cannot fill a deck.
*Serves:* S7.

**D9. "Latest core set" is computed, not hard-coded.** It is the newest set of type `core` in the set list. If its packs cannot be generated (no usable booster data, or a generated pack fails validation), the app falls back to the newest of the ten verified sets (Core Set 2021) and says so in a toast.
*Why:* the newest core set (Foundations) uses 14-card Play Boosters that PLAN lists as unverified. The owner asked for the latest core set, so it is the default, with a fallback that always works.
*Serves:* S7.

**D10. Pack contents keep coming from MTGJSON; card objects keep coming from Scryfall.** The brief for this topic says "set data fetched from Scryfall", but Scryfall publishes no booster composition (sheets, weights, slots). The existing pipeline (`data/mtgjson.ts`, `data/packs.ts`) already does this at runtime with nothing bundled.
*Why:* it works, it is tested on ten sets, and there is no Scryfall source for the same data.
*Serves:* S7, hard rule "no bundled card data".

**D11. A pool opened alone is generated from one local random seed, stored with the deck.** Pack *i* draws from `ByteStream("<seed>:<i>")` with the existing generator. The pool is saved before the opening animation starts.
*Why:* one seed makes the pool reproducible in tests and checkable later. Saving first means a reload in the middle of the animation loses nothing.
*Serves:* S14.

**D12. The opening animation is DOM and CSS, uses Spellplane's own pack art, shows the rare last and can always be skipped.** A pack takes at most 3 s. "Open all" skips to the pool. Reduced motion replaces it with a fade.
*Why:* opening packs is the reward moment of sealed play, and Hearthstone's rare-last reveal is the model. Own art because no Wizards logo, set symbol or pack art may be bundled.
*Serves:* S7, S9, S11.

### Simple decks

**D13. A deck's format is its size: 40, 60 or 100 cards.** There are no checks for Standard, Modern or any other Wizards format in M8.
*Why:* the owner asks for simple decks with clear curves, not tournament legality. A legality check needs a legality table per card and a format picker, for a table that enforces no rules. The search can still filter by format (`f:standard`), because Scryfall does that server-side.
*Serves:* S3.

**D14. The deck page always shows four things beside the list: the mana curve, the land count against a suggestion, the colour balance, and a short deck check.** Each problem line has one button that fixes it. A deck that passes every check gets a "Simple deck" mark.
*Why:* this is what "prioritize simple decks with clear mana curves" means on screen: the curve is never more than a glance away, and the commonest mistakes (too few lands, too many colours, no early plays) are named in words.
*Serves:* S3.

**D15. A new custom deck starts with a recipe.** The curve chart shows target bars for a plain deck of the chosen size (for 60 cards: 24 lands and 36 spells, peaking at two mana). Quick-search chips ("Cheap creatures", "Removal", "Card draw", "Finishers", "Lands") search within the deck's colours, most-played cards first.
*Why:* an empty search box over 30,000 cards is the opposite of simple. A recipe and five chips give a newcomer a deck in minutes without hiding the full search.
*Serves:* S3.

**D16. The land suggestion uses Frank Karsten's published regression, scaled to the deck size.** Lands for 60 cards = 19.59 + 1.90 × average mana value − 0.28 × cheap ramp cards. "Add suggested lands" adds basics split by the deck's colour symbols.
*Why:* it is one line, widely used, and gives 17 for a typical 40-card deck and 24 for a typical 60-card deck.
*Serves:* S3.

**D17. Warnings never block.** Any deck can be saved and taken to a private table. Only the ranked queue has entry conditions (D21).
*Why:* hard rule "no rules enforcement"; PLAN A7 says the same.
*Serves:* S3.

**D18. Sealed decks get "Suggest a deck", and a fresh pool arrives with the suggestion already applied.** It builds 23 spells and 17 lands from the pool's best two colours. The result is a normal edit, undone in one step, and the pill stays on the page for later.
*Why:* a first-time visitor has no deck and the app may bundle none. "Open boosters, suggest a deck, play" is the 30-second path to a first game.
*Serves:* S3, S11.

### Strength

**D19. Deck strength is one number from 1 to 100 plus one of five bands.** It is computed in the browser from the main deck's card data: card quality 40 %, curve 20 %, interaction 20 %, consistency 20 %, and the sum is scaled down by a mana check. The bands are Rough (1–20), Casual (21–40), Solid (41–60), Tuned (61–80) and Fierce (81–100). The deck page shows the five parts as bars with one sentence each.
*Why:* every part is something a player can read off the deck page and change. Measured on the M19 fixtures: a random 60-card pile scores about 18, an auto-built sealed deck 28–61 (median 44), the two fixture decks 40 and 54, a two-colour deck of playsets of rares and removal 93.
*Serves:* S5.

**D20. Card quality is the printing's rarity, nudged by Scryfall's `edhrec_rank` when the card has one.** The nudge is bounded to ±0.2 on a 0–1 scale.
*Why:* rarity alone rates a common staple as weak and depends on the printing chosen. The popularity rank belongs to the card, not the printing, and corrects the worst cases. Bounding it keeps scores close between a browser that has the rank cached and one that does not.
*Serves:* S5.

**D21. Only six facts about a deck may leave the browser before a game: kind, size, card count, strength score, band and formula version.** Never a card, a name, a colour, the cover or the deck's name. The ranked queue accepts a deck only when it is complete for its size and holds at most four copies of any card that is not a basic land (one copy at 100 cards).
*Why:* a decklist is hidden information. A coarse number is the least that makes "comparable decks" possible. The copy limit keeps the consistency part of the score honest; it is a condition of the queue, not a rule of the table.
*Serves:* S5, S8, hard rule on hidden information.

**D22. Strength and the sealed status are self-reported and cannot be verified by an opponent.** The limits are listed under "Limits of the strength measure" and shown in the strength popover in one sentence.
*Why:* there is no server, and a browser's storage can be edited. Saying so is better than a lock that only looks strong.
*Serves:* S5 (honesty about "preferably").

### Data, tools and look

**D23. `DeckRecord` grows by optional fields; this topic needs no database upgrade.** Old records are migrated on first read (`migrateDeckRecord`): a record with a draft `origin` becomes sealed, every other record becomes custom. Library files and backup files of version 1 stay readable.
*Why:* no index or store changes are needed for decks. `persistence.md` moves the database to version 2 for its own store; a per-record migration works under either version.
*Serves:* S14.

**D24. From PLAN A7 everything is kept except three items.** Kept: search with filter chips, card grid with whole card images, deck list grouped by type or mana value, sideboard and maybe-board, Commander and Companion slots, printing per card, curve, colours against land sources, type breakdown, card count against the target, sample hand, land helper, import and export, deck boxes with a cover card, duplicate, notes, undo. Dropped: format legality notes (D13), tags (a kind filter and a name search are enough for a personal library), drag and drop on touch (tap and steppers do the same without fighting the scroll).
*Why:* A7 was specified before the owner asked for simple decks and a journey; these three add weight without serving either.
*Serves:* S1, S3.

**D25. Import and export stay, and gain a text export.** Paste a list (plain, MTGA, MTGO) to make a custom deck; export a deck as text or as a `.spellplane.json` file; export the whole library. Pasting into a sealed deck is refused. A library file keeps a sealed deck sealed if its cards still fit its pool; otherwise it arrives as a custom deck with a note.
*Why:* the brief says import and export stay. Today there is no text export at all, only the JSON file.
*Serves:* S1, S4.

**D26. Edits save themselves; the last 50 are undoable; a deleted deck comes back from an undo toast.**
*Why:* Ztyle rule 9, "Forgiving by default. Undo everything. Autosave everything."
*Serves:* S9, S14.

**D27. Deck mode takes Ztyle's surface rules and adds depth through objects, not through panels.** Chrome is grayscale, labels are small uppercase with wide tracking, every action is a pill, containers are rounded rectangles on three elevations, and the page carries the halftone dot grid. Colour appears only for meaning (success, warning, danger) and for mana identity. Depth comes from things that look like things: deck boxes with thickness, a tray the list sits in, cards that lift and fly.
*Why:* the owner's complaint is boxy panels, mixed button sizes and no depth. Ztyle fixes the first two by rule; a card game fixes the third by showing its objects.
*Serves:* S9.

**D28. Card faces are always shown whole, sharp and uniformly scaled.** Tiles, heroes and the opening animation never crop, blur, tint or stretch a face. Mana symbols are Spellplane's own letter discs, not Wizards' symbol art.
*Why:* hard rules. This also binds the landing page: the selected deck can sit over a blurred arena, but its cover card may not be blurred itself.
*Serves:* S2, hard rules.

**D29. The selected deck is one setting, `Settings.home.deckId` (defined in `journey.md`).** "Play with this deck" in the library or on the deck page sets it and returns Home. Home's deck hero and booster hero belong to the journey topic and are composed from this topic's parts (`DeckBox`, `ManaPips`, `Sparkline`, `StrengthChip`, `KindBadge`, `BoosterPackArt`) and read the record's `summary`.
*Why:* one source of truth for "my deck" across Home, matchmaking and game setup, and one set of deck visuals everywhere.
*Serves:* S2, S7.

**D30. Where this document and its siblings overlap, the shell follows `journey.md` and the deck's substance follows this document; there is one strength measure, this one.**

| Subject | Wins | What the other document contributes |
| --- | --- | --- |
| Library page: layout, top navigation, click selects, summary panel, `PLAY WITH THIS DECK` | `journey.md` 4.2 | This document: what a tile and the summary show, tile states, sort, name search, delete with undo, storage states (section 3, D1). |
| New-deck chooser as a page with three cards; routes under `#/decks/new` | `journey.md` 4.3 | This document: what each path creates (sections 3 and 7). |
| Booster setup as a sheet shared with Draft Night | `journey.md` 4.4 | This document: the fields for a booster deck, defaults, status line, what OPEN does (section 3, D3). |
| Deck page (inside the builder), opening animation, analysis, seal, data model, import and export | this document | `journey.md` mounts it at `#/decks/<id>`. |
| Deck strength formula | this document (section 5) | `matchmaking.md` 2.7 defines a second, simpler formula. Build one: this one, behind the name `matchmaking.md` expects. Its bands 1 to 5 are this document's five bands in order. |
| Files | `src/ui/decks/` for everything | `journey.md` lists `DecksPage`, `DeckTile`, `DeckSummary`, `NewDeck`, `DeckPickerSheet` there and says the builder is `src/ui/builder/*`; the deck page is new code in `src/ui/decks/` (D1), and `DeckTile` is this topic's part. |

*Why:* the journey topic owns how screens connect; this topic owns what a deck is. The brief for this topic assigns the strength measure here, and this formula has parts for mana and interaction and was measured on the fixtures.
*Serves:* S1, S5, S11.

---

## Detailed design

### 1. Place in the journey

```
Home ──"DECKS"─────────────────► D1 Library (#/decks)
   ▲                               │  select a tile, EDIT ► D5 Deck page (#/decks/<id>)
   │                               │  + NEW DECK ► D2 chooser (#/decks/new)
   │                               │        ├ From boosters ► D3 setup sheet ► D4 Opening ► D5 (sealed, suggestion applied)
   │                               │        ├ Custom deck ► D5 (empty, recipe)
   │                               │        └ Import a list ► Import sheet ► D5
   └──"PLAY WITH THIS DECK" ───────┘
```

Routes (in `ui/routes.ts`, which is not a contract file; the same routes as `journey.md` section 3, plus the opening):

| Hash | Screen |
| --- | --- |
| `#/decks` | D1 Library |
| `#/decks/new` | D2 New-deck chooser; `#/decks/new/boosters`, `#/decks/new/custom` and `#/decks/new/import` open one path directly |
| `#/decks/<id>` | D5 Deck page |
| `#/decks/<id>/open` | D4 Opening |

The browser's Back button walks the same path backwards. `#/build` and `#/build/<id>` (M6-P5's routes, on branch `m6`) redirect to `#/decks` and `#/decks/<id>`. A deck page for an id that does not exist shows "This deck is gone." with one pill, "BACK TO DECKS".

Deck mode never opens a network connection to another player. It talks to Scryfall and MTGJSON only, through the existing limiter and caches.

### 2. Look and feel in Deck mode

Token names below are Ztyle's (`/Users/holzschneider/Workspace/ztyle/tokens/ztyle.css`). The M8 design-system package decides the final names and how the three looks map onto them; Deck mode uses tokens only and styles nothing ad hoc.

| Element | Recipe |
| --- | --- |
| Page | `background` with the halftone dot grid (`foreground/3`, 8 px). |
| Top bar | 56 px, fixed, `background/95`, hairline below. Left: back icon button and an uppercase overline. Right: at most one primary pill. |
| Primary action | One filled pill per screen (`btn-primary`: 44 px high, 32 px side padding, uppercase, tracking 0.05 em). D1: PLAY WITH THIS DECK (NEW DECK while no deck is selected). D2 and D3: OPEN BOOSTERS / OPEN. D4: NEXT PACK, then BUILD DECK. D5: DONE. |
| Secondary actions | Ghost pills (36 px high) and icon buttons (36 px, 44 px on touch). No other button sizes exist in Deck mode. |
| Containers | Flat (`card` + hairline) for rows and tiles at rest; Floating (`shadow-lg`) for the stats rail, the hover preview and anything dragged; Overlay (`shadow-xl`) for sheets and dialogs. Radius 8 px for rows and tiles, 16 px for the rail and sheets. |
| Type | The kit's face (Fira Code in Plain, bundled; `visual.md` V10). Overline labels 10–11 px uppercase, tracking 0.1 em, `muted-foreground`. Values 14 px. Deck names 16 px; the deck page's name 20 px light. |
| Colour | Grayscale. `success` for "Simple deck" and a met target, `destructive` for delete and for a broken state, the system's warning tone for deck-check warnings. Always with a word or glyph. |
| Mana identity | Six fixed inks, the same in light and dark (Ztyle's "theme-stable inks"): W `#F3EFD9` with a `foreground/40` rim, U `#2F6DB5`, B `#3A3438` with a `foreground/40` rim in dark, R `#C8402F`, G `#2F8F55`, C `#9A9A9A`. A pip is a 14 px disc with its letter (W U B R G C) in 9 px mono, so colour is never the only signal. |
| Motion | Ztyle durations: 150 ms for presses and count bumps, 200 ms for hover lift and row insert, 300 ms for sheets, 500 ms for screen changes. Ease-out. Only `transform` and `opacity` animate. |
| Sound | Existing cues only, and only when sound is on: `snap` when a card joins the deck, `drop` when it leaves, `slide` when a pack tears, `draw` per card flip, `shuffle` for a sample hand. |

Tactile details, each cheap:

- **Deck box.** A tile is a box seen from the front: a face, a 6 px side and a 6 px bottom made of two stacked hairline layers, so it has thickness. The cover card stands in the box, tilted −3°. Hover: the box lifts 2 px (`shadow-md` to `shadow-lg`) and the card straightens to 0° and rises 6 px, 200 ms. Press: scale 0.98, `shadow-sm`.
- **Card to deck.** Clicking a card in the grid sends a ghost of its image to the deck row in 220 ms; the row's count scales 1.15 to 1 in 150 ms.
- **Tray.** The deck list sits in a tray: `muted` fill, an inner top shadow (`inset 0 1px 2px foreground/8`), rows as flat cards on it.
- **Steppers.** `−` and `+` are 28 px round buttons (44 px hit area on touch) that depress 1 px.

No blur is used anywhere in Deck mode. Scrims use the design system's overlay token.

### 3. Screens

#### D1 Library (`#/decks`)

Layout and flow are `journey.md` 4.2: the app's top navigation, the grid on the left, the selected deck's summary panel on the right (under the grid on a phone), the filter pills `ALL · CUSTOM · BOOSTER`, and `+ NEW DECK`. A click on a tile selects it; a double-click, Enter or the panel's EDIT opens the deck page. This section defines what the tile and the panel hold and how they behave.

**Deck tile** (`DeckTile.svelte`), 220 × 268 px on desktop with a 96 px wide whole cover card in its well (ruling: the sizes and recipe of `visual.md` 2.8 "Deck tile" replace the 168 × 284 px tile and its 150 × 210 px cover; the content and order below stay), top to bottom:

1. Cover card, whole, 150 × 210 px (phone 104 × 146; Scryfall `small` tier, `normal` on high-density displays), standing in the deck box. A deck without cards shows Spellplane's neutral card back.
2. Name, 14 px, one line, ellipsis.
3. Card count, kind and colours: `60`, then `CUSTOM` or a lock glyph with `BOOSTER`, then up to five mana pips in WUBRG order; a colourless deck shows the C pip.
4. Curve sparkline (8 bars, each 4 px wide and up to 16 px tall, `foreground/50`) and the strength number with its band, for example `54 SOLID`. An incomplete deck shows its count as `12/60` in the warning tone and `—` for strength.

Tile states:

| State | Look |
| --- | --- |
| Rest | Flat box, `shadow-md`. |
| Hover or focus | Lift, card straightens, focus ring on keyboard focus. |
| Selected (shown in the summary panel) | 2 px `foreground` ring. |
| The deck Home plays with | A check after the name and the overline `PLAYING`. |
| Incomplete | Dashed box outline. |
| Opening not finished | Pack art instead of the cover card, badge `3 OF 6 OPENED`; opening the tile resumes D4. |
| Card data missing | Neutral back as cover, count shown, strength `—`, a small offline glyph. |

**Summary panel** — *not built in M8 (ruling above): the tile's action row and `⋯` menu carry `PLAY`, `EDIT`, Duplicate, Rename, Choose cover, Export, Convert and Delete.* The original specification (`DeckSummaryPanel.svelte`, 360 px wide), from the record and its `summary`:

- Name; `CUSTOM DECK · 60` or `BOOSTER DECK 🔒 · 6 × M21` (a pool from a live draft adds `· DRAFTED`); the mana pips.
- The curve chart at 240 × 64 px and the strength chip (number, band, and the five band pips `journey.md` shows).
- One line of counts: `24 lands · 28 creatures · 8 other`, and `✓ SIMPLE DECK` when it applies.
- `Last played 12 min ago`, or `Never played`.
- `PLAY WITH THIS DECK` (primary; sets `Settings.home.deckId` and goes Home), then the ghost pills EDIT and DUPLICATE and a `⋯` menu: Rename, Choose cover, Export, Convert to custom deck (booster decks only), Delete.

Delete removes the tile at once and shows the toast "Deleted "Elves". UNDO" for 6 s; the record is deleted from IndexedDB when the toast ends or the screen is left.

Sort and search. A sort stepper beside the filter pills: RECENT (default, by `updatedAt`), NAME, STRENGTH. A name search field appears once the library holds more than 12 decks. Filter, sort and search are per session.

Empty library: `journey.md`'s empty state (the `+ NEW DECK` tile, the line "No decks yet. Open boosters for a quick one, or build from all cards." and the three paths as pills). Below it, in 10 px muted text: "Card data and images load from Scryfall when you need them."

The page's `⋯` menu holds "Import decks from a file" and "Export all decks" (Import and export, below).

#### D2 New-deck chooser (`#/decks/new`)

Layout and copy are `journey.md` 4.3: three cards, FROM BOOSTERS (the filled action, with `6 × <SET> ✎` opening the setup sheet), CUSTOM DECK and IMPORT A LIST. What each creates:

| Path | Creates |
| --- | --- |
| FROM BOOSTERS | A sealed record with the whole pool (D3, D4), named `<SET> boosters · <day> <month>`; the suggestion is applied when the opening ends. |
| CUSTOM DECK | An empty custom record named "Untitled deck", size 60, and opens its deck page with the search focused and the recipe bar showing (D5). |
| IMPORT A LIST | The import sheet; on CREATE DECK a custom record from the list. |

A record is written only when there is something to keep: the booster pool at once, a custom deck at its first card or rename, an import on CREATE DECK. Leaving an untouched new custom deck leaves nothing behind.

#### D3 Booster setup (the sheet of `journey.md` 4.4, for a booster deck)

The sheet is shared with Draft Night. For a booster deck the way of opening is fixed to sealed, and the pick and timer fields are hidden. The sketch shows the fields; the sheet's frame is the journey's.

```
                     ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
                     │ M21││ M21││ M21││ M21││ M21││ M21│     pack art, 96 × 140, fanned 2°
                     └────┘└────┘└────┘└────┘└────┘└────┘
                        ‹   CORE SET 2021   ›
                              set · latest core set
                        ‹      6 PACKS      ›
                         about 84 cards for a 40-card deck
                     ( mix sets )
                              [  OPEN  ]
                     ✓ SET READY OFFLINE
```

- **Set stepper.** Steps through the set list: the latest core set first, then the other core sets newest first, then every other set with booster data newest first. A tap on the value opens a searchable list (code, name, year). The sub-label says why a set is first ("latest core set") or its year.
- **Packs stepper.** 3 to 12. The sub-label is `about <packs × pack size> cards for a 40-card deck`.
- **Mix sets.** A small pill. On: the row of packs becomes tappable and each pack gets its own set (the stepper edits the selected pack). Off again: all packs take the first pack's set.
- **OPEN.** The primary pill. While set data loads it shows a spinner and a percentage inside itself; a tap cancels (Ztyle's Start pill). When everything needed is cached it opens at once.
- **Status line** (10 px, uppercase, muted), one of: `✓ SET READY OFFLINE`, `SET DATA LOADS ON OPEN · 2 MB`, `THIS SET NEEDS A CONNECTION` (offline and not cached; OPEN is disabled), `NO BOOSTER DATA FOR THIS SET` (OPEN is disabled).

What OPEN does, in order:

1. Load `SetData` for each distinct set (`sets.get`).
2. Draw a 32-byte seed from `crypto.getRandomValues`, generate the packs (section 6) and validate them.
3. Save a sealed `DeckRecord` with the whole pool, an empty main deck and `seal.revealed = 0`, named `<SET> boosters · <day> <month>` (`MIXED boosters · …` for several sets).
4. Start loading the pool's card objects (`cardData.getMany`, two requests for 90 cards) without waiting.
5. Go to `#/decks/<id>/open`.

Failures: see section 8.

The sheet's value is `journey.md`'s `BoosterSetup` (`how`, `packs`, `picks`, `sets`, `pickTimer`); a booster deck reads `packs` and `sets` (one set per pack; a shorter list repeats its last entry) and ignores the rest. One sheet for both uses keeps S7 literally true: "same as the booster-drafted decks that can be pre-built".

#### D4 Opening (`#/decks/<id>/open`)

The stage is the page; the unopened packs stand in a row at the top (72 × 104 px each), the pack being opened is in the centre.

**Pack art** (`BoosterPackArt.svelte`). A foil wrapper drawn in CSS: a 5:7.3 rectangle with a vertical sheen (three neutral gradient bands), crimped top and bottom edges (a 2 px repeating gradient), and a centred label: the set code in 20 px mono with 0.1 em tracking, the set name in 9 px uppercase, and `15 CARDS` (the pack's real size) as an overline. No logo, no set symbol, no official art. With `mystery` set, the label is `?` and the name line is empty; three such packs fanned at −8°, 0° and 8° are the "mysterious and closed boosters" illustration for a live draft (S7).

**One pack, step by step** (full motion):

| Step | What happens | Time |
| --- | --- | --- |
| 1 | The next pack moves to the centre and scales to 220 × 320 px. | 300 ms |
| 2 | The top crimp tears off: the strip rotates 12° and slides away. Sound `slide`. | 200 ms |
| 3 | The cards rise out as one stack, face down (Spellplane's back); the wrapper drops and fades. | 250 ms |
| 4 | The cards deal into a grid of 5 columns, face down. | 15 × 30 ms |
| 5 | They flip face up one by one, commons first, then uncommons, the land, and the rare or mythic last. Sound `draw` per flip. | 90 ms each, 60 ms apart |
| 6 | Before the last flip there is a pause; after it, one ring pulse around the card (neutral `foreground`, never over the face) and a chip below it: `RARE`, `MYTHIC`, and `FOIL` where it applies. | 300 ms + 800 ms |

After step 6 the primary pill reads NEXT PACK (BUILD DECK after the last pack) and the footer shows running totals: `PACK 2 OF 6 · 30 CARDS · 2 RARES`.

Controls, always visible: SKIP (ghost; shows the current pack's cards at once) and OPEN ALL (ghost; reveals every remaining pack without animation and goes to the deck page). Keys: Space or Enter for the primary pill, Escape for SKIP. A tap or click on a revealed card opens the inspect view.

Rules:

- `seal.revealed` is written after each pack, so a reload resumes with the unopened packs. The library tile offers the same resume.
- Card faces that have not loaded yet flip to the placeholder face (name, cost, type) and swap to the image when it arrives.
- Only the current pack's cards are in the DOM; the previous pack's elements are removed when the next opens (S12).
- Reduced motion (`Settings.motion`, resolved as elsewhere): steps 1 to 6 become a 200 ms fade-in of the face-up grid; the chip still shows.

BUILD DECK applies the suggestion (section 4, "Suggest a deck") and goes to the deck page, with the toast "Suggested: green and white, 23 spells, 17 lands. Change anything. UNDO" and a one-time coach mark on the pool: "Click a card to swap it in. The deck stays within these boosters."

#### D5 Deck page (`#/decks/<id>`), custom deck

Desktop, 1100 px and wider:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← DECKS   Elves____________   CUSTOM · ‹60›   ◔ 54 SOLID     ↶ ↷  ⋯    [ DONE ]  │ 56
├────────────────────────────────────────────────────┬─────────────────────────────┤
│ [ Search any card: name, type or text        ] S M L│ ( MAIN 36/60 )( SIDE 0 )(MAYBE 3)
│ (W)(U)(B)(R)(G)(C) │ 0 1 2 3 4 5 6 7+ │ TYPE▾ RARITY▾│ group ‹ TYPE ›               │
│ SET▾ FORMAT▾ │ sort ‹ POPULAR ›                     │ ┌ tray ───────────────────┐ │
│ quick: (CHEAP CREATURES)(REMOVAL)(CARD DRAW)…       │ │ CREATURES · 14          │ │
│ ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐                 │ │ (−) 4 (+) ①Ⓖ Llanowar…  │ │
│ │     ││  ×2 ││     ││     ││     │                 │ │ (−) 2 (+) ③ⒼⒼ Colossal… │ │
│ │card ││card ││card ││card ││card │                 │ │ SPELLS · 8              │ │
│ └─────┘└─────┘└─────┘└─────┘└─────┘                 │ │ LANDS · 14              │ │
│  …                                                  │ └─────────────────────────┘ │
│                                                     ├─────────────────────────────┤
│                                                     │ CURVE · avg 2.9   ▂▅█▆▃▂▁   │
│                                                     │ LANDS 22 / 24  ( +2 SUGGESTED )
│                                                     │ COLOURS  G need ████ have ███│
│                                                     │ ✓ SIMPLE DECK   or  2 NOTES ▾│
└────────────────────────────────────────────────────┴─────────────────────────────┘
```

The left pane takes the remaining width (at least 560 px); the right column is 380 px. At 1440 px and wider the stats rail becomes a third column of 300 px and the deck list gets the full height.

**Top bar.**

- Back icon and `DECKS`.
- The deck name: text that becomes an underlined input on click (Ztyle input: bottom line only), up to 60 characters.
- Kind and size: `CUSTOM ·` and a size stepper `‹ 60 ›` (40, 60, 100).
- Strength chip: a 20 px ring gauge, the number and the band. A click opens the strength popover.
- Undo and redo icon buttons (also Ctrl or Cmd+Z and Shift+Ctrl or Cmd+Z), disabled at the ends.
- `⋯` menu: Play with this deck, Sample hand, Import into this deck, Export, Duplicate, Notes, Delete.
- DONE, the primary pill: back to the library. Nothing is lost without it; edits save themselves.

**Search pane.**

- *Search field.* Free text in Scryfall syntax. Searches run 350 ms after the last key, from 2 characters. The whole query is sent as today (`searchCards`: paper cards, one printing per card, the first 175 results in one request).
- *Filter chips.* They compile to query terms and combine with the text:

| Chip | Query term |
| --- | --- |
| Colour pips W U B R G C (multi-select) | `id<=wu` (cards castable in those colours); C alone: `id:c` |
| Mana value `0 … 7+` (multi-select) | `(mv=2 or mv=3)`, `mv>=7` |
| TYPE (creature, instant, sorcery, artifact, enchantment, planeswalker, land) | `t:creature` |
| RARITY | `r:rare` |
| SET (the set list) | `e:m21` |
| FORMAT (Standard, Pioneer, Modern, Legacy, Pauper, Commander) | `f:modern` |
| Sort stepper: POPULAR, MANA VALUE, NAME | `order=edhrec`, `cmc`, `name` |

- *Quick chips* appear while the text field is empty. Each is a ready query within the deck's colours (`id<=` the deck's colours, or no colour term if it has none):

| Chip | Query |
| --- | --- |
| CHEAP CREATURES | `t:creature mv<=3` |
| REMOVAL | `(o:"destroy target" or o:"exile target" or o:"damage to any target" or o:"damage to target creature")` |
| CARD DRAW | `(o:"draw two cards" or o:"draw three cards" or o:"draw a card") (t:instant or t:sorcery or t:enchantment)` |
| FINISHERS | `t:creature mv>=5 r>=rare` |
| LANDS | `t:land -t:basic` |

- *Result grid.* Whole card images in three sizes: S 122 px, M 146 px (default), L 196 px wide, remembered in `Settings.deckCardSize`. Images load lazily (`loading="lazy"`, `decoding="async"`); rows use `content-visibility: auto`. A card that is in the deck carries a count pill (`×2`) on its top right corner.
- *Adding.* A click or Enter adds one copy to the open board (Main, Side or Maybe). Shift+click adds up to four. A drag onto the deck list adds one to the board it is dropped on (mouse only). Right-click, long-press or Space opens the inspect view: the large face, the printing chooser, and the buttons ADD 1, ADD 4 and USE AS COVER.
- *States.* Before any search: the quick chips and the line "Search any card, or start from a chip." Loading: 10 skeleton tiles. No results: "No cards match. Check the spelling or remove a filter." 175 results: a footer "Showing the first 175. Narrow the search for more." Offline: the field is disabled, with the status line `CARD SEARCH NEEDS A CONNECTION`; the deck list and stats keep working from cached data. Scryfall 429: "Scryfall asked us to wait. Trying again in 30 s." and the search retries itself once.

**Deck list.**

- Board pills: `MAIN 36/60`, `SIDE 0`, `MAYBE 3`. The open board is where clicks in the grid go.
- Group stepper: TYPE (Creatures, Planeswalkers, Spells, Artifacts and Enchantments, Lands) or MANA VALUE (0 to 7+, lands last).
- A row is 36 px high (44 px on touch): the stepper `(−) n (+)`, the mana cost as pips, the name. A 3 px left edge carries the card's colour ink. Hovering a row shows the whole card at 244 px wide to the left of the column. A click on the name opens the inspect view. On touch a swipe to the left removes the row.
- More than four copies of a card that is not a basic land (more than one at 100 cards): the count shows in the warning tone, with the tooltip "More than four copies. Fine at a private table; the ranked queue allows four."
- A card whose data cannot be found shows as "Unknown card" with its id's first 8 characters and stays removable.
- At size 100 a COMMANDER slot row sits above the groups, and a COMPANION row is offered in the `⋯` menu. A card moves into a slot from its row menu. (Model and printing chooser come from M6-P5 on branch `m6`.)
- Empty deck: the tray shows the recipe in words, "A simple 60-card deck: 24 lands, 36 spells, most of them costing 1 to 3.", and a **recipe bar** above the search pane offers two optional choices: size (`40 · 60 · 100`) and colours (the five mana pips to toggle, none chosen at first, with the hint "one or two is easiest"). The colours only set the quick chips' colour term; the bar goes away at the tenth card.

**Stats rail** (floating, 16 px radius; collapsible to a 44 px bar that keeps the sparkline and the count).

1. *Curve.* A chart 320 × 96 px with 8 bars (0 to 7+), each 28 px wide. A bar stacks creatures (solid `foreground/80`) under other spells (`foreground/35`); the count is printed above. A dashed outline per bar shows the recipe target. The header reads `CURVE · avg 2.9`. A click on a bar filters the deck list to that mana value; a second click clears it. Below the chart, one line with the type breakdown: `14 creatures · 6 instants · 2 sorceries · 14 lands`.
2. *Lands.* `LANDS 22 / 24` and, when they differ by more than one, a pill `+2 SUGGESTED` or `−3 SUGGESTED`. The plus pill adds basic lands split by colour (section 4); the minus pill only highlights the land rows, because choosing which lands to cut is the player's call.
3. *Colours.* One row per colour in the deck: the pip, a "need" bar (share of coloured symbols in costs) and a "have" bar (share of land sources). A colour with need and no source shows the bar outline in the warning tone and the word `NO SOURCE`.
4. *Deck check.* Either `✓ SIMPLE DECK` in the success tone, or `n NOTES ▾`, which expands the list from section 4. Each note has its fix pill where one exists.

**Strength popover** (from the chip). The number and band large; five rows, each with a label, a bar 0 to 100 and one sentence from section 5; then the limit line: "A rough guess from card data. It knows nothing about combos or how you play." and a link "How it is computed" that expands the formula.

**Sample hand** (from the `⋯` menu). An overlay with seven whole cards from the shuffled main deck, the line `7 CARDS · 3 LANDS`, and three pills: NEW HAND, MULLIGAN (one card fewer, down to 4) and DRAW (adds the next card). Randomness is `Math.random` in the UI; nothing is stored.

**Notes** (from the `⋯` menu). A plain text field, up to 2,000 characters, saved with the deck.

#### D5 Deck page, sealed deck

The same page with these differences:

- The top bar shows a lock glyph and `BOOSTER · 6 × M21` (a pool from a live draft: `BOOSTER · DRAFTED · 3 × M21`), and the size is fixed at `40`.
- A strip under the top bar, on a `muted` fill: "Booster deck. Only cards from its boosters, plus basic lands." and a ghost pill `CONVERT TO CUSTOM DECK`.
- The left pane is the **pool**, not the search: the header `POOL · 84 CARDS · 61 NOT IN DECK`, the same colour, mana value, type and rarity chips (they filter locally; SET and FORMAT are absent), a local text filter over name, type and rules text, and sort by colour, mana value or rarity. The pane shows the cards that are not in the deck. A pill `SHOW ALL` adds the deck's cards, each with an `IN DECK` chip under its image; the face itself is never dimmed.
- A click on a pool card moves it into the deck; a click on a deck row's `−` moves it back.
- Boards: `MAIN 40/40` and `SIDE 61` (the rest of the pool; it is derived, not edited). There is no Maybe board and there are no Commander or Companion slots.
- A **basics dispenser** sits under the pool header: five pills `PLAINS +`, `ISLAND +`, `SWAMP +`, `MOUNTAIN +`, `FOREST +`, each with its count in the deck. The printing is the first basic printing of the pool's first set (`basicPrintings`, existing), changeable in the inspect view.
- The stats rail adds one pill at the top: `SUGGEST A DECK` (section 4).
- The `⋯` menu has no "Import into this deck".

**Convert dialog.** Title "Make a custom copy?". Body: "The copy can take any card. It is no longer a booster deck and plays as a custom deck. "M21 boosters · 20 Nov" stays as it is." Buttons: MAKE A COPY (primary) and a lowercase "not now". The copy opens at once.

#### Import and export

**Import sheet** (from D2's IMPORT A LIST, the library's `⋯` menu, or a custom deck's `⋯` menu). Two tabs:

- PASTE: a text area, the existing parser and resolver (`parseDecklist`, `resolveDeck`), the existing error list with near matches, and the count line `58 of 60 cards found`. CREATE DECK makes a custom deck (or adds to the open one). Unresolved lines never block.
- FILE: drop or choose a `.spellplane.json` library file or a backup file. The sheet lists what the file holds ("3 decks: 2 custom, 1 sealed") and any entry it skips, with the reason.

**Export sheet** (from the summary panel's `⋯` menu, the deck page's `⋯` menu, or the library's `⋯` menu as "Export all decks"). For one deck: three pills, COPY AS TEXT, DOWNLOAD TEXT (`<name>.txt`) and DOWNLOAD FILE (`<name>.spellplane.json`), and a format stepper for the text (PLAIN `4 Lightning Bolt`, MTGA `4 Lightning Bolt (M21) 199`). Sections `Commander`, `Companion`, `Deck`, `Sideboard`; the Maybe board is exported only in the file. For the library: one pill, DOWNLOAD LIBRARY.

#### Tablet and phone

Under 1100 px the page is one column with a segmented control `( CARDS )( DECK )( STATS )` below the top bar, and a fixed bottom bar, 56 px, that always shows `36/60`, the sparkline and the strength number; a tap on it opens STATS. Under 600 px the deck page's top bar keeps only back, name and DONE, and everything else moves into `⋯`; the library follows `journey.md` 4.2's phone layout. There is no drag and drop on touch. The opening grid uses 3 columns under 600 px. Phone polish is the last chunk of the build plan (S13: "later").

#### Keyboard and accessibility

- Tab order: top bar, search field, chips, grid, board pills, list, rail. `/` focuses the search field. In the grid, arrow keys move focus, Enter adds, Shift+Enter adds to the sideboard, Space inspects. In the list, `+` and `−` change the count, Delete removes the row.
- Every card image has an accessible name: name, mana cost, type line, and its count in the deck. Charts have a text alternative ("Mana curve: 4 cards at 1, 10 at 2, …").
- Edits announce themselves in a polite live region: "Llanowar Elves added, 3 in deck, 37 of 60 cards."
- Contrast, focus rings and "nothing by hue alone" follow the M7 principles. axe runs on D1, D3, D4 and D5 in the specs.

### 4. Deck analysis

All functions are pure and live in `src/data/deck/` (module `data` may import `core`, `store` and `util`). They take a deck and a lookup `(ref) => CardData | null`. A card whose data is missing counts toward the card total only.

**Card facts.** Lands are cards whose front type line contains "Land" (existing `isLandCard`). Mana value is `cmc`. Coloured symbols are counted as today (`costSymbols`: a hybrid symbol counts once for each of its colours). A land's sources are the colours in its `color_identity` (for lands, Scryfall derives it from the mana the land can make); a land of two colours counts half a source for each.

**Curve.** Non-land main-deck cards by mana value in buckets 0 to 7+, split into creatures and others; `avgMv` is their mean mana value.

**Recipe targets** (the dashed bars), non-land cards per bucket 0 to 7+:

| Size | Lands | Targets |
| --- | --- | --- |
| 40 | 17 | 0, 3, 6, 6, 4, 3, 1, 0 |
| 60 | 24 | 0, 6, 10, 8, 6, 4, 2, 0 |
| 100 | 37 | 0, 8, 14, 14, 11, 8, 5, 3 |

**Suggested lands.**

```
ramp      = non-land cards with mana value ≤ 3 whose text has "{T}: Add" or
            "search your library for a/up to … land"
ramp60    = ramp × 60 / cards
raw       = (19.59 + 1.90 × avgMv − 0.28 × ramp60) × size / 60
suggested = clamp(round(raw), round(0.30 × size), round(0.46 × size))
```

With fewer than 8 non-land cards, `suggested` is the recipe's land count. `size` is the deck's target size, so the suggestion does not jump while the deck fills. (The strength formula in section 5 calls the same function with the actual card count as `size` and always uses the formula, never the recipe shortcut.)

**Suggested basics** (`+n SUGGESTED`). `need = suggested − lands`. For each colour, `share` is its part of the coloured symbols and `have` its land sources; the wanted sources are `suggested × share`. The `need` lands are split in proportion to `max(0, wanted − have)` by largest remainder, and every colour with a symbol gets at least one while lands remain. A deck without coloured symbols gets no suggestion; the line reads "No coloured costs. Add any lands you like."

**Deck check.** Each line has an id, a severity and at most one fix.

| Id | Condition | Text | Fix |
| --- | --- | --- | --- |
| `size` (note) | fewer cards than the size | "36 of 60 cards. 24 to go." | none |
| `oversize` (note) | more than size + 2 | "63 cards. Bigger decks draw their best cards less often." | none |
| `lands` (warning) | lands differ from the suggestion by more than 1 | "20 lands. 24 fit this curve." | add suggested lands |
| `colours3` (note) | three colours each with at least 8 % of the symbols | "Three colours. Two are easier to cast." | none |
| `colours4` (warning) | four or five such colours | "Four colours. Expect hands you cannot cast." | none |
| `noSource` (warning) | a colour has symbols and no source | "No land makes red, but 6 cards need it." | add suggested lands |
| `early` (warning) | under 25 % of the spells cost 2 or less | "Few early plays: 4 cards cost 2 or less." | filter the search to mana value ≤ 2 |
| `topHeavy` (warning) | over 20 % of the spells cost 6 or more | "Top-heavy: 9 cards cost 6 or more." | filter the list to 6 and above |
| `copies` (note) | over the copy limit of D21 | "5 copies of Shock. The ranked queue allows four." | none |
| `unknown` (note) | cards without data | "3 cards have no data yet. Numbers are provisional." | retry loading |

**Simple deck.** True when the deck is complete (cards = size, or size to size + 2), has at most two colours, has no warning, and `avgMv ≤ 3.4`.

**Suggest a deck** (`autobuild.ts`, sealed decks). For each of the 15 one- and two-colour choices:

1. Candidates are the pool's non-land cards whose colour identity lies within the choice (colourless cards always qualify).
2. Sort them by card quality (section 5), highest first; ties by mana value, name, then id.
3. Fill 23 slots in that order, skipping a card while its mana-value bucket is at its cap (1: 4, 2: 8, 3: 7, 4: 5, 5: 4, 6+: 3) and other candidates remain.
4. The choice's value is the sum of the chosen cards' quality, plus 0.05 per interaction card, minus 0.5 per empty slot.

The best choice wins; ties go to the earlier one in WUBRG order. The deck becomes its spells, the pool's non-basic lands that make only its colours, and basics from the suggestion until it holds 40 cards. The toast reads "Suggested: green and white, 23 spells, 17 lands. UNDO". The result is deterministic for a pool.

### 5. Deck strength

`src/data/deck/strength.ts`, `STRENGTH_VERSION = 1`. Input: the main deck's cards with data. Output: `DeckStrength` (section 7).

Strength is `null` (shown as `—`) when the deck holds fewer than half its size, has no non-land card, or more than 10 % of its cards have no data.

Let `N` be the main deck's cards, `L` its lands, and `S` its non-land cards.

**Quality** `Q`, the mean over `S` of:

```
rarity  = common 0.35 · uncommon 0.50 · rare 0.70 · mythic 0.85 · anything else 0.60
q       = rarity                                              (no edhrec_rank)
q       = clamp(rarity + 0.3 × (rank − 0.25), 0.15, 1)        (with edhrec_rank r)
rank    = clamp(1 − log10(r) / 4.5, 0, 1)
```

**Curve** `C = 0.5 × a + 0.3 × e + 0.2 × t`:

```
a = 1                              for 1.6 ≤ avgMv ≤ 3.2
    falls to 0 at avgMv 5.0        above 3.2 (linear)
    falls to 0.6 at avgMv 1.0      below 1.6 (linear), and stays 0.6 below that
e = min(1, share of S costing ≤ 2 / 0.35)
t = 1 − clamp((share of S costing ≥ 6 − 0.10) / 0.20, 0, 1)
```

**Interaction** `I = min(1, (matches × 60 / N) / 12)`. A card matches when its rules text (all faces) matches one of these, case-insensitive:

```
destroy target · exile target (not "exile target card") · counter target
deals N|X damage to (any target | target creature | target planeswalker | each creature)
target creature gets -N/-N · fight(s) · destroy all · exile all · all creatures get -
return target (creature | nonland permanent | permanent) to its owner's hand
draw(s) (two | three | four | N≥2 | X) cards · target (player | opponent) discards
creature can't attack or block
```

**Consistency** `K = clamp((S / distinct − 1) / 2.5, 0, 1)`, where `distinct` is the number of different non-land cards (by `oracle_id`, else name). A deck of playsets scores 1, a deck of single copies 0. At size 100, where single copies are the format, `K` is fixed at 0.5.

**Mana** `M = 0.45 × l + 0.25 × c + 0.30 × s`:

```
l = 1 − clamp((|L − suggested(N)| − 1) / (0.12 × N), 0, 1)     suggested with size = N
c = 1 for ≤ 2 colours · 0.75 for 3 · 0.45 for 4 · 0.30 for 5   (colours with ≥ 8 % of symbols)
s = 1 − clamp(mismatch / 0.4, 0, 1)
mismatch = ½ × Σ over colours |share of symbols − share of sources|
s = 0 when the deck has coloured symbols and no land source
```

**Score.**

```
raw   = (0.40 × Q + 0.20 × C + 0.20 × I + 0.20 × K) × (0.4 + 0.6 × M)
score = clamp(round(1 + 99 × (raw − 0.20) / 0.70), 1, 100)
band  = rough 1–20 · casual 21–40 · solid 41–60 · tuned 61–80 · fierce 81–100
```

`basis` records what `Q` used: `rank` when at least 90 % of the non-land cards had a rank, `rarity` when at most 10 % had one, else `mixed`. `complete` is true when `N ≥ size`.

**Sentences in the popover**, one per part, picked by thirds of the part's value:

| Part | Low | Middle | High |
| --- | --- | --- | --- |
| Card quality | "Mostly commons and cards few players use." | "A mix of commons and stronger cards." | "Many rares and widely played cards." |
| Curve | "The curve is too high or too thin early." | "The curve is workable." | "A clean curve with plenty of early plays." |
| Interaction | "Few ways to answer the opponent's cards." | "Some removal, counters or card draw." | "Plenty of removal, counters or card draw." |
| Consistency | "Mostly single copies: every game differs." | "Some cards in multiples." | "Built on playsets: it does the same thing each game." |
| Mana | "The lands do not fit the spells." | "The mana mostly works." | "Lands and colours fit the spells." |

**Reference values** from a Python model of this formula on the M19 fixtures (rarity basis; the implementer's unit tests pin exact values from the TypeScript code and should land within 3 points of these):

| Deck | Q | C | I | K | M | Score |
| --- | --- | --- | --- | --- | --- | --- |
| `gw-m19-60.txt` (24 lands, no removal) | 0.44 | 0.99 | 0.00 | 0.56 | 0.96 | 40 Casual |
| `ur-m19-60.mtga.txt` (22 lands, 13 interaction) | 0.38 | 0.99 | 1.00 | 0.49 | 0.82 | 54 Solid |
| Auto-built sealed deck, 200 random pools of 6 packs | | | | | | 28 to 61, median 44 |
| 40 random spells and 20 random basics, 200 samples | | | | | | 2 to 34, median 18 |
| Playsets of five rares and four removal spells, two colours, 24 lands | 0.66 | 0.99 | 1.00 | 1.00 | 0.99 | 93 Fierce |
| 60 random spells, no lands | 0.48 | 1.00 | 1.00 | 0.00 | 0.07 | 10 Rough |

#### Limits of the strength measure

- **Self-reported.** The browser that owns the deck computes the number. An opponent cannot check it without seeing the list, and local storage can be edited. Matchmaking must treat it as a preference, as the owner says ("preferably").
- **No synergy.** A combo deck of commons scores low; a pile of unrelated rares scores high.
- **Rarity is a weak proxy** and belongs to the printing: the same card can be common in one set and uncommon in another. The rank nudge softens this.
- **The rank is Commander popularity** (Scryfall's `edhrec_rank`), not strength in a 60-card duel, and it drifts over months. Cards cached before M8 have no rank until their 30-day refresh, so the same list can differ by a few points between browsers (worst case about 11, typically under 4).
- **Text matching is crude.** It misses removal with unusual wording and counts weak effects that match.
- **It ignores the player**, the sideboard, the Commander slot's impact and the opponent's deck.
- **Versioned.** Two scores compare only within the same `v`. The queue should treat a different version as "unknown" and match by band or not at all.
- **The sealed status is as honest as its owner.** Anyone can open pools until one is good. Nothing short of a server or a witnessed opening prevents that; a live draft with other players is the witnessed form (S8 keeps it for custom games).

### 6. Booster generation

```
sets: SetCode[]  ──►  SetData per distinct set (data/mtgjson.ts: memory → IndexedDB `sets` → MTGJSON)
 (one per pack)  ──►  openBoosters(sets, data, seed)             src/draft/solo-sealed.ts, pure
                         pack i: generatePack(set, new ByteStream(`${seed}:${i}`))   data/packs.ts, unchanged
                 ──►  validate: every pack has ≥ 8 cards and every card a Scryfall id
                 ──►  pool: CardRef[] in pack order (pack 0 first; within a pack, real pack order)
                 ──►  DeckRecord { kind: 'sealed', seal: { via: 'packs', sets, pool, seed, generator: 1, revealed: 0 } }
                 ──►  cardData.getMany(sids)   (Scryfall /cards/collection, cached in `cards`)
```

- `PACK_GENERATOR_VERSION = 1` is stored as `seal.generator`, so a later change to the generator does not make old seeds lie.
- **Default set.** `latestCoreSet(summaries)` in `data/sets.ts`: the newest `SetSummary` by `releaseDate` with `type === 'core'`. `SetSummary` gains `type` (from MTGJSON's SetList, which already carries it; the ten featured sets are all `core`). Without the set list (offline, tests) the answer is M21.
- **Fallback** (D9). If `sets.get(code)` answers `null` or validation fails for the default set, setup switches to the newest featured set and shows "Foundations boosters could not be made here. Using Core Set 2021." If the player chose the set by hand, setup stays on it and the status line says `NO BOOSTER DATA FOR THIS SET`.
- **Tests** use `tests/fixtures/mtgjson/*.json` through `debug/fixture-sets.ts` and never the network. The debug hook can pin the next seed (`decks.nextSeed(hex)`), so a browser spec opens the same pool every time.

### 7. Data model, storage and migration

#### Contract changes (for the M8 contracts package; nobody else edits these files)

`src/store/types.ts`:

```ts
export type DeckKind = 'custom' | 'sealed';
export type DeckSize = 40 | 60 | 100;
export type StrengthBand = 'rough' | 'casual' | 'solid' | 'tuned' | 'fierce';

/** What makes a sealed deck sealed. Never edited after `revealed` reaches the pack total. */
export interface DeckSeal {
  /** Packs opened alone in Deck mode, or a pool drafted or opened at a table. */
  via: 'packs' | 'draft';
  /** The set of each pack, in opening order (as `origin.sets` and the setup sheet's `sets`). */
  sets: SetCode[];
  /** Every card the boosters gave, in pack order. Dispensed basics are not part of it. */
  pool: CardRef[];
  /** `via: 'packs'`: 64 hex characters; pack i draws from ByteStream(`${seed}:${i}`). */
  seed?: string;
  /** `via: 'packs'`: PACK_GENERATOR_VERSION when the pool was made. */
  generator?: number;
  /** `via: 'draft'`: the draft format and, when known, the room. */
  draft?: { format: DraftFormat; roomId?: string };
  /** ms epoch. */
  sealedAt: number;
  /** Packs shown by the opening animation so far; the pack total when done. */
  revealed: number;
}

export interface DeckStrength {
  /** STRENGTH_VERSION. */
  v: number;
  /** 1..100. */
  score: number;
  band: StrengthBand;
  /** Each 0..1. */
  parts: { quality: number; curve: number; interaction: number; consistency: number; mana: number };
  basis: 'rank' | 'rarity' | 'mixed';
  /** The main deck has at least `size` cards. */
  complete: boolean;
}

/** Derived facts kept on the record so tiles, the landing hero and the queue need no card data. */
export interface DeckSummary {
  /** DECK_SUMMARY_VERSION; an older one is recomputed on sight. */
  v: number;
  /** The record's `updatedAt` it was computed for. */
  at: number;
  cards: number;
  lands: number;
  /** Colours with at least 8 % of the coloured symbols, WUBRG order; empty for colourless. */
  colours: ('W' | 'U' | 'B' | 'R' | 'G')[];
  /** Non-land cards by mana value, 8 buckets. */
  curve: number[];
  avgMv: number;
  /** Cards whose data was missing. */
  unknown: number;
  strength: DeckStrength | null;
  simple: boolean;
  /** Largest number of copies of one card that is not a basic land. */
  maxCopies: number;
  cover: CardRef | null;
}

export interface DeckRecord {
  // … existing fields unchanged: id, name, main, side, source, text, createdAt, updatedAt,
  //   pool (M2), origin (M2), commander, companion (M6) …
  /** Added by M8. Absent on older records: see migrateDeckRecord. */
  kind?: DeckKind;
  size?: DeckSize;
  seal?: DeckSeal;
  /** Custom decks only. */
  maybe?: CardRef[];
  /** The player's chosen cover; absent means automatic. */
  cover?: CardRef;
  notes?: string;
  summary?: DeckSummary;
  /** On a custom deck made by "Convert to custom deck". */
  convertedFrom?: { id: string; name: string; at: number; via: DeckSeal['via']; sets: SetCode[] };
  lastPlayedAt?: number;
}

export const LIBRARY_FILE_VERSION = 2; // the reader accepts 1 and 2

export interface Settings {
  // …
  /** Added by M8. Card image size in the deck page's grid. */
  deckCardSize: 's' | 'm' | 'l';
}
// DEFAULT_SETTINGS: deckCardSize: 'm'
// The selected deck is Settings.home.deckId and the last booster setup lives in Settings.home too
// (journey.md section 7); this topic adds no key for either.
```

`src/data/types.ts`:

```ts
export interface CardData {
  // …
  /** Added by M8. Scryfall's EDHREC popularity rank (1 = most played); absent on many cards. */
  edhrec_rank?: number;
}

export interface SetSummary {
  // …
  /** Added by M8. MTGJSON's set type ('core', 'expansion', …); absent on entries built from a cached set. */
  type?: string;
}

/** Added by M8. */
export interface CardSearchOptions {
  /** Default 'name' (today's behaviour). */
  order?: 'name' | 'edhrec' | 'cmc';
}

export interface CardDataSource {
  searchCards?(query: string, options?: CardSearchOptions): Promise<CardData[]>;
  // …
}
```

`STORED_CARD_FIELDS` in `data/cards.ts` gains `edhrec_rank` (a number field; `trimCard` keeps it when it is a positive integer).

No new sound cues, no new debug shapes beyond `decks` (below), no change to `core/actions.ts` or `net/messages.ts` from this topic. The queue's wire shape belongs to the matchmaking topic; it embeds `QueueDeckInfo`.

#### The record's invariants

Custom deck: `main`, `side`, `maybe`, `commander`, `companion` are free lists. `pool` and `origin` are absent (removed at the first save after migration).

Sealed deck (`sealIntact(deck, isFreeBasic)` in `data/deck/seal.ts`):

1. `seal` is present, and `maybe`, `commander` and `companion` are empty or absent.
2. `main` without free basics is a sub-multiset of `seal.pool`.
3. `side` equals `seal.pool` minus those cards, in pool order. `side` is stored (the table's deck import reads it) but always recomputed by the edit functions.
4. A free basic is a card named Plains, Island, Swamp, Mountain or Forest with a "Basic Land" type line. Snow-covered basics and Wastes are not free.

A record read from this browser's own store is trusted. A record read from a file is checked: a sealed record that fails becomes a custom deck (`kind: 'custom'`, `seal` dropped, `convertedFrom` filled) and the import lists "This deck held cards from outside its boosters. It is a custom deck now."

#### Edit functions (`src/data/deck/edit.ts`, pure)

```ts
export type Board = 'main' | 'side' | 'maybe' | 'commander' | 'companion';
export type EditResult =
  | { ok: true; deck: DeckRecord }
  | { ok: false; reason: 'sealed' | 'notInPool' | 'absent' | 'opening' };

add(deck, ref, board, count, card: CardData | null): EditResult
remove(deck, ref, board, count): EditResult
move(deck, ref, from, to, count): EditResult
setPrinting(deck, board, fromSid, toSid): EditResult   // sealed: free basics only
rename(deck, name) · setSize(deck, size) · setCover(deck, ref | null) · setNotes(deck, text)
convertToCustom(deck, newId, now): DeckRecord
duplicate(deck, newId, now): DeckRecord                 // a sealed deck's duplicate is sealed too
```

On a sealed deck: `add` to `main` succeeds for a free basic (needs `card`; without card data the answer is `sealed`) or for a card still in `side`, which it moves; anything else answers `notInPool`. `add` to any other board answers `sealed`. `remove` from `main` drops a free basic or returns a pool card to `side`. Edits answer `opening` while `seal.revealed` is below the pack total.

No function reads the clock; the caller passes `now` where a time is stored.

#### Storage

- Store `decks`, key `id`, index `updatedAt`: unchanged. This topic does not touch `DB_VERSION`.
- `DeckStore` (`list`, `get`, `put`, `delete`) is unchanged. `list()` and `get()` pass each record through `migrateDeckRecord`.
- **Autosave.** The deck page keeps the open record in memory and writes it 400 ms after the last edit, and at once on `pagehide`, on DONE and on leaving the route. Each write refreshes `summary` and `updatedAt`.
- **Undo.** The last 50 records before each edit, in memory, per open deck page. Leaving the page drops them.
- **Two tabs.** The last write wins per record. The library reloads its list when the tab becomes visible.
- **No storage** (private window, IndexedDB blocked): Deck mode works on an in-memory store and shows a banner on D1: "Decks are not saved in this window. Export them before you close it."
- **Quota.** A failed `put` shows the toast "Could not save: this browser's storage is full. EXPORT DECK", and the deck stays open and dirty.

#### Migration (`migrateDeckRecord` in `src/store/decks.ts`, pure and idempotent)

| Old record | Becomes |
| --- | --- |
| `origin` present (a drafted or sealed pool from M2) | `kind: 'sealed'`, `size: 40`, `seal: { via: 'draft', sets: origin.sets, pool: the non-basic cards of record.pool in order, draft: { format: origin.format }, sealedAt: createdAt, revealed: pack total }`, `side` recomputed. `pool` and `origin` are kept for one release so the M2 builder can still open the record. |
| No `origin`, `commander` present | `kind: 'custom'`, `size: 100` |
| No `origin`, at most 45 cards in `main` | `kind: 'custom'`, `size: 40` |
| Anything else | `kind: 'custom'`, `size: 60` |

A record that already has `kind` is returned as it is. `summary` is not written by the migration (it needs card data); the library computes it the first time the record's cards are loaded and saves it then.

Library files: `exportLibrary` writes version 2 with the new fields. `importLibrary` reads versions 1 and 2, runs `migrateDeckRecord`, validates the new fields with the existing limits (`seal.pool` at most 5,000 refs, `notes` at most 2,000 characters, `seal.sets` at most 36 entries) and applies the sealed check above. Backup files (`store/backup.ts`) reuse the same reader, as today.

#### What may leave the browser

```ts
// src/data/deck/queue.ts
export interface QueueDeckInfo {
  kind: DeckKind;
  size: DeckSize;
  cards: number;
  strength: number;      // 1..100
  band: StrengthBand;
  v: number;             // STRENGTH_VERSION
}
export type QueueEligibility =
  | { ok: true; info: QueueDeckInfo }
  | { ok: false; reason: 'incomplete' | 'noStrength' | 'opening' | 'copies' };
export function queueEligibility(deck: DeckRecord): QueueEligibility;
```

It reads `deck.summary` only. `incomplete`: fewer cards than `size`. `copies`: `summary.maxCopies` above 4 (above 1 at size 100). `noStrength` is answered only for a deck that has cards but no card data at all; `matchmaking.md` 2.7 then queues it as average (band 3, score 50) with the line `DECK STRENGTH UNKNOWN · MATCHING AS AVERAGE`, which this function supports with `averageInfo(deck)`.

For `matchmaking.md`: its `Band` 1 to 5 is `bandNumber(band)` (rough 1, casual 2, solid 3, tuned 4, fierce 5, which is `ceil(score / 20)`), its `deckStrength(cards, kind)` is a thin wrapper over `strength()` here, and its queue key `constructed` or `limited` is `kind` `custom` or `sealed`. The shared leak test gets a scenario: build a `QueueDeckInfo` from a fixture deck, serialise it, and scan the bytes for every Scryfall id, card name, the deck's name and its colours; none may appear.

#### Debug hook

`registerDebug('decks', …)` in dev and test builds: `list()`, `get(id)`, `edit(id, op)` (returns the `EditResult`), `summary(id)`, `nextSeed(hex)`, `select(id)`. Browser specs assert on these, not on pixels.

### 8. Failure behaviour

| Situation | Behaviour |
| --- | --- |
| Offline, search | Field disabled, status line `CARD SEARCH NEEDS A CONNECTION`. Deck list, stats and export work from cached data. |
| Scryfall 429 | The limiter backs off 30 s (existing). The pane says so and retries once. |
| Scryfall 5xx or timeout | "Scryfall did not answer. Cards already on this device still work. RETRY" |
| MTGJSON unreachable on OPEN | The pill returns to OPEN; the toast reads "Could not load <set name>. Sets used before still work." (existing `UnreachableError` text). Nothing is saved. |
| Set without booster data | Status line `NO BOOSTER DATA FOR THIS SET`, OPEN disabled; the default set falls back (D9). |
| Pool saved, card objects fail to load | The opening shows placeholder faces; the deck page shows `unknown` in the deck check with RETRY. The pool itself is safe: it is ids. |
| Reload during the opening | Resumes at the first unopened pack. |
| A card id Scryfall no longer knows | Row "Unknown card", removable; it counts toward the total only. |
| Image fails | The existing placeholder face (name, cost, type). |
| Deck deleted in another tab while open | The next autosave finds no record: the banner "This deck was deleted elsewhere. KEEP IT · DISCARD". KEEP IT writes it back. |
| Import file too large or malformed | The existing messages of `importLibrary`; nothing is written. |

### 9. Seams with the other M8 topics

- **Home (`journey.md`).** Reads `Settings.home.deckId` and that record's `summary`; it never needs card data to draw the deck hero, except the cover's image. The cover is `summary.cover` (the player's choice, else the automatic one). The hero and the Draft Night booster hero are built from this topic's parts: `DeckBox` (cover card whole and sharp, on a drawn pile), `KindBadge`, `ManaPips`, `Sparkline` or `CurveChart`, `StrengthChip`, and `BoosterPackArt` with `mystery` for "mysterious and closed boosters" (S7).
- **First game without a deck (`journey.md`: "we open six boosters and build one for you").** `quickBoosterDeck(sets, cardData, now)` in `src/ui/decks/state/quick.ts` runs D3's steps with the defaults, skips the opening animation, applies the suggestion, saves the record as `FIRST BOOSTERS` and returns its id. It fails with the same errors as OPEN.
- **Deck picker sheet (`journey.md`'s `DeckPickerSheet`, reused by the lobby).** It shows `DeckTile`s and takes `allow: (deck) => true | string`; a string is the reason on a dimmed tile, such as "Booster decks only".
- **Matchmaking (`matchmaking.md`).** Takes `queueEligibility(deck)` and the mapping at the end of section 7. A sealed deck queues as limited (S8); its converted copy queues as constructed (D4). Opponents are shown the band, never the number. `matchmaking.md` 2.7's formula is replaced by section 5 here (D30); its window and rating rules are untouched, since they read only band and score.
- **Custom games.** "Booster drafted decks that have been created in advance" (S6) are the library's sealed decks; the picker's `allow` shows only them when the host chooses booster decks. A live draft saves each player's pool as a sealed deck (`via: 'draft'`) when the build stage starts and updates it when the player readies.
- **Table start.** `deckImportOfRecord(deck)` in `session/deck-build.ts` turns a record into today's `DeckImport` (`main`, `side`, plus `commander` and `companion` as M6-P5 does). Starting a game sets `lastPlayedAt`.
- **Persistence (`persistence.md`).** It moves the database to version 2 for its `games` store. This topic needs no store change; its migration is per record and runs under either version.
- **Design system.** Deck mode needs: primary and ghost pills, icon button, stepper, segmented pills, chip, sheet, dialog, toast with an action, tooltip, popover, the halftone page and the three elevations. Deck mode adds its own parts (section 2) on those tokens.
- **DESIGN.md** needs three edits by the integrator: "Pre-game" (deck kinds, the seal, Deck mode replaces the builder table as the main way to build), "Local persistence" (the new `DeckRecord` fields), and the secrecy specification (`QueueDeckInfo` as a designed reveal path).

---

## Build plan

Chunks are sized for 2 to 4 hours each. `DK-C` belongs inside the M8 contracts package. After it, `DK-1`, `DK-2`, `DK-3` and `DK-4` can run in parallel; `DK-5` to `DK-9` each own different files and can run in parallel once those four are merged; `DK-10` and `DK-11` come last.

Every chunk ends with `pnpm check` green. Browser specs run with `?profile=<name>&faces=placeholder`, the fixture card and set sources, and through the pnpm scripts only.

### DK-C Contracts (about 1.5 h, part of M8-C)

- `store/types.ts`: `DeckKind`, `DeckSize`, `StrengthBand`, `DeckSeal`, `DeckStrength`, `DeckSummary`, the new `DeckRecord` fields, `LIBRARY_FILE_VERSION = 2`, `Settings.deckCardSize` and its default. (`Settings.home` and `BoosterSetup` come from the journey's part of the same package.)
- `data/types.ts`: `CardData.edhrec_rank`, `SetSummary.type`, `CardSearchOptions`, the `searchCards` signature.
- `store/backup.ts`: the settings reader accepts `deckCardSize` (one of `s`, `m`, `l`).
- **Tests:** `tests/unit/m8-contracts.test.ts` checks the defaults, that a version 1 `DeckRecord` literal still type-checks, and that a backup with the new settings round-trips.

### DK-1 Deck model, seal and migration (about 3 h)

- New: `src/data/deck/edit.ts`, `src/data/deck/seal.ts` (`sealIntact`, `isFreeBasic`, `poolRemaining`, `convertToCustom`).
- Changed: `src/store/decks.ts` (`migrateDeckRecord`, `list` and `get` apply it, `exportLibrary` version 2, `importLibrary` reads 1 and 2 with the new validators and the sealed check).
- **Tests** (`tests/unit/decks/edit.test.ts`, `seal.test.ts`, `migrate.test.ts`):
  - adding a non-pool card to a sealed deck answers `notInPool`; adding to `maybe` answers `sealed`; adding Forest succeeds; adding Snow-Covered Forest answers `notInPool`;
  - moving a pool card to `main` and back leaves `side` equal to pool minus main;
  - `convertToCustom` leaves the original deep-equal and gives a custom deck whose `main` matches and whose `side` is the rest of the pool;
  - a version 1 library file with one pasted deck and one drafted pool imports as one custom and one sealed deck, and exporting then importing again is stable;
  - a version 2 file whose sealed deck holds a foreign card imports it as custom with the note;
  - `migrateDeckRecord` is idempotent.

### DK-2 Analysis and strength (about 4 h)

- New in `src/data/deck/`: `analyse.ts` (curve, symbols, sources, type breakdown), `lands.ts` (suggested lands and basics), `checks.ts` (deck check, `simple`), `strength.ts`, `summary.ts` (`summarise`, automatic cover: the non-land card with the highest quality, ties by lower mana value then name), `autobuild.ts`, `queue.ts`.
- `src/ui/builder/stats.ts` keeps working; its helpers (`isLandCard`, `manaCosts`, `costSymbols`) move to `data/deck/analyse.ts` and are re-exported from the old path.
- **Tests** (`tests/unit/decks/analyse.test.ts`, `strength.test.ts`, `autobuild.test.ts`, `queue.test.ts`):
  - the two fixture decklists give the hand-computed curve, land suggestion (GW: 23, UR: 25 or 26) and scores within 3 points of the reference table (40 and 54), then pinned exactly;
  - a deck with no lands scores under 15; a deck of only seven-drops scores under 10;
  - a hand-made card with `edhrec_rank: 10` raises `quality` and one with `30000` lowers it, both within ±0.2;
  - `strength` is `null` under half size and with more than 10 % unknown cards;
  - `autobuild` on a fixed M19 pool returns 40 cards in at most two colours, twice the same;
  - `queueEligibility` answers `incomplete`, `copies` and `ok` for three fixtures;
  - the leak scenario of section 7 in `tests/leak/`.

### DK-3 Booster pipeline and data additions (about 3 h)

- New: `src/draft/solo-sealed.ts` (`openBoosters`, `PACK_GENERATOR_VERSION`, pack validation).
- Changed: `src/data/sets.ts` (`latestCoreSet`, `type` on the featured entries), `src/data/mtgjson.ts` (keep `type` from the SetList), `src/data/cards.ts` (`edhrec_rank`), `src/data/source.ts` and `src/debug/fixture-cards.ts` (`searchCards` options; the fixture source sorts by name, mana value or rarity as a stand-in for popularity), `src/debug/fixture-sets.ts` (summaries carry `type: 'core'`).
- **Tests** (`tests/unit/packs/solo-sealed.test.ts`, `tests/unit/data/sets.test.ts`):
  - the same seed and sets give the same pool twice; a different seed gives another;
  - 6 M19 packs give 90 refs, each pack with exactly one rare or mythic;
  - mixed sets (`['M19', 'M19', 'M20']`) keep the pack order;
  - `latestCoreSet` picks the newest `core` entry and answers M21 for the featured list alone;
  - a pack with a card lacking a Scryfall id fails validation;
  - `trimCard` keeps a positive integer `edhrec_rank` and drops anything else.
- Optional, only if the main session allows one fixture recording over the network (never from a test): add Foundations (`FDN`) booster data to `tests/fixtures/mtgjson/` and a generation test for its Play Boosters. Without it, D9's fallback covers the risk at runtime.

### DK-4 Deck parts and harness (about 3 h; needs the M8 design-system tokens)

- New in `src/ui/decks/parts/`: `DeckBox.svelte`, `DeckTile.svelte`, `KindBadge.svelte`, `ManaPips.svelte`, `ManaCost.svelte`, `Sparkline.svelte`, `CurveChart.svelte`, `StrengthChip.svelte`, `BoosterPackArt.svelte`.
- New: `src/ui/decks/harness.ts`, mounted by `?harness=decks` (one line in `src/main.ts`'s harness table): every part in every state of section 3 on one page, fed from fixtures.
- **Tests** (`tests/e2e/decks/parts.spec.ts`): the harness mounts; each tile state is present with its accessible name; axe finds nothing; a card image's rendered aspect ratio is 5:7 within 1 % in every part (faces are never distorted); screenshots of the harness in each look go to `artifacts/shots/M8/decks/` as evidence.

### DK-5 Library and chooser (about 4 h; the same work as the journey's Decks page chunk: build it once)

- New: `src/ui/decks/DecksPage.svelte`, `DeckSummaryPanel.svelte`, `NewDeck.svelte`, `DeckPickerSheet.svelte` (layout of `journey.md` 4.2 and 4.3, contents of section 3 here), `state/library.svelte.ts` (reactive list, summaries filled in lazily, delete with undo, duplicate), `state/quick.ts` (`quickBoosterDeck`; it can land with DK-8 if DK-8 is not merged yet).
- Changed: `src/ui/routes.ts` (the routes of section 1 and the `#/build` redirects), `src/ui/App.svelte` (mounts them).
- **Tests** (`tests/e2e/decks/library.spec.ts`; `tests/unit/ui/routes.test.ts` extended):
  - an empty profile shows the empty state with its three paths;
  - a profile seeded with a version 1 pasted deck and a version 1 drafted pool shows one CUSTOM and one BOOSTER tile, and the debug hook reports `kind` on both;
  - a click selects and fills the summary panel; a double-click and Enter open the deck page;
  - delete then UNDO restores the record; delete and wait removes it from the store;
  - PLAY WITH THIS DECK sets `Settings.home.deckId`, and the tile reads PLAYING after a reload;
  - the filter pills and the sort stepper reorder the tiles;
  - the picker sheet with `allow` rejecting custom decks dims them with the reason.

### DK-6 Deck page for custom decks (about 4 h)

- New: `src/ui/decks/DeckRoute.svelte`, `editor/CardSearch.svelte`, `editor/FilterChips.svelte`, `editor/CardGrid.svelte`, `editor/DeckList.svelte`, `state/editor.svelte.ts` (open record, autosave, undo stack), `state/query.ts` (chips to a Scryfall query; pure).
- **Tests** (`tests/unit/decks/query.test.ts`, `tests/e2e/decks/custom.spec.ts`):
  - chips compile to the query terms of the table in section 3;
  - create a custom deck, search "elves" in the fixtures, click a card four times: the row reads 4 and the store holds the deck after 1 s without pressing DONE;
  - Shift+Enter adds to the sideboard; `−` removes; undo and redo walk the edits;
  - a deck with five copies shows the copy warning and can still be saved;
  - with the fixture source set offline (debug hook), the search field is disabled and the list still edits;
  - the whole flow by keyboard only.

### DK-7 Stats rail, deck check, strength popover, sample hand (about 3 h)

- New: `editor/StatsRail.svelte`, `editor/ColourBalance.svelte`, `editor/LandHelper.svelte`, `editor/DeckCheck.svelte`, `editor/StrengthPopover.svelte`, `editor/SampleHand.svelte`.
- **Tests** (`tests/e2e/decks/stats.spec.ts`):
  - the GW fixture deck shows 24 lands against its suggestion and no land note; removing 6 lands shows the `lands` warning; `+6 SUGGESTED` adds six basics split between Forest and Plains and is one undo step;
  - the chart's text alternative lists the hand-computed curve;
  - a click on the 2 bar filters the list to mana value 2;
  - the strength popover shows five rows whose values match the debug hook's `summary(id)`;
  - the sample hand shows 7 cards, MULLIGAN shows 6, DRAW adds one.

### DK-8 Sealed decks: setup, opening, pool page, convert, suggest (about 4 h)

- New: `src/ui/decks/sheets/BoosterSetupSheet.svelte` (the shared sheet of `journey.md` 4.4; if the journey's package has built it, add the booster-deck mode to that one), `OpenRoute.svelte`, `editor/PoolPane.svelte`, `editor/BasicsDispenser.svelte`, `sheets/ConvertDialog.svelte`, `state/open.ts` (D3's steps 1 to 5).
- Changed: `DeckRoute.svelte` (pool mode for `kind: 'sealed'`).
- **Tests** (`tests/e2e/decks/sealed.spec.ts`):
  - with a pinned seed, OPEN with the defaults saves a sealed deck of 90 pool cards before any card is shown (`seal.revealed` is 0 in the store);
  - a reload after the second pack resumes with pack 3;
  - OPEN ALL lands on the deck page with `revealed` 6 and the suggestion applied (40 cards in `main`); one undo empties the deck;
  - the page has no search field; `edit(id, add <a card outside the pool>)` through the debug hook answers `notInPool`;
  - after emptying the deck, SUGGEST A DECK gives the same 40 cards again;
  - `quickBoosterDeck` with a pinned seed returns a 40-card sealed deck named FIRST BOOSTERS;
  - CONVERT TO CUSTOM DECK creates a second record of kind custom with a search field, and the original is byte-equal to before (`canonicalJson`);
  - with reduced motion no flip animation runs (the grid is face up within 300 ms).

### DK-9 Import, export, printings, command slots (about 3 h)

- New: `src/data/deck/text.ts` (deck to plain or MTGA text; pure), `sheets/ImportSheet.svelte`, `sheets/ExportSheet.svelte`.
- Ported from branch `m6` (M6-P5), restyled on the new parts: `src/data/printings.ts`, `CardDataSource.printings` in `src/data/source.ts`, `src/ui/builder/PrintingChooser.svelte` (moved to `src/ui/decks/editor/`), and the Commander and Companion model of `src/ui/builder/command.ts`. If `m6` has been merged by then, use the merged files.
- **Tests** (`tests/unit/decks/text.test.ts`, `tests/e2e/decks/import-export.spec.ts`):
  - each fixture decklist parses, exports as text and parses again to the same counts per section;
  - pasting `mixed-40.mtgo.txt` creates a custom deck and lists the one unresolvable line;
  - "Import into this deck" is absent on a sealed deck;
  - a library file with a sealed deck imports sealed; the tampered one imports custom with the note;
  - choosing another printing of Forest changes the row's set label and survives a reload.

### DK-10 Seams (about 3 h)

- New: `deckImportOfRecord` in `src/session/deck-build.ts`; `strength` exported under the name and shape `matchmaking.md` expects (`deckStrength(cards, kind)`, `bandNumber`).
- Changed: `src/ui/builder/Builder.svelte` and `list/ListView.svelte`, `list/Library.svelte` (in the build stage after a draft: no `search` prop, no "open from library"; the pool is saved as a sealed deck when the stage starts and updated on Ready). `src/ui/DeckImport.svelte` (the HUD's deck import dialog) gains a "From my decks" tab that lists the library. This chunk starts after M7-P2's HUD is merged, since both touch the dialog's host.
- **Tests** (`tests/e2e/decks/seams.spec.ts`; the existing builder specs adjusted where they used search-and-add in a drafted pool):
  - after a fixture sealed evening reaches the build stage, the library holds one sealed deck with `via: 'draft'` and the right boosters, and the build stage offers no card search;
  - `deckImportOfRecord` of a sealed deck gives `main` and the rest of the pool as `side`;
  - `deckStrength` and `strength` agree on the two fixture decks, and `bandNumber` maps the five bands to 1 to 5;
  - gates M0 to M5 stay green.

### DK-11 Small screens, accessibility pass, gate scenario (about 3 h)

- The deck page's one-column layout under 1100 px, the bottom bar, 44 px touch targets, swipe to remove.
- axe on D1, D3, D4 and D5 in each look; focus order; the live region.
- The decks part of `tests/e2e/m8.gate.spec.ts` (run by `pnpm e2e:gate -- M8`, screenshots by `pnpm shots -- M8`): from an empty library, open 6 fixture boosters with a pinned seed, see the suggested 40 cards, a BOOSTER badge and a strength number; fail to add an outside card; convert; add a searched card to the copy; export it as text; delete it and undo; select the sealed deck for play. Asserted on the debug hook and the store. Screenshots: library, setup, opening mid-reveal, sealed deck page, custom deck page, strength popover, at 1280 × 800 and 390 × 844.
- A memory check for S12: open and close the deck page 20 times and open 12 packs in one spec; afterwards, back on the library, the number of `img` elements and of DOM nodes under the app root equals the count before the loop.

### Later (not in the overnight run)

- The new deck page as the in-room build stage, retiring the M2 builder table (D7).
- A search over cards already cached on this device while offline.
- More than 175 search results (paging).

---

## Open questions for the owner

Each has a default that the build follows until the owner says otherwise.

**Q1. Should there be a solo booster draft against pick bots?** The owner's words are "booster draft mode, where the deck is pre-made from boosters". Alone, without other drafters, that is sealed play: open packs, keep everything. A solo draft needs simulated drafters who take cards from the packs.
*Default:* no bots in M8. Pre-built booster decks are sealed pools; drafting happens live with other players.

**Q2. Is 6 packs of the latest core set the right default, given that the latest core set is Foundations?** Its 14-card Play Boosters are generated from the same data but have not been verified like the ten older core sets.
*Default:* Foundations when its packs generate cleanly, otherwise Core Set 2021, with a toast that says which.

**Q3. Should deck sizes be the only format, or should decks also be checked against Wizards formats (Standard, Modern, Commander legality)?**
*Default:* size only (40, 60, 100). The search can filter by format.

**Q4. Should opening sealed pools be limited, for example one new pool per set per day, so that a "sealed" deck in the ranked queue means more?** Without a server the limit could only be a local courtesy.
*Default:* no limit. The sealed status is honour-based, and the document says so.

**Q5. Is it acceptable that an opponent in the ranked queue learns the band of my deck (for example "Solid") before the game, and that my browser sends the number to find a match?** It is the only deck information that leaves the browser.
*Default:* yes: the number is sent, the band is shown.

**Q6. May the strength measure use Scryfall's EDHREC popularity rank?** It improves the card-quality guess but is third-party popularity data that changes over time.
*Default:* yes, as a bounded nudge on top of rarity.

**Q7. The app can bundle no starter decks (a decklist is card data). Is "Open boosters, Suggest a deck" acceptable as the newcomer's path to a first deck?**
*Default:* yes. The empty library and the empty deck hero both lead with OPEN BOOSTERS.

**Q8. Pack art and mana symbols are Spellplane's own drawings (a plain foil wrapper with the set code; letter discs). Should set symbols be loaded from Scryfall at runtime to make packs recognisable?**
*Default:* no. Text only, which is safe under the "no Wizards logos" rule.
