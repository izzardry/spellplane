# HUD proposal: what goes where

*M7, aspects A1 and A4. This is the structure shared by all three visual directions in `directions.html`, so the owner can judge it apart from the style. Every direction draws exactly this.*

## The rule

The screen has three layers, each quieter than the one before:

1. **Always visible**: only what you need at a glance in any turn. That is life totals, whose turn and which step it is, your hand, the piles, one primary button, Undo, Talk and a menu.
2. **On hover, selection or the moment**: card actions, life steppers, pile actions, prompts, stack controls and combat buttons. They appear where your eye already is, and they go away when you're done.
3. **One step away in the menu**: everything you do a few times an evening or less.

The battlefield takes the whole window. The HUD sits at the edges and floats over it, with no permanent columns, so the cards get roughly 85% of the screen instead of today's ~50%.

## Layout at a glance (desktop, 1v1, my turn)

```
┌───────────────────────────────────────────────────────────────────────┐
│ [Menu] [Undo]        ( Your turn · Turn 4 │ Beginning  MAIN  Combat  Main 2  End )   [Log 2] │
│                         ◆ Ben  18  · hand 5  ▯▯▯▯▯                                  │
│  Ben's piles          Ben's lands, then Ben's creatures                              │
│ ─ ─ ─ ─ ─ ─ ─ ─  centre line (the stack lane appears here only when used) ─ ─ ─ ─ ─ │
│                       my creatures   [selected: Tap · To graveyard · More]           │
│                       my lands                                     my piles          │
│ ● Ann (you) 20             [ my hand: 7 cards, fanned ]        [To combat ▸] [Mic]   │
└───────────────────────────────────────────────────────────────────────┘
```
## Always visible

| Item | Where | What it shows | Why |
| --- | --- | --- | --- |
| **Turn tracker** | Top centre, one pill | "Your turn · Turn 4", then five grouped steps: Beginning · Main · Combat · Main 2 · End. The current step is filled. On another player's turn it reads "Ben's turn" in Ben's seat colour and shape. | The heartbeat of the game. Seven equal words become five grouped steps with one highlighted. Untap, upkeep and draw fold into "Beginning", which expands on hover. |
| **Primary button** | Bottom right, beside the hand, the only filled button on screen | Context label: "Draw" in Beginning, "To combat ▸" in Main, "Main 2 ▸" after combat, "End turn ▸" in Main 2 or End. Not my turn: replaced by "Waiting for Ben". | One obvious next move. Today "Next turn `Ctrl+Enter`" is the smallest button. Shortcuts move to tooltips. |
| **My plate** | Bottom left, next to my hand | Avatar with seat shape, name, life in large numerals. Poison, energy, commander damage and other counters appear as chips only when not zero. | Life is the number you look at most. Showing "poison 0" all game is noise. |
| **Opponent plate** | At the opponent's edge of the table (top centre, under the turn tracker, in 1v1; at each seat in multiplayer) | Avatar, name, life, hand count (small card icon with a number), a speaking ring when they talk. | Information sits next to the player it belongs to, as at a real table. Hand count lives here because the hand itself is hidden. |
| **Piles on the table** | In each territory: library, graveyard, exile | The real piles with a count badge. Graveyard shows its top card. Exile and command appear only once they hold a card. | Today's "Library 53 / Graveyard 0 / Exile 0" buttons repeat what the table already shows. Empty hairline boxes make the table look like a wireframe. |
| **Hand** | Bottom centre, a gentle fan that overlaps the table edge | My cards, at a size you can read the name and cost. The full card on hover or long-press. | The hand gets space, but less than today's 200 px row, which dwarfed the battlefield. |
| **Undo** | Top left, beside the menu | Icon plus "Undo". Tooltip: the last action ("Undo: tap Forest"). | Common and reassuring, so it earns a permanent spot. |
| **Menu** | Top left | One button, "Menu". | Holds every rare tool (see below). |
| **Activity button** | Top right | Speech-bubble icon with an unread count. The last 2–3 events slide in under it and fade after about 6 seconds. | The log stays as a quiet ticker, not a permanent fifth of the screen. |
| **Talk** | Bottom right, beside the primary button | A microphone button: hold to talk (V), with a mute state. Hidden if voice is off for the table. | Voice is how friends play. One control, not five (Voice off, Join voice, Mute, ⚙, Dictation). |

## Shown on hover, on selection, or in the moment

