<!--
  Home `#/` (journey.md 4.1, 4.5, section 6; visual.md board 1 and 4): the deck hero (or three closed boosters in Draft
  night), four mode cards (a Segmented under 1100 px), the option row of the mode, one 56 px primary whose label is the
  next step, the status line, the CONTINUE strip and the recent games below the fold. Every decision of the primary is
  `homeView` (view.ts). M8-P2.
-->
<script lang="ts">
  import { onDestroy, onMount, tick as settled, untrack } from 'svelte';
  import BoosterSetupSheet from '../decks/BoosterSetupSheet.svelte';
  import JoinSheet from '../lobby/JoinSheet.svelte';
  import BoosterFan from '../design/BoosterFan.svelte';
  import Button from '../design/Button.svelte';
  import CardFan from '../design/CardFan.svelte';
  import Icon from '../design/Icon.svelte';
  import IconButton from '../design/IconButton.svelte';
  import ModeCard from '../design/ModeCard.svelte';
  import Pip from '../design/Pip.svelte';
  import SealBand from '../design/SealBand.svelte';
  import Segmented from '../design/Segmented.svelte';
  import Sheet from '../design/Sheet.svelte';
  import Sparkline from '../design/Sparkline.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import StrengthPips from '../design/StrengthPips.svelte';
  import HistoryList from '../history/HistoryList.svelte';
  import { relTime, rowState, rowTitle } from '../history/rows';
  import { FirstRunError, launchDraft, launchEmpty, launchFirstRun, launchPrivate, launchQuick, launchSolo, makeStarterDeck, summaryHash, type LaunchDeps } from '../play/launch';
  import { tableDeps } from '../table/context';
  import type { RoomLink } from '../types';
  import { COMPUTER_AVAILABLE } from '../../session/computer';
  import { MATCHMAKING_AVAILABLE } from '../../session/matchmaker';
  import type { TableSession } from '../../session/types';
  import type { GameStore } from '../../store/types';
  import { launchDeps, pageFaces } from './deps';
  import { isEnded } from '../../store/games';
  import type { CardRef } from '../../core/types';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import { DEFAULT_HOME_PREFS, type BoosterSetup, type DeckRecord, type GameSummary, type HomeMode, type HomePrefs } from '../../store/types';
  import { DRAFT_PLAYERS, FORMATS, heroPacks, homeView, MODE_ICONS, MODES, queuedSetup, stepDeck } from './view';

  let {
    matchmaker,
    games = null,
    newRoom = undefined,
    go = (h: string) => (location.hash = h),
    deps: given = {},
    openPractice = undefined,
    matchmakingAvailable = MATCHMAKING_AVAILABLE,
    computerAvailable = COMPUTER_AVAILABLE,
    storageOk = undefined,
    online = undefined,
    faceUrl = undefined,
    now = () => Date.now(),
  }: {
    matchmaker: Matchmaker;
    games?: GameStore | null;
    /** A fresh private table this browser creates (main.ts marks it created here). */
    newRoom?: (() => RoomLink) | undefined;
    go?: (hash: string) => void;
    /** Overrides of the launchers' dependencies (the harness page passes its fakes); the rest comes from the page. */
    deps?: Partial<LaunchDeps>;
    /** Opens the practice table `roomId` (main.ts `openPractice`): SOLO · ALONE deals the deck into it before it shows. */
    openPractice?: ((roomId: string) => Promise<TableSession>) | undefined;
    matchmakingAvailable?: boolean;
    computerAvailable?: boolean;
    /** Whether this browser keeps decks and games (default: a games store exists). */
    storageOk?: boolean | undefined;
    /** Whether the browser is online (default: navigator.onLine, following the online and offline events). */
    online?: boolean | undefined;
    /** The image of a card for the hero's fan, or null for a card back (default: the page's face source). */
    faceUrl?: ((ref: CardRef) => Promise<string | null>) | undefined;
    now?: () => number;
  } = $props();

  // The page's sources (App.svelte sets them for every table, ui/table/context.ts); the harness passes its own in `deps`.
  const page = tableDeps();
  const deps: LaunchDeps = untrack(() => launchDeps(given, { games, newRoom, go, openPractice, now, page, matchmaker }));
  const keeps = $derived(storageOk ?? deps.games !== null);
  let browserOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isOnline = $derived(online ?? browserOnline);
  const facesOf = untrack(() => faceUrl ?? pageFaces(page));

  let prefs: HomePrefs = $state(structuredClone(DEFAULT_HOME_PREFS));
  let decks: DeckRecord[] = $state([]);
  let searched = $state(false);
  const mm = untrack(() => matchmaker);
  let status: MatchmakerStatus = $state(mm.status());
  let latest = $state<GameSummary | null>(null);
  let recent = $state(0);
  let busy = $state(false);
  let firstRunFailed = $state(false);
  /** What the first-run sheet's TRY AGAIN runs again: the primary (first run) or the STARTER DECK link. */
  let retry: 'primary' | 'starter' = 'primary';
  let tick = $state(0);
  let ready = $state(false);
  let alive = true;
  let clock: ReturnType<typeof setInterval> | null = null;

  const offMm = mm.subscribe((s) => {
    status = s;
    syncClock();
  });

  const view = $derived(homeView(prefs, decks, isOnline, keeps, { available: matchmakingAvailable, status, searched }, { computer: computerAvailable }));
  const elapsed = $derived.by(() => {
    void tick;
    if (view.since === null) return '0:00';
    const s = Math.max(0, Math.floor((now() - view.since) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  const continueGame = $derived<GameSummary | null>(latest && !isEnded(latest) ? latest : null);

  function syncClock(): void {
    const on = status.phase === 'seeking';
    if (on && clock === null) clock = setInterval(() => (tick += 1), 1000);
    if (!on && clock !== null) {
      clearInterval(clock);
      clock = null;
    }
  }

  async function load(): Promise<void> {
    try {
      const [p, list, seen] = await Promise.all([
        deps.settings?.get('home') ?? Promise.resolve(DEFAULT_HOME_PREFS),
        deps.decks?.list() ?? Promise.resolve([]),
        deps.settings?.get('hintsSeen') ?? Promise.resolve([]),
      ]);
      if (!alive) return;
      prefs = { ...DEFAULT_HOME_PREFS, ...p };
      decks = list;
      searched = seen.includes('lobbyPrivacy');
    } catch {
      /* the defaults stay */
    }
    await loadLatest();
    ready = true;
  }

  /** The newest game for the CONTINUE strip (again after the recent list removed or restored one). */
  async function loadLatest(): Promise<void> {
    try {
      const games = (await deps.games?.list()) ?? [];
      if (alive) latest = games[0] ?? null;
    } catch {
      latest = null;
    }
  }

  async function save(next: HomePrefs): Promise<void> {
    prefs = next;
    await deps.settings?.set('home', $state.snapshot(next) as HomePrefs).catch(() => undefined);
  }

  function setMode(mode: string): void {
    if (view.optionsLocked) return;
    void save({ ...prefs, mode: mode as HomeMode });
  }

  /** Arrow keys move the mode (a radio group; the ends do not wrap, as the phone's stepper). */
  function modeKey(e: KeyboardEvent): void {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    // The kit's ModeCard moves the choice itself (M8-P1) and marks the key handled: one step per key, not two.
    if (!d || view.optionsLocked || e.defaultPrevented) return;
    e.preventDefault();
    const group = e.currentTarget as HTMLElement;
    const i = MODES.findIndex((m) => m.value === view.mode);
    const next = MODES[Math.min(MODES.length - 1, Math.max(0, i + d))]!;
    setMode(next.value);
    void settled().then(() => group.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  }

  function step(d: -1 | 1): void {
    if (view.deckLocked || !view.deck) return;
    const next = stepDeck(decks, view.deck.id, d);
    if (next && next.id !== view.deck.id) void save({ ...prefs, deckId: next.id });
  }

  function heroKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else return;
    e.preventDefault();
  }

  let rankedNote: string | null = $state(null);
  let rankedTimer: ReturnType<typeof setTimeout> | null = null;
  function setQuickFormat(v: string): void {
    if (view.optionsLocked) return;
    const format = v as HomePrefs['quick']['format'];
    const snapped = prefs.quick.ranked && format !== '1v1';
    void save({ ...prefs, quick: { format, ranked: snapped ? false : prefs.quick.ranked } });
    if (snapped) {
      rankedNote = 'Ranked is 1v1 for now.';
      if (rankedTimer) clearTimeout(rankedTimer);
      rankedTimer = setTimeout(() => (rankedNote = null), 4000);
    }
  }

  // CHANGE BOOSTERS opens the booster setup sheet (decks' BoosterSetupSheet, mode 'draft'); while that part draws
  // nothing in this build the button says so instead of doing nothing.
  let boostersOpen = $state(false);
  let boosterHost: HTMLElement | null = $state(null);
  async function openBoosters(): Promise<void> {
    boostersOpen = true;
    await settled();
    if (boosterHost && boosterHost.childElementCount === 0) {
      boostersOpen = false;
      deps.toast('Changing the boosters is not in this build yet.');
    }
  }
  // JOIN A GAME… opens the lobby package's JoinSheet (paste a table link), the same way.
  let joinOpen = $state(false);
  let joinHost: HTMLElement | null = $state(null);
  async function openJoin(): Promise<void> {
    joinOpen = true;
    await settled();
    if (joinHost && joinHost.childElementCount === 0) {
      joinOpen = false;
      deps.toast('Joining by a pasted link is not in this build yet. Open the link itself.');
    }
  }

  async function primary(): Promise<void> {
    if (busy || view.primary.disabled) return;
    const p = $state.snapshot(prefs) as HomePrefs;
    // Plain data: the launchers write the deck back (lastPlayedAt), and IndexedDB cannot clone a state proxy.
    const deck = view.deck ? ($state.snapshot(view.deck.record) as DeckRecord) : null;
    busy = true;
    try {
      switch (view.primary.action) {
        case 'play':
          await launchSolo(deps, p, deck, view.opponent);
          break;
        case 'firstRun':
          await launchFirstRun(deps, { ...p, solo: { opponent: view.opponent } });
          break;
        case 'find':
          if (deck) await launchQuick(deps, p, deck);
          searched = true;
          break;
        case 'create':
          await launchPrivate(deps, p, deck);
          break;
        case 'draft':
          await launchDraft(deps, p);
          break;
        case 'cancel':
          matchmaker.cancel();
          break;
        case 'none':
          break;
      }
    } catch (e) {
      if (e instanceof FirstRunError) {
        // The starter deck could not be built: the sheet (TRY AGAIN runs the first run again).
        retry = 'primary';
        firstRunFailed = true;
      } else {
        // The starter deck may already be saved (the start itself failed): read the library again, so the next press
        // plays that deck instead of building a second one.
        if (view.primary.action === 'firstRun') await reloadDecks();
        deps.toast('That did not work. Try again.');
      }
    } finally {
      if (alive) busy = false;
    }
  }

  /** STARTER DECK (journey.md 4.1 "Pick or build a deck first."): build and save a starter deck and select it; Home stays. */
  async function starterDeck(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const deck = await makeStarterDeck(deps, $state.snapshot(prefs) as HomePrefs);
      if (!alive) return;
      decks = [deck, ...decks.filter((d) => d.id !== deck.id)];
      prefs = { ...prefs, deckId: deck.id };
    } catch {
      if (alive) {
        retry = 'starter';
        firstRunFailed = true;
      }
    } finally {
      if (alive) busy = false;
    }
  }

  /** The library and the selected deck again (after a first run that saved its deck and then failed to start). */
  async function reloadDecks(): Promise<void> {
    try {
      const [p, list] = await Promise.all([deps.settings?.get('home') ?? Promise.resolve(prefs), deps.decks?.list() ?? Promise.resolve(decks)]);
      if (!alive) return;
      prefs = { ...DEFAULT_HOME_PREFS, ...p };
      decks = list;
    } catch {
      /* what is shown stays */
    }
  }

  /** TRY AGAIN on the first-run sheet: the action that failed. */
  function tryAgain(): void {
    firstRunFailed = false;
    void (retry === 'starter' ? starterDeck() : primary());
  }

  // After 400 ms of loading the status line says so (journey.md 4.1 "Other states").
  let slow = $state(false);
  onMount(() => {
    const t = setTimeout(() => (slow = true), 400);
    return () => clearTimeout(t);
  });

  onMount(() => {
    void load();
    syncClock();
  });
  onDestroy(() => {
    alive = false;
    offMm();
    if (clock !== null) clearInterval(clock);
    if (rankedTimer) clearTimeout(rankedTimer);
  });

  /** The hero's fan: the summary's cover and fan cards, at most five, front first. */
  const fanRefs = $derived.by((): CardRef[] => {
    const d = view.deck?.record;
    if (!d) return [];
    return (d.summary?.fan?.length ? d.summary.fan : d.main.slice(0, 5)).slice(0, 5);
  });
  let fanUrls = $state.raw<{ key: string; urls: (string | null)[] }>({ key: '', urls: [] });
  $effect(() => {
    const refs = fanRefs;
    const key = refs.map((r) => r.sid).join(',');
    if (key === fanUrls.key) return;
    let cancelled = false;
    void Promise.all(refs.map((r) => facesOf(r).catch(() => null))).then((urls) => {
      if (!cancelled) fanUrls = { key, urls };
    });
    return () => {
      cancelled = true;
    };
  });
  const fan = $derived.by(() => {
    const name = view.deck?.name ?? '';
    const key = fanRefs.map((r) => r.sid).join(',');
    return fanRefs.map((_, i) => ({ src: fanUrls.key === key ? (fanUrls.urls[i] ?? null) : null, alt: name }));
  });
  const curve = $derived(view.deck?.record.summary?.curve ?? []);
  const colours = $derived(view.deck?.record.summary?.colours ?? []);
  const strength = $derived(view.deck?.record.summary?.strength ?? null);
  const bandNo = $derived(strength ? ((['rough', 'casual', 'solid', 'tuned', 'fierce'].indexOf(strength.band) + 1) as 1 | 2 | 3 | 4 | 5) : null);
  const packs = $derived(heroPacks(prefs.draft.boosters));
  const sealLabel = $derived.by(() => {
    const seal = view.deck?.record.seal;
    if (!seal) return '';
    const sets = [...new Set(seal.sets)];
    return `${sets.join(' ')} × ${seal.sets.length}`;
  });
</script>

<svelte:window ononline={() => (browserOnline = true)} onoffline={() => (browserOnline = false)} />

<div class="home" data-testid="home" data-ready={ready}>
  <!-- 1. The hero -->
  <section class="hero" aria-label="Your deck" data-testid="home-hero" data-hero={view.hero}>
    {#if view.hero === 'boosters'}
      <span class="eyebrow">DRAFT NIGHT</span>
      <BoosterFan sets={packs} count={prefs.draft.boosters.packs} width={120} label="{packs.length} closed boosters of {packs[0]}" data-testid="home-boosters" />
      <h2 class="hero__name">{packs.length === 3 ? 'THREE' : packs.length} BOOSTERS · {packs[0]}</h2>
      <p class="facts">BOOSTER DRAFT · PICK {prefs.draft.boosters.picks}{prefs.draft.boosters.pickTimer ? '' : ' · NO TIMER'}</p>
      <div class="hero__acts">
        <Button size="sm" onclick={() => void openBoosters()} data-testid="home-change-boosters">CHANGE BOOSTERS</Button>
      </div>
    {:else if !ready}
      <!-- Loading (journey.md 4.1 "Other states"): an empty pile outline, no text until 400 ms have passed. -->
      <span class="eyebrow">YOUR DECK</span>
      <div class="hero__row"><div class="hero__empty" data-testid="home-loading-hero"></div></div>
    {:else if view.hero === 'empty'}
      <span class="eyebrow">YOUR DECK</span>
      <div class="hero__row">
        <div class="hero__empty" data-testid="home-empty-hero"><span>NO DECK YET</span></div>
      </div>
      <p class="facts">A card table for Magic. No rules engine, no account.</p>
    {:else if view.deck}
      <span class="eyebrow" data-testid="hero-eyebrow">{view.deckLocked ? 'IN THE QUEUE WITH' : `YOUR DECK · ${view.deckIndex + 1} OF ${view.deckCount}`}</span>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="hero__row" tabindex="0" role="group" aria-label="Deck {view.deck.name}; Left and Right change deck" onkeydown={heroKey} data-testid="hero-row">
        <IconButton label="Previous deck" disabled={view.deckLocked || view.deckIndex <= 0} onclick={() => step(-1)} data-testid="home-prev">‹</IconButton>
        <!-- The fan stands on the page over the arena; the pile's edges are under the cover card only (board 1; F18). -->
        <CardFan cards={fan} width={view.deckLocked ? 140 : 168} label="{view.deck.name}: cover and four cards" />
        <IconButton label="Next deck" disabled={view.deckLocked || view.deckIndex >= view.deckCount - 1} onclick={() => step(1)} data-testid="home-next">›</IconButton>
      </div>
      <h2 class="hero__name" data-testid="hero-name">{view.deck.name}</h2>
      <div class="facts" data-testid="hero-facts">
        {#each colours as c (c)}<Pip colour={c} />{/each}
        <span>{view.deck.kind === 'sealed' ? 'BOOSTER DECK' : 'CUSTOM DECK'} · {view.deck.cards} CARDS</span>
        {#if view.deck.kind === 'sealed' && sealLabel}<SealBand packs={sealLabel} />{/if}
        {#if curve.length}<Sparkline values={curve} label="Mana curve 0 to 7+" data-testid="hero-curve" />{/if}
        <span>STRENGTH</span><StrengthPips band={bandNo} score={strength?.score} />
      </div>
      <div class="hero__acts">
        <Button size="sm" disabled={view.deckLocked} onclick={() => deps.go('#/decks')} data-testid="home-change-deck">CHANGE DECK</Button>
        <Button size="sm" onclick={() => view.deck && deps.go(`#/decks/${encodeURIComponent(view.deck.id)}`)} data-testid="home-edit-deck">EDIT</Button>
      </div>
    {/if}
  </section>

  <!-- 2. Modes and options -->
  <div class="modes" role="radiogroup" aria-label="How to play" tabindex="-1" onkeydown={modeKey} data-testid="home-modes">
    {#each MODES as m (m.value)}
      <ModeCard
        value={m.value}
        name={m.name}
        meta={m.value === 'solo' ? (view.opponent === 'sparring' ? 'against Sparring' : 'practice alone') : m.value === 'quick' ? (matchmakingAvailable ? 'find opponents' : 'not in this build') : m.value === 'private' ? 'link or QR code' : 'boosters, live'}
        selected={view.mode === m.value}
        locked={view.optionsLocked}
        onselect={() => setMode(m.value)}
        data-testid="mode-{m.value}"
      >
        {#snippet icon()}<Icon name={MODE_ICONS[m.value]} size={20} />{/snippet}
      </ModeCard>
    {/each}
  </div>
  <div class="modes-narrow">
    <Segmented label="How to play" value={view.mode} options={MODES.map((m) => ({ value: m.value, label: m.name, disabled: view.optionsLocked }))} onchange={setMode} data-testid="home-modes-narrow" />
  </div>

  {#if status.phase === 'seeking'}<p class="queued" data-testid="home-queued">{queuedSetup(status.queues)}</p>{/if}
  <div class="options" class:locked={view.optionsLocked} data-testid="home-options">
    {#if view.mode === 'solo' && computerAvailable}
      <Segmented label="Opponent" size="sm" value={prefs.solo.opponent} options={[{ value: 'sparring', label: 'SPARRING', disabled: view.optionsLocked }, { value: 'alone', label: 'ALONE', disabled: view.optionsLocked }]} onchange={(v) => view.optionsLocked || void save({ ...prefs, solo: { opponent: v as 'sparring' | 'alone' } })} data-testid="opt-opponent" />
    {:else if view.mode === 'quick'}
      <Segmented label="Format" size="sm" value={prefs.quick.format} options={FORMATS.map((f) => ({ ...f, disabled: view.optionsLocked }))} onchange={setQuickFormat} data-testid="opt-quick-format" />
      <Segmented label="Ranked" size="sm" value={prefs.quick.ranked ? 'ranked' : 'unranked'} options={[{ value: 'unranked', label: 'UNRANKED', disabled: view.optionsLocked }, { value: 'ranked', label: 'RANKED', disabled: view.optionsLocked || prefs.quick.format !== '1v1', hint: 'Ranked is 1v1 for now.' }]} onchange={(v) => view.optionsLocked || void save({ ...prefs, quick: { ...prefs.quick, ranked: v === 'ranked' } })} data-testid="opt-ranked" />
    {:else if view.mode === 'private'}
      <Segmented label="Format" size="sm" value={prefs.private.format} options={[...FORMATS]} onchange={(v) => void save({ ...prefs, private: { ...prefs.private, format: v as HomePrefs['private']['format'] } })} data-testid="opt-private-format" />
      <Segmented label="Decks" size="sm" value={prefs.private.decks} options={[{ value: 'any', label: 'ANY DECK' }, { value: 'booster', label: 'BOOSTER DECKS ONLY' }]} onchange={(v) => void save({ ...prefs, private: { ...prefs.private, decks: v as 'any' | 'booster' } })} data-testid="opt-private-decks" />
      <Button size="sm" variant="quiet" onclick={() => void openJoin()} data-testid="home-join">JOIN A GAME…</Button>
    {:else if view.mode === 'draft'}
      <Segmented label="Players" size="sm" value={prefs.draft.format} options={[...DRAFT_PLAYERS]} onchange={(v) => void save({ ...prefs, draft: { ...prefs.draft, format: v as HomePrefs['draft']['format'] } })} data-testid="opt-draft-players" />
    {/if}
  </div>

  <!-- 3. The one primary -->
  <div class="go">
    <Button variant={view.primary.waiting ? 'secondary' : 'primary'} size="lg" waiting={view.primary.waiting} pressed={view.primary.waiting || undefined} disabled={!ready || view.primary.disabled || (busy && !view.primary.waiting)} onclick={() => void primary()} data-testid="home-primary">
      {busy && view.primary.action === 'firstRun' ? 'FETCHING THE DECKS…' : view.primary.label}
      {#snippet trailing()}{#if view.since !== null}<span class="timer" data-testid="home-timer">{elapsed}</span>{/if}{/snippet}
    </Button>
    {#if view.cancel}<IconButton label="Cancel the search" size="lg" variant="ghost" onclick={() => matchmaker.cancel()} data-testid="home-cancel">✕</IconButton>{/if}
  </div>
  <StatusLine tone={view.tone} data-testid="home-status">{ready ? (rankedNote ?? view.line ?? '') : slow ? 'Loading your decks…' : ''}</StatusLine>
  {#if view.links.length}
    <div class="links">
      <Button size="xs" variant="quiet" disabled={busy} onclick={() => void starterDeck()} data-testid="home-starter-deck">STARTER DECK</Button>
      <Button size="xs" variant="quiet" onclick={() => deps.go('#/decks/new/boosters')}>OPEN BOOSTERS</Button>
    </div>
  {/if}
  {#if view.useHere}<Button size="sm" onclick={() => matchmaker.cancel()}>USE HERE</Button>{/if}

  <!-- 4. The last unfinished game -->
  {#if continueGame}
    {@const g = continueGame}
    <Button size="md" onclick={() => deps.go(summaryHash(g))} data-testid="home-continue">
      <span class="cont"><span class="cont__eyebrow">↩ CONTINUE</span> <span class="cont__game" data-testid="home-continue-game">{rowTitle(g)} · {rowState(g)}</span> <span class="cont__code" data-testid="home-continue-time">{relTime(g.lastPlayedAt, now())}</span></span>
    </Button>
  {/if}

  <!-- 5. Recent games, below the fold -->
  <section class="recent" class:empty={recent === 0} aria-label="Your games" data-testid="home-recent">
    {#if recent > 0}<h3 class="eyebrow">YOUR GAMES</h3>{/if}
    <HistoryList games={deps.games} limit={5} {now} onopen={(g) => deps.go(summaryHash(g))} onchange={(n) => ((recent = n), void loadLatest())} />
    {#if recent > 5}<Button size="sm" variant="quiet" onclick={() => deps.go('#/history')}>{recent - 5} MORE GAMES</Button>{/if}
  </section>
</div>

{#if joinOpen}
  <div class="booster-sheet" bind:this={joinHost} data-testid="home-join-sheet"><JoinSheet onclose={() => (joinOpen = false)} /></div>
{/if}

{#if boostersOpen}
  <div class="booster-sheet" bind:this={boosterHost} data-testid="home-booster-sheet">
    <BoosterSetupSheet value={$state.snapshot(prefs.draft.boosters) as BoosterSetup} mode="draft" onchange={(b) => void save({ ...prefs, draft: { ...prefs.draft, boosters: b } })} onclose={() => (boostersOpen = false)} />
  </div>
{/if}

{#if firstRunFailed}
  <div class="scrim" data-ds-layer="sheet" data-testid="first-run-sheet">
    <Sheet label="A first deck" width="narrow" onclose={() => (firstRunFailed = false)}>
      {#snippet header()}<h2 class="sheet__title">A first deck needs a connection once.</h2>{/snippet}
      <p class="sheet__text">The starter deck's cards could not be fetched. Try again, paste a deck list, or open a table without a deck.</p>
      {#snippet footer()}
        <Button size="md" variant="ghost" onclick={() => ((firstRunFailed = false), void launchEmpty(deps, $state.snapshot(prefs) as HomePrefs))} data-testid="first-run-empty">OPEN AN EMPTY TABLE</Button>
        <Button size="md" variant="ghost" onclick={() => ((firstRunFailed = false), deps.go('#/decks/new/import'))} data-testid="first-run-paste">PASTE A DECK LIST</Button>
        <Button size="md" variant="primary" onclick={tryAgain} data-testid="first-run-retry">TRY AGAIN</Button>
      {/snippet}
    </Sheet>
  </div>
{/if}

<style>
  .home { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 1120px; margin: 0 auto; min-width: 0; }
  .eyebrow { margin: 0; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ds-muted); font-weight: 600; }
  .hero { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 360px; max-width: 100%; }
  .hero__row { display: flex; align-items: center; gap: 40px; border-radius: 16px; max-width: 100%; }
  .hero__row:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 4px; }
  .hero__empty { display: grid; place-items: center; width: 168px; height: 235px; border-radius: 12px; box-shadow: inset 0 0 0 2px var(--ds-line); color: var(--ds-muted); font-size: 11px; letter-spacing: 0.12em; }
  .hero__name { margin: 6px 0 0; font-size: 20px; letter-spacing: 0.04em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .facts { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; margin: 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ds-muted); }
  .hero__acts { display: flex; gap: 8px; margin-top: 4px; }
  .modes { display: flex; gap: 12px; margin-top: 12px; }
  .modes-narrow { display: none; max-width: 100%; overflow-x: auto; }
  .options { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; min-height: 36px; }
  .options.locked { opacity: 0.45; }
  .queued { margin: 0; font-size: 11px; letter-spacing: 0.12em; color: var(--ds-ink); }
  .go { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  .timer { font-weight: 700; letter-spacing: 0.1em; }
  .links { display: flex; gap: 8px; }
  .cont { display: inline-flex; align-items: center; gap: 8px; max-width: 520px; overflow: hidden; }
  .cont__eyebrow { font-size: 10px; letter-spacing: 0.14em; }
  .cont__game { text-transform: none; letter-spacing: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
  .cont__code { font-size: 10px; color: var(--ds-muted); }
  .recent { width: 100%; max-width: 760px; margin-top: 64px; display: flex; flex-direction: column; gap: 12px; }
  .recent.empty { margin-top: 0; }
  .scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: var(--ds-overlay); }
  .sheet__title { margin: 0; font-size: 17px; }
  .sheet__text { margin: 0; font-size: 13px; color: var(--ds-muted); }
  @media (max-width: 1099px) {
    .modes { display: none; }
    .modes-narrow { display: block; }
  }
  @media (max-width: 600px) {
    .hero__row { gap: 8px; }
    .hero { min-height: 0; }
  }
</style>
