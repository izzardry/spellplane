<!--
  The table HUD (PLAN M0-P4): screen-anchored layer over the scene (DESIGN "Camera and navigation", Screen-anchored
  layer) with hand fan, pile viewers, context menu, keymap and cheat sheet, inspect, avatars, turn strip, log and chat,
  deck import and token search. It changes shared state only through TableSession and moves the camera only through
  TableScene.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { mergeTimeline, type ChatTab } from '../core/log';
  import type { Anchor, CardInstance, CardRef, InstanceId, LogEntry, StackItemId, ZoneId } from '../core/types';
  import type { CardData } from '../data/types';
  import type { ActionId, KeyChord, KeyContext } from '../games/types';
  import type { ActivePing, TableScene, ViewState } from '../scene/types';
  import { attachPresence, type PresenceHandle } from '../scene/presence';
  import { hoveredStackItem } from '../scene/stack';
  import type { LookedCard } from '../session/types';
  import type { KeymapOverride } from '../store/types';
  import { cssText, hudCssVars } from '../themes/index';
  import { Commands, isEmptyChair, isOwnTurn, promptKeys, promptShowing, roundPassed, untapOfferOnOpen, type UiHooks } from './commands';
  import ConfirmPrompt from './confirm/ConfirmPrompt.svelte';
  import { promptModel, roundWhat } from './confirm/model';
  import { parsePlainList } from './deck';
  import { logLines } from './describe';
  import Flashes from './chat/Flashes.svelte';
  import { addPending, LogWatch, prunePending } from './chat/watch';
  import { inZoneKind, layoutOf } from './geometry';
  import { fitInsets as fitInsetsFor, handOrder } from './hand';
  import { applyOverrides, chordToString, findConflict, isTextEntry, KeyEngine, keyLabel, matchesChord, RESERVED_KEYS, reservedConflict, validOverrides } from './keymap';
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
  import TalkIndicator from './voice/TalkIndicator.svelte';
  import VoicePanel from './voice/VoicePanel.svelte';
  import { attachModifierTalk, attachTalkInput, focusKind, NOTE_FIELD_ATTR, runTalkAction } from './voice/input';
  import Speech from './settings/Speech.svelte';
  import ThemePicker from './settings/Theme.svelte';
  import { themeContext } from './settings/theme';
  import { ViewSettings, type ViewPrefs } from './settings/view';
  import { cuesFor, soundModeOf, soundOn, ThemeSoundPlayer, type SoundMode } from './sound';
  import { fieldDictation, sceneCaptions } from './settings/captions';
  import type { Caption } from '../voice/types';

  let { session, createScene, faces, cardData, game, theme, settings, parseDecklist, onVoice, newId }: HudProps = $props();

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
  let selection = $state.raw<InstanceId[]>([]);
  let pings = $state.raw<ActivePing[]>([]);
  let openPile = $state<string | null>(null);
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
    if (!scene) return;
    scene.startDrag(id, x, y);
    presence?.beginExternalDrag(id, x, y);
  }
  let sceneReady = $state(false);
  let sceneError = $state('');
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Overlays ------------------------------------------------------------------------------------------------
  let cheatOpen = $state(false);
  let inspectId = $state<InstanceId | null>(null);
  let inspectRef = $state<CardRef | null>(null);
  let viewer = $state<{ zone: ZoneId; looked: LookedCard[] | null; looking: 'top' | 'search' | null; shuffleOnClose: boolean } | null>(null);
  let menu = $state<{ title: string; entries: MenuEntry[]; x: number; y: number } | null>(null);
  let note = $state<{ target: { card: InstanceId } | { item: StackItemId }; x: number; y: number; text: string } | null>(null);
  /** The inline count prompt for draw N (Shift+D) and mill N (table menu). */
  let drawN = $state<{ text: string; what: 'draw' | 'mill' } | null>(null);
  /** The inline Ask field (K): an optional short label, Enter asks (M1-P3). */
  let askField = $state<{ text: string } | null>(null);
  let askInput = $state<HTMLInputElement | undefined>();
  let revealTo = $state<{ cards: InstanceId[]; x: number; y: number } | null>(null);
  let tokenNear = $state<{ near: InstanceId | null } | null>(null);
  let deckOpen = $state(false);
  let toast = $state<{ text: string; id: number } | null>(null);
  let untapOffer = $state(false);
  let logOpen = $state(true);
  let preview = $state<{ card: InstanceId; x: number; y: number } | null>(null);
  let voice = $state<{ talking: 'talk' | 'teamTalk' | null; muted: boolean }>({ talking: null, muted: false });
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
  /** Dictated captions (M3-P4, session.captions) and the speech settings panel. */
  let captionList = $state.raw<Caption[]>([]);
  let speechOpen = $state(false);
  /** Where the speech settings open: just below the Dictation button, wherever the wrapped toolbar puts it. */
  let speechTop = $state<number | undefined>(undefined);
  let noteInput = $state<HTMLInputElement | undefined>();
  let drawInput = $state<HTMLInputElement | undefined>();

  const cssVars = $derived(cssText(hudCssVars(theme.tokens)));
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
  const back = $derived(theme.cardDressing.back ?? game.cardBack);
  /**
   * Screen edges the screen-anchored layer covers, "top right bottom left" in CSS px, for the scene's fit (DESIGN
   * "Camera and navigation", Screen-anchored layer): the toolbar and turn strip row, the open log column, the hand fan
   * with the row above it, and the avatar column. Fitting the table keeps it clear of them, so the own piles are never
   * under the log or the hand at the fitted view.
   */
  /** Two-Headed Giant: the teammate's fan sits above the own one (TeamHands below), and the table fit keeps it clear. */
  const teamFanShown = $derived(!!session.team && Object.keys(st.teams).length > 0);
  const fitInsets = $derived(fitInsetsFor(vh, logOpen, teamFanShown));

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
    view: () => ({ hovered: forcedHover ?? hovered, selection }),
    ui: hooks,
    newId: makeId,
    now: () => Date.now(),
    pointer: () => (pointerSeen ? { x: pointer.x, y: pointer.y } : null),
  });
  const engine = new KeyEngine(
    untrack(() => game.keymap),
    { start: (b) => commands.run(b.action, 'start'), end: (b) => commands.run(b.action, 'end') },
    () => promptKeys(session.getState(), me),
  );
  $effect(() => {
    engine.setKeymap(keymap);
  });

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
    if (menu) menu = null;
    else if (themeOpen) themeOpen = false;
    else if (revealTo) revealTo = null;
    else if (tokenNear) tokenNear = null;
    else if (inspectId) hooks.inspect(null);
    else if (cheatOpen) cheatOpen = false;
    else if (promptUp) return false;
    else if (viewer) closeViewer();
    else if (deckOpen) deckOpen = false;
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
    if (untapOffer && !e.repeat && RESERVED_KEYS.some((r) => matchesChord(r.chord, e))) {
      e.preventDefault();
      untapOffer = false;
      commands.untapAndDraw();
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

  // --- Remapping (persisted through settings) ---------------------------------------------------------------------
  function remap(action: ActionId, context: KeyContext, chord: KeyChord): string | null {
    const clash = findConflict(keymap, chord, context, action)?.label ?? reservedConflict(chord, context);
    if (clash) return `${chordToString(chord)} is already “${clash}”.`;
    remapped = true;
    overrides = [...overrides.filter((o) => !(o.action === action && o.context === context)), { action, context, chord }];
    void settings?.set('keymap', overrides);
    return null;
  }
  /** Set once the player remaps in this session, so a late settings load never overwrites it. */
  let remapped = false;
  function resetKeys() {
    remapped = true;
    overrides = [];
    void settings?.set('keymap', []);
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
    if (!v) return;
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
  function openMenu(card: InstanceId | null, x: number, y: number) {
    const c = card ? st.cards[card] : undefined;
    menu = c ? { title: nameOf(c.id), entries: cardMenu(c, keymap, commands, (a) => runOn(c.id, a)), x, y } : { title: 'Table', entries: tableMenu(keymap, (a) => commands.run(a), libraryExtras), x, y };
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
  const otherAvatars = $derived(others.length);
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
  const glyphOf = (colour: number) => theme.tokens.colours.seats[colour]?.glyph ?? 'circle';
  const activeName = $derived(st.seats[st.turn.active]?.name ?? st.teams[st.turn.active]?.seats.map((s) => st.seats[s]?.name).join(' & ') ?? st.turn.active);
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
  const lines = $derived(
    logLines(mergeTimeline(entries, teamChat, pendingChat), {
      state: st,
      cardName: logName,
      phaseLabel: (id) => game.phases.find((p) => p.id === id)?.label ?? id,
      names: watch.names,
    }),
  );
  /** Chat tabs (DESIGN "Chat and voice", Text chat): the team tab when the own seat has a team. */
  const chatTabs = $derived<ChatTab[]>(st.seats[me]?.team ? ['table', 'team'] : ['table']);
  function sendChat(text: string, channel: ChatTab) {
    const a = session.chat(text, channel);
    followTeam();
    const team = session.team;
    // A team line stays out of the shared log: the team view holds it (and the teammate's), not the pending list.
    if (channel === 'team' && team) teamChat = team.chatLog();
    else pendingChat = addPending(pendingChat, a, session.log(), Date.now());
  }
  const inspectCard = $derived<CardInstance | null>(inspectId ? (st.cards[inspectId] ?? null) : null);
  const keyOf = (a: ActionId, ctx: KeyContext = 'table') => keyLabel(keymap, a, ctx);

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

  // --- Scene ------------------------------------------------------------------------------------------------------
  $effect(() => {
    if (!sceneReady || !scene) return;
    const view: ViewState = { selection: [...selection], hovered, privateFaces, reducedMotion, pings, openPile: viewer?.zone ?? openPile, captions: sceneCaptions(captionList, st) };
    scene.update(st, view);
  });

  // The hovered card or stack item is a caption's anchor (DESIGN "Chat and voice", Placement: "last acted on or is
  // hovering"). A stack marker (an ability or trigger) has no card: the scene reports it on its own.
  let captionHover = '';
  function syncCaptionHover(card: InstanceId | null): void {
    if (!session.captions) return;
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
    const voiceOff = liveVoice ? attachTalkInput(liveVoice, window, { modifier: false }) : null;
    // The Ctrl talk key under the hold-alone rule (M5-P7), on the talk binding with the player's remappings: it runs the
    // talk actions like any talk key once it counts (the KeyEngine never matches a bare modifier).
    let modifierTalk: 'talk' | 'teamTalk' = 'talk';
    const modifierOff = attachModifierTalk(
      window,
      {
        start: (team) => {
          modifierTalk = team ? 'teamTalk' : 'talk';
          hooks.voice(modifierTalk, 'start');
        },
        end: () => hooks.voice(modifierTalk, 'end'),
      },
      { talkChord: () => keymap.find((b) => b.action === 'talk' && b.context === 'table')?.chord ?? null },
    );
    const speakOff = liveVoice?.subscribe(() => (speaking = liveVoice.speaking()));
    captionList = session.captions?.captions() ?? [];
    const unsubCaptions = session.captions?.subscribe((list) => (captionList = list));
    void settings
      ?.get('sound')
      .then((m) => (soundMode = soundModeOf(m)))
      .catch(() => (soundMode = 'theme'));
    void settings
      ?.get('keymap')
      .then((o) => {
        if (!remapped) overrides = validOverrides(o);
      })
      .catch(() => {});
    try {
      const layout = layoutOf(game, st);
      if (!layout) throw new Error('the game definition has no table layout yet');
      scene = createScene(sceneHost!, {
        game,
        layout,
        viewerSeat: me,
        theme,
        faces,
        dispatch: (d) => session.dispatch(d),
        events: {
          hover: (id) => (sceneHover = id),
          contextMenu: (id, at) => openMenu(id, at.x, at.y),
          inspect: (id) => hooks.inspect(id),
          pileOpen: (id) => {
            const kind = id.split(':')[0];
            // Double-click draws from the own library and opens any other pile (DESIGN "Input and interaction design", Mouse).
            if (id === `library:${me}`) commands.run('draw');
            else if (st.zones[id] && (kind === 'library' || kind === 'graveyard' || kind === 'exile')) openViewer(id);
            else openPile = openPile === id ? null : id;
          },
          selectionChange: (ids) => (selection = [...ids]),
        },
      });
      sceneTheme = theme;
      sceneReady = true;
      // The viewer's quality and follow toggles (Settings.quality, followStack, followActive).
      view.attach(scene);
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
    return () => {
      unsub();
      unsubView();
      view.dispose();
      voiceOff?.();
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
  onfocus={() => syncView()}
  onpointermove={(e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointerSeen = true;
    syncCaptionHover(hovered);
  }}
/>
<svelte:document onvisibilitychange={() => document.visibilityState === 'visible' && syncView()} />

<div class="root" style={cssVars} data-testid="hud" data-sound={soundState}>
  <div class="scene" data-testid="scene-host" data-fit-insets={fitInsets} bind:this={sceneHost}></div>
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
    <div class="top-left">
      <nav class="toolbar" aria-label="Table tools">
        <button type="button" data-testid="open-deck-import" onclick={() => (deckOpen = !deckOpen)}>Import deck</button>
        <button type="button" onclick={() => commands.run('token')}>Token {#if keyOf('token')}<kbd>{keyOf('token')}</kbd>{/if}</button>
        <button type="button" onclick={() => commands.run('undo')}>Undo {#if keyOf('undo')}<kbd>{keyOf('undo')}</kbd>{/if}</button>
        <button type="button" data-testid="perspective" title="Switch between bird's-eye and ego view" onclick={() => scene?.camera.setRig(scene.camera.rig() === 'birdseye' ? 'ego' : 'birdseye')}>View {#if keyOf('perspective')}<kbd>{keyOf('perspective')}</kbd>{/if}</button>
        <button type="button" data-testid="open-cheat-sheet" onclick={() => (cheatOpen = !cheatOpen)}>Keys {#if keyOf('help')}<kbd>{keyOf('help')}</kbd>{/if}</button>
        {#if themeChoice}
          <span class="theme-anchor" bind:this={themeAnchor}>
            <button type="button" data-testid="open-theme-settings" aria-pressed={themeOpen} aria-expanded={themeOpen} aria-label="Theme" title="Theme" onclick={() => (themeOpen = !themeOpen)}>◐</button>
            {#if themeOpen}<div class="theme-pop"><ThemePicker choice={themeChoice} sound={{ mode: soundMode ?? 'theme', set: setSoundMode }} view={{ prefs: viewPrefs, set: (name, value) => void view.set(name, value).catch(() => {}) }} onclose={() => (themeOpen = false)} /></div>{/if}
          </span>
        {/if}
        {#if !liveVoice}
          {#if voice.talking}<span class="chip" data-testid="talking">{voice.talking === 'teamTalk' ? 'Team talk' : 'Talking'}</span>{/if}
          {#if voice.muted}<span class="chip" data-testid="muted">Muted</span>{/if}
        {/if}
      </nav>
      {#if liveVoice || (session.captions && !spectating)}
        <!-- The voice row: the talk-mode indicator (M3-P3) and the speech settings (M3-P4), so the shared toolbar keeps
             its layout and the avatar column below stays short. A spectator only sees captions. -->
        <div class="toolbar voice-row">
          {#if liveVoice}
            <TalkIndicator voice={liveVoice} talkKey={keyOf('talk') || 'Ctrl'} muteKey={keyOf('mute') || 'M'} panelOpen={voicePanel} ontogglepanel={() => (voicePanel = !voicePanel)} />
          {/if}
          {#if session.captions && !spectating}
            <button
              type="button"
              data-testid="open-speech-settings"
              aria-pressed={speechOpen}
              onclick={(e) => {
                speechTop = Math.round((e.currentTarget as HTMLElement).getBoundingClientRect().bottom + 6);
                speechOpen = !speechOpen;
              }}>Dictation</button
            >
          {/if}
          {#if liveVoice && voicePanel}
            <!-- Drops down over the avatar column instead of pushing it into the own avatar (M3-G). -->
            <div class="voice-pop"><VoicePanel voice={liveVoice} {session} onclose={() => (voicePanel = false)} /></div>
          {/if}
        </div>
      {/if}
      {#each others as seat (seat.id)}
        <Avatar
          {seat}
          life={lifeOf(seat.id)}
          me={false}
          active={st.turn.active === seat.id || st.turn.active === seat.team}
          speaking={speaks(seat.id)}
          responding={st.confirm?.holder === seat.id}
          asking={asking(seat.id)}
          glyph={glyphOf(seat.colour)}
          zones={zoneButtons(seat.id)}
          onlife={(delta) => session.dispatch({ type: 'life', seat: seat.id, delta })}
          oncounter={(kind, delta) => session.dispatch({ type: 'playerCounter', seat: seat.id, kind, delta })}
          onopenzone={openViewer}
          ongoto={() => scene?.camera.goToSeat(seat.id)}
          readonly={spectating}
          compact={otherAvatars >= 3}
        />
      {/each}
    </div>

    <div class="top-centre">
      <TurnStrip
        turn={st.turn.number}
        {activeName}
        {activeColour}
        phases={game.phases}
        current={st.turn.phase}
        nextPhaseKey={keyOf('nextPhase')}
        nextTurnKey={keyOf('nextTurn')}
        onphase={(phase) => session.dispatch({ type: 'phaseSet', phase })}
        onnextturn={() => commands.run('nextTurn')}
      />
      {#if top}
        <div class="stack-chip" data-testid="stack-chip">
          Stack {st.stack.length}
          <button type="button" class:lit={resolveLit} data-testid="resolve" onclick={() => commands.run('resolve')}>Resolve {#if keyOf('resolve')}<kbd>{keyOf('resolve')}</kbd>{/if}</button>
          {#if resolveTargets.length}
            <span class="to" data-testid="resolve-to">to
              {#each resolveTargets as t (t.zone)}
                <button type="button" class:default={t.isDefault} data-zone={t.zone} aria-label="Resolve to {t.label}{t.isDefault ? ' (default)' : ''}" onclick={() => commands.resolveTop(t.isDefault ? undefined : t.zone)}>{t.label}</button>
              {/each}
            </span>
          {/if}
          <button type="button" onclick={() => commands.run('counterTop')}>Counter {#if keyOf('counterTop')}<kbd>{keyOf('counterTop')}</kbd>{/if}</button>
        </div>
      {/if}
    </div>

    <div class="right">
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
        onhovercard={(card, x, y) => {
          preview = card ? { card, x, y } : null;
          hudHover = card;
        }}
      />
    </div>

    {#if st.seats[me]}
      <div class="own-avatar">
        <Avatar
          seat={st.seats[me]}
          life={lifeOf(me)}
          me={true}
          active={st.turn.active === me || st.turn.active === st.seats[me].team}
          speaking={speaks(me)}
          responding={st.confirm?.holder === me}
          asking={asking(me)}
          glyph={glyphOf(st.seats[me].colour)}
          zones={zoneButtons(me)}
          onlife={(delta) => session.dispatch({ type: 'life', seat: me, delta })}
          oncounter={(kind, delta) => session.dispatch({ type: 'playerCounter', seat: me, kind, delta })}
          onopenzone={openViewer}
          ongoto={() => scene?.camera.goToSeat(me)}
          readonly={spectating}
        />
      </div>
    {/if}

    <!-- Above the hand, centred (DESIGN "Specification: geometry, layout and motion", Screen layer); with a teammate's fan shown, above that fan too. -->
    <div class="above-hand" data-testid="above-hand" style:bottom={teamFanShown ? `${teamFanTop(vh) + 8}px` : null}>
      {#if toast}<p class="toast" role="status" data-testid="toast">{toast.text}</p>{/if}
      {#if untapOffer}
        <div class="offer" data-testid="untap-offer">
          Your turn.
          <button
            type="button"
            onclick={() => {
              untapOffer = false;
              commands.untapAndDraw();
            }}>Untap all and draw <kbd>U</kbd></button
          >
          <button type="button" class="x" aria-label="Dismiss" onclick={() => (untapOffer = false)}>×</button>
        </div>
      {/if}
      {#if prompt}
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
    </div>

    <HandFan
      ids={hand}
      {refOf}
      {nameOf}
      {faces}
      {back}
      {hovered}
      {selection}
      {vw}
      {vh}
      onhover={(id) => (hudHover = id)}
      oncontext={(id, x, y) => openMenu(id, x, y)}
      oninspect={(id) => hooks.inspect(id)}
      ondragout={(id, x, y) => dragOut(id, x, y)}
      onselect={(id) => (selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id])}
    />
    {#if session.team && teamFanShown}
      <!-- Two-Headed Giant: the teammate's hand above the own fan (M3-P2, ui/hand/*). -->
      <TeamHands team={session.team} state={st} {faces} {vw} {vh} oninspect={(id, ref) => ((inspectId = id), (inspectRef = ref))} />
    {/if}
  </div>

  {#if viewer}
    {@const zone = st.zones[viewer.zone]}
    {#if zone}
      <PileViewer
        title={`${zone.owner && zone.owner !== me ? `${st.seats[zone.owner]?.name ?? zone.owner}'s ` : ''}${zone.kind[0]!.toUpperCase()}${zone.kind.slice(1)}`}
        count={zone.ids.length}
        kind={zone.kind}
        own={zone.owner === me}
        hidden={zone.visibility !== 'public'}
        cards={viewerCards}
        looking={viewer.looking}
        bind:shuffleOnClose={viewer.shuffleOnClose}
        {faces}
        {back}
        {hovered}
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

  {#if menu}
    <ContextMenu title={menu.title} entries={menu.entries} x={menu.x} y={menu.y} onclose={() => (menu = null)} />
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
    </div>
  {/if}

  {#if drawN}
    <div class="inline draw-n" data-testid="draw-n">
      <label>{drawN.what === 'mill' ? 'Mill how many?' : 'Draw how many?'} <input bind:this={drawInput} bind:value={drawN.text} data-testid="draw-n-input" inputmode="numeric" onkeydown={(e) => (e.key === 'Enter' ? submitDrawN() : e.key === 'Escape' && (drawN = null))} onblur={() => (drawN = null)} /></label>
    </div>
  {/if}

  {#if revealTo}
    <div class="inline" style:left="{Math.min(revealTo.x, vw - 220)}px" style:top="{Math.max(8, revealTo.y - 20)}px" data-testid="reveal-to" role="menu">
      <p>Reveal {revealTo.cards.length === 1 ? nameOf(revealTo.cards[0]!) : `${revealTo.cards.length} cards`} to</p>
      {#if otherSeats.length === 0}
        <p class="muted">No other players at the table.</p>
      {:else}
        {#each otherSeats as s (s.id)}
          <button type="button" data-seat={s.id} onclick={() => doRevealTo([s.id])}>{s.name}</button>
        {/each}
        {#each teamRevealChoices(st, me) as c (c.id)}<button type="button" data-seat={c.id} onclick={() => doRevealTo(c.seats)}>{c.label}</button>{/each}
        {#if otherSeats.length > 1}<button type="button" data-seat="all" onclick={() => doRevealTo(otherSeats.map((s) => s.id))}>Everyone</button>{/if}
      {/if}
      <button type="button" class="x" onclick={() => (revealTo = null)}>Cancel</button>
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
    color-scheme: var(--sp-hud-scheme, light);
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
    font-family: var(--sp-font, system-ui);
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
    color: var(--sp-muted, #5f5f5f);
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    font-size: var(--sp-font-size-small, 12px);
  }
  .layer :global(button),
  .inline :global(button) {
    font: inherit;
  }
  .top-left {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    pointer-events: auto;
    align-items: center;
    /* Clear of the turn strip centred above the table (about 640 px wide): the tools wrap to a second row rather than
       slide under it (the View button of M4-P1 made the row too long at 1440 px). */
    max-width: max(220px, calc(50vw - 336px));
  }
  .toolbar button,
  .stack-chip button,
  .offer button,
  .inline button {
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 8px;
    cursor: pointer;
  }
  .voice-row {
    position: relative;
  }
  .theme-anchor {
    position: relative;
  }
  .theme-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 70;
  }
  .voice-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
  }
  kbd {
    font-family: var(--sp-font-mono, monospace);
    opacity: 0.7;
  }
  .chip {
    border: 1px solid var(--sp-fg, #111);
    border-radius: 999px;
    padding: 0 8px;
    background: var(--sp-surface, #fff);
  }
  .top-centre {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .stack-chip {
    pointer-events: auto;
    display: flex;
    gap: 6px;
    align-items: center;
    background: var(--sp-surface, #fff);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-md, 4px);
    padding: 2px 8px;
  }
  .stack-chip button {
    opacity: 0.55;
  }
  .stack-chip button.lit {
    opacity: 1;
    border-color: var(--sp-fg, #111);
  }
  .stack-chip .to {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    color: var(--sp-muted, #5f5f5f);
  }
  .stack-chip .to button {
    opacity: 1;
    padding: 0 4px;
  }
  .stack-chip .to button.default {
    border-color: var(--sp-fg, #111);
  }
  .right {
    position: absolute;
    top: 8px;
    right: 8px;
    bottom: calc(22vh + 16px);
    display: flex;
  }
  .own-avatar {
    position: absolute;
    left: 8px;
    bottom: calc(22vh + 16px);
  }
  .above-hand {
    position: absolute;
    /* Above the teammate's fan (z-index 19), so a hovered teammate card never covers OK and Hold. */
    z-index: 20;
    left: 50%;
    bottom: calc(22vh + 16px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .toast {
    margin: 0;
    padding: 4px 12px;
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
    border-radius: var(--sp-radius-md, 4px);
  }
  .offer {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--sp-surface, #fff);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
  }
  .x {
    border: 0 !important;
  }
  .inline {
    position: fixed;
    z-index: 66;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    padding: 6px 8px;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
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
    color: var(--sp-muted, #5f5f5f);
  }
  .preview {
    position: fixed;
    z-index: 75;
    width: 200px;
    height: 279px;
    pointer-events: none;
    box-shadow: 0 0 0 1px var(--sp-fg, #111);
    border-radius: 4.76% / 3.41%;
  }
</style>