| Item | Trigger | What appears | Why |
| --- | --- | --- | --- |
| **Card action strip** | Select a card (click or tap) | A small strip above the card with 3–4 likely actions for its zone and step: battlefield in Main shows Tap · To graveyard · ⋯; in Combat, Attack · Tap · ⋯; in hand, Play · Discard · ⋯. "⋯" opens the full context menu. | Gives touch and mouse users the same first-level actions, and teaches the keys through tooltips ("Tap — T"). It replaces the always-on five-pill thumb bar. |
| **Hover affordance** | Mouse over a card | A slight lift, a grab cursor and, the first few times, a one-line hint under the card: "Drag to move · T to tap · right-click for more". | Today nothing on a card says it can be dragged. |
| **Life steppers** | Hover or tap a life number | − and + appear beside it. Click the number to type a value. Long-press for counters. | Life changes are frequent but not constant. Hiding the tiny ± boxes calms the plates. |
| **Pile actions** | Hover or tap a pile | Library: Draw · Shuffle · Search…; Graveyard and Exile: Open. Double-click a library draws. | The actions sit right on the thing they act on. |
| **Stack controls** | Something is on the stack | The stack lane appears in the centre. Next to its top item sit Resolve · Counter · ⋯ and the "Ask / OK / Hold" prompt. | Today they sit in a second toolbar under the phases, far from the stack. |
| **Prompts** | Another player asks "OK?" | A compact card in the centre-bottom, above the hand: who asks, what, OK / Hold. It never covers the battlefield. | Nothing modal, as the design rules require, but clearly in sight. |
| **Combat bar** | The Combat step | The primary button becomes "Confirm attackers" or "Damage done ▸". "Bring back" (today "Settle") appears beside it once creatures have moved. | Shown only when combat happens. "Settle" gets a plain name. |
| **Activity drawer** | Click the activity button, or press Enter to chat | A right-side drawer over the table with Log, Chat and Team tabs and a chat input. Repeated events are grouped ("Ann draws 7 cards"). | Full history on demand, never a permanent column. |
| **First-run hints** | The first time a situation arises | One coach mark at a time, anchored to the thing it explains: "Drag a land from your hand onto the table", then "Click your library to draw", then "Select a creature and press Attack". They disappear once you've done it. | Teach the gesture when it matters, not keyboard tables at load. Hints never sit over the opponent's battlefield. |
| **Game over** | A life total reaches 0, or someone concedes | A banner over the table: "Ben wins". It offers "Next game", "New draft" (limited only) and "Back to lobby". | This is the only place "Next game" and "New draft" appear. Today they are always on screen. |

## In the menu (one step away)

Grouped, with icons, keys shown on the right in muted type.

| Group | Items | Why here |
| --- | --- | --- |
| **Game** | Mulligan · Draw several · Shuffle · Untap all · Create token… · Roll a die · Flip a coin · Tidy my side | A few times per game. All also reachable by key or by the card and pile strips. |
| **Deck** | Import deck… · Open deck builder · Sideboard | Before or between games. |
| **Table** | Invite players (copy link) · Spectator link · Seats and teams · Audit (verify shuffles) · Leave table | The lobby owns these. Audit is a power-user feature and must never pop over play. |
| **View** | Fit table · Switch perspective · Look at seat 1–4 · Theme ▸ | Rare during play. Theme changes the mood and stays out of the toolbar. |
| **Voice** | Voice and microphone… · Captions (dictation) · Volume per player | Set once per evening. Talk itself stays on the main screen. |
| **Help** | How to play (gesture sheet) · Keyboard shortcuts · Settings… | One keyboard sheet and one settings dialog, in the same design. |

## Multiplayer and touch differences (same structure)

- **3–4 players.** Each opponent's plate sits at their own edge. The turn tracker shows whose turn in that seat's colour and shape. The activity button still collapses the log.
- **iPad portrait.** The same items, rearranged vertically. The top bar holds Menu, Undo, the turn tracker (compact: "Your turn · Main") and activity. The opponent plate sits at the top edge of the table. Below the hand sit my plate, the primary button and Talk. The card action strip doubles as the thumb bar, with 44 pt targets and no key hints.
- **Keyboard.** Every item above has a key. Keys show in tooltips, menus and the gesture sheet, never as text on everyday buttons. Focus is visible on every control.
- **Accessibility.** Seat identity always pairs colour with a shape glyph. Life numbers keep AA contrast in every theme. The activity ticker is the screen-reader live region.

## What goes away entirely

- The "Next game / New draft" corner panel during play (moves to Game over).
- The permanent log column (becomes the activity button and drawer).
- The duplicate zone-count buttons on the player panels (the piles carry the counts).
- The always-on "poison 0" and "+ counter" (they appear only when used).
- Shortcut text on buttons (moves to tooltips and menus).
- The second gear, the separate "Voice off / Join voice / Dictation" buttons and the half-moon theme toggle (they move to the menu or the one Talk button).
- The empty command zone and empty stack box (shown only when used).
