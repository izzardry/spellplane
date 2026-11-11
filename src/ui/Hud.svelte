<!--
  The table HUD (PLAN M0-P4): screen-anchored layer over the scene (DESIGN "Camera and navigation", Screen-anchored
  layer) with hand fan, pile viewers, context menu, keymap and cheat sheet, inspect, avatars, turn strip, log and chat,
  deck import and token search. It changes shared state only through TableSession and moves the camera only through
  TableScene.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { CardInstance, CardRef, InstanceId, StackItemId, ZoneId } from '../core/types';
  import type { CardData } from '../data/types';
  import type { ActionId, KeyChord, KeyContext } from '../games/types';
  import type { ActivePing, TableScene, ViewState } from '../scene/types';
  import type { LookedCard } from '../session/types';
  import type { KeymapOverride } from '../store/types';
  import { tokensToCssVars } from '../themes/index';
  import { Commands, isEmptyChair, promptShowing, roundPassed, type UiHooks } from './commands';
  import ConfirmPrompt from './confirm/ConfirmPrompt.svelte';
  import { promptModel, roundWhat } from './confirm/model';
  import { parsePlainList } from './deck';
  import { logLines } from './describe';
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
  import Inspect from './Inspect.svelte';
  import LogPanel from './LogPanel.svelte';
  import PileViewer from './PileViewer.svelte';
  import TokenSearch from './TokenSearch.svelte';
  import TurnStrip from './TurnStrip.svelte';

  let { session, createScene, faces, cardData, game, theme, settings, parseDecklist, onVoice, newId }: HudProps = $props();

  // --- Shared state, as views of the session (the HUD is mounted per session; it never swaps sessions) ----------
  const me = untrack(() => session.seat);
  let st = $state.raw(untrack(() => session.getState()));
  let secrets = $state.raw(untrack(() => session.secrets()));
  let entries = $state.raw(untrack(() => session.log()));

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
  let forcedHover: InstanceId | null = null;
  let sceneHost = $state<HTMLElement | undefined>();
  let scene: TableScene | null = null;
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
  let revealTo = $state<{ cards: InstanceId[]; x: number; y: number } | null>(null);
  let tokenNear = $state<{ near: InstanceId | null } | null>(null);
  let deckOpen = $state(false);
  let toast = $state<{ text: string; id: number } | null>(null);
  let untapOffer = $state(false);
  let logOpen = $state(true);
  let preview = $state<{ card: InstanceId; x: number; y: number } | null>(null);
  let voice = $state<{ talking: 'talk' | 'teamTalk' | null; muted: boolean }>({ talking: null, muted: false });
  let logPanel = $state<LogPanel | undefined>();
  let noteInput = $state<HTMLInputElement | undefined>();
  let drawInput = $state<HTMLInputElement | undefined>();

  const cssVars = $derived(
    Object.entries(tokensToCssVars(theme.tokens))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; '),
  );
  const back = $derived(theme.cardDressing.back ?? game.cardBack);
  /**
   * Screen edges the screen-anchored layer covers, "top right bottom left" in CSS px, for the scene's fit (DESIGN
   * "Camera and navigation", Screen-anchored layer): the toolbar and turn strip row, the open log column, the hand fan
   * with the row above it, and the avatar column. Fitting the table keeps it clear of them, so the own piles are never
   * under the log or the hand at the fitted view.
   */
  const fitInsets = $derived(fitInsetsFor(vh, logOpen));

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
  });
  const engine = new KeyEngine(
    untrack(() => game.keymap),
    { start: (b) => commands.run(b.action, 'start'), end: (b) => commands.run(b.action, 'end') },
    () => promptShowing(session.getState(), me),
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
   * overlay (menu, reveal-to, token search, inspect, cheat sheet) closes first; pile viewers and the deck dialog stay.
   */
  function closeTop(promptUp: boolean): boolean {
    if (menu) menu = null;
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
  /** Card names as each log line was first written (DESIGN "Table model", Hidden cards: a later reveal never names an earlier hidden move). */
  const logNames = new Map<string, string | null>();
  const lines = $derived(
    logLines(entries, {
      state: st,
      cardName: (id) => (st.cards[id] ? nameOf(id) : null),
      phaseLabel: (id) => game.phases.find((p) => p.id === id)?.label ?? id,
      names: logNames,
    }),
  );
  const inspectCard = $derived<CardInstance | null>(inspectId ? (st.cards[inspectId] ?? null) : null);
  const keyOf = (a: ActionId, ctx: KeyContext = 'table') => keyLabel(keymap, a, ctx);

  // On Next turn, offer the new active player (or team) untap-and-draw; close the offer once the turn moves on
  // (DESIGN "Turn flow and confirmation": offered a single key, never done for them).
  let seenTurn = untrack(() => st.turn.number);
  $effect(() => {
    const mine = st.turn.active === me || (!!st.seats[me]?.team && st.seats[me]?.team === st.turn.active);
    const turn = st.turn.number;
    if (!mine) untapOffer = false;
    else if (turn !== seenTurn) untapOffer = true;
    seenTurn = turn;
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
    const view: ViewState = { selection: [...selection], hovered, privateFaces, reducedMotion, pings, openPile: viewer?.zone ?? openPile };
    scene.update(st, view);
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
    seenLog = log.length;
  }

  onMount(() => {
    seenLog = entries.length;
    const unsub = session.subscribe((s) => {
      st = s;
      secrets = session.secrets();
      const log = session.log();
      onLog(log);
      entries = log;
    });
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
      sceneReady = true;
    } catch (e) {
      sceneError = e instanceof Error ? e.message : String(e);
    }
    return () => {
      unsub();
      for (const t of timers) clearTimeout(t);
      timers = [];
      engine.blur();
      scene?.dispose();
      scene = null;
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
  onpointermove={(e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }}
/>

<div class="root" style={cssVars} data-testid="hud">
  <div class="scene" data-testid="scene-host" data-fit-insets={fitInsets} bind:this={sceneHost}></div>
  {#if sceneError}<p class="scene-error" role="status">Table unavailable: {sceneError}</p>{/if}

  <div class="layer">
    <div class="top-left">
      <nav class="toolbar" aria-label="Table tools">
        <button type="button" data-testid="open-deck-import" onclick={() => (deckOpen = !deckOpen)}>Import deck</button>
        <button type="button" onclick={() => commands.run('token')}>Token {#if keyOf('token')}<kbd>{keyOf('token')}</kbd>{/if}</button>
        <button type="button" onclick={() => commands.run('undo')}>Undo {#if keyOf('undo')}<kbd>{keyOf('undo')}</kbd>{/if}</button>
        <button type="button" data-testid="open-cheat-sheet" onclick={() => (cheatOpen = !cheatOpen)}>Keys {#if keyOf('help')}<kbd>{keyOf('help')}</kbd>{/if}</button>
        {#if voice.talking}<span class="chip" data-testid="talking">{voice.talking === 'teamTalk' ? 'Team talk' : 'Talking'}</span>{/if}
        {#if voice.muted}<span class="chip" data-testid="muted">Muted</span>{/if}
      </nav>
      {#each seats.filter((s) => s.id !== me && !isEmptyChair(st, s.id)) as seat (seat.id)}
        <Avatar
          {seat}
          life={lifeOf(seat.id)}
          me={false}
          active={st.turn.active === seat.id || st.turn.active === seat.team}
          responding={st.confirm?.holder === seat.id}
          asking={asking(seat.id)}
          glyph={glyphOf(seat.colour)}
          zones={zoneButtons(seat.id)}
          onlife={(delta) => session.dispatch({ type: 'life', seat: seat.id, delta })}
          oncounter={(kind, delta) => session.dispatch({ type: 'playerCounter', seat: seat.id, kind, delta })}
          onopenzone={openViewer}
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
        onchat={(text) => session.dispatch({ type: 'chat', text, channel: 'table' })}
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
          responding={st.confirm?.holder === me}
          asking={asking(me)}
          glyph={glyphOf(st.seats[me].colour)}
          zones={zoneButtons(me)}
          onlife={(delta) => session.dispatch({ type: 'life', seat: me, delta })}
          oncounter={(kind, delta) => session.dispatch({ type: 'playerCounter', seat: me, kind, delta })}
          onopenzone={openViewer}
        />
      </div>
    {/if}

    <div class="above-hand">
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
      ondragout={(id, x, y) => scene?.startDrag(id, x, y)}
      onselect={(id) => (selection = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id])}
    />
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
        ondragout={(id, x, y) => scene?.startDrag(id, x, y)}
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
        maxlength="80"
        placeholder="Note (Enter to save, empty clears)"
        aria-label="Note"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) submitNote();
          else if (e.key === 'Escape') note = null;
        }}
        onblur={() => (note = null)}
      />
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
    gap: 4px;
    pointer-events: auto;
    align-items: center;
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
