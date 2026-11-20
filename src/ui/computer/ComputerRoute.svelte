<!--
  `#/c/<room>`: a game against Sparring (computer.md section 3; contracts.md Part G "Computer opponent" item 5). Opens
  the computer game (the saved one of this room at once, else a new one for the selected deck) and renders the table
  frame with `kind: 'computer'`, `gather: false` and `extraShell`: the combat cue on the primary button
  (`primaryOverride`), Sparring's plate badge (`COMPUTER`, hexagon) and plate menu (Pause / Resume Sparring, Sparring
  concedes). One coach mark on the cue the first time, once per profile. Sparring pauses while the page is hidden.
  Leaving, the game-over overlay and checkpoints are the frame's; disposing the route disposes the runner and both
  sessions. While the HUD does not show the shell's plate slots (HUD_SHELL false) a small Sparring chip with the same
  menu stands in beside the frame's fallback bar.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { ComputerGame, ComputerStatus } from '../../session/types';
  import type { GameStore } from '../../store/types';
  import Badge from '../design/Badge.svelte';
  import CoachMark from '../design/CoachMark.svelte';
  import MenuPopover from '../design/MenuPopover.svelte';
  import type { MenuGroup } from '../design/menu';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import { HUD_SHELL } from '../hud/shell';
  import { leaveTable } from '../play/leave';
  import type { HudShellProps } from '../props';
  import { tableDeps } from '../table/context';
  import TableFrame from '../table/TableFrame.svelte';
  import type { TableDeps, TableFrameProps } from '../table/types';
  import { botDebugClock, setActiveComputer } from './debug';
  import { COMPUTER_BADGE, CUE_COACH_TEXT, coachDue, cueButton, pauseWhileHidden, plateItems, type CueButton } from './shell';

  let {
    room,
    go = (h: string) => (location.hash = h),
    open = undefined,
    games = undefined,
    deps = undefined,
    registerTable = undefined,
  }: {
    room: string;
    go?: (hash: string) => void;
    /** Opens the game (main.ts or a harness); default: the page's services from the table context. */
    open?: ((room: string) => Promise<ComputerGame>) | undefined;
    /** History's games store; default the profile's. */
    games?: GameStore | null | undefined;
    /** The page's sources and stores for the frame; default the context App sets. */
    deps?: TableDeps | undefined;
    /**
     * Dev and test builds: hand the human's session to the debug hook (main.ts registerSession) while the table is
     * shown, so `state`, `session.hash()` and `dispatch` answer for it as for every other table; returns the undo.
     */
    registerTable?: ((session: ComputerGame['session']) => () => void) | undefined;
  } = $props();

  const ctx = untrack(() => deps ?? tableDeps());
  let game = $state.raw<ComputerGame | null>(null);
  let store = $state.raw<GameStore | null>(untrack(() => games ?? null));
  let error = $state('');

  /** The default opener: the saved game of this room, else a new one for Home's selected deck (lazy chunk). */
  async function openDefault(roomId: string): Promise<ComputerGame> {
    const [m, page] = await Promise.all([import('../../session/computer'), import('./page')]);
    if (!ctx) return m.openComputerGame(roomId);
    const d = await page.pageComputerDeps(ctx);
    const clock = botDebugClock();
    if (clock) d.clock = clock;
    const deckId = ctx.settings ? await ctx.settings.get('home').then((h) => h.deckId, () => null) : null;
    if (store === null && games === undefined) store = (await page.pageStores())?.games ?? null;
    return m.openComputerGame(roomId, { deckId, deps: d });
  }

  $effect(() => {
    const roomId = room;
    let cancelled = false;
    let got: ComputerGame | null = null;
    let stop: (() => void) | null = null;
    let unregister: (() => void) | null = null;
    untrack(() => (open ?? openDefault)(roomId)).then(
      async (g) => {
        got = g;
        if (cancelled) {
          g.handle.dispose();
          return;
        }
        if (__SPELLPLANE_DEBUG__) {
          // The debug hook's `bot` part (dev and test builds): production never reaches Sparring's runner.
          const { runnerOf } = await import('../../session/computer');
          if (cancelled) return;
          const runner = runnerOf(g.handle);
          if (runner) setActiveComputer({ runner, config: g.handle.config });
          unregister = untrack(() => registerTable)?.(g.session) ?? null;
        }
        stop = pauseWhileHidden(g.handle, document);
        game = g;
        void record(roomId);
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
      game = null;
      unregister?.();
      if (got) {
        if (__SPELLPLANE_DEBUG__) setActiveComputer(null);
        got.handle.dispose();
      }
    };
  });

  /** History's row for a new computer game (GameStore.create with kind solo, opponent sparring). */
  async function record(roomId: string): Promise<void> {
    const g = store;
    if (!g) return;
    try {
      if (await g.get(roomId)) return;
      await g.create({ code: roomId, key: '', kind: 'solo', format: '1v1', decks: 'constructed', opponent: 'sparring', seat: 's0' });
    } catch {
      /* History is best effort; the table itself is saved by the sessions */
    }
  }

  // The table and Sparring's status, for the cue and the plate.
  let st = $state.raw<TableState | null>(null);
  let status = $state.raw<ComputerStatus | null>(null);
  $effect(() => {
    const g = game;
    if (!g) return;
    st = g.session.getState();
    status = g.handle.status();
    const offState = g.session.subscribe((s) => (st = s));
    const offStatus = g.handle.subscribe((s) => (status = s));
    return () => {
      offState();
      offStatus();
    };
  });

  const cue = $derived.by((): CueButton | null => {
    const g = game;
    if (!g || !st) return null;
    return cueButton(g.session, g.handle);
  });
  /** The cue, else `Sparring's turn` (quiet) on its turn, else the HUD's own step (computer.md 2.3). */
  const override = $derived.by((): HudShellProps['primaryOverride'] => {
    const g = game;
    if (!g || !st || st.result !== undefined || st.stage !== 'match') return null;
    if (cue) return { label: cue.label, run: () => cue.run() };
    if (st.turn.active === g.handle.seat) return { label: "Sparring's turn", quiet: true, run: () => undefined };
    return null;
  });

  // The coach mark on the cue (contracts.md Part G item 2), once per profile.
  let seen = $state.raw<readonly string[] | null>(null);
  onMount(() => {
    const s = ctx?.settings;
    if (!s) {
      seen = [];
      return;
    }
    s.get('hintsSeen').then(
      (h) => (seen = h),
      () => (seen = []),
    );
  });
  let coachDone = $state(false);
  let anchor = $state.raw<HTMLElement | null>(null);
  const showCoach = $derived(seen !== null && !coachDone && coachDue(cue, seen));
  $effect(() => {
    if (!showCoach) return;
    // The primary button is the frame's or the HUD's; find it once it is drawn.
    const find = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="frame-primary"], [data-testid="primary-action"]');
    anchor = find();
    if (anchor) return;
    const t = setTimeout(() => (anchor = find()), 50);
    return () => clearTimeout(t);
  });
  function dismissCoach(): void {
    if (coachDone) return;
    coachDone = true;
    const s = ctx?.settings;
    if (!s || !seen) return;
    const next = [...seen, 'coachSparring' as const];
    seen = next;
    void s
      .get('hintsSeen')
      .then((h) => (h.includes('coachSparring') ? undefined : s.set('hintsSeen', [...h, 'coachSparring'])))
      .catch(() => undefined);
  }

  // Sparring's plate menu items (tonight: Pause / Resume Sparring, Sparring concedes).
  const items = $derived.by(() => {
    const g = game;
    void st;
    void status;
    return g ? plateItems(g.session, g.handle) : [];
  });
  const groups = $derived<MenuGroup[]>([{ title: 'Sparring', items: items.map((i) => ({ id: i.id, label: i.label, danger: i.danger, disabled: i.disabled, testid: `sparring-${i.id}`, run: i.run })) }]);
  const paused = $derived(status?.phase === 'paused' ? 'PAUSED' : status?.phase === 'failed' ? 'STOPPED' : null);

  const extraShell = $derived.by((): NonNullable<TableFrameProps['extraShell']> => ({
    primaryOverride: override,
    plateBadge,
    plateMenuTop,
  }));

  let menuOpen = $state(false);
  let menuButton = $state<HTMLElement | null>(null);

  function leave(g: ComputerGame): void {
    void leaveTable({ session: g.session, kind: 'computer', code: room, games: store, go });
  }
