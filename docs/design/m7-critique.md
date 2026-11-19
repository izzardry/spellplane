# Spellplane today: an honest critique

*M7, aspect A1 input. Written for the owner. Every point names the screenshot it comes from and the M7 principle it breaks.*

Screenshots are under `artifacts/shots/` in the main checkout (M0–M5) and in the `m6.1` worktree (M6.1). I give them as `M<n>/<file>`. The card faces in them are test placeholders, so I judge the look around the cards, not the faces.

**The four principles, in short**
- **Obvious first use**: a newcomer can start, play a land, draw, tap and attack without reading anything.
- **Calm table**: the cards are the focus, and the HUD is quiet, grouped and labelled.
- **One design system**: every screen draws on one set of colours, type, spacing and components.
- **Equal input**: mouse, touch and keyboard work equally well, and nothing depends on colour alone.

## The verdict in one paragraph

The owner is right. Spellplane does a lot, and almost all of it is on screen at once at the same volume. Every screen is a page of browser-default form controls: grey boxes, small outlined buttons and monospace key hints. Nobody designed the hierarchy, the spacing or the moment. The table, which should be the hero, is a wireframe rectangle that fills about half the screen. A permanent log takes a fifth of the width, and stacked control panels take the rest. The cards on the battlefield are about 45 pixels tall, while the cards in the hand are 200. The three lit themes add particles and perspective on top of the same clutter. The problem is not the colours. It is that nothing is ranked.

---

## Start page

1. **It has no identity and looks like an unstyled form.** The first thing you read is "Play with friends", with no name, mark or picture of what Spellplane is. The controls are browser defaults: a full-width input, a grey "Create a table" button and a plain "Join" button. *M5/offline-start-page-chromium.png*. **One design system / Obvious first use.**
2. **There is only one way in, and it starts locked.** "Create a table" stays grey until you type a nickname, and the red "Enter a nickname." error shows before you have typed anything. Nothing offers "try it alone", "build a deck" or "open my decks", so solo play is hidden behind the table's "Import deck" button. *M5/offline-start-page-chromium.png*. **Obvious first use.**
3. **Housekeeping comes before play.** The top of the page is a five-line essay on Safari deleting data ("Add Spellplane to your Home Screen"). Below the form come "Check your connection" and a "Storage and backup" block that reports "4.4 MB of about 10.7 GB". A newcomer has done nothing yet and already reads about storage quotas. *M5/offline-start-page-chromium.png*, *M5/home-screen-hint-chromium.png*. **Calm.**
4. **The layers collide.** The offline toast sits on top of the Home Screen banner and hides its heading. Nothing defines what may cover what. *M5/offline-start-page-chromium.png*. **One design system.**
5. **Empty and error states all look alike.** "No deck yet", "Card search unavailable" and "Storage full" share the same bordered box with a coloured left stripe. Red marks both "Image unavailable" (harmless) and "Storage full" (serious). *M5/empty-states-page-chromium.png*. **One design system.**

## Lobby

1. **The invitation is a wall of characters.** Two raw URLs with long secret keys, in monospace fields, take the top third of the screen. The spectator link gets the same weight as the player link, though it is a rare need. *M2/flow-lobby-chromium.png*, *M1/connectivity-failure-chromium.png*. **Calm / Obvious first use.**
2. **There is no order on the page.** Five equal bordered boxes (link, spectators, chairs, you, game settings) give no first, second or third step. "Start the draft" sits alone in its own box on the right, and "Ready" is a grey button at the bottom of another column. You cannot tell whose move it is. *M2/lobby-settings-chromium.png*. **Obvious first use.**
3. **Choosing a deck means pasting text.** The deck is a monospace textarea pre-filled with "4 Llanowar Elves / 20 Forest", plus a "Check" button. Saved decks, the deck you just built and a cover image are nowhere to be seen. *M2/flow-lobby-chromium.png*. **Obvious first use.**
4. **The chairs diagram is mostly empty.** It is a large rectangle with two dashed lines and two small name tags, and it looks like a layout bug, not a table. *M2/flow-lobby-chromium.png*. **Calm.**
5. **The settings are a raw form full of jargon.** The selects are browser defaults. The "A different set per pack" checkbox floats on a line above its label. Pick-timer rules sit in fine print. The text under Ready says "Ready locks your deck and publishes a commitment to it." *M2/lobby-settings-chromium.png*. **One design system / Obvious first use.**
6. **The connection error alarms people.** It is a red-bordered paragraph that talks about relay servers and VPNs before anyone has had time to join. *M1/connectivity-failure-chromium.png*. **Calm.**

