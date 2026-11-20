<!--
  History: one list, newest first (journey.md 4.14; persistence.md section 3; contracts.md Part G "History and saving"
  item 4): rows with the table thumb, the other players' names, format and own deck, the state line, the time and the
  code in small type; the filter ALL │ UNFINISHED │ FINISHED (ALL hides ended solo games); Remove with an undo toast
  (purged when the toast runs out); the empty line. M8-P2.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Button from '../design/Button.svelte';
  import IconButton from '../design/IconButton.svelte';
  import Segmented from '../design/Segmented.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import TableThumb from '../design/TableThumb.svelte';
  import { toasts } from '../design/toasts';
  import { isEnded } from '../../store/games';
  import type { GameStore, GameSummary } from '../../store/types';
  import { codeText, relTime, rowLine, rowState, rowTitle, shows, type HistoryFilter } from './rows';

  let {
    games,
    limit = undefined,
    onopen,
    filter: showFilter = undefined,
    now = () => Date.now(),
    onchange = undefined,
  }: {
    games: GameStore | null;
    limit?: number | undefined;
    onopen: (g: GameSummary) => void;
    /** Show the filter (default: when the list is not limited). */
    filter?: boolean | undefined;
    now?: () => number;
    /** Called with the number of rows after every load (Home hides its section when 0). */
    onchange?: ((count: number) => void) | undefined;
  } = $props();

  /** The undo window: the kit's undo toast lives 5 s (visual.md 2.8); the records are purged when it ends. */
  const UNDO_MS = 5000;

  let rows: GameSummary[] = $state([]);
  let loaded = $state(false);
  let failed = $state(false);
  let filter: HistoryFilter = $state('all');
  // Not reactive state: timers of removals in their undo window.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let alive = true;

  const shown = $derived(rows.filter((g) => shows(g, limit !== undefined ? 'all' : filter)).slice(0, limit ?? Infinity));
  const withFilter = $derived(showFilter ?? limit === undefined);

  async function load(): Promise<void> {
    if (!games) {
      loaded = true;
      failed = true;
      return;
    }
    try {
      const list = await games.list();
      if (!alive) return;
      rows = list;
      failed = false;
    } catch {
      failed = true;
    }
    loaded = true;
    onchange?.(rows.filter((g) => shows(g, 'all')).length);
  }

  async function remove(g: GameSummary): Promise<void> {
    if (!games) return;
    const store = games;
    await store.remove(g.code, now());
    rows = rows.filter((r) => r.code !== g.code);
    onchange?.(rows.filter((r) => shows(r, 'all')).length);
    const text = isEnded(g) ? 'Game removed' : 'Game removed. Your hand in it goes with it.';
    const timer = setTimeout(() => {
      pending.delete(g.code);
      void store.purge(g.code);
    }, UNDO_MS);
    pending.set(g.code, timer);
    toasts.undo(text, () => {
      const t = pending.get(g.code);
      if (t !== undefined) clearTimeout(t);
      pending.delete(g.code);
      void store.restore(g.code).then(load);
    });
  }

  function seatColour(i: number): string {
    return i % 2 === 0 ? 'var(--ds-seat-a)' : 'var(--ds-seat-b)';
  }

  onMount(() => void load());
  onDestroy(() => {
    alive = false;
    // A removal still in its undo window is purged now: the page that could undo it is gone.
    for (const [code, t] of pending) {
      clearTimeout(t);
      void games?.purge(code);
    }
    pending.clear();
  });
</script>

<div class="history" data-testid="history-list">
  {#if withFilter}
    <div class="history__head">
      <Segmented
        label="Which games"
        size="sm"
        bind:value={filter}
        options={[
          { value: 'all', label: 'ALL' },
          { value: 'unfinished', label: 'UNFINISHED' },
          { value: 'finished', label: 'FINISHED' },
        ]}
        data-testid="history-filter"
      />
    </div>
  {/if}
  {#if loaded && failed}
    <StatusLine tone="danger">Your games could not be loaded.</StatusLine>
    <Button size="sm" onclick={() => void load()}>TRY AGAIN</Button>
  {:else if loaded && shown.length === 0}
    <p class="history__empty" data-testid="history-empty">No games yet. Games you play are kept here, on this device, so you can leave and come back.</p>
  {:else}
    <ul class="history__rows">
      {#each shown as g (g.code)}
        <li class="hrow" data-testid="history-row" data-code={g.code}>
          <button type="button" class="hrow__open" aria-label="Open {rowTitle(g)}" onclick={() => onopen(g)}>
            <TableThumb thumb={g.thumb ?? null} seats={g.players.map((p, i) => ({ colour: seatColour(i), life: p.life, computer: g.opponent === 'sparring' && !p.me }))} width={128} />
            <span class="hrow__text">
              <span class="hrow__title" data-testid="history-title">{rowTitle(g)}</span>
              <span class="hrow__line">{rowLine(g)}</span>
              <span class="hrow__state" data-testid="history-state">{rowState(g)}</span>
            </span>
          </button>
          <span class="hrow__right">
            <span class="hrow__time">{relTime(g.lastPlayedAt, now())}</span>
            <span class="hrow__code">{codeText(g.code)}</span>
            <IconButton label="Remove" size="sm" variant="quiet" onclick={() => void remove(g)} data-testid="history-remove">×</IconButton>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; }
  .history__head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .history__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .history__empty { margin: 0; color: var(--ds-muted); font-size: 13px; }
  .hrow { display: flex; align-items: stretch; gap: 12px; box-sizing: border-box; min-height: 88px; padding: 8px 12px 8px 8px; border-radius: 12px; background: var(--ds-panel-raised); box-shadow: var(--ds-elevation-raised); }
  .hrow__open { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--ds-ink); font: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
  .hrow__open:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
  .hrow__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .hrow__title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hrow__line { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ds-muted); }
  .hrow__state { font-size: 13px; }
  .hrow__right { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 4px; flex: none; }
  .hrow__time { font-size: 11px; color: var(--ds-muted); }
  .hrow__code { font-size: 10px; letter-spacing: 0.08em; color: var(--ds-muted); }
  @media (max-width: 600px) {
    .hrow__open :global(svg) { display: none; }
  }
</style>