</script>

{#snippet plateBadge(seat: SeatId)}
  {#if game && seat === game.handle.seat}
    <SeatGlyph seat={1} colour="var(--ds-seat-b)" size={16} computer label="Computer" />
    <Badge data-testid="computer-badge">{COMPUTER_BADGE}</Badge>
    {#if paused}<Badge tone="muted" data-testid="computer-paused">{paused}</Badge>{/if}
  {/if}
{/snippet}

{#snippet plateMenuTop(seat: SeatId, close: () => void)}
  {#if game && seat === game.handle.seat}
    {#each items as item (item.id)}
      <button type="button" class="ds-menu-item" class:ds-danger={item.danger} data-testid="sparring-{item.id}" disabled={item.disabled} onclick={() => (close(), item.run())}>{item.label}</button>
    {/each}
  {/if}
{/snippet}

{#if game}
  {@const g = game}
  <TableFrame session={g.session} kind="computer" code={room} games={store} gather={false} {extraShell} deps={ctx ?? undefined} onleave={() => leave(g)} />
  {#if !HUD_SHELL}
    <!-- Sparring's plate slots while the HUD does not show them (contracts.md Part C fallback). -->
    <div class="sparring-chip ds-root ds-panel" data-testid="sparring-chip">
      <SeatGlyph seat={1} colour="var(--ds-seat-b)" size={20} computer label="Computer" />
      <span class="ds-label">Sparring</span>
      <Badge data-testid="computer-badge">{COMPUTER_BADGE}</Badge>
      {#if paused}<Badge tone="muted" data-testid="computer-paused">{paused}</Badge>{/if}
      <button bind:this={menuButton} type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="sparring-menu" aria-haspopup="true" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>Sparring ⋯</button>
      {#if menuOpen}
        <div class="sparring-menu">
          <MenuPopover bind:open={menuOpen} anchor={menuButton} {groups} label="Sparring" testid="sparring-menu-popover" placement="below" />
        </div>
      {/if}
    </div>
  {/if}
  {#if showCoach && anchor}
    <CoachMark {anchor} title={CUE_COACH_TEXT} placement="below" ondismiss={dismissCoach} data-testid="coach-sparring" />
  {/if}
{:else if error}
  <main class="ds-page ds-root" data-testid="route-computer">
    <h1 class="ds-t-heading">Sparring</h1>
    <p class="ds-t-reading" role="alert">This game could not be opened: {error}</p>
    <button type="button" class="ds-btn ds-btn--secondary ds-btn--md" onclick={() => go('#/')}>Home</button>
  </main>
{:else}
  <main class="ds-page ds-root" data-testid="route-computer">
    <p class="ds-t-reading" role="status">Opening the game…</p>
  </main>
{/if}

<style>
  .sparring-chip {
    position: fixed;
    z-index: 30;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 8px;
  }
  .sparring-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 200px;
  }
</style>
