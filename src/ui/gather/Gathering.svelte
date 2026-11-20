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
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import { scrubbedHash } from '../../session/invite';
  import type { ClaimView, MusterStatus, SessionMuster } from '../../session/types';
  import TeamPrompt from '../seat/TeamPrompt.svelte';
  import { notices } from '../table/notices';
  import BringBack from './BringBack.svelte';
  import ClaimPage from './ClaimPage.svelte';
  import { setActiveMuster } from './active';
  import { claimScreenOf, joinNames, PLAY_ON_LINE, rowWord, titleOf } from './model';

  let {
    muster,
    table,
    code = null,
    failure = null,
    onhome,
    onbringback = undefined,
    onreadonly = undefined,
    onwatch = undefined,
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
    /** Bring a seat back; by default the card makes the link itself and shows it in the invite sheet. */
    onbringback?: ((seat: SeatId) => void) | undefined;
    /** Called with true while the table must not take actions (standby, or a claim page shown), false once live. */
    onreadonly?: ((readOnly: boolean) => void) | undefined;
    /** `WATCH` on a refusal screen; by default the game's watch link. */
    onwatch?: (() => void) | undefined;
    children?: Snippet;
  } = $props();

  /** How long the gathered player waits before `PLAY ON WITHOUT …` is offered (journey.md 4.12). */
  const PLAY_ON_AFTER_MS = 8000;

  let status = $state.raw<MusterStatus>(untrack(() => muster.muster()));
  let claim = $state.raw<ClaimView | null>(untrack(() => muster.claim?.() ?? null));
  let claimPhase = $state<'ready' | 'sitting'>('ready');
  let claimError = $state<string | null>(null);
  let looking = $state(false);
  let waitedLong = $state(false);
  let busy = $state(false);
  let error = $state('');
  let bringing = $state<SeatId | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const off = untrack(() =>
    muster.subscribe((m) => {
      status = m;
      claim = muster.claim?.() ?? null;
    }),
  );
  const offNotice = untrack(() => muster.onNotice?.((text) => notices.show(text)) ?? (() => undefined));
  const offActive = untrack(() => setActiveMuster(muster));

  // A new table state (a sync, a claim sequenced) may change what the claim page says.
  $effect(() => {
    void table;
    untrack(() => (claim = muster.claim?.() ?? null));
  });

  onMount(() => {
    // The token leaves the address bar once the session read it (persistence.md section 7): no history entry, no
    // hashchange, nothing left in screenshots.
    const clean = scrubbedHash(location.hash);
    if (clean !== null) history.replaceState(history.state, '', `${location.pathname}${location.search}${clean}`);
  });

  const claiming = $derived(claim !== null || claimError !== null);

  $effect(() => {
    const standby = !status.live || claiming;
    untrack(() => onreadonly?.(standby));
    if (!status.live && timer === null && !waitedLong) timer = setTimeout(() => (waitedLong = true), PLAY_ON_AFTER_MS);
    if (status.live) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      waitedLong = false;
      looking = false;
    }
  });

  onDestroy(() => {
    off();
    offNotice();
    offActive();
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
  const screen = $derived(claim !== null && claim.refusal !== null ? claimScreenOf(claim.refusal, claim.name) : claimError !== null ? claimScreenOf(claimError, claim?.name ?? '') : null);

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

  function bringBack(seat: SeatId): void {
    if (onbringback) onbringback(seat);
    else bringing = seat;
  }

  async function sit(name: string): Promise<void> {
    if (!muster.sitDown || claimPhase === 'sitting') return;
    claimPhase = 'sitting';
    claimError = null;
    try {
      await muster.sitDown(name);
      claim = muster.claim?.() ?? null;
    } catch (e) {
      claimError = e instanceof Error ? e.message : String(e);
    } finally {
      claimPhase = 'ready';
    }
  }

  function notNow(): void {
    muster.dismissClaim?.();
    onhome();
  }

  function openMine(): void {
    muster.dismissClaim?.();
    claim = null;
    claimError = null;
  }

  function watch(): void {
    if (onwatch) return onwatch();
    const m = /^#\/t\/([^/]+)\/([^/]+)/.exec(location.hash);
    muster.dismissClaim?.();
    if (m) location.hash = `#/t/${m[1]}/${m[2]}/watch`;
  }

  const team = $derived(muster.team?.() ?? null);
</script>

<div class="gathering" data-testid="gathering" data-live={status.live ? 'true' : 'false'}>
  <div class="table" inert={!status.live || claiming}>
    {@render children?.()}
  </div>
  {#if claiming}
    <div class="scrim" aria-hidden="true"></div>
    <div class="over">
      {#if screen}
        <ClaimPage phase="refused" seatName={claim?.name ?? ''} refusal={screen} onsit={() => undefined} onnotnow={notNow} onwatch={watch} onopenmine={openMine} />
      {:else if claim}
        <ClaimPage phase={claimPhase} seatName={claim.name} onsit={(n) => void sit(n)} onnotnow={notNow} />
      {/if}
    </div>
  {:else if !status.live}
    <div class="scrim" class:light={looking} aria-hidden="true"></div>
    {#if looking}
      <div class="banner" role="status" data-testid="gathering-banner">
        <span class="t">{missing.length ? `Waiting for ${names(missing)}` : 'Waiting for the others'}</span>
        {#if missing.length}
          <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" onclick={() => bringBack(missing[0]!)}>Bring back</button>
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
              {#if (row.state === 'away' || row.state === 'leftBefore') && table.settings.matched !== true}
                <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="gathering-bring" onclick={() => bringBack(row.seat)}>BRING BACK</button>
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
        {#if (waitedLong && missing.length > 0) || status.playOnHere}
          <p class="meta" data-testid="gathering-play-on-line">{PLAY_ON_LINE}</p>
        {/if}
      </div>
    {/if}
  {/if}
  {#if bringing !== null}
    <div class="over sheet-layer">
      <BringBack {muster} {table} seat={bringing} onclose={() => (bringing = null)} />
    </div>
  {/if}
  {#if team && !claiming}
    <div class="team"><TeamPrompt {team} /></div>
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
  @media (prefers-reduced-motion: reduce) {
    .dot.connecting {
      animation: none;
      opacity: 0.6;
    }
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
  .over {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: auto;
    pointer-events: none;
  }
  .over > :global(*) {
    pointer-events: auto;
  }
  .sheet-layer {
    z-index: 2;
  }
  .team {
    position: absolute;
    right: var(--ds-space-lg);
    bottom: var(--ds-space-lg);
    z-index: 3;
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