## Table HUD

1. **The toolbar is 9 to 13 equal buttons with no ranking.** In two or three wrapped rows top-left: Import deck, Token `Ctrl+T`, Undo `Ctrl+Z`, View `P`, Keys `?`, a gear, a half-moon, Voice off, Join voice, Mute `M`, a second gear, Dictation and Clip. Each has the same outline and size, and most carry shortcut text. Nothing says what to do first. Rare tools (Import deck, Token, Dictation) get the same weight as Undo, and two different gears sit two rows apart. *M4/game-paper-opponent-view-chromium.png*, *M6.1/clip-tray-toolbar-chromium.png*. **Calm / One design system.**
2. **The table is a small box, and the cards on it are tiny.** The log panel takes a fixed ~20% of the width and the player panels sit in a left column, so the battlefield gets about half the screen. Cards on it are ~45 px tall, while the hand below shows 200 px cards. At four players the battlefield cards are thumbnails. *M0/mid-game-board-chromium.png*, *M3/layout-ffa4-seat1-chromium.png*. **Calm.**
3. **The turn strip says little and doesn't move.** It shows Turn, a name, seven phase words of equal weight (Untap … End) and a small outlined "Next turn `Ctrl+Enter`". The highlight sits on "Untap" even on turn 6 and turn 8. Nothing announces "it's your turn", and the main action of the game is the smallest button on the strip. *M4/game-paper-end-chromium.png*, *M4/game-dusk-combat-blocks-chromium.png*. **Obvious first use.**
4. **The player panels are form rows, not life totals.** Life sits between tiny −/+ boxes. "poison 0" and "+ counter" are always shown. Library, Hand, Graveyard and Exile appear as count buttons that repeat the piles already drawn on the table. The opponent's panel is in the top-left corner, far from the opponent's side. *M4/game-paper-opponent-view-chromium.png*. **Calm.**
5. **The table looks like a wireframe.** Zones are empty hairline boxes with letter-spaced labels: LIBRARY, GRAVEYARD, EXILE, COMMAND, STACK. The command zone shows even when no one plays Commander, and the stack lane is a big empty rectangle. *M5/empty-state-no-deck-table-chromium.png*. **Calm.**
6. **Ending the game is always one click away, and the real end has no moment.** "Next game" and "New draft" sit permanently bottom-left during play and overlap the hand on iPad. When a player reaches 0 life, nothing happens. *M4/game-paper-end-chromium.png*, *M5/ipad-portrait-table-chromium.png*. **Obvious first use / Calm.**
7. **The hints block the game instead of guiding it.** The "Welcome to Spellplane" and "Point and press" popovers sit in the middle of the opponent's battlefield, and they are still there on turns 6 and 8. They teach keyboard shortcuts before you have a card in your hand. *M4/game-dusk-combat-blocks-chromium.png*, *M4/game-paper-end-chromium.png*. **Obvious first use.**
8. **The log is noisy and permanent.** "Ann draws a card" appears seven times in a row, and every play is logged twice ("moves Plains to their battlefield", then "turns Plains face up"). The panel never gets out of the way. *M5/radial-menu-chromium.png*. **Calm.**
9. **The themes change the mood, not the quality.** Wyrm and Stonetable push the table into a tilted, distant view with drifting embers. The HUD switches to a serif font in dark boxes with the same clutter. Paper looks like a blueprint. *M5/ego-wyrm-desktop-chromium.png*, *M6.1/clip-wyrm-chromium.png*. **One design system.**

## Card handling

