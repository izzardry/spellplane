<!--
  Gathering (journey.md 4.12; persistence.md section 5; contracts.md Part G "Rejoin"). Wraps the table: while this
  browser is on standby the saved table is drawn under the flat `overlay` scrim (never blurred: card faces are on it)
  with the Gathering card over it, and the frame's `readOnly` is set; when the muster rule holds, the scrim fades and
  the table is live. Implementer: M8-P5.

  The card: the title (`Waiting for Ben`, or `Getting everyone back` with more), one row per seat (`Here`,
  `Connecting…`, `Not here` with `BRING BACK`, `Left before you` with the same pill), the newest-copy line (or one
  failure line), `LOOK AT THE TABLE`, `PLAY ON WITHOUT BEN` after 8 seconds of waiting (with the line under it),
  `PLAY ON WITH THIS TABLE` when only a remembered newer head holds the table, and `HOME`. No filled button: every
  choice here is a ghost.
-->
<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { MusterStatus, SessionMuster } from '../../session/types';
  import { joinNames, PLAY_ON_LINE, rowWord, titleOf } from './model';

  let {
    muster,
    table,
    code = null,
    failure = null,
    onhome,
    onbringback,
    onreadonly,
    children,
  }: {
    muster: SessionMuster;
    /** The table as this browser holds it (for the names, the turn and the format). */
    table: TableState;
    /** The game code, shown small (`AMBER FOX 93`). */
    code?: string | null;
    /** One failure line replacing the newest-copy line (`No connection. Trying again in 8 s.`, the version notice). */
    failure?: string | null;
    onhome: () => void;
    onbringback?: (seat: SeatId) => void;
    /** Called with true while the table must not take actions (standby), false once live. */
    onreadonly?: (readOnly: boolean) => void;
    children?: Snippet;
  } = $props();

  /** How long the gathered player waits before `PLAY ON WITHOUT …` is offered (journey.md 4.12). */
  const PLAY_ON_AFTER_MS = 8000;

  let status = $state.raw<MusterStatus>(untrack(() => muster.muster()));
  let looking = $state(false);
  let waitedLong = $state(false);
  let busy = $state(false);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  const off = untrack(() => muster.subscribe((m) => (status = m)));

  $effect(() => {
    const standby = !status.live;
    untrack(() => onreadonly?.(standby));
    if (standby && timer === null && !waitedLong) timer = setTimeout(() => (waitedLong = true), PLAY_ON_AFTER_MS);
    if (!standby) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      waitedLong = false;
      looking = false;
    }
  });

  onDestroy(() => {
    off();
    if (timer !== null) clearTimeout(timer);
  });

  const names = (ids: readonly SeatId[]): string => joinNames(ids.map((id) => table.seats[id]?.name || id));
  // The seats PLAY ON WITHOUT names: those waited for that the table does not already mark away.
  const missing = $derived(status.waitingFor.filter((id) => table.seats[id]?.away !== true));
  const meta = $derived([table.format.toUpperCase(), `TURN ${table.turn.number}`, ...(code ? [code.replace(/-/g, ' ').toUpperCase()] : [])].join(' · '));
  const newest = $derived.by(() => {
    const k = status.knownHead;
    if (k !== null) {
      const who = (k.seat !== null ? table.seats[k.seat]?.name : null) || 'Another player';
      return `${who} has a newer table. Waiting for ${who}.`;
    }
    return `Newest table: yours · turn ${table.turn.number}`;
  });

  async function playOn(seats: SeatId[]): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await muster.playOn(seats);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="gathering" data-testid="gathering" data-live={status.live ? 'true' : 'false'}>
  <div class="table" inert={!status.live}>
    {@render children?.()}
  </div>
  {#if !status.live}
    <div class="scrim" class:light={looking} aria-hidden="true"></div>
    {#if looking}
      <div class="banner" role="status" data-testid="gathering-banner">
        <span class="t">{missing.length ? `Waiting for ${names(missing)}` : 'Waiting for the others'}</span>
        {#if missing.length && onbringback}
          <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" onclick={() => onbringback?.(missing[0]!)}>Bring back</button>
        {/if}
        {#if waitedLong && missing.length}
          <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" disabled={busy} onclick={() => playOn(missing)}>Play on without {names(missing)}</button>
        {/if}
        <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" data-testid="gathering-back-to-card" onclick={() => (looking = false)}>Back</button>
      </div>
    {:else}
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="gathering-title" data-testid="gathering-card">
        <p class="eyebrow" id="gathering-title" data-testid="gathering-title">{titleOf(status, table)}</p>
        <p class="meta">{meta}</p>
        <ul class="rows">
          {#each status.seats as row (row.seat)}
            <li class="row" data-testid="gathering-row" data-seat={row.seat} data-state={row.state}>
              <span class="name">{row.name || row.seat}{row.me ? ' (you)' : ''}</span>
              <span class="state">
                <span class="dot {row.state}" aria-hidden="true"></span>
                {rowWord(row.state)}
              </span>
              {#if (row.state === 'away' || row.state === 'leftBefore') && onbringback}
                <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="gathering-bring" onclick={() => onbringback?.(row.seat)}>BRING BACK</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if failure}
          <p class="line danger" role="alert" data-testid="gathering-failure">{failure}</p>
        {:else}
          <p class="line" data-testid="gathering-newest">{newest}</p>
        {/if}
        {#if error}<p class="line danger" role="alert">{error}</p>{/if}
        <div class="actions">
          <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="gathering-look" onclick={() => (looking = true)}>LOOK AT THE TABLE</button>
          {#if status.playOnHere}
            <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="gathering-play-here" disabled={busy} onclick={() => playOn([])}>PLAY ON WITH THIS TABLE</button>
          {/if}
          {#if waitedLong && missing.length > 0}
            <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="gathering-play-on" disabled={busy} onclick={() => playOn(missing)}>PLAY ON WITHOUT {names(missing).toUpperCase()}</button>
          {/if}
          <button type="button" class="ds-btn ds-btn--ghost ds-btn--md" data-testid="gathering-home" onclick={() => onhome()}>HOME</button>
        </div>
        {#if waitedLong && (missing.length > 0 || status.playOnHere)}
          <p class="meta" data-testid="gathering-play-on-line">{PLAY_ON_LINE}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .gathering {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .table {
    position: absolute;
    inset: 0;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--ds-overlay);
    opacity: 1;
    transition: opacity var(--ds-duration-base) var(--ds-ease-standard);
    pointer-events: none;
  }
  .scrim.light {
    opacity: 0.4;
  }
  .card {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-md);
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-md);
    background: var(--ds-panel);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
  }
  .eyebrow {
    margin: 0;
    font: var(--ds-type-title);
    letter-spacing: var(--ds-label-spacing);
    text-transform: uppercase;
  }
  .meta {
    margin: 0;
    font: var(--ds-type-small);
    color: var(--ds-muted);
    letter-spacing: var(--ds-label-spacing);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    min-height: 36px;
  }
  .name {
    flex: 1;
    font: var(--ds-type-body);
    font-weight: var(--ds-weight-bold);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-xs);
    font: var(--ds-type-small);
    color: var(--ds-muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.here {
    background: var(--ds-ink);
  }
  .dot.connecting {
    box-shadow: inset 0 0 0 1.5px var(--ds-ink);
    animation: pulse 1.2s var(--ds-ease-standard) infinite;
  }
  .dot.away,
  .dot.leftBefore {
    box-shadow: inset 0 0 0 1.5px var(--ds-muted);
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .line {
    margin: 0;
    font: var(--ds-type-small);
    color: var(--ds-muted);
  }
  .danger {
    color: var(--ds-danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-sm);
  }
  .banner {
    position: absolute;
    left: 50%;
    top: var(--ds-space-lg);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xs) var(--ds-space-md);
    border-radius: var(--ds-radius-pill);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-pop);
    font: var(--ds-type-small);
    color: var(--ds-ink);
    max-width: calc(100% - 32px);
    flex-wrap: wrap;
  }
</style>
