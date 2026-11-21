# M8 contracts and the rulings of revision 1

Written by the lead planner after the plan review (20 Nov 2026). Two jobs:

- **Parts A to F** are the specification of the contracts agent M8-C wherever the topic designs left a shape open or the review changed one. Together with PLAN "M8-C contracts" and `m7-adjustments.md` section 2 they are complete: M8-C invents no shape.
- **Part G** lists, per topic, the rules the review changed. It overrides the topic files (each topic file's rulings block points here).

Where this file and a topic file differ, this file holds.

## A. How contracts are landed and changed

1. **One contracts agent, two commits.** `feat(m8-c): core contracts` (core, net, store, session, data, lint, test config; no file under `src/ui`) with `pnpm check` green, then `feat(m8-c): ui contracts and frame` (kit seed and stubs, routes, URL builders, the app frame) with `pnpm check`, gates M0, M1 and M5 and `tests/e2e/themes/view-settings.spec.ts` green. After the second commit M8-C reads its own diff once against PLAN's contract table and this file, as a reviewer would, and fixes what is missing before it hands back.
2. **Contract files** are `*/types.ts`, `core/actions.ts`, `net/messages.ts`, `src/ui/props.ts`, `src/net/lobby/messages.ts`, `src/ui/design/tokens.ts` and the props of every kit component.
3. **Additive edits are allowed** to a contract file by any package: a new optional field, a new optional prop, a new union member that every existing `switch` already ignores, tagged with a comment `// [M8-P5]` on the same line. Never a rename, a removal, a changed meaning or a required member. The integrator merges contract files by union (both sides' additions are kept). Anything else is reported in the package's return value and waits for M8-P8 (journey integration), which may change a contract because every package is merged by then.
4. **`.gitattributes`** (new, by M8-C): `docs/DECISIONS.md merge=union`. Twelve agents append to that file.
5. **Leak tests are collected by name.** `vite.config.ts` includes only `tests/unit/**/*.test.ts`, `tests/sim/**/*.test.ts` and `src/**/*.test.ts`; `tests/leak/` holds helpers only. M8-C creates each file below with one `it.todo` per scenario, so it exists and is collected from the start; the owner replaces every `todo`. `tests/unit/m8-contracts.test.ts` asserts that each file exists; M8-P8 and the gate assert that none of them holds a `todo`.

| File | Owner | Scenarios |
| --- | --- | --- |
| `tests/unit/decks/queue-leak.test.ts` | M8-P3 | `queueDeckInfo` holds six facts and no card id, name or colour |
| `tests/sim/flow/leak-lobby.test.ts` | M8-P4 | no waiting-room message or state carries another player's deck name or list |
| `tests/sim/resume/leak-rejoin.test.ts` | M8-P5 | PL-1, PL-2, PL-3, PL-4, PL-6, PL-7, PL-9 (Part G) |
| `tests/sim/bot/leak.test.ts` | M8-P6 | the bot session and the human session see nothing hidden of each other; `BotView` |
| `tests/sim/lobby/leak.test.ts` | M8-P7 | a search through to a formed match carries only `QueueDeckInfo` about a deck |

## B. Kit components: final props

The kit is `src/ui/design/`. M8-C lands every component below with these props and plain working markup that carries the class names `visual.md` 2.8 and `mock.html` use; M8-P1 gives them their look and never renames a prop, a class or a `--ds-*` variable. "Children" is the default snippet. Every component passes unknown attributes (`data-testid`, `aria-*`) to its root. Sizes: `Size = 'xs' | 'sm' | 'md' | 'lg'` (28, 36, 44, 56 px).

| Component | Props |
| --- | --- |
| `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'quiet' \| 'danger'` (default `secondary`), `size?: Size` (default `md`), `pressed?: boolean`, `waiting?: boolean`, `disabled?: boolean`, `type?`, `href?: string` (renders a link), `onclick?`, `icon?: Snippet`, `trailing?: Snippet` (the timer of a waiting button), children |
| `IconButton` | `label: string` (accessible name and tooltip), `size?: Size`, `variant?` as `Button`, `pressed?`, `disabled?`, `onclick?`, children (the icon) |
| `Segmented` | `options: { value: string; label: string; disabled?: boolean; hint?: string }[]`, `value: string` (bindable), `size?: 'sm' \| 'md'`, `label: string`, `onchange?: (value: string) => void` — [M8-P1] with `onchange` the control is controlled: it reports the pick and shows the `value` its parent passes back (a parent that refuses a pick keeps its option), so a parent that passes `onchange` sets `value` in it and does not also rely on `bind:value`; without `onchange` it writes `value` itself (`bind:value`) |
| `Field` | `value: string` (bindable), `label: string`, `placeholder?`, `readonly?`, `square?: boolean` (link field), `icon?: Snippet`, `trailing?: Snippet`, `oninput?`, `onenter?` |
| `Stepper` | `eyebrow?: string`, `value: string`, `onprev: () => void`, `onnext: () => void`, `prevLabel: string`, `nextLabel: string` |
| `Chip` | `variant?: 'fill' \| 'line' \| 'on'`, `size?: 'xs' \| 'sm'`, `onclick?` (a button when given), `pressed?`, children |
| `Pip` | `colour: 'W' \| 'U' \| 'B' \| 'R' \| 'G' \| 'C'`, `size?: number` (px, default 16) |
| `SeatGlyph` | `seat: number` (0 to 3), `colour: string`, `size?: number`, `computer?: boolean` (hexagon), `label?: string` |
| `PresenceDot` | `state: 'here' \| 'connecting' \| 'away'`, `label?: string` |
| `StrengthPips` | `band: 1 \| 2 \| 3 \| 4 \| 5 \| null`, `score?: number`, `label?: string` |
| `Badge` | `tone?: 'ink' \| 'muted' \| 'danger' \| 'success'`, `onCard?: boolean`, children |
| `StatusLine` | `tone?: 'muted' \| 'danger' \| 'success'`, `icon?: Snippet`, children |
| `Sheet` | `label: string`, `width?: 'full' \| 'narrow'`, `onclose?: () => void`, `header?: Snippet`, `footer?: Snippet`, children |
| `Panel` | `eyebrow?: string`, `title?: string`, `actions?: Snippet`, `footer?: Snippet`, children |
| `MenuPopover` | `open: boolean` (bindable), `anchor: HTMLElement \| null`, `groups: MenuGroup[]` (`MenuGroup = { title?: string; items: MenuItem[] }`, `MenuItem = { id: string; label: string; hint?: string; danger?: boolean; disabled?: boolean; run(): void }` in `src/ui/design/menu.ts`), `top?: Snippet<[() => void]>`, `placement?: 'above' \| 'below' \| 'auto'`, `label: string` |
| `Toast` | `kind: 'undo' \| 'request' \| 'status' \| 'info'`, `text: string`, `detail?: string`, `actions?: { label: string; primary?: boolean; run(): void }[]`, `onclose?` |
| `ToastHost` | `place?: 'bottom-centre' \| 'above-primary'`; reads `src/ui/design/toasts.ts`: `toasts.undo(text, undo, opts?)`, `toasts.info(text, action?)`, `toasts.request(text, { allow, decline })`, `toasts.status(text \| null)`, `toasts.clear()` |
| `CoachMark` | `anchor: HTMLElement \| null`, `title: string`, `text?: string`, `placement?: 'above' \| 'below'`, `ondismiss: () => void` |
| `Dialog` | `open: boolean` (bindable), `label: string`, `onclose?`, `footer?: Snippet`, children |
| `QrPlate` | `matrix: boolean[][] \| null`, `size?: number` (px, default 184), `label: string` |
| `PileStack` | `count?: number` (thickness, 0 to 60), children (what lies on top) |
| `SealBand` | `packs: string` (for example `M19 × 6`), `label?: string` |
| `Sparkline` | `values: number[]`, `label: string` |
| `CurveChart` | `creatures: number[]` (eight columns, 0 to 7+), `others: number[]`, `target?: number[]`, `size?: 'full' \| 'small'`, `label: string` |
| `ColourBar` | `symbols: Partial<Record<'W' \| 'U' \| 'B' \| 'R' \| 'G', number>>`, `sources?: Partial<Record<'W' \| 'U' \| 'B' \| 'R' \| 'G', number>>` |
| `CardFan` | `cards: { src: string \| null; alt: string }[]` (front first, at most five), `width?: number` (px of the front card), `label: string` |
| `ModeCard` | `value: string`, `name: string`, `meta?: string`, `selected: boolean`, `locked?: boolean`, `onselect: () => void`, `icon?: Snippet` (a radio in a `role="radiogroup"` the parent provides) |
| `Countdown` | `seconds: number` (remaining; the parent steps it), `total: number`, `size?: number`, `label: string` |
| `BoosterPack` | `set: string`, `index?: number`, `width?: number` |
| `BoosterFan` | `sets: string[]` (one per pack shown, at most three drawn), `count?: number`, `width?: number`, `label: string`; `packArt(setCode, index)` in `src/ui/design/pack-art.ts` |
| `TableThumb` | `thumb: GameThumb \| null`, `seats: { colour: string; life?: number; computer?: boolean }[]`, `width?: number` |

Recipes without a component (the queue bar, a seat row, a history row, a plate, the turn tracker, a deck tile, a deck list row) are class recipes in `base.css`; the screen that uses one builds it from kit components and those classes.

## C. The frame and its seams

**Routes** (`src/ui/routes.ts`): `home` (`''`, `#/`), `decks`, `deckNew` (`path?`), `deck` (`id`), `deckOpen` (`id`), `history`, `practice` (`#/p/<room>`), `computer` (`#/c/<room>`), `solo` (`#/solo`), `room` (`#/t/<room>/<key>` with `watch?` and `rejoin?: { seat, token }`), `settings`, `about`, `diag`, and **`lobby` (`#/lobby`), which keeps rendering the legacy `StartPage`** (frozen, linked from nowhere, deleted in a later round together with the specs that use it). `#/build[/<id>]` goes to Decks.

**Shell** (`src/ui/shell/Shell.svelte`, stub by M8-C, then M8-P2): props `route`, `settings`, `matchmaker`, `games`, children (the page). `App.svelte` wraps Home, Decks, History, Settings, About and Diag in it; a table route is not wrapped.

**Table frame** (`src/ui/table/TableFrame.svelte`; a working simple version by M8-C, finished by M8-P8). Every table route renders it; no route builds `HudShellProps` itself.

```ts
export interface TableFrameProps {
  session: TableSession;
  kind: 'room' | 'matched' | 'computer' | 'practice' | 'sandbox';
  code: string | null;                 // the game code (room id); null in the sandbox
  games: GameStore | null;             // null when storage cannot be opened
  /** false for computer and practice tables: no Gathering, no seat presence, no invite entries. Default true for 'room' and 'matched'. */
  gather?: boolean;
  /** Extra shell members of the route (the computer game's cue button, badge and plate menu). The frame merges them over its own. */
  extraShell?: Pick<HudShellProps, 'primaryOverride' | 'plateBadge' | 'plateMenuTop' | 'menuTop'>;
  onleave: () => void;                 // src/ui/play/leave.ts
}
```

The frame chooses, by stage and kind: the waiting room (`WaitingRoom`), the matched entry (`MatchedEntry`, when a `MatchRecord` exists for the code), `Versus` (while the automatic setup runs), the draft and build stages, the HUD (inside `Gathering` when `gather`), and `GameOver` when `TableState.result` is set. It builds `HudShellProps` from `onleave`, `src/ui/table/menu-top.ts`, `SeatMenu`, `SeatBadge`, `presence.ts`, the notice store and `extraShell`. It starts `createCheckpointer(session, games)` on mount and stops it on unmount. `SoloRoute.svelte` (`#/p/<room>`) and `ComputerRoute.svelte` (`#/c/<room>`) open their session and render the frame; the sandbox (`#/solo`) renders it with `kind: 'sandbox'`.

**Leave** (`src/ui/play/leave.ts`, M8-P2): `leaveTable({ session, kind, code, games, go })` runs `checkpoint('leave')`, `session.leave()`, disposes, navigates Home and shows one toast. Copy by kind: networked `You left the table. The game goes on; your seat is kept.` with `REJOIN`; computer and practice `Game saved. Continue any time.` with `CONTINUE`. A solo game with fewer than 10 own actions is purged instead and shows no toast.

**`TableSession.leave(): Promise<void>`** (contract, `session/types.ts`): a solo session resolves at once; M8-C's networked default is today's dispose path; M8-P5 makes it send `bye { reason: 'leave' }`.

**Lifecycle counters** (`src/util/lifecycle.ts`, implemented by M8-C; `src/scene/lifecycle.ts` re-exports the context functions):

```ts
export type LifeKind = 'contexts' | 'sessions' | 'engines' | 'transports' | 'audioContexts' | 'workers' | 'rafLoops' | 'botRunners' | 'timers';
export function track(kind: LifeKind, what: object): void;       // idempotent per object
export function untrack(kind: LifeKind, what: object): void;
export function live(): Readonly<Record<LifeKind, number>>;
/** Called by a renderer's owner right after renderer.dispose(): what info.memory and info.programs still held. */
export function reportResidue(r: { geometries: number; textures: number; programs: number }): void;
export function residue(): { geometries: number; textures: number; programs: number; disposals: number };  // sums since load
```

`RenderDebug.liveContexts()` is `live().contexts`; `RenderDebug.memory()` returns `{ ...residue(), ...live() }`; `RenderMemory` is that shape. M8-C adds the `track` / `untrack` calls to the code that exists on `m8` (solo and networked sessions, the engine, both transports, the face-decode worker, the table scene's renderer and frame loop, the HUD's audio context). Owners keep them correct in their files afterwards: M7-P1 the renderers (table scene, `scene/draft.ts`, `scene/builder.ts`, `scene/stage.ts`, the still) and frame loops, M7-P5 the audio context, M8-P5 sessions and engines, M8-P6 bot runners and `LocalNetwork`, M8-P7 the lobby transport. `timers` is for long-lived intervals a module owns (checkpointer, matchmaker beat, bot runner). The rule every test asserts: on Home every count is 0 and `residue()` is all zeros.

**Debug hook** (`src/debug/index.ts` stays M8-C's): it registers `mm`, `bot`, `decks`, `games`, `home` by calling `registerMmDebug`, `registerBotDebug`, `registerDecksDebug`, `registerGamesDebug`, `registerHomeDebug` from `src/debug/mm.ts`, `bot.ts`, `decks.ts`, `games.ts`, `home.ts` (stubs by M8-C; owners M8-P7, M8-P6, M8-P3, M8-P2, M8-P2). No package edits `index.ts`.

**Harness pages**, one per package, so acceptance never needs another package's code: `?harness=kit` (M8-P1), `?harness=ui` (M7-P2, with `setShell(partial)`), `?harness=scene` (M7-P1, M7-P5), `?harness=home` (M8-P2: Shell and Home over fake stores and a fake matchmaker with `setStatus`), `?harness=history` (M8-P2), `?harness=decks` (M8-P3, over the fixture card source), `?harness=lobby` (M8-P4: the waiting room, sheets, versus and overlay over a fake room model), `?harness=gather` (M8-P5: Gathering, SeatMenu and SeatBadge over a fake `SessionMuster`), `?harness=computer` (M8-P6: a computer game mounted on the frame), `?harness=match` (M8-P7: queue chip and match-found card over a fake status). M8-C registers the names in `src/main.ts`'s harness table with a stub `mount`; each owner writes `src/ui/<area>/harness.ts`.

## D. Core and wire

```ts
// core/types.ts
interface Seat {
  conceded?: boolean;
  invite?: { h: string; by: SeatId; atSeq: number; exp: number };
  takeovers?: number;
  /** The game number (TableState.games ?? 0) for which this seat's opening hand was dealt. Set by `dealt`. */
  dealt?: number;
}
interface TableSettings {
  autoSetup?: boolean;
  /** Set by enterMatch for a game formed in the public lobby: no seat invites, rating rules apply. */
  matched?: boolean;
}
interface TableState { result?: GameResult }   // { winners: SeatId[]; reason: 'concede'; atSeq: number }

// core/actions.ts (all family 'players', not undoable)
type ConcedeAction    = A<'concede', {}>;
type SeatInviteAction = A<'seatInvite', { seat: SeatId; h: string | null; exp?: number }>;
type SeatClaimAction  = A<'seatClaim', { seat: SeatId; claim: string; peer: string; name: string }>;
type PlayOnAction     = A<'playOn', { without: SeatId[] }>;      // `without` may be empty
/** The seat marks its opening hand as dealt for game `game`. Refused when Seat.dealt === game. */
type DealtAction      = A<'dealt', { game: number }>;
```

- **`concede` is implemented by M8-C** in `core/reducer/result.ts` with its unit tests (1v1: the other seat wins; free-for-all: the seat is out, the game ends when one seat is left; 2HG: when both of a team conceded). `src/session/result.ts` has `concede(session)` and `resultOf(state)`. Three packages need the result, so it must not wait for one of them.
- **Hooks in `core/reducer/table.ts`** (file stays M8-C's): `turnPass` skips a seat for which `isOut(state, seat)` (exported by `result.ts`) is true; `away`, `seatLeave` and `playOn` call `onPresence(draft, seat, present)` exported by `core/reducer/rejoin.ts` (M8-P5 fills it: it clears `Seat.invite`).
- **`seatInvite`, `seatClaim`, `playOn`** are registered and refuse with a reason until M8-P5 fills `rejoin.ts`. `seatInvite` is refused for good when `settings.matched`.
- **The play count.** `play` counts the applied actions that are a player's move: every action except chat, typing and presence lines, the `players` family (`away`, `seatInvite`, `seatClaim`, `playOn`, `seatTake`, `seatLeave`, …) and the sequencer's own records (`sequencerClaim`). `isPlayAction(action)` in `src/core/log.ts` is the one definition (M8-C, unit-tested over every action type). The engine keeps `play` beside `seq` in every retained state and in the saved snapshot; M8-C adds the field and the counting, M8-P5 uses it.

```ts
// net/messages.ts, PROTOCOL_VERSION = 4
type HelloMessage = /* as today, plus */ { lastPlay: number };
type HeadMessage = Envelope<'head', { seq: number; play: number; h: string; turn: number; stage: Stage; live: boolean; saving: boolean }>;
// bye.reason gains 'leave'; NonceKind gains 'claim'

// session/types.ts
interface KnownHead { play: number; seq: number; peer: string; seat: SeatId | null }
// net session internals (src/session/net.ts)
interface NetSessionInternals { /* as today, plus */ neverAlone?: boolean }
```

- **Newest** is decided by `(play, seq, peerId)`: more moves wins; then the higher `seq`; then the smaller peer id (the engine's present tie rule, kept). M8-C changes the comparison in `deferTo()` to read `lastPlay` first (a peer without the field compares by `lastSeq` as before).
- **`neverAlone`** (implemented by M8-C in `src/session/net.ts`): the session never starts a table of its own, however long no peer answers. `openRoom` in `src/main.ts` sets `createdHere` when the room's `MatchRecord` names this identity in seat 0, and `neverAlone` for every other member of a matched room and for a route with `rejoin`.
- **Opening hands** (`src/session/entry.ts`, implemented by M8-C, unit-tested over `LoopbackNetwork` with two and four sessions): `importIfNeeded(session, deck)` imports and commits the deck only when the seat has none committed; `dealOpening(session)` shuffles, draws seven and dispatches `dealt { game }` in one group, and does nothing when `Seat.dealt` already equals the current game number; `rollFirstPlayer(session)` (creator or seat 0 only, once per game); `enterMatch(session, plan)` (seat, colour, `autoSetup`, `matched`, then the two steps above). Tests: a deck committed at Ready is then dealt once; a reload in the middle of the deal deals the rest once; a second game deals again.

## E. Store, session, lobby

- `MatchRecord` gains `deckId: string` (the deck the ticket was made for) and `rated?: { key: RatingKey; before: number; after: number }`. While a search runs the selected deck is locked (Home's arrows and `CHANGE DECK` are disabled; the tile action `PLAY` in Decks answers `Cancel the search to change deck.`).
- `GameSummary` gains `ended?: 'result' | 'replaced'` and `actions: number` (own actions, for the purge rule). `GameStore` gains `endOlderSolo(keep: number): Promise<void>` (M8-P2 implements; M8-C's stub resolves).
- `createCheckpointer(session, games): { stop(): void; now(reason): Promise<void> }` in `src/session/checkpoint.ts` (stub by M8-C: both no-ops; M8-P2 implements).
- **Lobby realm** (`src/net/lobby/types.ts`, constant chosen by M8-C): `preview` when `__SPELLPLANE_PREVIEW__`, else `dev` when `__SPELLPLANE_DEBUG__`, else `live`. The three never meet.
- **No relay by accident in tests** (`src/session/transports.ts`, M8-C): in a test build (`dist-test`) `createPageTransport` uses Trystero only when the URL says `?transport=trystero`, which only the `@network` specs do; without a flag the test build uses the local transport. Production and dev builds are unchanged.
- Lobby validators (`src/net/lobby/validate.ts`) are M8-P7's; M8-C lands the message and type shapes only.

## F. What M8-C does not do

No real screen, no look, no bot, broker, muster or deck logic, no region markers in `src/scene/table-scene.ts` (the M7 branches rewrite those regions; markers would only add conflicts). It does not merge any M7 branch beyond the contract edits listed in `m7-adjustments.md` section 2.

## G. Rules changed by the review

### Rejoin (persistence.md)

1. **Team seats.** Only a teammate may ever invite a team seat. With the whole team away the others use `PLAY ON WITHOUT …`; there is no "any present player" exception. After any `seatClaim`, every teammate's browser **withholds `teamHand` from that seat** until its player confirms a prompt on the plate: `Ben is back from a new browser (link made by Cy). Show him your hand?` · `SHOW` · `NOT YET`. `src/session/team.ts` is M8-P5's.
2. **Newest wins by moves, not by sequence numbers.** The comparison is `(play, seq, peerId)` (Part D) in `deferTo`, in the muster rule and in `knownHead`. A stale browser that chatted alone no longer beats a copy with more moves. Gathering copy: `The table with more moves is kept; the other side's moves are played again on top where they still fit.`
3. **`knownHead`** is `{ play, seq, peer, seat }`. It is cleared when a `seatClaim` replaces that peer (its copy is gone for good) and when `playOn` is applied.
4. **`playOn { without: [] }`** is legal when every seat that is not away is connected: the button reads `PLAY ON WITH THIS TABLE` and is offered when rule 3 fails only because of `knownHead`.
5. **Standby and the sequencer.** A standby browser may claim the sequencer role and sequences exactly `seatInvite`, `seatClaim`, `playOn`, chat, and `away false` for seats that are connected. It marks nobody away and proposes nothing else until it is live.
6. **A claim on the wrong device.** The claim page says, above its buttons: `If another browser of yours still has this game, open the link there. Sitting down here discards that hand.` The page has no filled button: `SIT DOWN HERE AS BEN` is a ghost button and `NOT NOW` (to Home) stands beside it. The sequencer refuses a `seatClaim` while the seat's previous peer is connected (`Ben is still connected from his other browser.`).
7. **Invites need absence.** The sequencer accepts `seatInvite` only when it has seen the seat away for 30 seconds on its own clock (`awaySince` kept in memory per seat; a new sequencer starts the 30 seconds again). Matched games (`settings.matched`) take no invite at all and show no `BRING BACK`.
8. **Leak scenarios tonight:** PL-1, PL-2, PL-3, PL-4, PL-6, **PL-7** (a split, both sides advance, the copy with more moves wins, own actions replayed) and the new **PL-9**: 2HG, both players of team B away; an opponent's `seatInvite` for a B seat is refused; and, with a teammate-made invite, a claimed seat receives no `teamHand` until the teammate confirms. Each is shown to fail when its leak is injected.
9. **Sim rows added** to `tests/sim/resume/muster.test.ts`: Ben announced a newer head, lost his storage and re-seated by link: Ann becomes live (item 3); the same with `PLAY ON WITH THIS TABLE` (item 4); three browsers all on standby, one presses `PLAY ON` (item 5); a stale browser with four chat lines against a copy with three more moves (item 2).

### History and saving (persistence.md; built by M8-P2)

1. Starting a solo game (`SPARRING` or `ALONE`) marks older unfinished solo games ended (`ended: 'replaced'`) and keeps the newest three resumable (`GameStore.endOlderSolo(3)`).
2. Leaving a solo game with fewer than 10 own actions purges it.
3. History's default filter is `ALL` without ended solo games; `FINISHED` shows them.
4. Tonight's History is one list (newest first) with the filter `ALL │ UNFINISHED │ FINISHED`; the groups Today / This week / Earlier, summaries for pre-M8 tables and the detail column are later.

### Matchmaking (matchmaking.md)

1. **Broker rule 8** is replaced: after a `pass` with reason `window`, the anchor may offer that member set again from the next row boundary (10, 20, 40, 60, 90 s) of any member's wait, at most 5 s later; `unreachable` still blocks until a link changes. A member judges an offer with 2 s of slack on the others' waiting time.
2. **Arrival.** A member that entered `moving` and is not connected to every other member within 30 s returns to `seeking` with its waiting time kept; nobody ever ends in two rooms. Both are part of the property test.
3. **A matched room has a creator:** seat 0 of the plan creates the table; the others never sit alone (Part D).
4. **Ranked honesty.** No rating change for a game with `takeovers > 0` or a recovery on either seat. The absence claim stays later, so the ranked option carries the line `Ranked counts only when the loser concedes.` in Home's status line while it is selected.
5. **Before the first search** Home's status line reads: `Connects your browser directly to other players who are looking. They see your name and network address.`
6. **Realm** `preview` for the preview build (Part E).
7. **If the night runs short** (PLAN's cut line): the 2HG and 3 FFA queues go first; 1v1 and 4 FFA stay.

### Decks (decks.md)

1. **`FROM BOOSTERS` ends on a finished deck:** after the reveal the suggestion is applied (`autobuild`), so the pool page opens with 40 cards in `MAIN` and the rest in the pool: the deck is "pre-made from boosters" and playable at once. `SUGGEST A DECK` rebuilds it.
2. **A fourth chooser entry, `SIMPLE DECK`:** pick one of five colours; `buildStarterDeck` (M8-P6) makes 17 lands and 23 creatures on a clear curve; saved as a custom deck. While the generator is a stub the entry is disabled with `Not in this build yet.`
3. **The `SIMPLE DECK` mark** is built tonight: `isSimpleDeck(analysis)` (one or two colours, at least 15 creatures per 40 cards, lands within 1 of the suggestion, at most 4 cards of mana value 5 or more per 40) shows the chip `SIMPLE DECK` on the tile and the deck page.
4. **A deck that may not be picked** (the picker's `allow`): the tile's text and well are dimmed and a badge gives the reason; **the card face keeps full opacity**.
5. **The seal band** sits in the well below the cover card's lower edge and never crosses a card face.
6. **Later, and said to the owner:** a solo pick-and-pass draft against simulated drafters. "Booster draft mode" tonight means opening boosters (a sealed pool) alone, or a live draft at a table.
7. The build stage's seal after a live draft and saving a drafted pool to the library move to later.

### Computer opponent (computer.md)

1. **The cue shows whenever** one of the human's cards is marked attacking, in any phase.
2. **One tip survives the cut** as a coach mark on the primary button, once per profile: `Press ATTACK so Sparring can block and count the damage.`
3. **Sparring concedes by itself:** when its life is 0 or less after it booked damage (or the human set it), it proposes `concede`. The human at 0 life gets the `ConcedeChip` as planned.
4. **The starter recipe** (section 8.1) holds in full: 40 cards, 17 lands, mana-value slots 3 / 7 / 6 / 4 / 2 / 1, up to 2 copies, classes A and B first and **class C to fill a slot**, a slot that cannot be filled borrows from the nearest. "23 creatures with no or keyword-only text" was a shorthand and is wrong for the M19 fixture (no colour has 12 such creatures). Tests pin green.
5. `ComputerRoute.svelte` renders the table frame with `kind: 'computer'`, `gather: false` and `extraShell`; it builds no shell props, leave, overlay or persistence of its own.

### Journey and Home (journey.md)

1. `#/lobby` keeps the legacy start page (Part C); nothing links to it.
2. The leave toast for a solo game reads `Game saved. Continue any time.`
3. `dealIn` is replaced by `importIfNeeded` and `dealOpening` (Part D).
4. The 500 ms camera move into a table is later; tonight the still cross-fades to the table (150 ms).
5. The table frame and the cross-package journey belong to M8-P8; M8-P2 builds the shell, Home and History.

### Visual (visual.md, mock.html)

1. **The arena still is properly soft:** the frame is halved repeatedly on 2D canvases down to one sixteenth of its width, box-blurred there three times (radius 2 px, by pixel loops), and scaled up by the browser when shown. No CSS filter and no canvas `filter`.
2. `mock.html` uses `filter: blur()` once, on the drawn arena, as a sketch; it is not a recipe. `tests/unit/design/no-adhoc.test.ts` scans all of `src/` for `blur(` and `backdrop-filter`.
3. `.locked` in the mock dims a whole tile; in the app only text and well are dimmed (Decks item 4).
4. **In-table and stage panels are swept tonight, by their owners**, to kit classes and the four heights (no restructuring): M7-P2 the context menu, inspect, pile viewer, token search, cheat sheet, confirm prompt, chat and audit panels; M8-P5 the recovery panel; M8-P3 the build stage; M8-P4 the draft screens. Settings, storage, about and diag stay later.
