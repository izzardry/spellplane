<!--
  The players' side of spectating (PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: "A spectator joins by
  the same link without taking a chair … A player may reveal their hand to a named spectator"). Lists who is watching
  and offers each seated player "Show my hand" per spectator: one `revealTo` per hand card naming that spectator only
  (ui/lobby/spectate.ts revealHandDrafts), whose identities go to that spectator's page only. In the lobby (`inline`)
  it also shows the spectator link; at the table it floats in the bottom-right corner, below the log, and stays
  out of the way while nobody watches.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TableState } from '../../core/types';
  import type { SessionNetStatus, TableSession } from '../../session/types';
  import type { RoomLink } from '../types';
  import { handOf, revealHandDrafts, watchers, watchUrl } from './spectate';

  let { session, link = null, inline = false }: { session: TableSession; link?: RoomLink | null; inline?: boolean } = $props();

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let net = $state.raw<SessionNetStatus>(untrack(() => session.netStatus()));
  let shown = $state<Record<string, number>>({});
  let open = $state(false);
  let copied = $state(false);

  onMount(() => {
    const a = session.subscribe((s) => (st = s));
    const b = session.subscribeNet((n) => (net = n));
    st = session.getState();
    net = session.netStatus();
    return () => {
      a();
      b();
    };
  });

  const list = $derived(watchers(net.peers));
  const seated = $derived(session.role !== 'spectator' && Object.hasOwn(st.seats, session.seat) && st.seats[session.seat]?.peer !== undefined);
  const handSize = $derived(seated ? handOf(st, session.seat).length : 0);
  const watch = $derived(link ? watchUrl(link) : '');

  let groupCount = 0;
  function showHand(spectator: string) {
    const drafts = revealHandDrafts(session.getState(), session.seat, spectator, `g-show-${spectator}-${Date.now().toString(36)}-${++groupCount}`);
    for (const d of drafts) session.dispatch(d);
    shown = { ...shown, [spectator]: drafts.length };
  }

  async function copyWatch() {
    try {
      await navigator.clipboard.writeText(watch);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

{#if inline}
  <section class="block inline" aria-label="Spectators" data-testid="spectator-panel">
    <label for="watch-link">Spectators join with this link, without taking a chair. They see the public table only and can chat and ping.</label>
    {#if watch}
      <div class="row">
        <input id="watch-link" data-testid="watch-link" readonly value={watch} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <button type="button" onclick={copyWatch}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    {/if}
    <p class="who" data-testid="spectator-count">
      {#if list.length === 0}Nobody is watching.{:else}Watching: {#each list as s, i (s.id)}<span data-testid="spectator-name" data-spectator={s.id}>{s.nickname || 'Spectator'}</span>{i < list.length - 1 ? ', ' : ''}{/each}{/if}
    </p>
  </section>
{:else if list.length > 0}
  <aside class="float" aria-label="Spectators" data-testid="spectator-panel">
    <button type="button" class="toggle" aria-expanded={open} data-testid="spectator-toggle" onclick={() => (open = !open)}>
      {list.length} watching
    </button>
    {#if open}
      <ul>
        {#each list as s (s.id)}
          <li data-testid="spectator-row" data-spectator={s.id}>
            <span class="name">{s.nickname || 'Spectator'}</span>
            {#if seated}
              <button type="button" data-testid="show-hand" disabled={handSize === 0} title={handSize === 0 ? 'Your hand is empty' : `Show the ${handSize} cards in your hand to ${s.nickname || 'this spectator'} only`} onclick={() => showHand(s.id)}>Show my hand</button>
              {#if shown[s.id] !== undefined}<span class="done" data-testid="shown-count">shown {shown[s.id]}</span>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .inline {
    display: grid;
    gap: 8px;
  }
  .block {
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row input {
    flex: 1;
    min-width: 0;
    font-family: var(--sp-font-mono);
  }
  .who {
    margin: 0;
    color: var(--sp-muted, #555);
  }
  .float {
    position: absolute;
    z-index: 21;
    right: 12px;
    bottom: 12px;
    max-width: min(320px, calc(50vw - 24px));
    font-family: var(--sp-font);
    font-size: 13px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #222);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 4px 8px;
  }
  .toggle {
    font: inherit;
  }
  ul {
    list-style: none;
    margin: 6px 0 2px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done {
    color: var(--sp-muted, #555);
  }
</style>
