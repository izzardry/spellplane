<!--
  The versus screen (journey.md 4.7) while the automatic setup of a table with `autoSetup` runs: one column per player
  with ticking lines (connected, deck shuffled, cards n / 7), the committed size and never a deck's name, the format
  line, who goes first, at least 1.2 s on screen, and the failure copy of 4.7 after 30 s (BACK TO THE WAITING ROOM is
  not offered: the game has started; LOOK AT THE TABLE and HOME are). The setup itself (session/entry.ts
  startAutoSetup: the deal once per seat and game by the `dealt` mark, the creator's roll) is run by the table frame,
  never here, so one deal runs per browser and a reload deals nothing twice. M8-P4.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Format, SeatId, TableState } from '../../core/types';
  import type { SessionNetStatus, TableSession } from '../../session/types';
  import { paper } from '../../themes/paper/index';
  import Button from '../design/Button.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import { themeContext } from '../settings/theme';
  import { VERSUS_FAIL_MS, VERSUS_HAND, VERSUS_MIN_MS, versusColumns, versusDone, versusFailure } from '../lobby/waiting';

  let {
    session,
    creator: _creator = false,
    label = '',
    ondone = undefined,
    onhome = undefined,
  }: {
    session: TableSession;
    /** This browser created the table (it rolls for the first player; the frame's setup does it). */
    creator?: boolean;
    /** The format line; default from the table (`1V1 · PRIVATE`). */
    label?: string;
    /** Called once every player is connected and dealt and the minimum time has passed. */
    ondone?: (() => void) | undefined;
    onhome?: (() => void) | undefined;
  } = $props();

  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));
  const seatColours = $derived(theme.tokens.colours.seats);

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let net = $state.raw<SessionNetStatus>(untrack(() => session.netStatus()));
  let minPassed = $state(false);
  let failed = $state(false);
  let dismissed = $state(false);
  const me = untrack(() => session.seat);

  const connected = (seat: SeatId): boolean => {
    const peer = st.seats[seat]?.peer;
    if (!peer) return false;
    if (net.mode === 'solo') return true;
    return net.peers.some((p) => p.peerId === peer && p.status === 'connected');
  };
  const columns = $derived(versusColumns(st, me, connected));
  const done = $derived(versusDone(columns));
  const FORMAT_LABEL: Record<Format, string> = { '1v1': '1V1', ffa3: '3 FFA', ffa4: '4 FFA', '2hg': '2V2' };
  const line = $derived(label || `${FORMAT_LABEL[st.format]} · ${st.settings.matched ? 'MATCH' : 'PRIVATE'}`);
  const first = $derived.by(() => {
    if (!done || st.turn.number > 1) return null;
    const active = st.turn.active;
    const seat = st.seats[active] ?? Object.values(st.seats).find((s) => s.team === active);
    if (!seat) return null;
    return seat.id === me ? 'You go first.' : `${seat.name} goes first.`;
  });

  onMount(() => {
    const offState = session.subscribe((s) => (st = s));
    const offNet = session.subscribeNet((n) => (net = n));
    st = session.getState();
    net = session.netStatus();
    const t1 = setTimeout(() => (minPassed = true), VERSUS_MIN_MS);
    const t2 = setTimeout(() => (failed = true), VERSUS_FAIL_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      offState();
      offNet();
    };
  });

  let reported = false;
  $effect(() => {
    if (done && minPassed && !reported) {
      reported = true;
      untrack(() => ondone?.());
    }
  });
</script>

{#if !dismissed}
  <div class="versus ds-root" role="dialog" aria-modal="true" aria-label="Setting up the table" data-testid="versus" data-done={done}>
    <div class="cols">
      {#each columns as c, i (c.seat)}
        <!-- Only between two players: with three or four the row wraps, and a "vs" ended a row (gate M8 finding F10). -->
        {#if i > 0 && columns.length === 2}<span class="vs ds-t-eyebrow" aria-hidden="true">vs</span>{/if}
        <section class="col" data-testid="versus-col" data-seat={c.seat}>
          <h2 class="ds-t-title"><SeatGlyph seat={c.index} colour={seatColours[c.colour]?.colour ?? 'currentColor'} size={28} label="Seat colour of {c.name}" /> {c.name}{c.me ? ' (you)' : ''}</h2>
          <p class="ds-t-eyebrow">DECK · {c.cards || '…'}</p>
          <ul>
            <li data-testid="versus-connected" data-on={c.connected}><span aria-hidden="true">{c.connected ? '✓' : '◌'}</span> connected</li>
            <li data-testid="versus-shuffled" data-on={c.shuffled}><span aria-hidden="true">{c.shuffled ? '✓' : '◌'}</span> deck shuffled</li>
            <li data-testid="versus-cards" data-on={c.dealt}><span aria-hidden="true">{c.dealt ? '✓' : '◌'}</span> cards {Math.min(c.hand, VERSUS_HAND)} / {VERSUS_HAND}</li>
          </ul>
        </section>
      {/each}
    </div>
    <p class="ds-t-eyebrow">{line}</p>
    {#if first}<p class="first" data-testid="versus-first">{first}</p>{/if}
    {#if failed && !done}
      <p class="ds-status ds-status--danger" role="alert" data-testid="versus-failure">{versusFailure(columns)}</p>
      <div class="actions">
        <Button variant="ghost" size="sm" data-testid="versus-look" onclick={() => (dismissed = true)}>LOOK AT THE TABLE</Button>
        <Button size="sm" data-testid="versus-home" onclick={() => (onhome ? onhome() : (location.hash = '#/'))}>HOME</Button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .versus {
    position: fixed;
    inset: 0;
    z-index: 85;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--ds-space-xl);
    padding: var(--ds-space-lg);
    background: var(--ds-mat);
    color: var(--ds-ink);
    font-family: var(--ds-font-body);
  }
  .cols {
    display: flex;
    align-items: center;
    gap: var(--ds-space-xxl);
    flex-wrap: wrap;
    justify-content: center;
  }
  .col {
    min-width: 200px;
    display: grid;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-sheet);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-sheet);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--ds-space-xs);
    font-size: var(--ds-type-body);
  }
  li[data-on='false'] {
    color: var(--ds-muted);
  }
  .first {
    margin: 0;
    font-size: var(--ds-type-title);
  }
  .actions {
    display: flex;
    gap: var(--ds-space-sm);
  }
</style>