1. **Cards on the battlefield can't be read.** At ~45 px you cannot tell your creatures apart without inspecting each one. *M0/mid-game-board-chromium.png*, *M6.1/clip-paper-chromium.png*. **Calm.**
2. **Stack controls are a second toolbar far from the stack.** "Stack 1 · Resolve `R` · to [Battlefield] Graveyard Exile Hand · Counter `Shift+R`" appears under the turn strip. The OK/Hold pill lands at the bottom and covers the library label. *M1/confirmation-prompt-chromium.png*. **Obvious first use / Calm.**
3. **The radial menu reads like a debug widget.** It is a large white disc of eight equal white circles with two-line text labels ("Tap / untap", "To graveyard", "+1/+1") and a "…" in the middle. It has no icons and no grouping, and it covers the table. *M5/radial-menu-chromium.png*. **One design system / Equal input.**
4. **Inspect has no panel behind its text.** The card's rules text floats on a translucent white veil, over the log text behind it, and mana costs show raw as `{2}{W}{W}`. *M0/inspect-chromium.png*. **One design system.**
5. **The hand is a flat row of big cards.** On desktop the hand is a straight row taller than anything on the table. On touch, the lifted card covers its neighbours and the action bar. *M5/hand-fan-lifted-chromium.png*. **Calm / Equal input.**
6. **There is no visible affordance.** A hovered card shows no hint that it can be dragged or what keys it takes. Labels use house jargon ("Settle", "Ask", "Hold"). Disabled "Resolve" is a dashed outline that looks like keyboard focus. *M5/thumb-bar-chromium.png*, *M5/radial-menu-chromium.png*. **Obvious first use.**
7. **Combat is hard to read.** The attack and block lines are thin and short, and in Wyrm they are lost among the embers. *M4/game-wyrm-combat-blocks-chromium.png*. **Calm.**

## Draft

1. **The pack is too small to read while most of the screen is empty.** Fifteen ~80 px cards fill the top strip, and an empty "POOL · 0" box fills 60% of the screen. *M2/pick-in-progress-chromium.png*, *M5/ipad-draft-pick-chromium.png*. **Calm.**
2. **Taking a card is explained, not shown.** "Click the marked card again or press Enter to take it." is the only affordance, and Take/Clear sit top-right, far from the card. *M2/pick-in-progress-chromium.png*. **Obvious first use.**
3. **The jittered rotation looks careless.** Every card in the pack is tilted a little, so it reads as a rendering glitch, not as a hand-dealt pack. *M5/ipad-draft-pick-chromium.png*. **One design system.**
4. **The other players and the timer are hard to read.** Players appear as two large card backs with "Ann 1", which doesn't say who is waiting for whom. The pick timer has no prominent place. *M2/pick-in-progress-chromium.png*. **Obvious first use.**
5. **Technical panels jump in mid-draft.** An "Audit of game 2" popover about "shuffle nonces" opens over the Rochester table. *M2/rochester-table-chromium.png*. **Calm.**

## Deck builder

1. **The "Table" view can't be read.** Deck columns are overlapping slivers where only 8 px titles show. *M2/builder-sorted-colour-chromium.png*. **Calm.**
2. **There are two builders with two sets of controls.** Table and List are different screens with different filters, and List uses W U B R G M C letter buttons and `{3}{R}{R}` raw cost text. *M2/list-view-chromium.png*. **One design system.**
3. **The primary action isn't primary.** "Ready" is a small outlined button top-right. "New draft", which throws the draft away, sits in the status bar right next to "Build your deck and press Ready". *M2/builder-sorted-colour-chromium.png*. **Obvious first use.**
4. **The basic land helper speaks in set numbers.** Its selects read "M19 #261", and how-to text sits in a grey paragraph at the bottom of the panel. *M2/list-view-chromium.png*. **Obvious first use.**

## Settings, menus, dialogs, notices

