<!--
  The table HUD (PLAN M0-P4): screen-anchored layer over the scene (DESIGN "Camera and navigation", Screen-anchored
  layer) with hand fan, pile viewers, context menu, keymap and cheat sheet, inspect, avatars, turn strip, log and chat,
  deck import and token search. It changes shared state only through TableSession and moves the camera only through
  TableScene.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { mergeTimeline, type ChatTab } from '../core/log';
  import type { Anchor, CardInstance, Seat, CardRef, InstanceId, LogEntry, StackItemId, ZoneId } from '../core/types';
  import type { CardData } from '../data/types';
  import type { ActionId, KeyChord, KeyContext } from '../games/types';
  import { perspectiveToggleTilt, type ActivePing, type TableScene, type ViewState } from '../scene/types';
  import type { PileHover, SelectionAnchor } from '../scene/types'; // M7-P5
  import { resolveMotion } from '../scene/types'; // M7-P5
  import { attachPresence, type PresenceHandle } from '../scene/presence';
  import { hoveredStackItem } from '../scene/stack';
  import type { LookedCard } from '../session/types';
  import type { KeymapOverride } from '../store/types';
  import { cssText } from '../themes/index';
  import type { SeatAnchor } from '../scene/types';
  import './design/kit';
  import { hudLook, lookCssVars } from './design/css';
  import { lookContext } from './design/look';
  import Icon from './design/Icon.svelte';
  import Button from './design/Button.svelte';
  import Dialog from './design/Dialog.svelte';
  import HudMenu from './hud/HudMenu.svelte';
  import { menuWithShell, shellGroups } from './hud/menu-model';
  import './hud/hud.css';
  import NoDeck from './hud/NoDeck.svelte';
  import OpeningHand from './hud/OpeningHand.svelte';
  import ViewControl from './hud/ViewControl.svelte';
  import { gameNumber, openingHandShown, ownTurnEnded } from './hud/opening';
  import { passTarget, primaryAction } from './hud/turn';
  import { tickerText } from './hud/ticker';
  import { hudMenu, type HudMenuId } from './menu';
  import { proposals, PROPOSAL_LABELS } from './flow/model';
  import { Commands, isEmptyChair, isOwnTurn, nextActive, promptKeys, promptShowing, roundPassed, untapOfferOnOpen, type UiHooks } from './commands';
  import ConfirmPrompt from './confirm/ConfirmPrompt.svelte';
  import { promptModel, roundWhat } from './confirm/model';
  import { parsePlainList } from './deck';
  import { logLines } from './describe';
  import Flashes from './chat/Flashes.svelte';
  import { typersOf, typingSeats, type Typer } from './chat/typing';
  import { addPending, LogWatch, prunePending } from './chat/watch';
  import { inZoneKind, layoutOf } from './geometry';
  import { fitInsets as fitInsetsFor, handOrder, type FanSpan } from './hand';
  import { LAYOUT } from './design/tokens';
  import { applyOverrides, isMenuKey, isTextEntry, KeyEngine, keyLabel, matchesChord, RESERVED_KEYS } from './keymap';
  import { cardMenu, tableMenu, type MenuEntry } from './menu';
  import type { HudProps } from './props';
  import Avatar from './Avatar.svelte';
  import CardFace from './CardFace.svelte';
  import CheatSheet from './CheatSheet.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DeckImport from './DeckImport.svelte';
  import HandFan from './HandFan.svelte';
  import TeamHands from './hand/TeamHands.svelte';
  import { teamFanTop, teamRevealChoices } from './hand/team';
  import Inspect from './Inspect.svelte';
  import LogPanel from './LogPanel.svelte';
  import PileViewer from './PileViewer.svelte';
  import TokenSearch from './TokenSearch.svelte';
  import TurnStrip from './TurnStrip.svelte';
  import TalkButton from './voice/TalkButton.svelte';
  import VoicePanel from './voice/VoicePanel.svelte';
  import { attachModifierTalkActions, attachTalkInput, focusKind, NOTE_FIELD_ATTR, runTalkAction } from './voice/input';
  import { PressTalk } from './voice/press';
  import Speech from './settings/Speech.svelte';
  import ThemePicker from './settings/Theme.svelte';
  import { themeContext } from './settings/theme';
  import { ViewSettings, type ViewPrefs } from './settings/view';
  import { cuesFor, soundModeOf, soundOn, ThemeSoundPlayer, type SoundMode } from './sound';
  import { shuffledZones } from './sound'; // M7-P5
  import { fieldDictation, sceneCaptions } from './settings/captions';
  import type { Caption, HoldAloneState } from '../voice/types';
  import EmptyState from './empty/EmptyState.svelte';
  import Hint from './hints/Hint.svelte';
  import { HintController, isTouchDevice } from './hints/hints';
  import { CardBackSetting, type CardBackState } from './settings/back';
  import { KeymapSettings, remapMessage } from './settings/keys';
  import type { SettingsSection } from './settings/sections';
  import SettingsPanel from './settings/Settings.svelte';
  import { isQuotaError, isStorageFullLine } from './settings/storage';
  import { registerDebug } from '../util/debug';
  import { registerHudDebug } from './hud/debug';
  import { recentGestures } from '../scene/input/pointers';
  import RadialMenu from './touch/RadialMenu.svelte';
  import ThumbBar from './touch/ThumbBar.svelte';
  import Affordances from './touch/Affordances.svelte'; // M7-P5
  import type { PileButton } from './touch/affordances'; // M7-P5
  import CoachMark from './hints/CoachMark.svelte'; // M7-P5
  import { CoachController } from './hints/coach'; // M7-P5
  import { RADIAL_SLOTS, THUMB_BAR, type RadialMenuState } from './touch/actions';
  import { blockPageGestures, safeAreaInsets, touchDevice } from './touch/device';
  import { THUMB_BAR_SPACE_PX, clampMenu } from './touch/fan';
  import { slotAction } from './touch/radial';
  import { describeCard, describeFocus, focusCards, focusMoveOf, keepFocus, LogAnnouncements, moveFocus, zoneLabel, type CardFocus, type FocusMove } from './a11y/index';
  import { pageAnnouncer } from './a11y/announcer';
  import { installReducedMotionCss, prefersReducedMotion, watchReducedMotion } from './a11y/motion';
  import FocusMirror from './a11y/FocusMirror.svelte';

  let {
    session,
    createScene,
    faces,
    cardData,
    game,
    theme,
    settings,
    parseDecklist,
    onVoice,
    newId,
    evening,
    // HudShellProps (src/ui/props.ts): what the shell tells the HUD; all optional (docs/design/m8/m7-adjustments.md section 2).
    onleave,
    menuTop,
    sandbox,
    onchoosedeck,
    seatPresence,
    plateMenuTop,
    plateBadge,
    status,
    notice,
    chrome = 'full',
    readOnly = false,
    primaryOverride = null,
  }: HudProps = $props();
  /** Everything but the plates, their menus and the status line (HudShellProps.chrome 'plates': a waiting room, a gathering). */
  const full = $derived(chrome !== 'plates');
  /**
   * Nothing on this HUD may change the table: the shell's readOnly ("Look, do not touch", m7-adjustments section 2), or
   * chrome 'plates' (a waiting room or a gathering shows no hand, Undo or primary, so no route acts behind them).
   * Every acting route (keys, card and table menus, the radial menu, pile actions, drags, the stack's buttons) checks it.
   */
  const viewOnly = $derived(readOnly || !full);
  /**
   * "Import deck…" and the paste dialog (D7: set-up belongs to Home; only the sandbox imports). A HUD mounted without a
   * shell (no `onleave`: the pages from before M8, the harness) keeps offering it unless `sandbox` says otherwise.
   */
  const importOffered = $derived(sandbox ?? onleave === undefined);
  /** A seat's player is away: the table says so (Seat.away) or the shell does (seatPresence). */
  const isAway = (seat: string): boolean => seatPresence?.[seat] === 'away' || st.seats[seat]?.away === true;
  /** The shell's notice, shown once per id (HudShellProps.notice). */
  let shownNotice = $state.raw<{ id: number; text: string; action?: { label: string; run: () => void } } | null>(null);
  /** Notice ids shown already (plain, not reactive). */
  const seenNotices: number[] = [];
  $effect(() => {
    const n = notice;
    if (!n || seenNotices.includes(n.id)) return;
    seenNotices.push(n.id);
    shownNotice = n;
    untrack(() => later(() => {
      if (shownNotice?.id === n.id) shownNotice = null;
    }, n.action ? 10000 : 6000));
  });

  // --- Shared state, as views of the session (the HUD is mounted per session; it never swaps sessions) ----------
  const me = untrack(() => session.seat);
  let st = $state.raw(untrack(() => session.getState()));
  let secrets = $state.raw(untrack(() => session.secrets()));
  let entries = $state.raw(untrack(() => session.log()));
  /** Own chat lines not in the session log yet, and what the HUD notices as the log grows (ui/chat/watch.ts, M1-P6). */
  let pendingChat = $state.raw<readonly LogEntry[]>([]);
  const watch = new LogWatch();
  /**
   * Two-Headed Giant team chat this browser sent or received (session.team chatLog, M3-P2): team lines never enter the
   * shared log (DESIGN "A team channel carries voice and text only between teammates"), so the timeline merges them in.
   */
  let teamChat = $state.raw<readonly LogEntry[]>([]);
  let teamUnsub: (() => void) | null = null;
  function followTeam(): void {
    const team = session.team;
    if (!team || teamUnsub) return;
    teamUnsub = team.subscribe(() => (teamChat = team.chatLog()));
    teamChat = team.chatLog();
  }

  // --- Local view state (never shared) -------------------------------------------------------------------------
  let sceneHover = $state<InstanceId | null>(null);
  let hudHover = $state<InstanceId | null>(null);
  const hovered = $derived(hudHover ?? sceneHover);
  /** Keyboard card focus (DESIGN "Input and interaction design", Accessibility; PLAN M5-P4, ui/a11y): arrow keys move it. */
  let focus = $state.raw<CardFocus | null>(null);
  /**
   * The card the keymap acts on: with a keyboard focus, its card, which is none on a zone without a focusable card (a
   * library, an empty zone), so a resting pointer never acts behind the focus; without one, the hovered card.
   */
  const keyTarget = $derived(focus ? focus.card : hovered);
  let selection = $state.raw<InstanceId[]>([]);
  let pings = $state.raw<ActivePing[]>([]);
  let openPile = $state<string | null>(null);
  /** The player's keymap (M5-P5, ui/settings/keys.ts): the settings panel, the cheat sheet and the keys share it. */
  const keySettings = new KeymapSettings(untrack(() => game.keymap), untrack(() => settings));
  let overrides = $state.raw<KeymapOverride[]>([]);
  const keymap = $derived(applyOverrides(game.keymap, overrides));
  let vw = $state(typeof window === 'undefined' ? 1440 : window.innerWidth);
  let vh = $state(typeof window === 'undefined' ? 900 : window.innerHeight);
  const pointer = { x: 0, y: 0 };
  /** Whether the pointer moved over the page yet (the P key's anchor, M4-P1). */
  let pointerSeen = false;
  let forcedHover: InstanceId | null = null;
  let sceneHost = $state<HTMLElement | undefined>();
  let scene: TableScene | null = null;
  let presence: PresenceHandle | null = null;
  /** Hand a drag out of the hand fan or a pile viewer to the scene, and show it to the others (M1-P5 presence). */
  function dragOut(id: InstanceId, x: number, y: number): void {
    if (!scene || viewOnly) return;
    // The drag becomes a table press ("Talk while I hold or drag", M6-P2): captions said meanwhile attach to this card.
    pressTalk.dragOut(id);
    scene.startDrag(id, x, y);
    presence?.beginExternalDrag(id, x, y);
  }
  let sceneReady = $state(false);
  let sceneError = $state('');
  // Look, do not touch (HudShellProps.readOnly, or chrome 'plates'): the scene proposes no action (TableScene.setReadOnly,
  // M7-P5). It is created with the setting (TableSceneOptions.readOnly) and told of every change.
  $effect(() => {
    const ro = viewOnly;
    if (sceneReady) scene?.setReadOnly?.(ro);
  });
  // An acting overlay open when the table turns view-only (a gathering switching a live table to standby) closes: its
  // handlers would act on the table.
  $effect(() => {
    if (!viewOnly) return;
    untrack(() => {
      menu = null;
      radial = null;
      note = null;
      drawN = null;
      askField = null;
      revealTo = null;
      tokenNear = null;
      deckOpen = false;
      leaving = null;
    });
  });
  /** The viewer's reduced-motion setting, followed live (M5-P4 reduced-motion audit; ui/a11y/motion.ts). */
  let reducedMotion = $state(prefersReducedMotion());

  // --- Overlays ------------------------------------------------------------------------------------------------
  let cheatOpen = $state(false);
  let inspectId = $state<InstanceId | null>(null);
  let inspectRef = $state<CardRef | null>(null);
  let viewer = $state<{ zone: ZoneId; looked: LookedCard[] | null; looking: 'top' | 'search' | null; shuffleOnClose: boolean } | null>(null);
  let menu = $state<{ title: string; entries: MenuEntry[]; x: number; y: number; keyboard: boolean } | null>(null);
  let note = $state<{ target: { card: InstanceId } | { item: StackItemId }; x: number; y: number; text: string } | null>(null);
  /** The inline count prompt for draw N (Shift+D) and mill N (table menu). */
  let drawN = $state<{ text: string; what: 'draw' | 'mill' } | null>(null);
  /** The inline Ask field (K): an optional short label, Enter asks (M1-P3). */
  let askField = $state<{ text: string } | null>(null);
  let askInput = $state<HTMLInputElement | undefined>();
  let revealTo = $state<{ cards: InstanceId[]; x: number; y: number } | null>(null);
  /** The reveal-to menu's measured size: it opens at the pointer and is moved inside the window (gate M8 finding F3). */
  let revealW = $state(0);
  let revealH = $state(0);
  const revealAt = $derived(revealTo ? clampMenu(revealTo.x, revealTo.y - 20, revealW || 220, revealH, vw, vh, undefined, 8) : { left: 0, top: 0 });
  let tokenNear = $state<{ near: InstanceId | null } | null>(null);
  let deckOpen = $state(false);
  let toast = $state<{ text: string; id: number } | null>(null);
  /** The long-press radial menu (M5-P1; DESIGN "Input and interaction design", Touch). */
  let radial = $state<{ card: InstanceId; at: { x: number; y: number } } | null>(null);
  let selAnchor = $state.raw<SelectionAnchor | null>(null); // M7-P5: where the selection strip stands (SceneEvents.selectionAnchor)
  let pileHover = $state.raw<PileHover | null>(null); // M7-P5: the pile whose actions show (SceneEvents.pileHover)
  let sceneReadOnly = $state(false); // M7-P5: look, do not touch (SceneEvents.readOnly): no coach mark, no on-card control
  const coach = new CoachController(untrack(() => settings)); // M7-P5: the gesture coach marks, one at a time, above the hand
  // M7-P5: a pile action button runs the same routes as the pile viewer's buttons and the keys.
  function pileAction(b: PileButton, h: PileHover): void { // M7-P5: a pile action button runs the routes the pile viewer and the keys run
    const zone = h.zone; // M7-P5
    if (!zone) { if (h.pile) openPile = openPile === h.pile ? null : h.pile; return; } // M7-P5
    if (viewOnly) return openViewer(zone); // M7-P2: look, do not touch — a pile button only opens the pile
    if (b.id === 'draw') commands.run('draw'); // M7-P5
    else if (b.id === 'drawN') commands.run('drawN'); // M7-P5
    else if (b.id === 'shuffle') void session.shuffle(zone); // M7-P5
    else if (b.id === 'revealTop') commands.revealTop(); // M7-P5
    else if (b.id === 'search') { openViewer(zone); void libraryAction('search'); } // M7-P5
    else openViewer(zone); // M7-P5
  } // M7-P5
  /** A touch screen (or a finger touched the page): the thumb bar shows and the hand fan scrolls (ui/touch/device.ts). */
  let touchUi = $state(touchDevice());
  let untapOffer = $state(false);
  /**
   * The log and chat drawer (docs/design/m7-hud-proposal.md, Activity drawer: "Full history on demand, never a permanent
   * column"): closed, an activity button with an unread count and a ticker; it opens from that button or Enter.
   */
  let logOpen = $state(false);
  /** Which seat plates have their "⋯" menu open (Avatar bind:moreOpen): kept here, as a plate is a new Avatar when it moves to its seat edge. */
  let openPlates = $state<Record<string, boolean>>({});
  let preview = $state<{ card: InstanceId; x: number; y: number } | null>(null);
  let voice = $state<{ talking: 'talk' | 'teamTalk' | null; muted: boolean }>({ talking: null, muted: false });
  /** The modifier talk key's hold-alone state (shown on the talk indicator as data-hold). */
  let talkHold = $state<HoldAloneState>('idle');
  /** Live voice of a networked table (M3-P3); the solo table and the harness have none. */
  const liveVoice = untrack(() => session.voice);
  let voicePanel = $state(false);
  /** Who speaks now, by identity peer id (the avatars' speaking rings). */
  let speaking = $state.raw<Record<string, boolean>>({});
  const speaks = (seat: string): boolean => {
    const peer = st.seats[seat]?.peer;
    return !!peer && speaking[peer] === true;
  };
  let logPanel = $state<LogPanel | undefined>();
  /**
   * Who is typing (M6-P2, GAPS 22; ui/chat/typing.ts): other peers' presence, shown beside the chat field and on their
   * avatars. Spectators' names come from their connections' nicknames; `watching` counts the spectators connected now.
   */
  let typers = $state.raw<Typer[]>([]);
  let watching = $state(0);
  const typingAt = $derived(typingSeats(typers));
  function refreshTypers(): void {
    const peers = session.netStatus().peers;
    const next = typersOf(session.presence.peers(), st, me, peers, Date.now());
    // Presence fires on every throttled cursor and drag message: keep the same array unless who is typing changed.
    if (JSON.stringify(next) !== JSON.stringify(typers)) typers = next;
    const w = new Set(peers.filter((p) => p.role === 'spectator' && p.status !== 'handshake' && p.peerId).map((p) => p.peerId)).size;
    if (w !== watching) watching = w;
  }
  /** Dictated captions (M3-P4, session.captions) and the speech settings panel. */
  let captionList = $state.raw<Caption[]>([]);
  let speechOpen = $state(false);
  /** Where the speech settings open: just below the Dictation button, wherever the wrapped toolbar puts it. */
  let speechTop = $state<number | undefined>(undefined);
  let noteInput = $state<HTMLInputElement | undefined>();
  let drawInput = $state<HTMLInputElement | undefined>();

  /** The viewer's look (ui/design/look.ts): the HUD's design tokens; in a harness page without the app shell, the theme's own look. */
  const lookChoice = lookContext();
  let storedLook = $state(untrack(() => lookChoice?.current() ?? hudLook(theme)));
  const look = $derived(lookChoice ? storedLook : hudLook(theme));
  $effect(() => lookChoice?.subscribe((l) => (storedLook = l)));
  const cssVars = $derived(cssText(lookCssVars(theme, look, reducedMotion)));
  /** The Menu (docs/design/m7-hud-proposal.md, In the menu): every rare tool, one step away. */
  let menuOpen = $state(false);
  let menuButton = $state<HTMLButtonElement | undefined>();
  /** "Next game" and "New draft" leave the game: they ask first (critique, Top 10, 9: destructive actions). */
  let leaving = $state<'nextGame' | 'newDraft' | null>(null);
  /** Each seat's table edge on screen (SceneEvents.seatAnchors), where its plate sits; empty until the scene reports them. */
  let anchors = $state.raw<SeatAnchor[]>([]);
  /** The settings panel (M5-P5, ui/settings/Settings.svelte); the theme popover below stays as its shortcut. */
  let settingsOpen = $state(false);
  let settingsSection = $state<SettingsSection>('display');
  function openSettings(section: SettingsSection = 'display'): void {
    settingsSection = section;
    settingsOpen = true;
    themeOpen = false;
  }
  /** First-run hints (M5-P5, ui/hints): one at a time, by the own hand, never blocking; the talk hint once voice is joined. */
  const hints = new HintController(
    untrack(() => settings),
    { where: 'table', touch: isTouchDevice(), voice: untrack(() => !!session.voice?.joined), spectator: untrack(() => session.role === 'spectator'), networked: untrack(() => !!session.voice) },
  );
  /** A save that failed for lack of space (M5-P5 storage full): from the log, or a quota error anywhere on the page. */
  let quotaError = $state(false);
  let storageFullDismissed = $state(false);
  /** No deck dismissed by the player (M5-P5 empty states). */
  /** The viewer's theme picker (PLAN M4-P6): present when the app shell provides the choice, not in harness pages. */
  const themeChoice = themeContext();
  let themeOpen = $state(false);
  let themeAnchor = $state<HTMLElement | null>(null);
  // The picker is a dismissible popover: a press anywhere outside it (table, HUD) closes it, as Esc and × do.
  $effect(() => {
    if (!themeOpen) return;
    const away = (e: PointerEvent) => {
      if (themeAnchor && !themeAnchor.contains(e.target as Node | null)) themeOpen = false;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  // The theme's sound set (DESIGN "Themes and rendering", Sound) under the viewer's Settings.sound; audio starts on the
  // viewer's first press or key (browsers' autoplay rule).
  const sound = new ThemeSoundPlayer();
  /** The viewer's Settings.sound; null until it is read, so a viewer who turned sound off never hears a start. */
  let soundMode = $state<SoundMode | null>(untrack(() => (settings ? null : 'theme')));
  let soundLive = $state(false);
  $effect(() => {
    sound.setTheme(theme.sounds);
    sound.setMode(soundMode ?? 'off');
    soundLive = sound.ambient();
  });
  /** 'off', 'on' (waiting for a gesture or no room tone) or 'playing' (the room tone runs). */
  const soundState = $derived(soundOn(theme.sounds, soundMode ?? 'off') ? (soundLive ? 'playing' : 'on') : 'off');
  function setSoundMode(mode: SoundMode): void {
    soundMode = mode;
    void settings?.set('sound', mode).catch(() => {});
  }
  $effect(() => {
    const unlock = () => {
      sound.unlock();
      soundLive = sound.ambient();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  });
  /** The theme the scene was built with or last switched to; a new theme prop is handed to the scene without reload. */
  let sceneTheme: typeof theme | null = null;
  $effect(() => {
    const t = theme;
    if (!sceneReady || !scene || sceneTheme === null || t === sceneTheme) return;
    sceneTheme = t;
    scene.setTheme(t);
  });
  // The viewer's card back (M5-P5, ui/settings/back.ts): the official back once chosen and loaded, else the theme's or game's.
  const cardBack = new CardBackSetting({ settings: untrack(() => settings) });
  let backState = $state.raw<CardBackState>(cardBack.state());
  const back = $derived(backState.back ?? theme.cardDressing.back ?? game.cardBack);
  /** The back the scene has (it starts with the theme's or game's). */
  let handedBack: CardBackState['back'] = null;
  $effect(() => {
    const b = backState.back;
    if (!sceneReady || !scene || b === handedBack) return;
    handedBack = b;
    scene.setCardBack?.(b);
  });
  /**
   * Screen edges the screen-anchored layer covers, "top right bottom left" in CSS px, for the scene's fit (DESIGN
   * "Camera and navigation", Screen-anchored layer): the toolbar and turn strip row, the open log column, the hand fan
   * with the row above it, and the avatar column. Fitting the table keeps it clear of them, so the own piles are never
   * under the log or the hand at the fitted view.
   */
  /** Two-Headed Giant: the teammate's fan sits above the own one (TeamHands below), and the table fit keeps it clear. */
  const teamFanShown = $derived(!!session.team && Object.keys(st.teams).length > 0);
  /** The thumb action bar above the hand (touch screens; spectators act on nothing). */
  const thumbShown = $derived(touchUi && untrack(() => session.role) !== 'spectator');
  /** The device's safe-area insets (the iPad's home indicator and rounded corners; zeros elsewhere), read again on resize. */
  const safeInsets = $derived.by(() => {
    void vw;
    void vh;
    return safeAreaInsets();
  });
  // The drawer opens over the table and never resizes it (m7-adjustments.md, M7-P2 "HUD layout": Activity), so the
  // table's framing ignores it.
  /**
   * Where the hand fan spans the width (a touch screen, a window up to 1100 px) the own plate and the primary button sit
   * in a row just above the hand (see the CSS below): the table's fit keeps clear of that row too, so the primary never
   * covers the own library or a card (m7-hud-proposal, iPad: "never over a card"). The primary is 56 px high, 16 px up.
   */
  const rowAboveHand = $derived(full && (touchUi || vw <= 1100) ? 56 + 16 : 0);
  /**
   * The bottom row on a wide window (visual.md 2.9 board 7; gate M8 finding F17): the own plate bottom left, talk and
   * the primary bottom right, and the hand fan in the band between them, 16 px clear of each, so nothing lies over a
   * card face. The two clusters' widths are measured (a resize observer, not per frame); where the plate and the
   * primary sit in a row above the hand (narrow windows, touch screens) the fan keeps the whole width.
   */
  let plateWidth = $state(0);
  /** The width of each seat-edge plate (measured on resize), so the whole plate stays in the free room. */
  let anchorWidths = $state<Record<string, number>>({});
  /**
   * The open activity drawer's reserve at the right edge: the drawer (360), its gap and the tilt handle beside it (8 + 44)
   * and the edge inset; plates and the tracker keep left of it, so the drawer never covers a plate's menu.
   */
  const LOG_RESERVE = LAYOUT.edge + 360 + 8 + 44 + 8;
  /** A seat-edge plate's centre x: at its anchor, kept inside the window and clear of an open drawer. */
  function anchorX(x: number, width: number): number {
    const lo = LAYOUT.edge + width / 2;
    const hi = vw - (logOpen ? LOG_RESERVE : LAYOUT.edge) - width / 2;
    return hi < lo ? lo : Math.min(Math.max(x, lo), hi);
  }
  /** Which way a seat's edge faces on screen: a side seat (left or right of the table) or one across it. */
  const sideOf = (a: SeatAnchor): 'left' | 'right' | null => {
    const d = ((a.outwardDeg % 360) + 360) % 360;
    return d > 45 && d < 135 ? 'right' : d > 225 && d < 315 ? 'left' : null;
  };
  /** The gap between a side seat's table edge and its plate. */
  const SIDE_GAP = 24;
  /**
   * How far a side plate that does not fit beside the table moves along its edge, away from that seat's pile column: a
   * seat's library and graveyard lie on its right hand, which on screen is the outward direction turned a quarter
   * counter-clockwise (the left seat's piles run down from the edge's middle, the right seat's up), so it goes the other way.
   */
  const SIDE_SHIFT = 36;
  /**
   * A seat-edge plate's centre (gate M8 finding N4): a side seat's plate stands outside the table beside its edge, clear
   * of that seat's battlefield and pile column; the plate across the table stays centred on its edge.
   */
  function anchorPoint(a: SeatAnchor & { at: { x: number; y: number } }, width: number): { x: number; y: number } {
    const side = sideOf(a);
    let x = a.at.x;
    let y = a.at.y;
    if (side) {
      x += (side === 'left' ? -1 : 1) * (SIDE_GAP + width / 2);
      // Only a plate the window's edge pushes back toward the table moves along the edge, off the pile column.
      if (Math.abs(anchorX(x, width) - x) > 1) y -= Math.cos(((a.outwardDeg + 90) * Math.PI) / 180) * SIDE_SHIFT;
    }
    return { x: Math.round(anchorX(x, width)), y: Math.round(Math.min(Math.max(y, 70), vh - 200)) };
  }
  /** The top-left tools' width (measured on resize): the tracker keeps right of them when it moves for the drawer. */
  let toolsWidth = $state(0);
  /**
   * With the activity drawer open the tracker is centred in the room between the tools and the drawer, and drops its
   * turn number and shortens the name where that room is narrow, so the drawer never covers MAIN 2 and END (gate M8
   * finding N7). Null: centred in the window.
   */
  const trackerRoom = $derived.by<{ centre: number; compact: boolean } | null>(() => {
    if (!logOpen || !full) return null;
    const lo = LAYOUT.edge + toolsWidth + LAYOUT.edge;
    const hi = vw - LOG_RESERVE;
    if (hi <= lo) return null;
    return { centre: Math.round((lo + hi) / 2), compact: hi - lo < 720 };
  });
  let rightWidth = $state(0);
  let stackWidth = $state(0);
  const fanSpan = $derived.by<FanSpan | null>(() => {
    if (!full || touchUi || vw <= 1100) return null;
    const clear = LAYOUT.edge;
    const left = plateWidth > 0 ? LAYOUT.edge + plateWidth + clear : LAYOUT.edge;
    const right = vw - LAYOUT.edge - Math.max(rightWidth, stackWidth) - clear;
    return right > left ? { left, right } : null;
  });
  /**
   * Every other player's plate is compact at a table of three or more chairs, whoever is seated or away: one plate size
   * for one table size (gate M8 finding N4: 46 px pills in one game, a 72 px plate in another of the same size).
   */
  const seatCount = $derived(Object.keys(st.seats).length);
  // At three or more chairs the side seats' plates stand beside the table on both sides: the fit keeps the same room on
  // the right as on the left, so the table is centred and each side plate has the window's edge to itself (gate M8 N4).
  const fitInsets = $derived(fitInsetsFor(vh, false, teamFanShown, (thumbShown ? THUMB_BAR_SPACE_PX : 0) + rowAboveHand, safeInsets, seatCount >= 3 && !touchUi && vw > 1100));
  /** Bottom of the block above the hand (toast, offer, prompt): above the teammate's fan and the thumb bar when shown. */
  const aboveHandBottom = $derived.by(() => {
    const thumb = thumbShown ? THUMB_BAR_SPACE_PX : 0;
    if (teamFanShown) return `${teamFanTop(vh) + 8 + thumb}px`;
    return thumb ? `calc(22vh + ${16 + thumb}px + var(--sp-above-row, 0px))` : null;
  });

  /**
   * The coach mark sits above whatever the slot above the hand shows (KEEP and MULLIGAN, the no-deck line), never over it
   * (gate M8 screenshot review: the first-run coach covered KEEP). Measured when the slot's height changes, not per frame.
   */
  let aboveEl = $state<HTMLElement | null>(null);
  let aboveHeight = $state(0);
  const coachBottom = $derived.by(() => {
    void vh;
    if (!aboveEl || aboveHeight < 8) return aboveHandBottom;
    return `${Math.round(window.innerHeight - aboveEl.getBoundingClientRect().top)}px`;
  });

  // --- Card identity as this browser may know it ----------------------------------------------------------------
  /** The face this viewer may see: public identity, else own hand or own face-down identity, else a targeted reveal. Never a library face. */
  function refOf(id: InstanceId): CardRef | null {
    const c = st.cards[id];
    if (!c) return null;
    if (c.identity) return c.identity;
    if (inZoneKind(c, 'library')) return null;
    return secrets.identities[id]?.card ?? secrets.received[id]?.card ?? null;
  }
  function dataOf(ref: CardRef | null): CardData | null {
    return ref ? session.cardData(ref) : null;
  }
  function nameOf(id: InstanceId): string {
    const ref = refOf(id);
    if (!ref) return st.cards[id]?.tokenLabel ?? 'Hidden card';
    return dataOf(ref)?.name ?? 'Card';
  }
  const privateFaces = $derived.by(() => {
    const out: Record<InstanceId, CardRef> = {};
    for (const c of Object.values(st.cards)) {
      if (c.identity || inZoneKind(c, 'library')) continue;
      const ref = secrets.identities[c.id]?.card ?? secrets.received[c.id]?.card;
      if (ref) out[c.id] = ref;
    }
    return out;
  });

  // --- Commands and keys ----------------------------------------------------------------------------------------
  let toastSeq = 0;
  /** Timeouts the HUD owns (toast, ping fade); cleared when it unmounts. */
  let timers: ReturnType<typeof setTimeout>[] = [];
  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers = timers.filter((x) => x !== t);
      fn();
    }, ms);
    timers.push(t);
  }
  function notify(text: string) {
    const id = ++toastSeq;
    toast = { text, id };
    later(() => {
      if (toast?.id === id) toast = null;
    }, 3500);
  }

  const hooks: UiHooks = {
    openNote(target) {
      const existing = 'card' in target ? st.cards[target.card]?.note : st.stack.find((i) => i.id === target.item)?.note;
      note = { target, x: pointer.x, y: pointer.y, text: existing ?? '' };
      void tick().then(() => noteInput?.focus());
    },
    openRevealTo(cards) {
      revealTo = { cards, x: pointer.x, y: pointer.y };
    },
    inspect(card) {
      inspectId = card;
      // A library card is known here only from an open look (scry, search); never otherwise.
      inspectRef = card ? (refOf(card) ?? viewer?.looked?.find((l) => l.id === card)?.ref ?? null) : null;
    },
    openAsk() {
      askField = { text: '' };
      void tick().then(() => askInput?.focus());
    },
    openDrawN() {
      drawN = { text: '2', what: 'draw' };
      void tick().then(() => drawInput?.select());
    },
    openTokenSearch(near) {
      tokenNear = { near };
    },
    toggleCheatSheet() {
      cheatOpen = !cheatOpen;
    },
    focusChat() {
      logOpen = true;
      void tick().then(() => logPanel?.focusChat());
    },
    voice(action, phase) {
      onVoice?.(action, phase);
      if (liveVoice) runTalkAction(liveVoice, action, phase);
      if (action === 'mute') voice = { ...voice, muted: !voice.muted };
      else voice = { ...voice, talking: phase === 'start' ? action : null };
    },
    notify,
  };

  const makeId = (prefix: string) => newId?.(prefix) ?? `${prefix}-${me}-${crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '')}`;
  const commands = new Commands({
    session: untrack(() => session),
    game: untrack(() => game),
    scene: () => scene,
    // The keyboard-focused card counts as hovered (DESIGN "Input and interaction design", Accessibility; M5-P4). With a
    // keyboard focus the keys act on that card only: the selection counts only when it holds the card, and a focus on a
    // zone without a focusable card gives no card (no selection, no stack marker under a resting pointer).
    view: () => {
      if (!focus) return { hovered: forcedHover ?? hovered, selection };
      const card = forcedHover ?? focus.card;
      return { hovered: card, selection: card !== null && selection.includes(card) ? selection : [], keyFocus: true };
    },
    ui: hooks,
    newId: makeId,
    now: () => Date.now(),
    pointer: () => (pointerSeen ? { x: pointer.x, y: pointer.y } : null),
  });
  const engine = new KeyEngine(
    untrack(() => game.keymap),
    {
      start: (b) => keyAllowed(b.action) && commands.run(b.action, 'start'),
      end: (b) => keyAllowed(b.action) && commands.run(b.action, 'end'),
    },
    () => promptKeys(session.getState(), me),
  );
  $effect(() => {
    engine.setKeymap(keymap);
  });

  /** Look, do not touch (HudShellProps.readOnly): only keys that move the view or show something still work. */
  const READ_ONLY_KEYS: ReadonlySet<ActionId> = new Set<ActionId>(['perspective', 'fitTable', 'zoomTo', 'inspect', 'help']);
  function keyAllowed(action: ActionId): boolean {
    return !viewOnly || READ_ONLY_KEYS.has(action);
  }
  /** The card and table menu entries that only look (inspect, zoom, fit, the key sheet): all a view-only menu keeps. */
  const lookOnly = (entries: MenuEntry[]): MenuEntry[] => entries.filter((e) => READ_ONLY_KEYS.has(e.id as ActionId));
  /** Run an action as if `card` were hovered (context menu entries). */
  function runOn(card: InstanceId, action: ActionId) {
    forcedHover = card;
    try {
      commands.run(action);
    } finally {
      forcedHover = null;
    }
  }

  /**
   * Close the topmost overlay for Esc. While a confirmation prompt shows, Esc means Hold, except that a transient
   * overlay (menu, reveal-to, token search, inspect, cheat sheet, theme picker) closes first; pile viewers and the deck
   * dialog stay.
   */
  function closeTop(promptUp: boolean): boolean {
    if (radial) radial = null;
    else if (leaving) leaving = null;
    else if (menuOpen) menuOpen = false;
    else if (menu) menu = null;
    else if (themeOpen) themeOpen = false;
    else if (settingsOpen) settingsOpen = false;
    else if (revealTo) revealTo = null;
    else if (tokenNear) tokenNear = null;
    else if (inspectId) hooks.inspect(null);
    else if (cheatOpen) cheatOpen = false;
    else if (promptUp) return false;
    else if (viewer) closeViewer();
    else if (deckOpen) deckOpen = false;
    else if (focus) setFocus(null, false);
    else return false;
    return true;
  }

  function onkeydown(e: KeyboardEvent) {
    const inText = isTextEntry(e.target) || isTextEntry(document.activeElement);
    if (inText) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    // Enter and Space on a keyboard-focused control (button, link, checkbox) activate that control.
    if (plain && (e.key === 'Enter' || e.key === ' ') && isControl(e.target)) return;
    if (e.key === 'Escape' && plain && closeTop(promptShowing(st, me))) {
      e.preventDefault();
      return;
    }
    if (untapOffer && !viewOnly && !e.repeat && RESERVED_KEYS.some((r) => matchesChord(r.chord, e))) {
      e.preventDefault();
      untapOffer = false;
      commands.untapAndDraw();
      return;
    }
    // The context-menu key or Shift+F10 (the platform keys for a context menu, ui/keymap.ts MENU_KEYS; M5-P4).
    if (isMenuKey(e) && !menu && !radial && !ownsArrows(e.target)) {
      e.preventDefault();
      openKeyMenu();
      return;
    }
    const move = focusMoveOf(e);
    // The cheat sheet covers the table: arrows and Page keys do not move a focus the player cannot see under it; while
    // the radial menu is open they are its own (M5 review).
    if (move && !menu && !radial && !cheatOpen && !ownsArrows(e.target)) {
      e.preventDefault();
      moveKeyFocus(move);
      return;
    }
    if (engine.keydown(e, false)) e.preventDefault();
  }
  function isControl(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el?.tagName && (['BUTTON', 'A', 'SUMMARY', 'INPUT', 'SELECT'].includes(el.tagName) || el.getAttribute?.('role') === 'menuitem');
  }
  /** A mouse click leaves no focus on HUD buttons, so Enter and Space keep their table meaning afterwards. */
  function onclick(e: MouseEvent) {
    if (e.detail > 0 && isControl(e.target) && !isTextEntry(e.target)) (e.target as HTMLElement).blur();
    else if (e.detail > 0 && (e.target as HTMLElement | null)?.closest?.('button')) (e.target as HTMLElement).closest('button')?.blur();
  }
  function onkeyup(e: KeyboardEvent) {
    if (engine.keyup(e)) e.preventDefault();
  }
  function onfocusin(e: FocusEvent) {
    if (isTextEntry(e.target)) engine.blur();
  }

  // --- Remapping (persisted through settings; M5-P5 ui/settings/keys.ts) -------------------------------------------
  function remap(action: ActionId, context: KeyContext, chord: KeyChord): string | null {
    return remapMessage(keySettings.remap(action, context, chord));
  }
  function resetKeys() {
    keySettings.resetAll();
  }

  // --- Pile viewers -------------------------------------------------------------------------------------------------
  function openViewer(zone: ZoneId) {
    if (viewer?.zone === zone) return;
    if (viewer) closeViewer();
    viewer = { zone, looked: null, looking: null, shuffleOnClose: true };
  }
  function closeViewer() {
    const v = viewer;
    viewer = null;
    if (hudHover && v?.looked?.some((l) => l.id === hudHover)) hudHover = null;
    if (v?.looking === 'search' && v.shuffleOnClose) void session.shuffle(v.zone);
  }
  async function libraryAction(what: 'draw' | 'drawN' | 'shuffle' | 'look' | 'search' | 'mulligan' | 'mill' | 'revealTop', n?: number) {
    const v = viewer;
    if (!v || viewOnly) return;
    if (what === 'draw') commands.run('draw');
    else if (what === 'drawN') commands.run('drawN');
    else if (what === 'mill') commands.mill(n ?? 1);
    else if (what === 'revealTop') commands.revealTop();
    else if (what === 'shuffle') {
      v.looked = null;
      v.looking = null;
      await session.shuffle(v.zone);
    } else if (what === 'mulligan') await session.mulligan();
    else {
      const count = st.zones[v.zone]?.ids.length ?? 0;
      const k = what === 'search' ? count : Math.max(1, Math.min(count, Math.floor(n ?? 1)));
      if (k <= 0) return;
      const looked = await session.lookAt(v.zone, k);
      if (viewer?.zone !== v.zone) return;
      viewer.looked = looked;
      viewer.looking = what === 'search' ? 'search' : 'top';
    }
  }
  const viewerCards = $derived.by(() => {
    if (!viewer) return [];
    const zone = st.zones[viewer.zone];
    if (!zone) return [];
    if (zone.visibility !== 'public') {
      const inZone = new Set(zone.ids);
      return (viewer.looked ?? []).filter((l) => inZone.has(l.id)).map((l) => ({ id: l.id, ref: l.ref, name: dataOf(l.ref)?.name ?? 'Card' }));
    }
    return zone.ids.map((id) => ({ id, ref: refOf(id), name: nameOf(id) }));
  });

  // --- Menus ----------------------------------------------------------------------------------------------------
  function openMenu(card: InstanceId | null, x: number, y: number, keyboard = false, point: { x: number; y: number } | null = keyboard ? null : { x, y }) {
    const c = card ? st.cards[card] : undefined;
    const next = c
      ? { title: focusName(c.id), entries: [...cardMenu(c, keymap, commands, (a) => runOn(c.id, a)), ...clipHereEntry(c.id, point)], x, y, keyboard }
      : { title: 'Table', entries: tableMenu(keymap, (a) => commands.run(a), libraryExtras), x, y, keyboard };
    // Look, do not touch: only the entries that look; no menu at all when none is left.
    if (viewOnly) next.entries = lookOnly(next.entries);
    menu = next.entries.length > 0 ? next : null;
  }
  /**
   * "Clip here" where the menu's point (the right-click, or the long-press that opened the touch radial menu) covers two
   * or more battlefield cards (M6-P1; PLAN Milestone 6, owner decisions, Paperclips: the touch full menu offers it).
   */
  function clipHereEntry(card: InstanceId, point: { x: number; y: number } | null): MenuEntry[] {
    if (!point || spectating || !scene?.cardsAt) return [];
    const under = scene.cardsAt(point.x, point.y);
    // Only for a menu of a table card at that point (not a hand card shown over the table).
    if (under.length < 2 || !under.includes(card)) return [];
    const at = scene.screenToTable(point.x, point.y);
    if (!at) return [];
    return [{ id: 'clipHere', label: 'Clip here', key: null, run: () => void commands.clipHere(under, at) }];
  }
  /** Where the long-press that opened the radial menu was: its full menu offers "Clip here" there (M6-P1). */
  let radialPoint: { x: number; y: number } | null = null;
  /** A paperclip's own menu (right-click or long-press on it): remove it (M6-P1). */
  function openClipMenu(clip: string, at: { x: number; y: number }): void {
    radial = null;
    const c = st.clips?.[clip];
    if (!c || spectating || viewOnly) return;
    menu = { title: `Paperclip: ${c.cards.map((id) => nameOf(id)).join(', ')}`, entries: [{ id: 'removeClip', label: 'Remove clip', key: null, run: () => session.dispatch({ type: 'clipRemove', clip }) }], x: at.x, y: at.y, keyboard: false };
  }
  /** The clip tray (M6-P1): a press on it hands a new paperclip to the table, which follows the pointer until dropped. */
  function clipTrayDown(e: PointerEvent): void {
    if (e.button !== 0 || !scene?.startClipDrag) return;
    e.preventDefault();
    menu = null;
    scene.startClipDrag(e.clientX, e.clientY);
  }
  /**
   * The context menu from the keyboard (DESIGN "Input and interaction design": every action has a context-menu route,
   * and every card action is reachable from the keyboard; M5-P4): for the keyboard-focused card (the table menu on a
   * zone without one), else for the hovered card, beside the card; the menu takes focus and hands it back on close.
   */
  function openKeyMenu(): void {
    const card = focus ? focus.card : hovered;
    // The menu hands focus back to the element that had it: the mirror, so a screen reader follows the card again.
    if (focus && mirrorEl && (document.activeElement === document.body || document.activeElement === null)) mirrorEl.focus({ preventScroll: true });
    const at = menuAnchor(card);
    openMenu(card, at.x, at.y, true);
  }
  /** Where a keyboard-opened menu stands: at the top right of the card (its focus ring, or its hand or pile element), else mid-screen or at the pointer. */
  function menuAnchor(card: InstanceId | null): { x: number; y: number } {
    if (card !== null && typeof document !== 'undefined') {
      const sel = CSS.escape(card);
      // The card itself before any other element naming it (a log line's card name comes earlier in the DOM).
      const els = [
        document.querySelector(`[data-testid="focus-ring"][data-focus-card="${sel}"] polygon`),
        document.querySelector(`[data-testid="hand-card"][data-card="${sel}"]`),
        document.querySelector(`[data-testid="pile-card"][data-card="${sel}"]`),
        ...document.querySelectorAll(`[data-card="${sel}"]`),
      ];
      for (const el of els) {
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) return { x: Math.round(r.right), y: Math.round(r.top) };
      }
    }
    if (!focus && pointerSeen) return { x: pointer.x, y: pointer.y };
    return { x: Math.round(vw / 2), y: Math.round(vh / 2) };
  }

  /** Keyless library actions for the table menu (DESIGN "Card manipulation", Library actions: reveal top, mill N). */
  const libraryExtras: MenuEntry[] = [
    { id: 'revealTop', label: 'Reveal top card', key: null, run: () => commands.revealTop() },
    {
      id: 'mill',
      label: 'Mill N…',
      key: null,
      run: () => {
        drawN = { text: '1', what: 'mill' };
        void tick().then(() => drawInput?.select());
      },
    },
  ];

  // --- Inline prompts ---------------------------------------------------------------------------------------------
  function submitNote() {
    const n = note;
    note = null;
    if (!n) return;
    const text = n.text.trim();
    if ('card' in n.target) session.dispatch({ type: 'note', card: n.target.card, text });
    else session.dispatch({ type: 'stackNote', item: n.target.item, note: text });
  }
  function submitDrawN() {
    const what = drawN?.what;
    const n = Math.floor(Number(drawN?.text ?? ''));
    drawN = null;
    if (!Number.isFinite(n) || n < 1) return;
    if (what === 'mill') commands.mill(n);
    else void session.draw(n);
  }
  function doRevealTo(seats: string[]) {
    const r = revealTo;
    revealTo = null;
    if (!r || seats.length === 0) return;
    const group = r.cards.length > 1 ? makeId('g') : null;
    for (const id of r.cards) session.dispatch(group ? { type: 'revealTo', instanceId: id, seats, group } : { type: 'revealTo', instanceId: id, seats });
  }
  /** The plate menu's "Reveal my hand to them": the existing reveal path (revealTo) for every card in the own hand, one group. */
  function revealHandTo(seats: string[]): void {
    if (hand.length === 0 || seats.length === 0) return;
    const group = hand.length > 1 ? makeId('g') : null;
    for (const id of hand) session.dispatch(group ? { type: 'revealTo', instanceId: id, seats, group } : { type: 'revealTo', instanceId: id, seats });
    notify(`Revealed your hand to ${seats.map((x) => st.seats[x]?.name ?? x).join(', ')}`);
  }
  const otherSeats = $derived(
    Object.values(st.seats)
      .filter((s) => s.id !== me)
      .sort((a, b) => a.index - b.index),
  );

  // --- Derived HUD data -------------------------------------------------------------------------------------------
  const hand = $derived(handOrder(st, secrets, me));
  const seats = $derived(Object.values(st.seats).sort((a, b) => a.index - b.index));
  /** The other players' avatars in the left column; at a four-seat table they are compact so the column fits the screen. */
  const others = $derived(seats.filter((s) => s.id !== me && !isEmptyChair(st, s.id)));
  /** A spectator's HUD (M3-P5): life and counters without controls. */
  const spectating = untrack(() => session.role === 'spectator');
  const lifeOf = (seat: string) => {
    const s = st.seats[seat];
    const team = s?.team ? st.teams[s.team] : undefined;
    return team?.life ?? s?.life ?? 0;
  };
  const zoneButtons = (seat: string) =>
    ['library', 'hand', 'graveyard', 'exile']
      .map((kind) => ({ id: `${kind}:${seat}`, label: kind[0]!.toUpperCase() + kind.slice(1), count: st.zones[`${kind}:${seat}`]?.ids.length ?? 0 }))
      .filter((z) => st.zones[z.id] && !(z.id === `hand:${me}`));
  /** Another player's personal volume and mute for their plate menu (DESIGN "Chat and voice", Live voice). */
  const peerAudioOf = (peer: string) => ({
    get: () => liveVoice!.peerAudio(peer),
    set: (setting: { volume: number; muted: boolean }) => void liveVoice!.setPeerAudio(peer, setting).catch(() => {}),
  });
  const glyphOf = (colour: number) => theme.tokens.colours.seats[colour]?.glyph ?? 'circle';
  /** The active seat is an empty chair (the sandbox's second seat): the tracker says so and the primary passes it on. */
  const activeEmpty = $derived(st.turn.active !== me && isEmptyChair(st, st.turn.active));
  const activeName = $derived(
    activeEmpty ? 'Empty seat' : (st.seats[st.turn.active]?.name || (st.teams[st.turn.active]?.seats.map((s) => st.seats[s]?.name).join(' & ') ?? st.turn.active)),
  );
  const activeColour = $derived(st.seats[st.turn.active]?.colour ?? st.seats[st.teams[st.turn.active]?.seats[0] ?? '']?.colour ?? null);
  const prompt = $derived(promptModel(st, me));
  /** A manual round (not about a stack item) that still waits makes its asker's avatar pulse (DESIGN "Turn flow and confirmation", Prompt). */
  const asking = (seat: string) => !!prompt && prompt.round.askedBy === seat && prompt.round.about === undefined && !prompt.allPassed;
  const top = $derived(st.stack[st.stack.length - 1] ?? null);
  const resolveLit = $derived(!!top && (!st.confirm || st.confirm.about !== top.id || roundPassed(st)));
  /**
   * Where the top spell may resolve to, default first (DESIGN "The effect stack", Resolving 2: Resolve asks where the
   * item goes; one key, R, accepts the default). Markers vanish, so they get no choice.
   */
  const resolveTargets = $derived.by(() => {
    const card = top?.card ? st.cards[top.card] : undefined;
    if (!top || !card) return [];
    const ref = refOf(card.id);
    let def: ZoneId | null = null;
    try {
      def = game.defaultDestination(top, dataOf(ref) ?? undefined, card);
    } catch {
      def = null;
    }
    const zones: { zone: ZoneId; label: string }[] = [
      { zone: `battlefield:${top.controller}`, label: 'Battlefield' },
      { zone: `graveyard:${card.owner}`, label: 'Graveyard' },
      { zone: `exile:${card.owner}`, label: 'Exile' },
      { zone: `hand:${card.owner}`, label: 'Hand' },
    ];
    return zones
      .filter((z) => st.zones[z.zone])
      .map((z) => ({ ...z, isDefault: z.zone === def }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  });
  /** A card's name for the log as this browser may know it now; null for a hidden card (the line says "a card"). */
  function logName(id: InstanceId): string | null {
    if (!st.cards[id]) return null;
    return refOf(id) || st.cards[id].tokenLabel ? nameOf(id) : null;
  }
  /**
   * Card names as each log line was first written (DESIGN "Table model", Hidden cards: a later reveal never names an
   * earlier hidden move); the watch fills in the names this browser could see just before each action (M1-P6).
   */
  const soloShuffles = untrack(() => session.netStatus().mode === 'solo');
  const lines = $derived(
    logLines(mergeTimeline(entries, teamChat, pendingChat), {
      state: st,
      cardName: logName,
      phaseLabel: (id) => game.phases.find((p) => p.id === id)?.label ?? id,
      names: watch.names,
      soloShuffles,
    }),
  );
  /**
   * Chat tabs (DESIGN "Chat and voice", Text chat: table, team and spectator tabs): the team tab when the own seat has a
   * team; the spectator tab for a spectator, and for players while someone watches or once the timeline holds a
   * spectator line (M6-P2, GAPS 22).
   */
  const spectatorLines = $derived(entries.some((e) => e.kind === 'action' && e.action.type === 'chat' && e.action.channel === 'spectator'));
  const chatTabs = $derived<ChatTab[]>([
    'table',
    ...(st.seats[me]?.team && !spectating ? (['team'] as const) : []),
    ...(spectating || watching > 0 || spectatorLines ? (['spectator'] as const) : []),
  ]);
  function sendChat(text: string, channel: ChatTab) {
    const a = session.chat(text, channel);
    followTeam();
    const team = session.team;
    // A team line stays out of the shared log: the team view holds it (and the teammate's), not the pending list.
    if (channel === 'team' && team) teamChat = team.chatLog();
    else pendingChat = addPending(pendingChat, a, session.log(), Date.now());
  }
  const inspectCard = $derived<CardInstance | null>(inspectId ? (st.cards[inspectId] ?? null) : null);
  /** No card of this player's anywhere on the table (M5-P5 empty states: no deck); not for a spectator or before the match. */
  const noDeck = $derived(!spectating && !!st.seats[me] && st.stage === 'match' && !Object.values(st.cards).some((c) => c.owner === me));
  const storageFull = $derived(quotaError || entries.some(isStorageFullLine));
  const keyOf = (a: ActionId, ctx: KeyContext = 'table') => keyLabel(keymap, a, ctx);

  // --- The always-visible HUD (docs/design/m7-hud-proposal.md, Always visible) ------------------------------------
  const mineTurn = $derived(isOwnTurn(st, me));
  /** The one primary button: the next move for this moment (ui/hud/turn.ts). */
  const primary = $derived(primaryAction({ mine: mineTurn, phase: st.turn.phase, phases: game.phases, activeName, offer: untapOffer, spectator: spectating, emptyChair: activeEmpty }));
  /** The primary button's label and kind: the shell's override (the computer game's cues) wins over the turn step. */
  const primaryShown = $derived(primaryOverride ? { label: primaryOverride.label, kind: 'override', disabled: false, quiet: primaryOverride.quiet === true } : { label: primary.label, kind: primary.kind, disabled: !!primary.disabled, quiet: !!primary.disabled });
  function runPrimary(): void {
    if (primaryOverride) {
      primaryOverride.run();
      return;
    }
    const p = primary;
    if (p.disabled) return;
    if (p.kind === 'untapDraw') {
      untapOffer = false;
      commands.untapAndDraw();
    }
    // End turn passes over empty chairs (ui/hud/turn.ts passTarget): at the sandbox it comes straight back.
    if (p.kind === 'endTurn') session.dispatch({ type: 'turnPass', to: passTarget(st, nextActive, isEmptyChair) });
    else if (p.phase) session.dispatch({ type: 'phaseSet', phase: p.phase });
  }
  /** Undo's tooltip names the action it takes back (docs/design/m7-hud-proposal.md, Undo: "Undo: tap Forest"). */
  const undoTip = $derived.by(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.kind === 'action' && l.seat === me) return `Undo: ${tickerText({ ...l, actor: '' })}`;
    }
    return 'Undo';
  });
  /** Another player's hand count on their plate (docs/design/m7-hud-proposal.md, Opponent plate). */
  const handCountOf = (seat: string): number | null => (seat === me ? null : (st.zones[`hand:${seat}`]?.ids.length ?? null));
  /** The evening's proposals open now (Next game, New draft), offered in the Menu behind a confirmation. */
  const offers = $derived(evening ? proposals(st, me) : []);
  const menuGroups = $derived(
    hudMenu(
      { spectator: spectating || readOnly, voice: !!liveVoice, captions: !!session.captions, proposals: readOnly ? [] : offers, muted: voice.muted, importDeck: importOffered },
      (a) => keyOf(a),
      runMenu,
      spectating || readOnly ? {} : { clip: clipTrayDown },
    ),
  );
  function runMenu(id: HudMenuId): void {
    switch (id) {
      case 'drawN':
        commands.run('drawN');
        return;
      case 'mulligan':
      case 'shuffle':
      case 'untapAll':
      case 'token':
      case 'rollDie':
      case 'flipCoin':
      case 'tidy':
      case 'ask':
      case 'fitTable':
        commands.run(id);
        return;
      case 'mute':
        if (liveVoice) liveVoice.toggleMute();
        else hooks.voice('mute', 'start');
        return;
      case 'importDeck':
        deckOpen = true;
        return;
      case 'nextGame':
      case 'newDraft':
        leaving = id;
        return;
      case 'perspective':
        scene?.camera.setTilt(perspectiveToggleTilt(scene.camera.tilt()), { source: 'handle' });
        return;
      case 'look':
        themeOpen = true;
        return;
      case 'voice':
        voicePanel = true;
        return;
      case 'dictation':
        speechTop = 56;
        speechOpen = true;
        return;
      case 'keys':
        cheatOpen = true;
        return;
      case 'settings':
        openSettings();
        return;
      case 'clip':
        return;
    }
  }
  async function confirmLeave(): Promise<void> {
    const event = leaving;
    leaving = null;
    if (!event || !evening) return;
    const moved = await evening.propose(event);
    if (!moved) notify(event === 'nextGame' ? 'The next game did not go ahead.' : 'The new draft did not go ahead.');
  }
  /** Plates at their seat's edge (docs/design/m7-hud-proposal.md, Opponent plate); the own plate stays bottom left. */
  const anchorOf = (seat: string): SeatAnchor | null => {
    const a = anchors.find((x) => x.seat === seat);
    return a?.at ? a : null;
  };

  // KEEP / MULLIGAN (ui/hud/opening.ts): closed for a game by KEEP or once the seat's own first turn ended. Remembered
  // per room, seat and game in this tab (per-tab convenience, as the untap offer below; storage may be unavailable), so
  // a remount or reload in turn 1 does not bring them back.
  const openingKey = `spellplane:opening-closed:${untrack(() => session.roomId)}:${me}`;
  let closedGame = $state<number | null>(
    (() => {
      try {
        const v = sessionStorage.getItem(openingKey);
        return v === null ? null : Number(v);
      } catch {
        return null;
      }
    })(),
  );
  function closeOpening(game: number): void {
    if (closedGame === game) return;
    closedGame = game;
    try {
      sessionStorage.setItem(openingKey, String(game));
    } catch {
      // Not remembered: the chips still follow the table.
    }
  }
  let turnSeen = untrack(() => ({ number: st.turn.number, mine: isOwnTurn(st, me) }));
  $effect(() => {
    const now = { number: st.turn.number, mine: isOwnTurn(st, me) };
    untrack(() => {
      if (ownTurnEnded(turnSeen, now)) closeOpening(gameNumber(st));
      turnSeen = now;
    });
  });

  // On Next turn, offer the new active player (or team) untap-and-draw; close the offer once the turn moves on
  // (DESIGN "Turn flow and confirmation": offered a single key, never done for them).
  // A page that opens (reload, rejoin) after the turn passed to this seat offers it too: from the log, or from the
  // open offer this tab remembers across reloads (per-tab convenience; storage may be unavailable).
  const offerKey = `spellplane:untap-offer:${untrack(() => session.roomId)}:${me}`;
  const readOffered = (): number | null => {
    try {
      const v = sessionStorage.getItem(offerKey);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  };
  const writeOffered = (turn: number | null): void => {
    try {
      if (turn === null) sessionStorage.removeItem(offerKey);
      else sessionStorage.setItem(offerKey, String(turn));
    } catch {
      // Not remembered: the offer still follows the log.
    }
  };
  untapOffer = untrack(() => untapOfferOnOpen(st, me, session.log(), readOffered()));
  let seenTurn = untrack(() => st.turn.number);
  $effect(() => {
    const mine = isOwnTurn(st, me);
    const turn = st.turn.number;
    if (!mine) untapOffer = false;
    else if (turn !== seenTurn) untapOffer = true;
    seenTurn = turn;
  });
  $effect(() => {
    const open = untapOffer;
    const turn = untrack(() => st.turn.number);
    writeOffered(open ? turn : null);
  });
  // A HUD hover lasts only while its card is shown in a HUD surface: a card that leaves the hand (cast, G, E, …) or
  // a pile viewer that closes fires no pointerleave, and a stale hover would steal keys meant for the table.
  $effect(() => {
    const h = hudHover;
    if (!h) return;
    const shown = hand.includes(h) || viewerCards.some((c) => c.id === h) || (logOpen && preview?.card === h);
    if (!shown) hudHover = null;
  });
  // Drop selection entries for cards that left the table.
  $effect(() => {
    const live = selection.filter((id) => st.cards[id]);
    if (live.length !== selection.length) selection = live;
  });

  // --- Touch (M5-P1; DESIGN "Input and interaction design", Touch) ------------------------------------------------------
  /** Whether a radial action applies to the menu's card (Commands.applies, as the context menu decides). */
  function radialApplies(card: InstanceId, action: ActionId): boolean {
    const c = st.cards[card];
    return !!c && commands.applies(action, c);
  }
  // The menu closes when its card leaves the table.
  $effect(() => {
    if (radial && !st.cards[radial.card]) radial = null;
  });
  /** The debug hook's touch part (debug/types.ts TouchDebug). */
  const touchDebug = {
    gestures: () => recentGestures(),
    radial: (): RadialMenuState | null => {
      const r = radial;
      if (!r) return null;
      return {
        card: r.card,
        at: { ...r.at },
        slots: RADIAL_SLOTS.map((slot) => ({
          id: slot.id,
          enabled: slotAction(slot, (a) => radialApplies(r.card, a)) !== null,
          screen: document.querySelector(`[data-testid="radial-${slot.id}"]`)?.getBoundingClientRect() ?? new DOMRect(),
        })),
      };
    },
    thumbBar: () => (thumbShown ? [...THUMB_BAR] : []),
  };
  /** Safe-area insets the radial menu keeps clear of (read when it opens). */
  const radialInsets = $derived(safeInsets);
  // --- Keyboard card focus and the live region (DESIGN "Input and interaction design", Accessibility; PLAN M5-P4) ---
  /** The focus order's viewer: the own seat, or none for a spectator (who starts at the stack). */
  const a11yViewer = $derived(st.seats[me] ? me : null);
  /** The focus order's extras: the hand's fan order, and the own library cards the pile viewer shows (Search, Look at top N). */
  const focusOpts = $derived({ handOrder: hand, looked: viewer?.looked ? { zone: viewer.zone, ids: viewer.looked.map((l) => l.id) } : null });
  /**
   * A card's name for the focus and its menu: as `nameOf`, and a card of the own library the pile viewer shows by the
   * identity this browser was shown (it stays in this browser: the mirror and the live region are local).
   */
  function focusName(id: InstanceId): string {
    if (refOf(id)) return nameOf(id);
    const ref = viewer?.looked?.find((l) => l.id === id)?.ref;
    return ref ? (dataOf(ref)?.name ?? 'Card') : nameOf(id);
  }
  /** The focused zone's cards in focus order as last seen, so focus on a card that leaves passes to its neighbour. */
  let focusOrder: InstanceId[] = [];
  /** Where the pointer was when the keyboard last moved focus: a pointer that moves away onto a card takes over. */
  let focusPointer = { x: 0, y: 0 };
  const { announcer, release: releaseAnnouncer } = pageAnnouncer();
  let mirrorEl = $state<HTMLElement | undefined>();
  function setFocus(next: CardFocus | null, speak: boolean): void {
    focus = next;
    focusOrder = next ? focusCards(st, game, a11yViewer, next.zone, focusOpts) : [];
    focusPointer = { x: pointer.x, y: pointer.y };
    if (speak && next) announcer.focus(describeFocus(st, game, a11yViewer, next, focusName, focusOpts));
  }
  function moveKeyFocus(move: FocusMove): void {
    setFocus(moveFocus(st, game, a11yViewer, focus, move, focusOpts), true);
    // The mirror takes DOM focus, so a screen reader follows (unless a HUD control has it).
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (mirrorEl && active !== mirrorEl && (!active || active === document.body || (sceneHost?.contains(active) ?? false))) mirrorEl.focus({ preventScroll: true });
  }
  /** HUD panels whose controls keep the arrow and Page keys while they hold DOM focus (ownsArrows). */
  const ARROW_PANELS = ['settings', 'audit-panel', 'theme-settings', 'voice-panel', 'deck-import', 'token-search', 'reveal-to', 'log-lines', 'cheat-sheet']
    .map((id) => `[data-testid="${id}"]`)
    .concat('.theme-pop', '.voice-pop')
    .join(', ');
  /**
   * Keys the focused element uses itself: arrows in a select, slider, menu, list box or grid are not card focus, nor
   * are they inside a dialog or a HUD panel (M5 review: the settings panel, the audit panel, the theme popover, a
   * prompt), where they belong to the panel's controls or scroll it.
   */
  function ownsArrows(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el?.closest) return false;
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && ['range', 'radio', 'number'].includes((el as HTMLInputElement).type))) return true;
    if (el.closest('[role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="radiogroup"], [role="tablist"], [role="grid"], [role="tree"]')) return true;
    if (el.closest('dialog, [role="dialog"], [role="alertdialog"]')) return true;
    // HUD panels (their roots), and the scrollable regions that scroll with arrows and Page keys when they hold DOM
    // focus: the log lines, the cheat sheet.
    return !!el.closest(ARROW_PANELS);
  }
  // The table changed: focus stays on its card, or passes to the card that took its place (ui/a11y keepFocus).
  $effect(() => {
    const s = st;
    const opts = focusOpts;
    untrack(() => {
      if (!focus) return;
      const next = keepFocus(s, game, a11yViewer, focus, focusOrder, opts);
      const moved = next?.zone !== focus.zone || next?.card !== focus.card;
      if (moved) focus = next;
      focusOrder = next ? focusCards(s, game, a11yViewer, next.zone, opts) : [];
      // The next key acts on another card: say which, after the log line of the move. That line is queued by the log
      // effect below in this same update, so the focus waits for the update to settle, then follows the waiting lines.
      if (moved && next) {
        const text = describeFocus(s, game, a11yViewer, next, focusName, opts);
        void tick().then(() => {
          if (focus?.zone === next.zone && focus.card === next.card) announcer.focusAfterLog(text);
        });
      }
    });
  });
  /** The last input wins: any press on the table (a click, the start of a box selection) ends the keyboard focus (M5 review). */
  function pressOnTable(): void {
    if (focus) setFocus(null, false);
  }
  /** The last input wins: a pointer moved onto a card hands the keys back to hover (window pointermove, after the scene's hover). */
  function pointerTakesOver(): void {
    if (focus && hovered !== null && hovered !== focus.card && Math.hypot(pointer.x - focusPointer.x, pointer.y - focusPointer.y) > 4) focus = null;
  }
  const focusText = $derived(focus ? describeFocus(st, game, a11yViewer, focus, focusName, focusOpts) : null);
  const mirrorCards = $derived(focus ? focusCards(st, game, a11yViewer, focus.zone, focusOpts).map((id) => ({ id, text: describeCard(st, id, focusName), current: id === focus?.card })) : []);
  // New log lines are announced once each, batched (ui/a11y/log.ts, announcer.ts).
  const logAnnouncements = new LogAnnouncements(untrack(() => me));
  $effect(() => {
    const texts = logAnnouncements.next(lines);
    untrack(() => {
      for (const t of texts) announcer.announce(t);
    });
  });
  // Prompts addressed to this player are assertive: a confirmation round to answer, the untap offer.
  let promptSpoken: string | null = null;
  $effect(() => {
    const p = prompt;
    if (!p || p.mode !== 'respond' || promptSpoken === p.round.id) return;
    promptSpoken = p.round.id;
    untrack(() => {
      const asker = st.seats[p.round.askedBy]?.name || 'A player';
      announcer.announce(`${asker} ${roundWhat(st, p.round, nameOf)}. ${keyOf('confirmOk', 'prompt') || 'Enter'}: OK. ${keyOf('confirmHold', 'prompt') || 'Escape'}: hold.`, 'assertive');
    });
  });
  $effect(() => {
    if (untapOffer) untrack(() => announcer.announce('Your turn. U: untap all and draw.', 'assertive'));
  });

  // --- Scene ------------------------------------------------------------------------------------------------------
  $effect(() => {
    if (!sceneReady || !scene) return;
    // With a keyboard focus the keys act on the focused card, so the scene shows no hover outline on another (M5-P4).
    const view: ViewState = { selection: [...selection], hovered: focus ? null : hovered, focused: focus?.card ?? null, privateFaces, reducedMotion, pings, openPile: viewer?.zone ?? openPile, captions: sceneCaptions(captionList, st) };
    scene.update(st, view);
  });

  // The hovered card or stack item is a caption's anchor (DESIGN "Chat and voice", Placement: "last acted on or is
  // hovering"). A stack marker (an ability or trigger) has no card: the scene reports it on its own.
  let captionHover = '';
  function syncCaptionHover(hoveredCard: InstanceId | null): void {
    if (!session.captions) return;
    // A held press that talks keeps its card as the anchor while it drags it (M6-P2, ui/voice/press.ts).
    const card = pressTalk.anchorCard() ?? hoveredCard;
    const item = card ? null : hoveredStackItem(scene);
    const anchor: Anchor | null = card ? { kind: 'card', id: card } : item ? { kind: 'stackItem', id: item } : null;
    const key = anchor ? `${anchor.kind}:${anchor.id}` : '';
    if (key === captionHover) return;
    captionHover = key;
    session.captions.hover(anchor);
  }
  $effect(() => {
    const h = hovered;
    untrack(() => syncCaptionHover(h));
  });
  /** "Talk while I hold or drag" (M6-P2): the scene's held table presses open the mic; captions attach to the pressed card. */
  const pressTalk = new PressTalk({
    voice: liveVoice,
    cardAt: (x, y) => scene?.cardAt(x, y) ?? null,
    onAnchor: () => syncCaptionHover(hovered),
  });
  /** While the note field has focus, dictation goes into it (DESIGN "Chat and voice", Notes by voice). */
  function dictateNote(on: boolean): void {
    // The note open at focus: a late final is written only while that note is still the one open (never another card's).
    const open = on ? note : null;
    session.captions?.dictateInto(
      open
        ? fieldDictation(
            () => (note === open ? open.text : null),
            (text) => {
              if (note === open) open.text = text;
            },
            80,
          )
        : null,
    );
  }

  // A note field removed without a blur (Enter, Escape) hands dictation back to captions. WebKit fires no focusout for
  // a removed field, so the talk state is told what has focus now (else it stays on the gone field and drops words).
  $effect(() => {
    if (note === null)
      untrack(() => {
        dictateNote(false);
        if (typeof document !== 'undefined') liveVoice?.focus(focusKind(document.activeElement));
      });
  });

  let seenLog = 0;
  function onLog(log: typeof entries) {
    const fade = theme.motion.pingFadeMs;
    for (let i = seenLog; i < log.length; i++) {
      const e = log[i];
      if (e?.kind === 'action' && e.action.type === 'ping') {
        const ping: ActivePing = { id: `${e.action.cid}`, target: e.action.target, seat: e.action.by };
        pings = [...pings, ping];
        later(() => (pings = pings.filter((p) => p !== ping)), fade);
      }
    }
    // A log that shrank (a resume replaced it) rings nothing.
    if (log.length > seenLog) sound.play(cuesFor(log.slice(seenLog), me));
    if (log.length > seenLog) for (const z of shuffledZones(log.slice(seenLog), st)) scene?.animate?.({ kind: 'shuffle', cards: [], from: z, cue: null }); // M7-P5: the pile riffles
    seenLog = log.length;
  }

  /**
   * The viewer's quality level and follow toggles (DESIGN "Themes and rendering", Renderer; "Camera and navigation",
   * Follow options), handed to the scene whenever they differ from what it has: on mount, when the picker changes them,
   * and when the window regains focus or becomes visible (another tab may have changed them; SettingsStore has no change
   * events). The scene keeps the quality choice across theme switches.
   */
  const view = new ViewSettings(untrack(() => settings));
  let viewPrefs = $state.raw<ViewPrefs>(view.state());
  function syncView(): void {
    void view.refresh();
  }

  onMount(() => {
    installReducedMotionCss();
    const unwatchMotion = watchReducedMotion((v) => (reducedMotion = v));
    registerDebug({ a11y: { focus: () => focus, announcements: () => announcer.history() } });
    registerHudDebug(() => document.querySelector('[data-testid="hud"]'));
    seenLog = entries.length;
    watch.start(entries);
    followTeam();
    const unsubView = view.subscribe((p) => (viewPrefs = p));
    syncView();
    const unsub = session.subscribe((s) => {
      followTeam();
      const log = session.log();
      // Before the HUD moves on: names this browser could see and other players' cards touched (M1-P6).
      watch.observe(log, st, s, logName);
      st = s;
      secrets = session.secrets();
      onLog(log);
      entries = log;
      pendingChat = prunePending(pendingChat, log);
    });
    // The talk key's focus rules and the talk mouse button (M3-P3), and the speaking rings.
    const voiceOff = liveVoice ? attachTalkInput(liveVoice, window) : null;
    // The Ctrl talk key under the hold-alone rule (M5-P7), on the talk and team talk bindings with the player's
    // remappings: it runs the talk actions like any talk key once it counts (the KeyEngine never matches a bare modifier).
    const chordOf = (action: 'talk' | 'teamTalk') => keymap.find((b) => b.action === action && b.context === 'table')?.chord ?? null;
    const modifierOff = attachModifierTalkActions(window, (action, phase) => hooks.voice(action, phase), { talkChord: () => chordOf('talk'), teamTalkChord: () => chordOf('teamTalk'), onHold: (h) => (talkHold = h) });
    const speakOff = liveVoice?.subscribe(() => {
      speaking = liveVoice.speaking();
      hints.setContext({ voice: liveVoice.joined });
    });
    // Who is typing (M6-P2): presence, the connections (spectators' nicknames) and the seats (names, teams).
    refreshTypers();
    const typingOff = session.presence.subscribe(() => refreshTypers());
    const typingNetOff = session.subscribeNet(() => refreshTypers());
    const typingStateOff = session.subscribe(() => refreshTypers());
    // A typing peer that went silent (a lost stop) drops out after TYPING_STALE_MS even if nothing else changes.
    const typingTimer = setInterval(() => typers.length > 0 && refreshTypers(), 1000);
    captionList = session.captions?.captions() ?? [];
    const unsubCaptions = session.captions?.subscribe((list) => (captionList = list));
    void settings
      ?.get('sound')
      .then((m) => (soundMode = soundModeOf(m)))
      .catch(() => (soundMode = 'theme'));
    const unsubKeys = keySettings.subscribe((o) => (overrides = o));
    void keySettings.load();
    const unsubBack = cardBack.subscribe((s) => (backState = s));
    void cardBack.refresh();
    void hints.load();
    try {
      const layout = layoutOf(game, st);
      if (!layout) throw new Error('the game definition has no table layout yet');
      scene = createScene(sceneHost!, {
        game,
        layout,
        viewerSeat: me,
        theme,
        faces,
        readOnly: viewOnly,
        dispatch: (d) => session.dispatch(d),
        events: {
          hover: (id) => (sceneHover = id),
          contextMenu: (id, at) => openMenu(id, at.x, at.y),
          clipMenu: (clip, at) => openClipMenu(clip, at),
          inspect: (id) => hooks.inspect(id),
          pileOpen: (id) => {
            const kind = id.split(':')[0];
            // Double-click draws from the own library and opens any other pile (DESIGN "Input and interaction design", Mouse).
            if (id === `library:${me}` && !viewOnly) commands.run('draw');
            else if (st.zones[id] && (kind === 'library' || kind === 'graveyard' || kind === 'exile')) openViewer(id);
            else openPile = openPile === id ? null : id;
          },
          selectionChange: (ids) => (selection = [...ids]),
          seatAnchors: (a) => (anchors = a),
          selectionAnchor: (a) => (selAnchor = a), // M7-P5
          pileHover: (h) => (pileHover = h), // M7-P5
          readOnly: (on) => (sceneReadOnly = on), // M7-P5
          pressHold: (phase, kind) => pressTalk.hold(phase, kind),
          radialMenu: (id, at) => {
            menu = null;
            // Look, do not touch: a long-press opens the look-only menu (inspect, zoom) instead of the acting ring.
            if (viewOnly) {
              radial = null;
              if (id && st.cards[id]) openMenu(id, at.x, at.y);
              return;
            }
            radial = id && !spectating && st.cards[id] ? { card: id, at: { x: at.x, y: at.y } } : null;
            if (radial) radialPoint = { ...radial.at };
          },
        },
      });
      sceneTheme = theme;
      sceneReady = true;
      registerDebug({ touch: touchDebug });
      // The viewer's quality and follow toggles (Settings.quality, followStack, followActive).
      view.attach(scene);
      // M7-P5: the viewer's Settings.motion (a 'system' setting follows ViewState.reducedMotion, which the scene reads already).
      void settings?.get('motion').then((m) => { if (scene && m && m !== 'system') scene.setMotion?.(resolveMotion(m, reducedMotion)); }, () => undefined); // M7-P5
      // Other players' cursors and drags in their seat colour (DESIGN "Players, seats and formats"; M1-P5).
      presence = attachPresence(sceneHost!, scene, session.presence, {
        selfSeat: me,
        state: () => st,
        selection: () => selection,
        colourOf: (seat) => theme.tokens.colours.seats[(seat ? st.seats[seat]?.colour : undefined) ?? 0]?.colour ?? '#555',
        labelOf: (p) => (p.seat && st.seats[p.seat]?.name) || 'Player',
      });
    } catch (e) {
      sceneError = e instanceof Error ? e.message : String(e);
    }
    const unblock = blockPageGestures();
    return () => {
      unblock();
      const hook = window.__spellplane as Record<string, unknown> | undefined;
      if (hook?.touch === touchDebug) delete hook.touch;
      unwatchMotion();
      releaseAnnouncer();
      unsub();
      unsubKeys();
      unsubBack();
      cardBack.dispose();
      unsubView();
      view.dispose();
      voiceOff?.();
      typingOff();
      typingNetOff();
      typingStateOff();
      clearInterval(typingTimer);
      pressTalk.dispose();
      modifierOff();
      speakOff?.();
      teamUnsub?.();
      teamUnsub = null;
      unsubCaptions?.();
      session.captions?.dictateInto(null);
      for (const t of timers) clearTimeout(t);
      timers = [];
      engine.blur();
      presence?.stop();
      presence = null;
      scene?.dispose();
      scene = null;
      sound.dispose();
    };
  });
