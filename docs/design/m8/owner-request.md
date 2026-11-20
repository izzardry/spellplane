# M8 owner request (verbatim, 20 Nov 2026, about 02:30)

> ok, add another Part to it. pause implementation for now and work through the following request and then resume as stated.
> the whole game presentation and user journey is very soul less and not very well-designed (Style and journey-wise).
>
> The UI presents itself with placed buttons and functions of different sizes, the panels are technical and boxy and the internal ordering of components looks like absent of design.
> the white design lacks depth and tactileness. look into Ztyle and adopt portions of it for the plain design.
>
> The most important part is the missing user journey: the visitor is directly thrown into an arena, with manual configurations to be made and a blocky log being open. that has to be changed.
>
> instead, a landingscreen is the right way to start, similar to Zhess. Instant access to a new game or access to old games.
> options to play against computer or other players. creating a game with multiple players requires first connection and sharing.
>
> also in addition to just setting game parameters and hitting start, the deck building and deck picking is the core activity that happens outside of an active game that is configured without booster draft.
> So the landing page needs to have access to deck building mode with a library of decks and an individual deck creation and modification page. then returning to the landing page, a deck can be selected and should be as present as a blurred-out arena in the background.
> Deck building should prioritize simple decks with clear mana curves and a custom mode where any card can be looked up and picked, or a booster draft mode, where the deck is pre-made from boosters and cannot be customized outside.
> the boosters pack configuration seals the deck building, so it cannot be garnished with custom cards selected from the full library unless it's converted into a custom deck.
>
> then either match making from a queue of players waiting for a matchup that matches the configured setup (1on1, 3 FFA, 2v2 or 4 FFA, and whatever other mode is in order), or a private game is started and shared.
> the match making might require a service to connect to and requires also a match making ranking and a measure of the selected deck's strength to preferably match against other players of comparable decks.
>
> the other mode that's needed is custom with either booster drafted decks that have been created in advance or live booster draft as a round among the players before the game.
> when selecting that, the deck that is picked is replaced by just an illustration of mysterious and closed boosters. by default from the latest core set, but actually a set of boosters could be also configurable, same as the booster-drafted decks that can be pre-built.
>
> live booster draft games are always custom games, while playing ranked games with booster drafted decks that have been pre-built can be done with open match making.
>
> if the match making system cannot be implemented using some webRTC glue service like peer.js, then create a service that temporarily runs locally but would later run on a cloud instance somewhere. explore if there's a middle ground where things like github gists or some free messaging service could be misused for matchmaking. Or peerJS could create a common chat-like space where match making basically happens by announcing and having all others who are currently connected, respond, and then they all broker a matchup in da distributed way. yes, that's the way I'd like it to be. forget the centralized service.
>
> ok, so based on these descriptions of a well-worked out user journey, complete the hole with standard game practices like in Heartstone or Heroes of the Storm, where character selection, configuration and matchmaking are part of the core concept and the landing page or lobby. while the game itself is something that can be played as a game between waiting in the landing page. also leaving a game would not stop it, the state should be saved by everybody in a timed way. so when the game is left, it lands on the history, and can be re-entered. but only if all players reconnect and exchange the saved state has been synced up (where the newest overrides the older states, in case the remaining player or players continued to make some moves). states are saved locally in the browser. and game codes will provide the game's unique identity to reconnect directly via PeerJS to it. no new invitation needed to be sent around. if one player doesn't show up or the browser expunged the local state, re-inviting him via a link or QR code should work from ingame in a specal menu present in each the player state in the respective panel. and if the player rejoins with that link the state is synced by the newest other player joining.
>
> work through this self-relaintly. make decisions by best effort and by leaning on blizzard's excellent examples. create a comprehensive plan outlining a well-researched and designed UI/UX and user journey through the game. add this as the core point to a new Milestone M8 and implement M7 and M8 in one go using workflows and subagents (up to 50). make sure to not mess up the system with memory leaks. connect to /oomph to keep memory usage checked. Using safari in dev mode and puppeteering mode seemed to work just fine. Target is Safari and Chrome. later also a mobile or tablet version, but that can go into M8.
>
> good luck, I'm going to bed. don't timebox it for now, I'll intervene tomorrow once I'm back at the desk. size the tasks in a way that in about 10-12 hours there's a chance the core parts of this are well implemented and can be reviewed by me. use Opus 5.5 high for the implementation and Fable 5.2 high for the planning nad designing part of M8 and the adjustments for M7 that become obsolete as M8 changes things.

References on this Mac (read-only; never edit, commit or push there):
- Ztyle, the izzardry house style: `/Users/holzschneider/Workspace/ztyle` (README.md, docs/01–18, tokens/ztyle.css, index.html, assets/screenshots incl. zhess/).
- Zhess, the izzardry chess game with a landing screen, history and rooms over PeerJS: `/Users/holzschneider/Workspace/zhess` (DESIGN.md, PLAN.md, src/), live at https://izzardry.github.io/zhess/.