1. **The same thing is shown in two different designs.** Keyboard shortcuts appear in a cheat sheet with underlined "change" links and in a Settings tab with boxed "Change" buttons. The content is the same, the look is not. *M0/cheat-sheet-chromium.png*, *M5/settings-panel-keys-chromium.png*. **One design system.**
2. **Settings overlap other panels.** Settings opens as a panel beside the welcome hint, with no backdrop and no single place for dialogs. Voice has its own toolbar panel and also a Settings tab. *M5/settings-panel-keys-chromium.png*, *M3/voice-panel-open-chromium.png*. **One design system.**
3. **The voice panel is a raw form.** Its controls are browser-default radios, selects and range sliders, and some options make no sense to a player ("Talk mouse button: None"). *M3/voice-panel-open-chromium.png*. **One design system.**
4. **Every notice is a paragraph in a striped box.** Notices of different importance look the same, and many have three lines of technical text. *M5/empty-states-page-chromium.png*. **Calm.**

## iPad

1. **The HUD wraps apart.** The toolbar breaks into four rows. Phase names wrap ("Main / 1", "Next / turn"). The log shrinks to a lone input box. *M5/ipad-portrait-table-chromium.png*. **Equal input.**
2. **The table cards are tiny on a large screen.** The battlefield cards are ~45 px on a 1668 px-tall iPad, and the hand is cut off at the bottom. *M5/ipad-portrait-table-chromium.png*. **Calm / Equal input.**
3. **"Next game / New draft" covers the hand.** *M5/ipad-portrait-table-chromium.png*, *M5/hand-fan-lifted-chromium.png*. **Equal input.**
4. **The thumb bar ignores context.** "Attack · Settle · Resolve · Ask · Talk" always shows five same-size pills, even with nothing selected and no stack, and one of them is dashed. *M5/first-run-hint-touch-chromium.png*. **Obvious first use / Equal input.**
5. **Desktop-only key hints show on touch.** "Mute `M`" and other key hints appear on a device with no keyboard. *M5/ipad-landscape-table-chromium.png*. **Equal input.**

---

## Top 10, ranked by how much they hurt a first evening

1. **Nothing says what to do first.** The start page leads with storage and Home Screen essays and a locked "Create a table". The table greets you with 9 to 13 equal buttons, seven equal phase words and a popover about keyboard shortcuts. A newcomer has no first move. *(start page, table HUD)*
2. **The cards are not the hero.** Battlefield cards are ~45 px in a half-screen wireframe box, framed by a permanent log column and stacked panels. You cannot read your own board. *(M0/mid-game-board, M3/layout-ffa4)*
3. **No design system.** Every surface is browser-default controls with outlines, monospace shortcut text and ad hoc boxes, and each screen invents its own buttons. This is most of why it looks "ugly". *(all screens)*
4. **The turn has no rhythm.** There is no clear "your turn" moment, the phase strip is stuck on Untap, and "Next turn" is a small key-labelled button. Turn flow, the heartbeat of a game, is invisible. *(M4/game-paper-end)*
5. **The lobby is a form, not an invitation.** Raw secret URLs, a pasted-text deck, five unordered boxes and a lonely grey "Ready". *(M2/flow-lobby)*
6. **The life totals and zones are clutter, not information.** The panels repeat the piles, always show poison 0, sit far from their seat and hide life between tiny −/+ boxes. *(M4/game-paper-opponent-view)*
7. **The hints block the game.** Welcome and key hints sit over the opponent's battlefield for the whole game and teach keys instead of gestures. *(M4/game-dusk-combat-blocks)*
8. **The touch layout falls apart.** The toolbar wraps on iPad, "Next game" covers the hand and the thumb bar ignores context. *(M5/ipad-portrait-table)*
9. **Destructive actions sit next to everyday ones.** "Next game / New draft" is always on screen during play, and "New draft" sits beside the builder's main instruction. *(M4/game-paper-end, M2/builder-sorted-colour)*
10. **Draft and builder can't be read.** Packs and deck columns are too small to read, half the screen is empty, and the two builder views behave differently. *(M2/pick-in-progress, M2/builder-sorted-colour)*

**What is good and worth keeping:** the turn-and-attribution log (once it is quieter), seat colours paired with shapes, the stack's per-player cascade, the inspect view's large readable card, the mana curve in the builder, and the idea of a thumb bar for touch.