</script>

<svelte:window
  bind:innerWidth={vw}
  bind:innerHeight={vh}
  {onkeydown}
  {onkeyup}
  {onfocusin}
  {onclick}
  onblur={() => engine.blur()}
  onunhandledrejection={(e) => {
    if (isQuotaError(e.reason)) quotaError = true;
  }}
  onfocus={() => syncView()}
  onpointerdowncapture={(e) => {
    if (e.pointerType === 'touch') touchUi = true;
  }}
  onpointermove={(e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointerSeen = true;
    pointerTakesOver();
    syncCaptionHover(hovered);
  }}
/>
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && syncView()} />

{#snippet plate(seat: Seat, mine: boolean)}
  <Avatar
    bind:moreOpen={openPlates[seat.id]}
    {seat}
    life={lifeOf(seat.id)}
    me={mine}
    active={st.turn.active === seat.id || st.turn.active === seat.team}
    speaking={speaks(seat.id)}
    typing={!mine && typingAt.has(seat.id)}
    responding={st.confirm?.holder === seat.id}
    asking={asking(seat.id)}
    glyph={glyphOf(seat.colour)}
    zones={zoneButtons(seat.id)}
    handCount={handCountOf(seat.id)}
    onlife={(delta) => session.dispatch({ type: 'life', seat: seat.id, delta })}
    oncounter={(kind, delta) => session.dispatch({ type: 'playerCounter', seat: seat.id, kind, delta })}
    onopenzone={openViewer}
    ongoto={() => scene?.camera.goToSeat(seat.id)}
    readonly={spectating || viewOnly}
    compact={!mine && seatCount >= 3}
    away={isAway(seat.id)}
    badge={plateBadge}
    menuTop={plateMenuTop}
    voiceControls={!mine && !!liveVoice}
    peerAudio={!mine && liveVoice && seat.peer ? peerAudioOf(seat.peer) : undefined}
    onrevealhand={!mine && !spectating && !viewOnly && hand.length > 0 ? () => revealHandTo([seat.id]) : undefined}
  />
{/snippet}

<div class="root ds-root sp-hud" class:touch-ui={touchUi} style:--thumb-space="{thumbShown ? THUMB_BAR_SPACE_PX : 0}px" data-look={look} style={cssVars} data-testid="hud" data-sound={soundState} data-card-back={backState.status}>
  <!-- Positioned inline as well as in the stylesheet: the scene and the presence layer read the host's computed
       position when they attach and make a static host relative; before the stylesheet applied (WebKit, a component
       stylesheet still loading) that left the host relative and 0 px high, with the table drawn into nothing. -->
  <div class="scene" style:position="absolute" style:inset="0" data-testid="scene-host" data-fit-insets={fitInsets} bind:this={sceneHost} onpointerdowncapture={(e) => {
      pressOnTable();
      pressTalk.down(e.clientX, e.clientY);
    }}></div>
  {#if sceneError}<p class="scene-error" role="status">Table unavailable: {sceneError}</p>{/if}
  <Flashes
    {watch}
    table={st}
    scene={() => scene}
    fadeMs={theme.motion.pingFadeMs}
    {reducedMotion}
    seatName={(s) => st.seats[s]?.name ?? s}
    seatColour={(s) => st.seats[s]?.colour ?? null}
  />

  <div class="layer">
    <!-- Top left: the Menu and Undo (docs/design/m7-hud-proposal.md, Always visible). -->
    {#if full}
    <div class="top-left" data-hud-chrome="tools" bind:offsetWidth={toolsWidth}>
      <nav class="toolbar sp-bar" aria-label="Table tools" data-testid="hud-bar">
        {#if onleave}
          <button type="button" class="ds-btn ds-icon-btn ds-btn--quiet sp-h-md sp-round" data-testid="leave" aria-label="Leave" title="Leave: the game is kept in your history" onclick={() => onleave?.()}
            ><svg class="sp-arrow" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button
          >
          <span class="sp-divider" aria-hidden="true"></span>
        {/if}
        <button
          bind:this={menuButton}
          type="button"
          class="ds-btn ds-icon-btn ds-btn--quiet sp-h-md sp-pill"
          data-testid="open-menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Menu"
          title="Menu: this game, deck, tokens, dice, view, voice, keys, settings"
          onclick={() => (menuOpen = !menuOpen)}><Icon name="menu" /><span class="sp-word">Menu</span></button
        >
        {#if !spectating && !readOnly}
          <button type="button" class="ds-btn ds-icon-btn ds-btn--quiet sp-h-md sp-pill" data-testid="undo" aria-label="Undo" title="{undoTip}{keyOf('undo') ? ` (${keyOf('undo')})` : ''}" onclick={() => commands.run('undo')}><Icon name="undo" /><span class="sp-word">Undo</span></button>
        {/if}
        {#if !liveVoice}
          {#if voice.talking}<span class="ds-chip" data-testid="talking">{voice.talking === 'teamTalk' ? 'Team talk' : 'Talking'}</span>{/if}
          {#if voice.muted}<span class="ds-chip" data-testid="muted">Muted</span>{/if}
        {/if}
      </nav>
      {#if menuOpen}
        <div class="menu-pop">
          <HudMenu groups={menuWithShell(shellGroups(menuTop?.()), menuGroups)} label="Menu" anchor={menuButton ?? null} onclose={() => (menuOpen = false)} />
        </div>
      {/if}
      {#if themeChoice && themeOpen}
        <div class="theme-pop" bind:this={themeAnchor}><ThemePicker choice={themeChoice} sound={{ mode: soundMode ?? 'theme', set: setSoundMode }} view={{ prefs: viewPrefs, set: (name, value) => void view.set(name, value).catch(() => {}) }} onclose={() => (themeOpen = false)} /></div>
      {/if}
    </div>
    {/if}

    <!-- Top centre: the turn tracker and the plates without a seat edge. -->
    <div class="top-centre" data-hud-chrome="tracker" style:left={trackerRoom ? `${trackerRoom.centre}px` : null}>
      {#if full}
      <TurnStrip
        compact={trackerRoom?.compact ?? false}
        turn={st.turn.number}
        {activeName}
        {activeColour}
        mine={mineTurn}
        phases={game.phases}
        current={st.turn.phase}
        nextPhaseKey={keyOf('nextPhase')}
        onphase={(phase) => !readOnly && session.dispatch({ type: 'phaseSet', phase })}
      />
      {/if}
      {#if status}<div class="sp-status" data-testid="hud-status">{@render status()}</div>{/if}
      <!-- Other players' plates without a reported seat edge sit in a row under the tracker. -->
      <div class="plates-row">
        {#each others as seat (seat.id)}
          {#if !anchorOf(seat.id)}
            <div class="plate-top" data-hud-chrome="plate" class:menu-open={!!openPlates[seat.id]}>{@render plate(seat, false)}</div>
          {/if}
        {/each}
      </div>
    </div>

    {#each others as seat (seat.id)}
      {@const a = anchorOf(seat.id)}
      {#if a?.at}
        <!-- At the seat's table edge (SceneEvents.seatAnchors), moved by a transform when the camera settles. -->
        {@const at = anchorPoint({ ...a, at: a.at }, anchorWidths[seat.id] ?? 240)}
        <div class="plate-anchor" data-hud-chrome="plate" data-side={sideOf(a) ?? 'across'} class:plate-top={a.at.y < vh / 2} class:menu-open={!!openPlates[seat.id]} bind:offsetWidth={anchorWidths[seat.id]} style:transform="translate({at.x}px, {at.y}px)">{@render plate(seat, false)}</div>
      {/if}
    {/each}

    <!-- Top right: the activity button and its ticker; the drawer opens over the right edge. -->
    {#if full}
    <div class="right" class:open={logOpen} data-hud-chrome="activity">
      {#if logOpen}
        <!-- The tilt keeps its visible handle while the drawer is open: beside the drawer, at the Activity button's place. -->
        <div class="view-beside"><ViewControl camera={() => scene?.camera ?? null} /></div>
      {/if}
      <LogPanel
        bind:this={logPanel}
        {lines}
        open={logOpen}
        ontoggle={() => (logOpen = !logOpen)}
        onchat={sendChat}
        {cardData}
        {faces}
        {back}
        tabs={chatTabs}
        {typers}
        ontyping={(channel) => session.presence.typing(channel)}
        onhovercard={(card, x, y) => {
          preview = card ? { card, x, y } : null;
          hudHover = card;
        }}
      >
        {#snippet under()}<ViewControl camera={() => scene?.camera ?? null} />{/snippet}
      </LogPanel>
    </div>
    {/if}

    {#if st.seats[me]}
      <div class="own-avatar" data-hud-chrome="own-plate" bind:offsetWidth={plateWidth}>{@render plate(st.seats[me], true)}</div>
    {/if}

    <!-- Bottom right, above the primary: the stack's controls while something is on the stack (out of the top centre,
         where they covered the opponent's plate and row of card backs; gate M1, seam fix M8-P8). -->
    <div class="stack-dock" data-hud-chrome="stack" bind:offsetWidth={stackWidth}>
      {#if top && full}
        <div class="stack-chip ds-panel" data-testid="stack-chip">
          <span class="ds-label">Stack {st.stack.length}</span>
          {#if !readOnly}
          <button type="button" class="ds-btn sp-h-xs sp-pill" class:lit={resolveLit} data-testid="resolve" title="Resolve{keyOf('resolve') ? ` (${keyOf('resolve')})` : ''}" onclick={() => commands.run('resolve')}>Resolve</button>
          {#if resolveTargets.length}
            <span class="to" data-testid="resolve-to">to
              {#each resolveTargets as t (t.zone)}
                <button type="button" class="ds-btn ds-btn--quiet sp-h-xs sp-pill" class:default={t.isDefault} data-zone={t.zone} aria-label="Resolve to {t.label}{t.isDefault ? ' (default)' : ''}" onclick={() => commands.resolveTop(t.isDefault ? undefined : t.zone)}>{t.label}</button>
              {/each}
            </span>
          {/if}
          <button type="button" class="ds-btn sp-h-xs sp-pill" title="Counter{keyOf('counterTop') ? ` (${keyOf('counterTop')})` : ''}" onclick={() => commands.run('counterTop')}>Counter</button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Bottom right: Talk and the one primary button. -->
    {#if full}
    <div class="bottom-right" data-hud-chrome="primary" bind:offsetWidth={rightWidth}>
      {#if liveVoice}
        <div class="talk-cluster">
          {#if voicePanel}
            <!-- The voice panel opens above the Talk button it belongs to (and from the Menu's "Voice and microphone…"). -->
            <div class="voice-pop"><VoicePanel voice={liveVoice} {session} onclose={() => (voicePanel = false)} /></div>
          {/if}
          <TalkButton voice={liveVoice} talkKey={keyOf('talk') || 'Ctrl'} panelOpen={voicePanel} hold={talkHold} ontogglepanel={() => (voicePanel = !voicePanel)} />
        </div>
      {/if}
      {#if !spectating && !readOnly}
        <button
          type="button"
          class="ds-btn sp-h-lg sp-pill sp-primary"
          class:ds-btn--primary={!primaryShown.quiet}
          class:sp-primary-quiet={primaryShown.quiet}
          data-testid="primary-action"
          data-kind={primaryShown.kind}
          aria-disabled={primaryShown.disabled ? 'true' : undefined}
          title={primaryOverride ? primaryOverride.label : primary.kind === 'endTurn' && keyOf('nextTurn') ? `End the turn (${keyOf('nextTurn')})` : primary.kind === 'untapDraw' ? 'Untap all your permanents and draw a card (U)' : primary.label}
          onclick={runPrimary}>{primaryShown.label}</button
        >
      {/if}
    </div>
    {/if}

    <!-- Above the hand, centred (DESIGN "Specification: geometry, layout and motion", Screen layer); with a teammate's fan shown, above that fan too. -->
    {#if full && thumbShown && !readOnly}
      <div class="thumbs" data-hud-chrome="thumbs" style:bottom={teamFanShown ? `${teamFanTop(vh) + 8}px` : null}>
        <ThumbBar run={(a, phase) => commands.run(a, phase)} keyOf={(a) => keyOf(a)} talking={voice.talking === 'talk'} {resolveLit} />
      </div>
    {/if}
    <!-- The shell's notice shows in every chrome (a waiting room's "Ben left the table"); the rest only at the full HUD. -->
    <div class="above-hand" data-testid="above-hand" data-hud-chrome="above-hand" style:bottom={aboveHandBottom} bind:this={aboveEl} bind:offsetHeight={aboveHeight}>
      {#if full}
      {#if storageFull && !storageFullDismissed}
        <div class="state"><EmptyState id="storageFull" action={{ label: 'Storage settings', run: () => openSettings('storage'), testid: 'empty-storage-settings' }} ondismiss={() => (storageFullDismissed = true)} /></div>
      {/if}
      {#if noDeck && !deckOpen && !readOnly}
        <NoDeck onchoose={onchoosedeck} onpaste={importOffered ? () => (deckOpen = true) : undefined} />
      {/if}
      {#if !readOnly && openingHandShown(st, me, hand.length, closedGame)}
        <OpeningHand
          onkeep={() => closeOpening(gameNumber(st))}
          onmulligan={() => commands.run('mulligan')}
        />
      {/if}
      {/if}
      {#if shownNotice}
        <div class="ds-toast sp-notice" role="status" data-testid="hud-notice" data-notice={shownNotice.id}>
          <span>{shownNotice.text}</span>
          {#if shownNotice.action}
            {@const act = shownNotice.action}
            <button
              type="button"
              class="ds-btn sp-h-xs sp-pill"
              data-testid="hud-notice-action"
              onclick={() => {
                const run = act.run;
                shownNotice = null;
                run();
              }}>{act.label}</button
            >
          {/if}
          <button type="button" class="ds-btn ds-btn--quiet ds-icon-btn sp-h-xs sp-round" aria-label="Dismiss" data-testid="hud-notice-close" onclick={() => (shownNotice = null)}><Icon name="close" size={14} /></button>
        </div>
      {/if}
      {#if toast && full}<p class="ds-toast" role="status" data-testid="toast">{toast.text}</p>{/if}
      {#if full}
      {#if untapOffer && !readOnly}
        <!-- The new turn's offer (DESIGN "Turn flow and confirmation": offered, never done for them). The primary button
             says it ("Untap & draw ▸") just under this place, so the offer is no second visible line over the hand
             (gate M8 finding N9): it stays as text for assistive technology (the announcer speaks it once), and U or the
             primary takes it. -->
        <p class="ds-sr-only" data-testid="untap-offer">Your turn. Untap all and draw: the primary button or U.</p>
      {/if}
      <FocusMirror
        bind:el={mirrorEl}
        text={focusText}
        zone={focus ? zoneLabel(st, game, a11yViewer, focus.zone) : null}
        cards={mirrorCards}
        onfocusin={() => {
          if (!focus) setFocus(moveFocus(st, game, a11yViewer, null, 'first', focusOpts), true);
        }}
        oncontextmenu={(e) => {
          // The context-menu key's own event (some platforms send it after the keydown the HUD already handled).
          e.preventDefault();
          if (!menu) openKeyMenu();
        }}
      />
      {#if prompt && !readOnly}
        <ConfirmPrompt
          model={prompt}
          {me}
          seatName={(seat) => st.seats[seat]?.name || seat}
          seatColour={(seat) => st.seats[seat]?.colour ?? null}
          what={roundWhat(st, prompt.round, nameOf)}
          keys={{ ok: keyOf('confirmOk', 'prompt'), hold: keyOf('confirmHold', 'prompt') }}
          reducedMotion={reducedMotion}
          onok={() => commands.run('confirmOk')}
          onhold={() => commands.run('confirmHold')}
          onrelease={() => commands.run('confirmOk')}
        />
      {/if}
      {/if}
    </div>
    {#if full}
    <HandFan
      ids={hand}
      {refOf}
      {nameOf}
      {faces}
      {back}
      hovered={keyTarget}
      focused={focus?.card ?? null}
      {selection}
      {vw}
      {vh}
      onhover={(id) => (hudHover = id)}
      oncontext={(id, x, y) => openMenu(id, x, y)}
      oninspect={(id) => hooks.inspect(id)}
      ondragout={(id, x, y) => dragOut(id, x, y)}
      onselect={(id) => (selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id])}
      touch={touchUi}
      insets={safeInsets}
      span={fanSpan}
      onradial={(id, x, y) => {
        menu = null;
        if (viewOnly) {
          radial = null;
          if (id) openMenu(id, x, y);
          return;
        }
        radial = id && !spectating ? { card: id, at: { x, y } } : null;
      }}
    />
    {#if session.team && teamFanShown}
      <!-- Two-Headed Giant: the teammate's hand above the own fan (M3-P2, ui/hand/*). -->
      <TeamHands team={session.team} state={st} {faces} {vw} {vh} oninspect={(id, ref) => ((inspectId = id), (inspectRef = ref))} />
    {/if}
    {/if}
  </div>

  {#if viewer}
    {@const zone = st.zones[viewer.zone]}
    {#if zone}
      <PileViewer
        title={`${zone.owner && zone.owner !== me ? `${st.seats[zone.owner]?.name ?? zone.owner}'s ` : ''}${zone.kind[0]!.toUpperCase()}${zone.kind.slice(1)}`}
        count={zone.ids.length}
        kind={zone.kind}
        own={zone.owner === me && !viewOnly}
        hidden={zone.visibility !== 'public'}
        cards={viewerCards}
        looking={viewer.looking}
        bind:shuffleOnClose={viewer.shuffleOnClose}
        {faces}
        {back}
        hovered={keyTarget}
        focused={focus?.card ?? null}
        {vw}
        {vh}
        keys={{ draw: keyOf('draw'), drawN: keyOf('drawN'), shuffle: keyOf('shuffle'), mulligan: keyOf('mulligan') }}
        onhover={(id) => (hudHover = id)}
        oncontext={(id, x, y) => openMenu(id, x, y)}
        oninspect={(id) => hooks.inspect(id)}
        ondragout={(id, x, y) => dragOut(id, x, y)}
        onlibrary={libraryAction}
        onclose={closeViewer}
      />
    {/if}
  {/if}

  <!-- M7-P5 affordances -->
  <Affordances
    state={st}
    me={st.seats[me] ? me : null}
    {selection}
    {commands}
    anchor={selAnchor}
    pile={pileHover}
    touch={touchUi}
    spectator={spectating}
    readOnly={sceneReadOnly || viewOnly}
    {vw}
    {vh}
    {coach}
    identity={(c) => dataOf(refOf(c.id))}
    onmore={(card, x, y) => openMenu(card, x, y)}
    onpile={pileAction}
  />
  <CoachMark {coach} touch={touchUi} corner={!touchUi && vw > 1100} bottom={coachBottom} hidden={sceneReadOnly || viewOnly || spectating || !!prompt || untapOffer || !!shownNotice} />
  <!-- /M7-P5 -->

  {#if radial}
    <RadialMenu
      card={radial.card}
      title={nameOf(radial.card)}
      at={radial.at}
      {vw}
      {vh}
      insets={radialInsets}
      applies={(a) => !!radial && radialApplies(radial.card, a)}
      onrun={(card, a) => runOn(card, a)}
      onmore={(card, x, y) => openMenu(card, x, y, false, radialPoint)}
      onclose={() => (radial = null)}
    />
  {/if}

  {#if menu}
    <ContextMenu title={menu.title} entries={menu.entries} x={menu.x} y={menu.y} autofocus={menu.keyboard} onclose={() => (menu = null)} />
  {/if}

  {#if note}
    <div class="inline" style:left="{Math.min(note.x, vw - 260)}px" style:top="{Math.max(8, note.y - 40)}px" data-testid="note-editor">
      <input
        bind:this={noteInput}
        bind:value={note.text}
        data-testid="note-input"
        {...{ [NOTE_FIELD_ATTR]: '' }}
        maxlength="80"
        placeholder="Note (Enter to save, empty clears)"
        aria-label="Note"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) submitNote();
          else if (e.key === 'Escape') note = null;
        }}
        onfocus={() => dictateNote(true)}
        onblur={() => {
          dictateNote(false);
          note = null;
        }}
      />
    </div>
  {/if}

  {#if askField}
    <div class="inline draw-n" data-testid="ask-field">
      <label
        >Ask <input
          bind:this={askInput}
          bind:value={askField.text}
          data-testid="ask-input"
          class="ask"
          maxlength="80"
          placeholder="optional label, e.g. attacks? (Enter)"
          aria-label="Ask label"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
              const text = askField?.text ?? '';
              askField = null;
              commands.ask(text);
            } else if (e.key === 'Escape') askField = null;
          }}
          onblur={() => (askField = null)}
        /></label
      >
      <!-- Asks without a key (touch): the press keeps the field's focus, so its blur does not close it first. -->
      <button
        type="button"
        class="ds-btn sp-h-xs"
        data-testid="ask-submit"
        onmousedown={(e) => e.preventDefault()}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => {
          const text = askField?.text ?? '';
          askField = null;
          commands.ask(text);
        }}>Ask</button
      >
    </div>
  {/if}

  {#if drawN}
    <div class="inline draw-n" data-testid="draw-n">
      <label>{drawN.what === 'mill' ? 'Mill how many?' : 'Draw how many?'} <input bind:this={drawInput} bind:value={drawN.text} data-testid="draw-n-input" inputmode="numeric" enterkeyhint="go" onkeydown={(e) => (e.key === 'Enter' ? submitDrawN() : e.key === 'Escape' && (drawN = null))} onblur={() => (drawN = null)} /></label>
      <!-- The button for a screen without an Enter key (a tablet): its press keeps the focus in the field, whose blur would close it. -->
      <button type="button" class="ds-btn sp-h-xs" data-testid="draw-n-go" onmousedown={(e) => e.preventDefault()} onclick={() => submitDrawN()}>{drawN.what === 'mill' ? 'Mill' : 'Draw'}</button>
    </div>
  {/if}

  {#if revealTo}
    <div class="inline" style:left="{revealAt.left}px" style:top="{revealAt.top}px" bind:offsetWidth={revealW} bind:offsetHeight={revealH} data-testid="reveal-to" role="menu">
      <p>Reveal {revealTo.cards.length === 1 ? nameOf(revealTo.cards[0]!) : `${revealTo.cards.length} cards`} to</p>
      {#if otherSeats.length === 0}
        <p class="muted">No other players at the table.</p>
      {:else}
        {#each otherSeats as s (s.id)}
          <button type="button" class="ds-btn sp-h-xs" data-seat={s.id} onclick={() => doRevealTo([s.id])}>{s.name}</button>
        {/each}
        {#each teamRevealChoices(st, me) as c (c.id)}<button type="button" class="ds-btn sp-h-xs" data-seat={c.id} onclick={() => doRevealTo(c.seats)}>{c.label}</button>{/each}
        {#if otherSeats.length > 1}<button type="button" class="ds-btn sp-h-xs" data-seat="all" onclick={() => doRevealTo(otherSeats.map((s) => s.id))}>Everyone</button>{/if}
      {/if}
      <button type="button" class="ds-btn ds-btn--quiet sp-h-xs x" onclick={() => (revealTo = null)}>Cancel</button>
    </div>
  {/if}

  {#if tokenNear}
    {@const nearCard = tokenNear.near ? st.cards[tokenNear.near] : undefined}
    <TokenSearch
      {cardData}
      near={nearCard ? dataOf(refOf(nearCard.id)) : null}
      onpick={(t) => {
        const near = tokenNear?.near ?? null;
        tokenNear = null;
        commands.createToken(t.id, near, null);
      }}
      onclose={() => (tokenNear = null)}
    />
  {/if}

  {#if deckOpen}
    <DeckImport
      {cardData}
      parse={parseDecklist ?? parsePlainList}
      onimport={async (deck) => {
        await session.importDeck(deck);
        notify(`Imported ${deck.main.length} cards${deck.side.length ? ` and a ${deck.side.length}-card sideboard` : ''}`);
      }}
      onclose={() => (deckOpen = false)}
    />
  {/if}

  {#if speechOpen && session.captions}
    <Speech captions={session.captions} top={speechTop} onclose={() => (speechOpen = false)} />
  {/if}

  {#if settingsOpen}
    <SettingsPanel
      {settings}
      keys={keySettings}
      {cardBack}
      {themeChoice}
      sound={{ mode: soundMode ?? 'theme', set: setSoundMode }}
      view={{ prefs: viewPrefs, set: (name, value) => void view.set(name, value).catch(() => {}) }}
      voice={liveVoice ?? undefined}
      {session}
      captions={spectating ? undefined : session.captions}
      {storageFull}
      section={settingsSection}
      talkKey={keyOf('talk')}
      onclose={() => (settingsOpen = false)}
    />
  {/if}

  <Hint {hints} keyOf={(a) => keyOf(a)} />

  {#if leaving}
    <Dialog title={leaving === 'nextGame' ? 'Start the next game?' : 'Start a new draft?'} testid="leave-confirm" onclose={() => (leaving = null)}>
      <p class="dialog-text">
        {leaving === 'nextGame'
          ? 'This game ends for everyone at the table once they agree, and you go back to your decks to sideboard.'
          : 'This game and the drafted pools end for everyone at the table once all agree, and the table goes back to the lobby.'}
      </p>
      {#snippet actions()}
        <Button variant="quiet" class="sp-h-md" data-testid="leave-cancel" onclick={() => (leaving = null)}>Keep playing</Button>
        <Button variant="primary" class="sp-h-md" data-testid="leave-ok" onclick={() => void confirmLeave()}>{leaving === 'nextGame' ? PROPOSAL_LABELS.nextGame : PROPOSAL_LABELS.newDraft}</Button>
      {/snippet}
    </Dialog>
  {/if}

  {#if cheatOpen}
    <CheatSheet {keymap} onremap={remap} onreset={resetKeys} onclose={() => (cheatOpen = false)} />
  {/if}

  {#if preview && st.cards[preview.card]}
    <div class="preview" data-testid="card-preview" style:left="{Math.max(8, preview.x - 330)}px" style:top="{Math.min(Math.max(8, preview.y - 120), vh - 290)}px">
      <CardFace {faces} cardRef={refOf(preview.card)} {back} alt={nameOf(preview.card)} />
    </div>
  {/if}

  {#if inspectId}
    <Inspect
      {faces}
      cardRef={inspectRef}
      data={dataOf(inspectRef)}
      {back}
      note={inspectCard?.note}
      counters={inspectCard?.counters}
      {vw}
      {vh}
      onclose={() => hooks.inspect(null)}
    />
  {/if}
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    /* iPad Safari (PLAN Milestone 5, owner decisions): no text-selection callout or magnifier on a long press at the
       table; text fields keep selection. */
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    color-scheme: var(--sp-hud-scheme, light);
    background: var(--ds-mat);
    color: var(--ds-ink);
    font-family: var(--ds-font-body);
  }
  .scene {
    position: absolute;
    inset: 0;
  }
  .scene-error {
    position: absolute;
    top: 50%;
    width: 100%;
    text-align: center;
    color: var(--ds-muted);
  }
  .root :global(input),
  .root :global(textarea),
  .root :global([contenteditable]) {
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
  }
  .layer {
    position: absolute;
    /* Inside the iPad's safe area (rounded corners, home indicator); zero elsewhere. */
    inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    pointer-events: none;
    font-size: var(--ds-type-small);
  }
  .top-left {
    position: absolute;
    top: var(--ds-edge);
    left: var(--ds-edge);
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
    align-items: flex-start;
    z-index: 40;
  }
  /* One row that never wraps (critique, iPad 1: "The toolbar breaks into four rows"). */
  .toolbar {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--ds-space-sm);
    pointer-events: auto;
    align-items: center;
  }
  /* The pill bar (Ztyle chrome bar): round buttons, short dividers. */
  .sp-bar {
    background: var(--ds-panel);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-pill);
    box-shadow: var(--ds-elevation-raised);
    padding: 2px;
    gap: 2px;
  }
  .sp-divider {
    width: 1px;
    height: 20px;
    background: var(--ds-line);
  }
  /* Menu and Undo show their word from 1024 px, icon only below. */
  @media (max-width: 1023px) {
    .sp-word {
      display: none;
    }
  }
  /* The shell's status line: no box of its own, so what it renders sits under the tracker as the column's own item, and
     a status that renders nothing (or only hidden elements) adds neither height nor a gap. */
  .sp-status {
    pointer-events: auto;
    display: contents;
  }
  .sp-primary {
    min-width: 200px;
    pointer-events: auto;
  }
  .sp-primary-quiet {
    background: var(--ds-chip);
    color: var(--ds-muted);
    box-shadow: var(--ds-elevation-raised);
  }
  .sp-notice {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    pointer-events: auto;
  }
  .talk-cluster {
    position: relative;
  }
  .voice-pop {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--ds-space-sm));
    z-index: 60;
    pointer-events: auto;
    max-height: calc(100vh - 2 * var(--ds-edge) - var(--ds-control-lg) - 96px);
    overflow-y: auto;
  }
  .menu-pop,
  .theme-pop {
    position: absolute;
    top: calc(var(--ds-control-md) + var(--ds-space-sm));
    left: 0;
    z-index: 60;
    pointer-events: auto;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
  }
  .stack-chip button.lit {
    background: var(--ds-on);
    color: var(--ds-on-ink);
    border-color: var(--ds-on);
  }
  .stack-chip .to button.default {
    border-color: var(--ds-ink);
  }
  .top-centre {
    position: absolute;
    top: var(--ds-edge);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ds-space-sm);
    z-index: 30;
  }
  /* A narrow column above the primary, clear of the hand fan and of the top centre. */
  .stack-dock {
    position: absolute;
    right: var(--ds-edge);
    bottom: calc(var(--ds-edge) + var(--ds-control-lg) + var(--ds-space-sm));
    z-index: 35;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
  }
  @media (max-width: 1100px) {
    .stack-dock {
      bottom: calc(22vh + 16px + var(--ds-control-lg) + var(--ds-space-sm));
    }
  }
  .touch-ui .stack-dock {
    bottom: calc(22vh + 16px + var(--thumb-space, 0px) + var(--ds-control-lg) + var(--ds-space-sm));
  }
  .stack-chip {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-xs);
    align-items: stretch;
    padding: var(--ds-space-sm);
  }
  .stack-chip .to {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: stretch;
    color: var(--ds-muted);
  }
  .plates-row {
    display: flex;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
    justify-content: center;
    max-width: min(900px, calc(100vw - 2 * var(--ds-edge)));
  }
  .plates-row:empty {
    display: none;
  }
  .plate-anchor {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 10;
    /* The transform puts the plate's centre on the anchor. */
    translate: -50% -50%;
    transition: transform var(--ds-duration-slow) var(--ds-ease-standard);
  }
  /* A plate whose "⋯" menu is open lies over the first-run hint (z-index 55), which may sit over the far seat's edge. */
  .plate-anchor.menu-open,
  .plate-top.menu-open {
    position: relative;
    z-index: 56;
  }
  .plate-anchor.menu-open {
    position: absolute;
  }
  .right {
    position: absolute;
    top: var(--ds-edge);
    right: var(--ds-edge);
    display: flex;
    z-index: 50;
  }
  .right.open {
    bottom: calc(22vh + 16px);
    gap: var(--ds-space-sm);
  }
  .view-beside {
    align-self: flex-start;
    pointer-events: auto;
  }
  .own-avatar {
    position: absolute;
    left: var(--ds-edge);
    bottom: var(--ds-edge);
    z-index: 35;
  }
  .bottom-right {
    position: absolute;
    right: var(--ds-edge);
    bottom: var(--ds-edge);
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    z-index: 35;
  }
  /* Where the hand fan spans the width (a narrow window, a touch screen's scrolling fan), the plate and the primary
     button sit just above the hand, within thumb reach, never over a card (docs/design/m7-hud-proposal.md, iPad). */
  @media (max-width: 1100px) {
    .own-avatar,
    .bottom-right {
      bottom: calc(22vh + 16px);
    }
    /* The chips and prompts move above that row, so the plate never covers KEEP. */
    .above-hand {
      --sp-above-row: calc(var(--ds-control-lg) + 24px);
      bottom: calc(22vh + 16px + var(--sp-above-row));
    }
  }
  .touch-ui .own-avatar,
  .touch-ui .bottom-right {
    bottom: calc(22vh + 16px + var(--thumb-space, 0px));
  }
  .touch-ui .above-hand {
    --sp-above-row: calc(var(--ds-control-lg) + 24px);
    bottom: calc(22vh + 16px + var(--thumb-space, 0px) + var(--sp-above-row));
  }
  /* Talk keeps its states and buttons; shortcut text stays out of the primary UI (tooltips name the keys). */
  .talk-cluster :global(kbd) {
    display: none;
  }
  .above-hand {
    position: absolute;
    /* Above the teammate's fan (z-index 19) and the own fan (20), so a raised card never covers OK and Hold: the pointer
       moving from the card up to the prompt would otherwise stay on the card (resume spec, the band-centred fan). */
    z-index: 22;
    left: 50%;
    bottom: calc(22vh + 16px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .state {
    max-width: min(440px, 90vw);
  }
  .state :global(button) {
    pointer-events: auto;
  }
  .thumbs {
    position: absolute;
    z-index: 21;
    left: 50%;
    bottom: calc(22vh + 8px);
    transform: translateX(-50%);
  }
  .offer {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-md);
  }
  .dialog-text {
    margin: 0;
    color: var(--ds-ink);
  }
  .inline {
    position: fixed;
    z-index: 66;
    background: var(--ds-panel-raised);
    color: var(--ds-ink);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-panel);
    box-shadow: var(--ds-elevation-pop);
    padding: 6px 8px;
    font-size: var(--ds-type-small);
    line-height: 1.4;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    max-width: 260px;
  }
  .inline p {
    margin: 0;
    width: 100%;
  }
  .inline input {
    font: inherit;
    width: 220px;
  }
  .draw-n {
    left: 170px;
    bottom: calc(22vh + 16px);
  }
  .draw-n input {
    width: 4em;
  }
  .draw-n input.ask {
    width: min(18em, 60vw);
  }
  .muted {
    color: var(--ds-muted);
  }
  .preview {
    position: fixed;
    z-index: 75;
    width: 200px;
    height: 279px;
    pointer-events: none;
    box-shadow: 0 0 0 1px var(--ds-ink);
    border-radius: 4.76% / 3.41%;
  }
</style>
