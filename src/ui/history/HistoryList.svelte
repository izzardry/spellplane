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
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import TableThumb from '../design/TableThumb.svelte';
  import { toasts } from '../design/toasts';
  import { themeContext } from '../settings/theme';
  import { isEnded } from '../../store/games';
  import type { GameStore, GameSummary } from '../../store/types';
  import { summaryHash } from '../play/launch';
  import { codeText, relTime, rowAction, rowLine, rowState, rowTitle, shows, type HistoryFilter } from './rows';

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

  let rows: GameSummary[] = $state([]);
  let loaded = $state(false);
  let failed = $state(false);
  let filter: HistoryFilter = $state('all');
  let alive = true;
  // The seat colours of the viewer's theme (App.svelte's context); the kit's accent and ink without one (a harness).
  const theme = themeContext();

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

  /**
   * Remove with an undo toast (persistence.md section 3): the row is soft-deleted at once and purged when the toast
   * runs out unanswered (the toast store's own timer, so leaving the page does not cut the undo short); a page closed
   * in the window leaves a soft-deleted row that the next start purges (GameStore `purgeRemoved`).
   */
  async function remove(g: GameSummary): Promise<void> {
    if (!games) return;
    const store = games;
    await store.remove(g.code, now());
    rows = rows.filter((r) => r.code !== g.code);
    onchange?.(rows.filter((r) => shows(r, 'all')).length);
    const text = isEnded(g) ? 'Game removed' : 'Game removed. Your hand in it goes with it.';
    toasts.undo(
      text,
      () => {
        void store.restore(g.code).then(() => (alive ? load() : undefined));
      },
      { commit: () => void store.purge(g.code).catch(() => undefined) },
    );
  }

  function seatColour(colour: number, i: number): string {
    const seats = theme?.current().tokens.colours.seats;
    return seats?.[colour]?.colour ?? (i === 0 ? 'var(--ds-accent)' : 'var(--ds-ink)');
  }

  // The protection line under the full list (persistence.md section 3): whether the browser may delete saved games.
  let persisted = $state<boolean | null>(null);
  const safari = typeof navigator !== 'undefined' && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent);
  const homeScreen = typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
  async function protect(): Promise<void> {
    persisted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
  }

  onMount(() => {
    void load();
    if (limit === undefined) void navigator.storage?.persisted?.().then((p) => (persisted = p), () => undefined);
  });
  onDestroy(() => {
    alive = false;
  });
</script>

<div class="history" data-testid="history-list" data-loaded={loaded}>
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
  {#if loaded && (failed || shown.length === 0) && limit !== undefined}
    <!-- Home's recent games (journey.md 4.14): "On Home's fold the section is simply absent." -->
  {:else if loaded && failed}
    <StatusLine tone="danger">Your games could not be loaded.</StatusLine>
    <Button size="sm" onclick={() => void load()}>TRY AGAIN</Button>
  {:else if loaded && shown.length === 0}
    <p class="history__empty" data-testid="history-empty">No games yet. Games you play are kept here, on this device, so you can leave and come back.</p>
  {:else}
    <ul class="history__rows">
      {#each shown as g (g.code)}
        <li class="hrow" data-testid="history-row" data-code={g.code}>
          <a
            class="hrow__open"
            href={summaryHash(g)}
            aria-label="Open {rowTitle(g)}"
            onclick={(e) => {
              e.preventDefault();
              onopen(g);
            }}
          >
            <TableThumb thumb={g.thumb ?? null} seats={g.players.map((p, i) => ({ colour: seatColour(p.colour, i), life: p.life, computer: g.opponent === 'sparring' && !p.me, me: p.me, away: p.away }))} width={128} />
            <span class="hrow__text">
              <span class="hrow__head">
                <span class="hrow__title" data-testid="history-title">{rowTitle(g)}</span>
                <!-- Seat colours are never shown alone: each disc of the thumb has its glyph here (DESIGN accessibility). -->
                <span class="hrow__glyphs">{#each g.players as p, i (p.seat)}<SeatGlyph seat={i % 4} colour={seatColour(p.colour, i)} size={12} computer={g.opponent === 'sparring' && !p.me} label={p.me ? 'you' : p.name} />{/each}</span>
              </span>
              <span class="hrow__line">{rowLine(g)}</span>
              <span class="hrow__state" data-testid="history-state">{rowState(g)}</span>
            </span>
          </a>
          <span class="hrow__right">
            <span class="hrow__top">
              <span class="hrow__time">{relTime(g.lastPlayedAt, now())}</span>
              <span class="hrow__code">{codeText(g.code)}</span>
            </span>
            <!-- O-4, O-5: the row's one action bottom right; Remove first in the row and behind a divider, never next to it. -->
            <span class="hrow__actions">
              <IconButton label="Remove" size="sm" variant="quiet" icon="trash" onclick={() => void remove(g)} data-testid="history-remove" />
              <span class="hrow__divider" aria-hidden="true"></span>
              <Button size="sm" aria-label="{rowAction(g)} {rowTitle(g)}" onclick={() => onopen(g)} data-testid="history-action">{rowAction(g)}</Button>
            </span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if limit === undefined && persisted !== null}
    <p class="history__protect" data-testid="history-protection">
      {#if persisted}
        Saved games are protected in this browser.
      {:else if safari && !homeScreen}
        Safari deletes saved games after seven days without a visit. Add Spellplane to the Home Screen, or export a backup.
        <Button size="xs" variant="quiet" href="#/settings">HOW</Button>
      {:else}
        This browser may delete saved games when space is short.
        <Button size="xs" variant="quiet" onclick={() => void protect()} data-testid="history-protect">PROTECT</Button>
      {/if}
    </p>
  {/if}
</div>

<style>
  .history { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; }
  .history__head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .history__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .history__protect { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; font-size: 12px; color: var(--ds-muted); }
  .history__empty { margin: 0; color: var(--ds-muted); font-size: 13px; }
  .hrow { display: flex; align-items: stretch; gap: 12px; box-sizing: border-box; min-height: 88px; padding: 8px 12px 8px 8px; border-radius: 12px; background: var(--ds-panel-raised); box-shadow: var(--ds-elevation-raised); }
  .hrow__open { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--ds-ink); font: inherit; text-align: left; text-decoration: none; cursor: pointer; border-radius: 8px; }
  .hrow__open:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
  .hrow__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .hrow__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .hrow__glyphs { display: inline-flex; gap: 2px; flex: none; }
  .hrow__title { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hrow__line { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ds-muted); }
  .hrow__state { font-size: 13px; }
  .hrow__right { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 4px; flex: none; }
  .hrow__top { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .hrow__actions { display: flex; align-items: center; gap: 8px; }
  .hrow__divider { width: 1px; height: 24px; background: var(--ds-border); }
  .hrow__time { font-size: 11px; color: var(--ds-muted); }
  .hrow__code { font-size: 10px; letter-spacing: 0.08em; color: var(--ds-muted); }
  @media (max-width: 600px) {
    .hrow__open :global(svg) { display: none; }
  }
</style>
