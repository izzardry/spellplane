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
  import type { ComputerGameRecord, GameStore } from '../../store/types';
  import Badge from '../design/Badge.svelte';
  import CoachMark from '../design/CoachMark.svelte';
  import MenuPopover from '../design/MenuPopover.svelte';
  import type { MenuGroup } from '../design/menu';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import { HUD_SHELL } from '../hud/shell';
  import { newComputerRoom } from '../home/deps';
  import { computerHash } from '../play/launch';
  import { computerPurge, leaveTable, type ComputerStores } from '../play/leave';
  import type { HudShellProps } from '../props';
  import { tableDeps } from '../table/context';
  import TableFrame from '../table/TableFrame.svelte';
  import type { FrameLeave, TableDeps, TableFrameProps } from '../table/types';
  import { botDebugClock, setActiveComputer } from './debug';
  import { COMPUTER_BADGE, CUE_COACH_TEXT, coachDue, cueButton, keepRematch, pauseWhileHidden, plateItems, takeRematch, type CueButton } from './shell';

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
    /**
     * Opens the game (a harness); default: the page's services from the table context. `rematchOf` is the finished
     * game's record when the room was opened by its REMATCH (computer.md 2.4: the same decks, a new seed).
     */
    open?: ((room: string, opts?: { rematchOf?: ComputerGameRecord }) => Promise<ComputerGame>) | undefined;
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
  /** The stores the default opener saved this game into (the short-game purge deletes from them). */
  let savedIn: ComputerStores | null = null;

  /** The default opener: the saved game of this room, else a new one for Home's selected deck (lazy chunk). */
  async function openDefault(roomId: string, opts?: { rematchOf?: ComputerGameRecord }): Promise<ComputerGame> {
    const [m, page] = await Promise.all([import('../../session/computer'), import('./page')]);
    if (!ctx) return m.openComputerGame(roomId, { rematchOf: opts?.rematchOf ?? null });
    const d = await page.pageComputerDeps(ctx);
    const clock = botDebugClock();
    if (clock) d.clock = clock;
    const deckId = ctx.settings ? await ctx.settings.get('home').then((h) => h.deckId, () => null) : null;
    if (store === null && games === undefined) store = (await page.pageStores())?.games ?? null;
    savedIn = { tables: d.tables, computer: d.computer };
    return m.openComputerGame(roomId, { deckId, deps: d, rematchOf: opts?.rematchOf ?? null });
  }

  $effect(() => {
    const roomId = room;
    let cancelled = false;
    let got: ComputerGame | null = null;
    let stop: (() => void) | null = null;
    let unregister: (() => void) | null = null;
    const again = takeRematch(roomId);
    untrack(() => (open ?? openDefault)(roomId, again ? { rematchOf: again } : undefined)).then(
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
    // Pressing the cue by any means (pointer, Enter, Space) counts as having seen the coach mark.
    if (cue) return { label: cue.label, run: () => (dismissCoach(), cue.run()) };
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
    if (coachDone || !showCoach) return;
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

  /**
   * Where the mark stands: below the cue where there is room (the frame's bar, the HUD's primary above the hand on a
   * narrow or touch layout), above it when the cue sits at the window's lower edge (the HUD's primary on a desktop).
   */
  function coachPlacement(el: HTMLElement): 'above' | 'below' {
    return el.getBoundingClientRect().bottom + 96 > window.innerHeight ? 'above' : 'below';
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

  /**
   * REMATCH on the game-over overlay (computer.md 2.4): Sparring never answers a next-game proposal (4.2 item 6), so
   * the overlay leaves this table, saved as on any leave and without its toast, for a new computer room that plays the
   * same decks with a new seed (as Home's SOLO launcher opens one: a History row, the newest three solo games kept).
   */
  async function rematch(g: ComputerGame, c?: FrameLeave): Promise<unknown> {
    const { recordOf } = await import('../../session/computer');
    const again = recordOf(g.handle);
    const next = newComputerRoom();
    if (again) keepRematch(next, again);
    const to = computerHash(next);
    const deck = again?.human.deckId ? { deck: { id: again.human.deckId, name: again.human.deckName } } : {};
    try {
      await store?.create({ code: next, key: '', kind: 'solo', format: '1v1', decks: 'constructed', opponent: 'sparring', seat: 's0', ...deck });
      await store?.endOlderSolo(3);
    } catch {
      /* History is best effort */
    }
    await leaveTable({ session: g.session, kind: 'computer', code: room, games: store, go: (h) => go(h === '#/' ? to : h), toast: () => undefined, checkpointer: c?.checkpointer ?? null, purgeComputer: computerPurge(g.handle, room, savedIn) });
    return undefined;
  }

  function leave(g: ComputerGame, c?: FrameLeave): Promise<unknown> {
    // A purge disposes Sparring before it deletes, so the handle's last saves never write a row back (M8-P8).
    return leaveTable({ session: g.session, kind: 'computer', code: room, games: store, go, checkpointer: c?.checkpointer ?? null, purgeComputer: computerPurge(g.handle, room, savedIn) });
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
  <TableFrame session={g.session} kind="computer" code={room} games={store} gather={false} {extraShell} deps={ctx ?? undefined} onleave={(c) => leave(g, c)} onrematch={(c) => rematch(g, c)} />
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
    <CoachMark {anchor} title={CUE_COACH_TEXT} placement={coachPlacement(anchor)} ondismiss={dismissCoach} data-testid="coach-sparring" />
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
