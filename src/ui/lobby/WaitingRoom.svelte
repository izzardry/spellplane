<!--
  The waiting room of a private table or a draft night (docs/design/m8/journey.md 4.8, 4.9; matchmaking.md 2.12;
  visual.md 2.8 "Seat row", "Invite sheet"; mock.html board 5). Calm and in one order: the seats around a table outline
  in the format's positions (an empty seat invites), my deck slot (the deck selected on Home, CHANGE DECK, or in a draft
  night the closed boosters), the one primary READY (it commits the deck), the line that always says what is missing,
  the creator's pill (WAITING · 1 OPEN SEAT, WAITING · 1 OF 2 READY, START · 3 that presses itself), the setup summary
  (the creator edits it), nickname and seat colour, and the invite sheet beside the room (open by itself for the
  creator, never covering the room). A pair that cannot connect is named calmly after 15 s. Never another player's deck
  name: only its state and, after Ready, its size. No log, chat panel or table tools here.
  The rules of seats.ts, ready.ts and connectivity.ts stay; the data-testids of the M1 lobby are kept. M8-P4.
-->
<script lang="ts">
  import { onMount, untrack, type Snippet, type Component } from 'svelte';
  import type { Format, SeatId, TableState } from '../../core/types';
  import type { FaceSource } from '../../data/types';
  import { toViewerFrame } from '../../games/frame';
  import type { BoosterSetup, DeckRecord, DeckStore, HomePrefs, SettingsStore } from '../../store/types';
  import { DEFAULT_BOOSTER_SETUP } from '../../store/types';
  import type { SessionNetStatus } from '../../session/types';
  import { paper } from '../../themes/paper/index';
  import { themeContext } from '../settings/theme';
  import ThemePicker from '../settings/Theme.svelte';
  import { checkDeck, parsePlainList, type CheckedDeck } from '../deck';
  import type { LobbyProps } from '../types';
  import Button from '../design/Button.svelte';
  import BoosterFan from '../design/BoosterFan.svelte';
  import Field from '../design/Field.svelte';
  import PresenceDot from '../design/PresenceDot.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import Segmented from '../design/Segmented.svelte';
  import Sheet from '../design/Sheet.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import DeckPickerSheet from '../decks/DeckPickerSheet.svelte';
  import BoosterSetupSheet from '../decks/BoosterSetupSheet.svelte';
  import { EMPTY_STATES } from '../empty/states';
  import { boosterToLobby, lobbyToBooster } from '../home/view';
  import { ConnectivityCheck, type ConnectivityReport } from './connectivity';
  import { pastedDeckId, readyVerdict } from './ready';
  import SpectatorPanel from './SpectatorPanel.svelte';
  import InviteSheet from './InviteSheet.svelte';
  import { chairChoice, chairs, colourClash, colourTakenBy, hostSeat, nicknameProblem, normaliseNickname, pickColour, readiness, seatOf, startProblem, SEAT_COLOURS, teamGroups, type Chair } from './seats';
  import {
    codeLabel,
    countdownMayRun,
    deckAllow,
    deckKindOf,
    deckRuleOf,
    draftPacks,
    isLiveDraft,
    missingLine,
    START_COUNT,
    startPill,
    type DeckRule,
  } from './waiting';

  type PickerProps = {
    allow?: ((deck: DeckRecord) => true | string) | undefined;
    onpick: (deck: DeckRecord) => void;
    onclose?: (() => void) | undefined;
    /** The room's own deck library and faces: the sheet opens no second store or card source. */
    decks?: DeckStore | null;
    faces?: FaceSource | null;
    selectedId?: string | null;
  };
  type BoosterProps = { value: BoosterSetup; mode: 'deck' | 'draft'; onchange?: ((value: BoosterSetup) => void) | undefined; onclose?: (() => void) | undefined };

  let {
    session,
    game,
    link,
    identity,
    decks,
    cardData,
    parseDecklist,
    settings = undefined,
    deckRule: ruleFallback = undefined,
    starter = undefined,
    faces = undefined,
    onleave = undefined,
    picker = DeckPickerSheet as unknown as Component<PickerProps>,
    boosterSheet = BoosterSetupSheet as unknown as Component<BoosterProps>,
    rules = undefined,
  }: LobbyProps & {
    /** The table's rules panel (the draft and timer settings of the stage, ui/flow/LobbyDraft), in the side column. */
    rules?: Snippet | undefined;
    /** The viewer's settings: the deck selected on Home (Settings.home.deckId) and, for the creator, Home's deck rule. */
    settings?: SettingsStore | undefined;
    /** The table's deck rule when the table does not carry one (TableSettings.decks); default any. */
    deckRule?: DeckRule | undefined;
    /** Makes a starter deck for USE A STARTER DECK (M8-P6's generator); absent or rejecting: the slot says so. */
    starter?: (() => Promise<DeckRecord>) | undefined;
    /** Card faces for the deck picker's covers (the table's FaceSource). */
    faces?: FaceSource | undefined;
    /** ← HOME: the table frame's leave path (checkpoint, leave, the toast); without it the room goes to `#/`. */
    onleave?: (() => void) | undefined;
    /** The deck picker sheet (M8-P3's DeckPickerSheet; a harness passes a fake). */
    picker?: Component<PickerProps>;
    /** The booster setup sheet (M8-P3's BoosterSetupSheet in mode 'draft'; a harness passes a fake). */
    boosterSheet?: Component<BoosterProps>;
  } = $props();

  // The viewer's theme (PLAN M4-P6): its seat colours colour the glyphs; Paper where no app shell provides the choice.
  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));
  const seatColours = $derived(theme.tokens.colours.seats);

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let net = $state.raw<SessionNetStatus>(untrack(() => session.netStatus()));
  let selfPeer = $state('');
  let nickname = $state('');
  let savedNickname = $state('');
  let preferredColour = $state(0);
  let now = $state(Date.now());
  const check = new ConnectivityCheck();

  let savedDecks = $state.raw<DeckRecord[]>([]);
  let homePrefs = $state.raw<HomePrefs | null>(null);
  let deckChoice = $state<string>('paste');
  let pasting = $state(false);
  let deckText = $state('');
  let checked = $state.raw<CheckedDeck | null>(null);
  let checkedText = $state('');
  let busy = $state(false);
  let failure = $state('');
  let note = $state('');
  let inviteOpen = $state(false);
  let invitedOnce = false;
  let pickerOpen = $state(false);
  let setupOpen = $state(false);
  let boostersOpen = $state(false);
  /** READY ✓ tapped again: this browser holds the start (journey.md 4.8: "any player can stop it by un-readying"). */
  let held = $state(false);
  let count = $state<number | null>(null);
  let counter: ReturnType<typeof setInterval> | null = null;

  const mySeat = $derived(selfPeer ? seatOf(st, selfPeer) : null);
  const me = $derived(mySeat ? st.seats[mySeat] : undefined);
  /** The table as the start rules read it on this browser: a held READY counts as not ready. */
  const view = $derived.by((): TableState => {
    if (!held || !mySeat || !st.seats[mySeat]?.ready) return st;
    return { ...st, seats: { ...st.seats, [mySeat]: { ...st.seats[mySeat]!, ready: false } } };
  });
  const list = $derived(chairs(st, selfPeer));
  const teams = $derived(teamGroups(st, selfPeer));
  const ready = $derived(readiness(st));
  const open = $derived(list.filter((c) => !c.occupied).length);
  const report: ConnectivityReport = $derived(selfPeer ? check.observe(net, st, selfPeer, now) : { overall: 'checking', pairs: [], problems: [] });
  const present = (seat: SeatId): boolean => {
    const peer = st.seats[seat]?.peer;
    if (!peer) return false;
    if (peer === selfPeer) return true;
    return net.peers.some((p) => p.peerId === peer && p.status === 'connected');
  };
  const host = $derived(hostSeat(st, present));
  const isHost = $derived(mySeat !== null && mySeat === host);
  const startBlocked = $derived(startProblem(view, mySeat, host));
  const nickProblem = $derived(nicknameProblem(nickname));
  /** Every seated player's browser is connected to this one. */
  const connected = $derived(list.filter((c) => c.occupied).every((c) => present(c.seat)));
  // The table carries the rule (TableSettings.decks): every seat reads the same one from the shared state.
  const rule = $derived(deckRuleOf(st, ruleFallback ?? 'any'));
  const allow = $derived(deckAllow(rule));
  const drafting = $derived(isLiveDraft(st));
  const packs = $derived(draftPacks(st));
  const pill = $derived(startPill({ state: view, connected, count }));
  const line = $derived(
    !drafting || st.stage !== 'lobby'
      ? missingLine(view, mySeat, host, connected, count)
      : open > 0
        ? missingLine(view, mySeat, host, connected, count)
        : isHost
          ? 'Everyone is here. Start the draft when you are ready.'
          : `Waiting for ${(host && st.seats[host]?.name) || 'the host'} to start the draft.`,
  );
  const failedPeers = $derived(new Set(report.pairs.filter((p) => p.state === 'failed').map((p) => p.peer)));
  const code = $derived(codeLabel(link.roomId));
  const seatedCount = $derived(list.filter((c) => c.occupied).length);
  const watchLink = $derived(`${link.url}/watch`);
  const FORMAT_LABEL: Record<Format, string> = { '1v1': '1V1', ffa3: '3 FFA', ffa4: '4 FFA', '2hg': '2V2' };
  const passLabel = $derived(st.settings.passTimerMs === null ? 'PASS OFF' : `PASS ${Math.round(st.settings.passTimerMs / 1000)} S`);
  const decksLabel = $derived(drafting ? 'LIVE DRAFT' : rule === 'booster' ? 'BOOSTER DECKS ONLY' : 'ANY DECK');
  const summary = $derived(`${drafting ? 'DRAFT NIGHT' : 'PRIVATE GAME'} · ${FORMAT_LABEL[st.format]} · ${decksLabel} · ${passLabel}`);
  const hostName = $derived((host && st.seats[host]?.name) || 'The host');
  // One conversion both ways, Home's (ui/home/view.ts): a grid's packs are its grids there and here.
  const boosters = $derived(st.lobby && st.lobby.draft !== null ? lobbyToBooster(st.lobby) : (homePrefs?.draft.boosters ?? DEFAULT_BOOSTER_SETUP));
  /** Fewer players than chairs, at least two of them ready: START WITH n PLAYERS (journey.md 4.8). */
  const shortStart = $derived(isHost && open > 0 && seatedCount >= 2 && (drafting || list.filter((c) => c.occupied).every((c) => view.seats[c.seat]?.ready)));

  // The table from above, turned so the own chair is at the bottom (DESIGN "Players, seats and formats"). Each seat
  // plate stands outside the table's outline on the edge its chair faces (mock.html board 5, gate M8 finding F5): the
  // near and far seats under and over the table, the side seats beside it, so two plates never meet across the table.
  const layout = $derived(game.layout(st.format));
  const viewerAngle = $derived(mySeat ? (layout.seats[st.seats[mySeat]?.index ?? 0]?.angle ?? 0) : 0);
  const rightAngled = $derived(layout.seats.every((s) => s.angle % 90 === 0));
  const box = $derived(!rightAngled ? { w: layout.table.w, d: layout.table.d } : (viewerAngle / 90) % 2 === 1 ? { w: layout.table.d, d: layout.table.w } : { w: layout.table.w, d: layout.table.d });
  type Edge = 'top' | 'bottom' | 'left' | 'right';
  /** A seat's edge of the table outline and where along it (per cent of the outline's box). */
  function place(x: number, y: number): { edge: Edge; left: number; top: number } {
    const p = toViewerFrame({ x, y, rot: 0 }, viewerAngle);
    // A chair a little off the middle of its edge (the four-player table's turned seats) is drawn at the middle.
    const snap = (n: number): number => (Math.abs(n - 50) < 8 ? 50 : Math.max(0, Math.min(100, n)));
    const u = snap(((p.x + box.w / 2) / box.w) * 100);
    const v = snap(((box.d / 2 - p.y) / box.d) * 100);
    if (Math.abs(p.x) / box.w > Math.abs(p.y) / box.d) return p.x < 0 ? { edge: 'left', left: 0, top: v } : { edge: 'right', left: 100, top: v };
    return p.y > 0 ? { edge: 'top', left: u, top: 0 } : { edge: 'bottom', left: u, top: 100 };
  }
  /** Whether any seat stands beside the table (three and four players): the seats' box keeps room for those plates. */
  const sideSeats = $derived(
    list.some((c) => {
      const a = layout.seats[c.index]?.zones.avatar;
      return a ? ['left', 'right'].includes(place(a.x, a.y).edge) : false;
    }),
  );

  const selected = $derived(deckChoice === 'paste' ? null : (savedDecks.find((d) => d.id === deckChoice) ?? null));
  const showPaste = $derived(deckChoice === 'paste' && (pasting || savedDecks.length === 0 || !!deckText));
  const deckRefs = $derived.by(() => {
    if (deckChoice === 'paste') return checked && checkedText === deckText && checked.resolved.main.length ? { main: checked.resolved.main, side: checked.resolved.side } : null;
    return selected && selected.main.length && allow(selected) === true ? { main: selected.main, side: selected.side } : null;
  });
  const committed = $derived(mySeat ? (st.commitments[mySeat]?.instanceIds.length ?? 0) : 0);
  /** The deck this browser committed: its name is shown only here, on its owner's screen. */
  let readyDeckName = $state('');

  onMount(() => {
    const unsub = session.subscribe((s) => (st = s));
    const unsubNet = session.subscribeNet((n) => (net = n));
    st = session.getState();
    net = session.netStatus();
    const timer = setInterval(() => (now = Date.now()), 1000);
    // A deck made in another tab (OPEN SIX BOOSTERS) shows up when this tab is shown again.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void relist();
    };
    document.addEventListener('visibilitychange', onVisible);
    void identity.get().then((r) => {
      selfPeer = r.peerId;
      nickname = r.nickname;
      savedNickname = r.nickname;
      preferredColour = r.seatColour;
    });
    const home = settings ? settings.get('home').catch(() => null) : Promise.resolve(null);
    void Promise.all([decks.list().catch(() => [] as DeckRecord[]), home]).then(([d, h]) => {
      savedDecks = d;
      homePrefs = h;
      if (deckChoice !== 'paste' || deckText) return;
      // The deck selected on Home, else the newest deck with cards (as the M1 lobby took the first saved deck).
      const want = h?.deckId ? d.find((x) => x.id === h.deckId) : undefined;
      const first = want ?? [...d].sort((a, b) => b.updatedAt - a.updatedAt).find((x) => x.main.length > 0);
      if (first) deckChoice = first.id;
    });
    return () => {
      unsub();
      unsubNet();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      stopCount();
    };
  });

  // The invite sheet opens by itself for the creator while seats are open (journey.md 4.8), once per visit.
  $effect(() => {
    if (invitedOnce || !isHost || st.stage !== 'lobby') return;
    invitedOnce = true;
    if (open > 0) inviteOpen = true;
  });

  // A guest's first line (journey.md 4.9): "Ben invites you to a 1v1." for 6 s.
  const FORMAT_WORDS: Record<Format, string> = { '1v1': '1v1', ffa3: 'three-player free-for-all', ffa4: 'four-player free-for-all', '2hg': '2v2' };
  let welcome = $state('');
  let welcomed = false;
  let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // The inviter: the first seated player before me (the creator sits in the first chair).
    const inviter = list.find((c) => c.occupied && !c.mine);
    const mine = list.find((c) => c.mine);
    if (welcomed || !mine || !inviter || inviter.index > mine.index || st.stage !== 'lobby') return;
    welcomed = true;
    welcome = `${inviter.name} invites you to a ${FORMAT_WORDS[st.format]}.`;
    welcomeTimer = setTimeout(() => (welcome = ''), 6000);
  });
  onMount(() => () => {
    if (welcomeTimer) clearTimeout(welcomeTimer);
  });

  // A held READY is let go when the seat is no longer ready (a new game, a seat change).
  $effect(() => {
    if (held && !me?.ready) held = false;
  });

  // Two players who picked the same colour at once: the later chair gives way (ui/lobby/seats.ts colourClash).
  let clashFixed = '';
  $effect(() => {
    if (!mySeat) return;
    const next = colourClash(st, mySeat);
    const key = `${st.seq}:${next}`;
    if (next === null || clashFixed === key) return;
    clashFixed = key;
    untrack(() => session.takeSeat(mySeat, next));
  });

  // START · 3 presses itself on the creator's browser when every seat is taken, ready and connected (journey.md 4.8).
  function stopCount(): void {
    if (counter) clearInterval(counter);
    counter = null;
    count = null;
  }
  $effect(() => {
    const may = isHost && !drafting && countdownMayRun(view, connected);
    untrack(() => {
      if (!may) return stopCount();
      if (counter) return;
      count = START_COUNT;
      counter = setInterval(() => {
        if (count === null) return;
        count -= 1;
        if (count <= 0) {
          stopCount();
          start();
        }
      }, 1000);
    });
  });

  async function saveNickname(): Promise<void> {
    if (nickProblem) return;
    const n = normaliseNickname(nickname);
    nickname = n;
    if (n === savedNickname) return;
    await identity.setNickname(n);
    savedNickname = n;
    if (mySeat && me) session.takeSeat(mySeat, me.colour);
  }

  function takeChair(seat: SeatId): void {
    failure = '';
    if (seat === mySeat) return;
    const ok = chairChoice(st, seat, selfPeer);
    if (!ok.ok) {
      failure = ok.reason;
      return;
    }
    session.takeSeat(seat, pickColour(st, seat, me?.colour ?? preferredColour, mySeat));
  }

  async function pickSeatColour(c: number): Promise<void> {
    if (!mySeat || colourTakenBy(st, c, mySeat) !== null) return;
    preferredColour = c;
    session.takeSeat(mySeat, c);
    await identity.setSeatColour(c).catch(() => undefined);
  }

  async function checkPasted(): Promise<void> {
    busy = true;
    failure = '';
    try {
      checkedText = deckText;
      checked = await checkDeck(deckText, parseDecklist ?? parsePlainList, cardData);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      checked = null;
    } finally {
      busy = false;
    }
  }

  let confirmedText = $state<string | null>(null);
  async function pressReady(): Promise<void> {
    failure = '';
    note = '';
    if (deckChoice === 'paste' && (!checked || checkedText !== deckText)) await checkPasted();
    if (!mySeat) return;
    if (deckChoice === 'paste') {
      if (failure) return;
      const verdict = readyVerdict(checked && checkedText === deckText ? checked : null, deckText, confirmedText);
      if (verdict.kind !== 'go') {
        failure = verdict.message;
        if (verdict.kind === 'confirm') confirmedText = deckText;
        return;
      }
    } else if (selected && allow(selected) !== true) {
      failure = String(allow(selected));
      return;
    }
    const deck = deckRefs;
    if (!deck) {
      failure = 'This deck has no cards. Choose another deck or paste a list.';
      return;
    }
    busy = true;
    try {
      await session.importDeck({ main: [...deck.main], side: [...deck.side] });
      readyDeckName = selected?.name ?? 'Pasted list';
      if (deckChoice === 'paste') {
        const at = Date.now();
        const first = deckText.split(/\r?\n/).find((l) => l.trim() && !/^(deck|sideboard|main)/i.test(l.trim()));
        await decks
          .put({ id: pastedDeckId(deckText), name: first ? `Deck with ${first.replace(/^\s*\d+x?\s+/, '').trim()}` : 'Pasted deck', main: deck.main, side: deck.side, source: 'pasted', text: deckText, createdAt: at, updatedAt: at })
          .catch(() => undefined);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  /**
   * READY ✓ tapped: take it back. The deck stays committed to the chair (the table has no action that withdraws a
   * commitment, DECISIONS [M1-P5]); the start waits for this browser until READY is pressed again.
   */
  function toggleHeld(): void {
    if (!isHost) {
      // Only the creator's browser counts down; a guest's hold cannot reach it yet (DECISIONS [M8-P4]).
      note = `Your deck stays locked to your seat. Ask ${hostName} to wait if you need a moment.`;
      return;
    }
    held = !held;
    note = held ? 'Your deck stays locked to your seat. The game does not start until you press READY again.' : '';
  }

  function start(): void {
    if (startProblem(view, mySeat, host)) return;
    stopCount();
    try {
      if (drafting && session.evening) session.evening.start();
      else session.dispatch({ type: 'stageSet', stage: 'match' });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  /** START WITH n PLAYERS: the empty chairs stay empty (the table cannot change its format once a player is Ready). */
  function startShort(): void {
    // Like the countdown (countdownMayRun): every seated player is connected (the empty chairs stay empty).
    if (!connected) {
      failure = 'Waiting for everyone to connect.';
      return;
    }
    stopCount();
    try {
      if (drafting && session.evening) session.evening.start();
      else session.dispatch({ type: 'stageSet', stage: 'match' });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  async function useStarter(): Promise<void> {
    note = '';
    if (!starter) {
      note = 'Starter decks are not in this build yet. Paste a list instead.';
      pasting = true;
      return;
    }
    try {
      const d = await starter();
      await decks.put(d);
      savedDecks = [...savedDecks.filter((x) => x.id !== d.id), d];
      deckChoice = d.id;
    } catch {
      note = 'The starter deck could not be made. Paste a list instead.';
      pasting = true;
    }
  }

  function pickDeck(d: DeckRecord): void {
    const ok = allow(d);
    if (ok !== true) {
      failure = ok;
      return;
    }
    failure = '';
    if (!savedDecks.some((x) => x.id === d.id)) savedDecks = [...savedDecks, d];
    deckChoice = d.id;
    pasting = false;
    pickerOpen = false;
  }

  function home(): void {
    if (onleave) onleave();
    else location.hash = '#/';
  }

  /**
   * OPEN SIX BOOSTERS: the new-deck flow opens in another tab of the same profile, so this table stays open; the room
   * reads the library again when this tab is shown again, and the new booster deck is in CHANGE DECK.
   */
  function openBoosters(): void {
    note = '';
    const url = `${location.pathname}${location.search}#/decks/new`;
    // Not the 'noopener' feature: with it window.open answers null even when the tab opened.
    const w = typeof window.open === 'function' ? window.open(url, '_blank') : null;
    if (w) w.opener = null;
    if (!w) note = 'Open Decks in another tab to open boosters; this table stays here.';
    else note = 'Decks opened in another tab. Your new deck shows up here when you come back.';
  }
  async function relist(): Promise<void> {
    const d = await decks.list().catch(() => null);
    if (d) savedDecks = d;
  }

  function setFormat(f: string): void {
    if (f === st.format) return;
    try {
      session.dispatch({ type: 'formatSet', format: f as Format, life: game.startingLife(f as Format) });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  function setDecks(v: string): void {
    note = '';
    if (v === 'draft') {
      if (!drafting) setLobby(boosterToLobby(boosters));
      return;
    }
    if (drafting) setLobby({ draft: null, sets: st.lobby?.sets ?? ['M19'], pickTimer: false });
    const r: DeckRule = v === 'booster' ? 'booster' : 'any';
    if ((st.settings.decks ?? 'any') === r) return;
    try {
      session.dispatch({ type: 'settings', settings: { decks: r } });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  function setLobby(lobby: NonNullable<TableState['lobby']>): void {
    try {
      if (session.evening) session.evening.setLobby(lobby);
      else session.dispatch({ type: 'lobbySet', lobby });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  function setPass(v: string): void {
    const ms = v === 'off' ? null : Number(v);
    try {
      session.dispatch({ type: 'settings', settings: { passTimerMs: ms } });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  function seatState(c: Chair): string {
    if (!c.occupied) return 'OPEN SEAT';
    if (c.ready) {
      const n = st.commitments[c.seat]?.instanceIds.length ?? 0;
      return n ? `DECK READY · ${n}` : 'READY';
    }
    if (c.away) return 'AWAY';
    // A draft night needs no deck: the presence word beside the dot says it all ("here"), not "here HERE".
    return drafting ? '' : 'CHOOSING A DECK';
  }
  function seatPresence(c: Chair): 'here' | 'connecting' | 'away' {
    if (c.mine) return 'here';
    if (c.away) return 'away';
    return present(c.seat) ? 'here' : 'connecting';
  }
  function cannotConnect(c: Chair): boolean {
    if (!c.peer) return false;
    if (c.mine) return failedPeers.size > 0;
    return failedPeers.has(c.peer);
  }
</script>

<main class="room ds-root" data-testid="lobby" aria-labelledby="lobby-title" data-invite={inviteOpen} data-side={inviteOpen || !!rules}>
  <header class="top">
    <Button variant="ghost" size="sm" data-testid="room-home" onclick={home}>← HOME</Button>
    <div class="title">
      <h1 id="lobby-title" class="ds-t-title">
        <span class="code" data-testid="room-code">{code}</span>
        <PresenceDot state={connected ? 'here' : 'connecting'} label={connected ? 'Everyone here is connected' : 'Connecting'} />
      </h1>
      <p class="ds-t-eyebrow" data-testid="setup-summary">{summary}</p>
    </div>
    <div class="top-actions">
      {#if isHost}<Button variant="ghost" size="sm" data-testid="setup-edit" onclick={() => (setupOpen = true)}>SETUP ✎</Button>{/if}
      <Button variant="ghost" size="sm" data-testid="invite-open" aria-expanded={inviteOpen} onclick={() => (inviteOpen = !inviteOpen)}>INVITE ⇪</Button>
    </div>
  </header>

  <div class="body">
    <div class="main">
      {#if welcome}<p class="welcome" role="status" data-testid="invite-welcome">◆ {welcome}</p>{/if}
      {#if !isHost && host}<p class="ds-t-meta who-sets" data-testid="setup-owner">{hostName} chooses the setup.</p>{/if}

      <section class="seats" class:sides={sideSeats} aria-label="Seats">
        <div class="table-box" style:aspect-ratio="{box.w} / {box.d}" style:max-width="min(560px, calc(30vh * {(box.w / box.d).toFixed(3)}))">
          <svg viewBox="{-box.w / 2} {-box.d / 2} {box.w} {box.d}" aria-hidden="true">
            <rect class="table" x={-box.w / 2 + 8} y={-box.d / 2 + 8} width={box.w - 16} height={box.d - 16} rx="80" />
          </svg>
          {#each list as c (c.seat)}
            {@const a = layout.seats[c.index]?.zones.avatar}
            {@const pos = a ? place(a.x, a.y) : { edge: 'bottom' as Edge, left: 50, top: 100 }}
            {@const sc = seatColours[c.colour]}
            {@const failed = cannotConnect(c)}
            <div class="seat" data-edge={pos.edge} style:left="{pos.left}%" style:top="{pos.top}%">
              {#if c.occupied}
                <button
                  type="button"
                  class="plate ds-focusable"
                  class:mine={c.mine}
                  data-testid="chair"
                  data-seat={c.seat}
                  data-occupied="true"
                  data-mine={c.mine}
                  data-ready={c.ready}
                  data-colour={c.colour}
                  data-team={c.team ?? ''}
                  data-connect={failed ? 'failed' : ''}
                  aria-pressed={c.mine}
                  onclick={() => takeChair(c.seat)}
                >
                  <SeatGlyph seat={c.index} colour={sc?.colour ?? 'currentColor'} size={36} label="Seat colour of {c.name}" />
                  <span class="who">
                    <span class="name" title={c.name}><span class="nm">{c.name}</span>{#if c.mine || c.seat === host}<span class="ds-t-meta tag">{[c.mine ? 'you' : '', c.seat === host ? 'host' : ''].filter(Boolean).join(' · ')}</span>{/if}</span>
                    <span class="state" data-testid="seat-state">
                      <PresenceDot state={failed ? 'away' : seatPresence(c)} label={failed ? 'CANNOT CONNECT' : seatPresence(c)} />
                      {#if !failed && seatState(c)}<span class="sep" aria-hidden="true">·</span>{/if}
                      {failed ? '' : seatState(c)}
                    </span>
                  </span>
                  {#if c.ready}<span class="check" aria-hidden="true">✓</span>{/if}
                </button>
              {:else}
                {@const choice = chairChoice(st, c.seat, selfPeer)}
                <button
                  type="button"
                  class="plate free ds-focusable"
                  data-testid="chair"
                  data-seat={c.seat}
                  data-occupied="false"
                  data-mine="false"
                  data-ready="false"
                  data-colour=""
                  data-team={c.team ?? ''}
                  disabled={!choice.ok && !mySeat}
                  onclick={() => (mySeat ? (choice.ok ? takeChair(c.seat) : (inviteOpen = true)) : takeChair(c.seat))}
                >
                  <span class="plus" aria-hidden="true">＋</span>
                  <span class="who"><span class="name">Open seat</span><span class="state">{mySeat && choice.ok ? 'MOVE HERE' : 'SIT HERE'}</span></span>
                </button>
                <!-- The invitation sits inside the open seat's plate, at its end (board 5's seat row ⋯), the same on every edge. -->
                <span class="invite-at"><Button variant="ghost" size="xs" data-testid="seat-invite" aria-label="Invite a player to this seat" onclick={() => (inviteOpen = true)}>INVITE</Button></span>
              {/if}
              {#if c.team !== null}<span class="ds-t-meta team" data-testid="chair-team">{teams.find((g) => g.team === c.team)?.label ?? ''}</span>{/if}
            </div>
          {/each}
        </div>
        {#if teams.length > 0}
          <ul class="teams ds-t-meta" data-testid="lobby-teams" aria-label="Teams">
            {#each teams as g (g.team)}
              <li data-team={g.team} data-mine={g.mine} data-full={g.full}><strong>{g.label}{g.mine ? ' (your team)' : ''}</strong>: {g.chairs.map((c) => (c.occupied ? c.name : 'open seat')).join(' & ')}</li>
            {/each}
          </ul>
        {/if}
      </section>

      <div class="deck-and-start">
        <section class="slot" aria-label="Your deck" data-testid="deck-slot" data-kind={drafting ? 'boosters' : me?.ready ? 'ready' : selected ? 'deck' : 'empty'}>
          {#if drafting}
            <p class="ds-t-eyebrow">LIVE BOOSTER DRAFT</p>
            <BoosterFan sets={packs} count={packs.length} width={72} label="Closed boosters: your deck is drafted at this table" data-testid="slot-boosters" />
            <p class="ds-t-meta">{packs.length} boosters each. Nothing to choose: your deck is drafted here.</p>
          {:else if me?.ready}
            <p class="ds-t-eyebrow">YOUR DECK</p>
            <p class="deck-name" data-testid="slot-deck-name">{readyDeckName || 'Your deck'}</p>
            <p class="ds-t-meta" data-testid="ready-done">You are ready. Your deck of {committed} cards is committed and locked to your chair.</p>
          {:else}
            <p class="ds-t-eyebrow">YOUR DECK</p>
            {#if selected && !showPaste}
              <p class="deck-name" data-testid="slot-deck-name">{selected.name}</p>
              <p class="ds-t-meta">{deckKindOf(selected) === 'sealed' ? 'BOOSTER DECK' : 'CUSTOM DECK'} · {selected.main.length}</p>
              {#if allow(selected) !== true}<StatusLine tone="danger" data-testid="slot-reason">{allow(selected)}</StatusLine>{/if}
              <div class="offers">
                <Button size="sm" data-testid="change-deck" onclick={() => (pickerOpen = true)}>CHANGE DECK</Button>
                <Button size="sm" variant="quiet" data-testid="paste-instead" onclick={() => ((deckChoice = 'paste'), (pasting = true))}>PASTE A LIST</Button>
              </div>
            {:else}
              {#if !showPaste || savedDecks.length === 0}
                <div class="offers">
                  {#if rule !== 'booster'}<Button size="sm" data-testid="use-starter" onclick={useStarter}>USE A STARTER DECK</Button>{/if}
                  <Button size="sm" data-testid="open-boosters" onclick={openBoosters}>OPEN SIX BOOSTERS</Button>
                  {#if savedDecks.length > 0}<Button size="sm" data-testid="change-deck" onclick={() => (pickerOpen = true)}>CHANGE DECK</Button>{/if}
                </div>
              {/if}
              {#if rule !== 'booster'}
                <label class="ds-t-eyebrow paste-label" for="lobby-deck-text">PASTE A LIST</label>
                <textarea id="lobby-deck-text" bind:value={deckText} rows="5" spellcheck="false" data-testid="lobby-deck-text" placeholder="4 Llanowar Elves&#10;20 Forest"></textarea>
                <div class="offers">
                  <Button size="sm" data-testid="lobby-deck-check" disabled={busy || !deckText.trim()} onclick={checkPasted}>CHECK THE LIST</Button>
                  {#if savedDecks.length > 0}<Button size="sm" variant="quiet" data-testid="paste-cancel" onclick={() => ((pasting = false), (deckText = ''), (deckChoice = selected?.id ?? savedDecks[0]?.id ?? 'paste'))}>BACK TO MY DECK</Button>{/if}
                </div>
                {#if checked && checkedText === deckText}
                  <p class="ds-t-meta" data-testid="lobby-deck-summary">
                    {checked.resolved.main.length} cards in the deck{#if checked.resolved.side.length}, {checked.resolved.side.length} in the sideboard{/if}.{#if checked.errors.length}
                      {checked.errors.length} line{checked.errors.length === 1 ? '' : 's'} not found: {checked.errors.map((e) => `line ${e.line}`).join(', ')}.{/if}
                  </p>
                {/if}
              {/if}
            {/if}
          {/if}
        </section>

        <section class="primary" aria-label="Ready and start">
          {#if me?.ready}
            <Button size="lg" pressed={!held} data-testid="ready-on" data-held={held} onclick={toggleHeld}>{held ? 'READY' : 'READY ✓'}</Button>
          {:else if !drafting}
            <Button
              variant={isHost && pill.kind === 'start' ? 'secondary' : 'primary'}
              size="lg"
              data-testid="ready"
              disabled={busy || !mySeat || (deckChoice !== 'paste' && !deckRefs) || (deckChoice === 'paste' && !deckText.trim())}
              onclick={pressReady}>READY</Button
            >
          {/if}
          {#if isHost && drafting}
            {#if open === 0}
              <Button variant="primary" size="lg" data-testid="room-start-draft" onclick={() => startShort()}>START THE DRAFT</Button>
            {:else if shortStart}
              <Button variant="ghost" size="lg" data-testid="start-short" onclick={startShort}>START WITH {seatedCount} PLAYERS</Button>
            {:else}
              <span class="pill ds-t-eyebrow" role="status" data-testid="start-pill">{pill.label}</span>
            {/if}
          {:else if isHost}
            {#if pill.kind === 'start' && !startBlocked}
              <Button variant="primary" size="lg" data-testid="start-game" data-counting={pill.counting} onclick={start}>{pill.label}</Button>
            {:else if shortStart}
              <Button variant="ghost" size="lg" data-testid="start-short" onclick={startShort}>START WITH {seatedCount} PLAYERS</Button>
            {:else}
              <span class="pill ds-t-eyebrow" role="status" data-testid="start-pill">{pill.label}</span>
            {/if}
          {/if}
          <p class="line" role="status" data-testid="missing-line">{line}</p>
          {#if !drafting}<p class="ds-t-meta" data-testid="ready-count">{readiness(view).ready} of {Object.keys(st.seats).length} players ready.</p>{/if}
          {#if startBlocked && !drafting}<p class="ds-t-meta" data-testid="start-blocked" hidden={startBlocked === line}>{startBlocked}</p>{/if}
          {#if failure}<p class="ds-status ds-status--danger" role="alert" data-testid="lobby-failure">{failure}</p>{/if}
          {#if note}<StatusLine data-testid="lobby-note">{note}</StatusLine>{/if}
        </section>
      </div>

      {#if report.problems.length}
        <section class="calm" role="alert" data-testid="connectivity-problem">
          {#each report.problems as p (p.kind + (p.peer ?? ''))}
            <!-- The shared empty and error states (ui/empty/states.ts) title the relay and no-peer cases. -->
            <p class="ds-t-reading">{#if p.kind === 'relays'}<strong>{EMPTY_STATES.relayUnreachable.title}.</strong> {:else if p.kind === 'alone'}<strong>{EMPTY_STATES.noPeers.title}.</strong> {/if}{p.text}</p>
          {/each}
        </section>
      {:else if report.notice}
        <p class="calm ds-t-reading" role="status" data-testid="connectivity-waiting"><strong>{EMPTY_STATES.noPeers.title}.</strong> {report.notice}</p>
      {/if}

      <section class="you" aria-label="Name and seat colour" data-testid="lobby-you">
        <div class="you-row">
          <div class="nick">
            <Field
              bind:value={nickname}
              label="Nickname"
              placeholder="Your name at the table"
              maxlength={40}
              aria-invalid={!!nickProblem}
              data-testid="lobby-nickname"
              onblur={saveNickname}
              onenter={() => void saveNickname()}
            />
            {#if nickProblem}<p class="ds-status ds-status--danger">{nickProblem}</p>{/if}
          </div>
          <fieldset class="colours" disabled={!mySeat}>
            <legend class="ds-sr-only">Seat colour</legend>
            {#each Array.from({ length: SEAT_COLOURS }, (_, i) => i) as c (c)}
              {@const sc = seatColours[c]}
              {@const takenBy = colourTakenBy(st, c, mySeat)}
              <label class="swatch" style:--seat={sc?.colour ?? 'currentColor'} title={takenBy ? `Taken by ${st.seats[takenBy]?.name}` : `Colour ${c + 1}`}>
                <input type="radio" name="seat-colour" value={c} checked={me?.colour === c} disabled={takenBy !== null} data-testid="colour" data-colour={c} onchange={() => pickSeatColour(c)} />
                <span class="dot" aria-hidden="true"></span>
                <span class="ds-sr-only">Colour {c + 1}{takenBy ? `, taken by ${st.seats[takenBy]?.name}` : ''}</span>
              </label>
            {/each}
          </fieldset>
        </div>
        {#if themeChoice}
          <details class="theme-choice" data-testid="lobby-theme">
            <summary class="ds-t-meta">Look: {theme.label}</summary>
            <ThemePicker choice={themeChoice} />
          </details>
        {/if}
      </section>

      <details class="spect">
        <summary class="ds-t-eyebrow">SPECTATORS</summary>
        <SpectatorPanel {session} {link} inline />
      </details>
    </div>

    {#if inviteOpen || rules}
      <div class="side">
    {#if inviteOpen}
      <aside class="invite" aria-label="Invite">
        <InviteSheet
          title="Invite players"
          text="Send this link, or let them scan the code. Whoever opens it sits down at your table."
          link={link.url}
          code={codeLabel(link.roomId)}
          spectatorLink={watchLink}
          status={open > 0 ? `Waiting for players · ${seatedCount} of ${Object.keys(st.seats).length} here` : `Everyone is here · ${seatedCount} of ${Object.keys(st.seats).length}`}
          onclose={() => (inviteOpen = false)}
        />
      </aside>
    {/if}
    {#if rules}<div class="rules">{@render rules()}</div>{/if}
      </div>
    {/if}
  </div>

  {#if pickerOpen}
    {@const Picker = picker}
    <div class="layer" role="presentation" data-testid="picker-layer" onclick={(e) => e.target === e.currentTarget && (pickerOpen = false)} onkeydown={(e) => e.key === 'Escape' && (pickerOpen = false)}>
      <Picker {allow} {decks} faces={faces ?? null} selectedId={selected?.id ?? null} onpick={pickDeck} onclose={() => (pickerOpen = false)} />
    </div>
  {/if}

  {#if setupOpen && isHost}
    <div class="layer dim" role="presentation" onclick={(e) => e.target === e.currentTarget && (setupOpen = false)} onkeydown={(e) => e.key === 'Escape' && (setupOpen = false)}>
      <Sheet label="Table setup" width="narrow" onclose={() => (setupOpen = false)} data-testid="setup-sheet">
        {#snippet header()}<h2 class="ds-t-title">Table setup</h2>{/snippet}
        <p class="ds-t-eyebrow">TABLE</p>
        <Segmented
          label="Table"
          size="sm"
          value={st.format}
          options={(['1v1', 'ffa3', 'ffa4', '2hg'] as const).map((f) => ({ value: f, label: FORMAT_LABEL[f], disabled: ready.ready > 0 }))}
          onchange={setFormat}
          data-testid="setup-format"
        />
        <p class="ds-t-eyebrow">DECKS</p>
        <Segmented
          label="Decks"
          size="sm"
          value={drafting ? 'draft' : rule}
          options={[
            { value: 'any', label: 'OWN DECKS' },
            { value: 'booster', label: 'BOOSTER DECKS' },
            { value: 'draft', label: 'LIVE DRAFT' },
          ]}
          onchange={setDecks}
          data-testid="setup-decks"
        />
        {#if drafting}
          <div class="setup-boosters" data-testid="setup-boosters">
            <BoosterFan sets={packs} width={44} label="The boosters of this draft" />
            <Button size="sm" data-testid="setup-boosters-edit" onclick={() => (boostersOpen = true)}>BOOSTERS…</Button>
          </div>
        {/if}
        <p class="ds-t-eyebrow">PASS TIMER</p>
        <Segmented
          label="Pass timer"
          size="sm"
          value={st.settings.passTimerMs === null ? 'off' : String(st.settings.passTimerMs)}
          options={[
            { value: 'off', label: 'OFF' },
            { value: '3000', label: '3 S' },
            { value: '5000', label: '5 S' },
            { value: '10000', label: '10 S' },
          ]}
          onchange={setPass}
          data-testid="setup-pass"
        />
      </Sheet>
    </div>
  {/if}
  {#if boostersOpen && isHost}
    {@const Boosters = boosterSheet}
    <div class="layer" role="presentation" data-testid="boosters-layer" onclick={(e) => e.target === e.currentTarget && (boostersOpen = false)} onkeydown={(e) => e.key === 'Escape' && (boostersOpen = false)}>
      <Boosters value={boosters} mode="draft" onchange={(b) => setLobby(boosterToLobby(b))} onclose={() => (boostersOpen = false)} />
    </div>
  {/if}

</main>

<style>
  /* The header stays in the window; only the body scrolls, and only when the window is too short (gate M8 finding F5). */
  .room {
    box-sizing: border-box;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-body);
    color: var(--ds-ink);
    background: var(--ds-mat);
  }
  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--ds-space-lg);
    min-height: var(--ds-control-md);
    padding: var(--ds-space-xl) var(--ds-space-xxl) var(--ds-space-md);
  }
  .top-actions,
  .top > :global(:first-child) {
    flex: 0 0 auto;
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  h1 {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-sm);
  }
  .code {
    font-family: var(--ds-font-mono);
    letter-spacing: 0.12em;
  }
  .top-actions {
    display: flex;
    gap: var(--ds-space-sm);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    box-sizing: border-box;
    padding: var(--ds-space-md) var(--ds-space-xxl) var(--ds-space-xxxl);
    display: grid;
    gap: var(--ds-space-xl);
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  /* Board 5: the room in the middle, the invitation and the table's rules in a 336 px column on the right. */
  .room[data-side='true'] .body {
    grid-template-columns: minmax(0, 1fr) 336px;
  }
  .side {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ds-space-lg);
    min-width: 0;
  }
  .main {
    display: grid;
    gap: var(--ds-space-lg);
    min-width: 0;
    max-width: 880px;
    width: 100%;
    justify-self: center;
  }
  .who-sets,
  .welcome {
    margin: 0;
    text-align: center;
  }
  .welcome {
    font-size: var(--ds-type-title);
  }
  /* The seat plates stand outside the table's outline (gate M8 finding F5): the seats' box keeps a plate's height above
     and below the table, and, where seats sit beside it (three and four players), a plate's width on either side. */
  .seats {
    --plate-w: 248px;
    --plate-gap: 12px;
    display: grid;
    gap: var(--ds-space-md);
    padding: calc(var(--ds-control-lg) + var(--plate-gap) + var(--ds-space-lg)) 0;
  }
  .seats.sides {
    padding-left: calc(var(--plate-w) + var(--plate-gap));
    padding-right: calc(var(--plate-w) + var(--plate-gap));
  }
  .table-box {
    position: relative;
    width: 100%;
    margin: 0 auto;
  }
  .table-box svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .table {
    fill: var(--ds-frame);
    stroke: var(--ds-line);
    stroke-width: 8;
  }
  .seat {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ds-space-xs);
  }
  .seat[data-edge='bottom'] {
    transform: translate(-50%, var(--plate-gap));
  }
  /* A seat across the table keeps its extra line (the team) on the outside, away from the table. */
  .seat[data-edge='top'] {
    flex-direction: column-reverse;
    transform: translate(-50%, calc(-100% - var(--plate-gap)));
  }
  .seat[data-edge='left'] {
    align-items: flex-end;
    transform: translate(calc(-100% - var(--plate-gap)), -50%);
  }
  .seat[data-edge='right'] {
    align-items: flex-start;
    transform: translate(var(--plate-gap), -50%);
  }
  /* A seat plate (visual.md 2.8 "Seat row"): a raised pill, 56 high; an open seat is a dashed well. */
  .plate {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-md);
    width: var(--plate-w);
    height: var(--ds-control-lg);
    padding: 0 var(--ds-space-lg) 0 var(--ds-space-sm);
    border: 0;
    border-radius: var(--ds-radius-plate);
    background: var(--ds-panel-raised);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-raised);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform var(--ds-duration-fast, 120ms) var(--ds-ease-out, ease-out);
  }
  .plate.mine {
    box-shadow:
      0 0 0 2px var(--ds-ink),
      var(--ds-elevation-raised);
    cursor: default;
  }
  .plate.free {
    padding-right: 96px;
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--ds-border);
    color: var(--ds-muted);
  }
  /* The open seat's INVITE sits at the plate's end, over the plate's padding (a sibling, not a button in a button). */
  .invite-at {
    position: absolute;
    top: calc(var(--ds-control-lg) / 2);
    right: var(--ds-space-md);
    translate: 0 -50%;
  }
  .seat[data-edge='top'] .invite-at {
    top: auto;
    bottom: calc(var(--ds-control-lg) / 2);
    translate: 0 50%;
  }
  .plate:disabled {
    cursor: default;
  }
  .plus {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--ds-chip);
  }
  .who {
    display: grid;
    gap: var(--ds-space-xxs);
    min-width: 0;
    flex: 1;
  }
  /* The plate is a 56 px control (visual.md 2.5): the name on one line, wide enough for any made-up nickname, and who it
     is (you, host) after it in meta type, which never shrinks; only a very long chosen name is cut, with its tooltip. */
  .name {
    display: flex;
    align-items: baseline;
    gap: var(--ds-space-sm);
    min-width: 0;
    font-weight: var(--ds-weight-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    flex: none;
    font-weight: normal;
  }
  /* Presence and deck state in one meta line: "HERE · CHOOSING A DECK" (gate M8 finding N11). */
  .state {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-xs);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--ds-type-label);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ds-muted);
  }
  .plate[data-connect='failed'] .state {
    color: var(--ds-danger);
  }
  .check {
    font-weight: var(--ds-weight-bold);
  }
  .teams {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    gap: var(--ds-space-lg);
    justify-content: center;
  }
  .deck-and-start {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--ds-space-lg);
    align-items: start;
  }
  .slot {
    display: grid;
    justify-items: center;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-lg);
    border-radius: var(--ds-radius-sheet);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-sheet);
    text-align: center;
  }
  .slot p {
    margin: 0;
  }
  .deck-name {
    font-size: var(--ds-type-title);
    font-weight: var(--ds-weight-bold);
  }
  .offers {
    display: flex;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
    justify-content: center;
  }
  .paste-label {
    justify-self: start;
  }
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: var(--ds-space-md) var(--ds-space-lg);
    border: 0;
    border-radius: var(--ds-radius-card);
    background: var(--ds-chip);
    box-shadow: var(--ds-elevation-well, none);
    color: var(--ds-ink);
    font-family: var(--ds-font-mono);
    font-size: var(--ds-type-small);
    resize: vertical;
  }
  textarea:focus-visible {
    outline: 2px solid var(--ds-focus);
    outline-offset: 2px;
  }
  .primary {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--ds-space-sm);
    padding-top: var(--ds-space-lg);
  }
  .primary p {
    margin: 0;
    text-align: center;
  }
  .primary :global(.ds-btn--lg) {
    min-width: 220px;
  }
  .pill {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-width: 220px;
    height: var(--ds-control-sm);
    padding: 0 var(--ds-space-lg);
    border-radius: var(--ds-radius-pill);
    box-shadow: inset 0 0 0 1px var(--ds-border);
  }
  .line {
    font-size: var(--ds-type-body);
  }
  .calm {
    margin: 0;
    padding: var(--ds-space-md) var(--ds-space-lg);
    border-radius: var(--ds-radius-card);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-sheet);
  }
  .calm p {
    margin: 0;
  }
  .you {
    display: grid;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-md) var(--ds-space-lg);
    border-radius: var(--ds-radius-sheet);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-sheet);
  }
  .you-row {
    display: flex;
    gap: var(--ds-space-lg);
    flex-wrap: wrap;
    align-items: center;
  }
  .nick {
    flex: 1 1 220px;
    display: grid;
    gap: var(--ds-space-xs);
  }
  .colours {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-xs);
    border: 0;
    padding: 0;
    margin: 0;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--ds-control-sm);
    height: var(--ds-control-sm);
    border-radius: 50%;
    background: var(--ds-chip);
    cursor: pointer;
  }
  .swatch .dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--seat);
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .swatch:has(input:checked) {
    box-shadow: inset 0 0 0 2px var(--ds-ink);
  }
  .swatch:has(input:disabled) {
    opacity: 0.4;
  }
  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--ds-focus);
    outline-offset: 2px;
  }
  .invite :global(> *) {
    width: 100%;
    box-sizing: border-box;
  }
  .layer {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: var(--ds-space-lg);
  }
  /* The kit's picker and booster sheets draw their own scrim: only the setup sheet (a bare Sheet) is dimmed here. */
  .layer.dim {
    background: var(--ds-overlay);
  }
  .setup-boosters {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
  }
  /* The legacy spectator panel (not this package's) wears the kit's smallest height here. */
  .spect {
    padding: var(--ds-space-sm) var(--ds-space-lg);
  }
  .spect summary {
    cursor: pointer;
  }
  .spect :global(button),
  .spect :global(input:not([type='checkbox']):not([type='radio'])) {
    box-sizing: border-box;
    height: 28px;
  }
  @media (max-width: 1100px) {
    .room[data-side='true'] .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      order: -1;
      justify-items: center;
    }
    .top,
    .body {
      padding-left: var(--ds-space-lg);
      padding-right: var(--ds-space-lg);
    }
  }
  @media (max-width: 720px) {
    .deck-and-start {
      grid-template-columns: minmax(0, 1fr);
    }
    .seats,
    .seats.sides {
      --plate-w: min(100%, 320px);
      padding: 0;
    }
    .table-box {
      aspect-ratio: auto !important;
      max-width: none !important;
      display: grid;
      gap: var(--ds-space-md);
      justify-items: center;
      max-height: none;
    }
    .table-box svg {
      display: none;
    }
    .seat,
    .seat[data-edge] {
      position: relative;
      left: auto !important;
      top: auto !important;
      transform: none;
      width: var(--plate-w);
    }
    .seat .plate {
      width: 100%;
    }
  }
</style>
