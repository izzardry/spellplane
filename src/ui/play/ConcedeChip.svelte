<!--
  The quiet 0-life offer (journey.md 4.13; contracts.md Part G "Computer opponent" item 3): only for this browser's seat
  at 0 life or less (or 10 poison), above the hand: `You are at 0 life.` · CONCEDE · NOT YET. Nobody else is prompted,
  nothing is forced. NOT YET hides it until the life total or the poison count changes. M8-P4.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TableState } from '../../core/types';
  import type { TableSession } from '../../session/types';
  import { concede } from '../../session/result';
  import Button from '../design/Button.svelte';
  import { concedeOffer, lifeOf, poisonOf } from '../lobby/waiting';

  let { session }: { session: TableSession } = $props();
  let st = $state.raw<TableState>(untrack(() => session.getState()));
  onMount(() => session.subscribe((s) => (st = s)));
  // Read again with every state: a claim or a chair move changes the seat (K1, gate M8 round 4).
  const seat = $derived.by(() => {
    void st;
    return session.role === 'spectator' ? null : session.seat;
  });
  const offer = $derived(concedeOffer(st, seat));
  // The team's life and poison in Two-Headed Giant (waiting.ts lifeOf, poisonOf).
  const key = $derived(seat ? `${st.games ?? 0}:${lifeOf(st, seat)}:${poisonOf(st, seat)}` : '');
  let notYet = $state('');
  let failure = $state('');

  function yes(): void {
    failure = '';
    try {
      concede(session);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
</script>

{#if offer && notYet !== key}
  <div class="chip ds-root" role="status" data-testid="concede-chip" data-reason={offer.reason}>
    <span class="text">{offer.text}</span>
    <Button variant="danger" size="xs" data-testid="concede-yes" onclick={yes}>CONCEDE</Button>
    <Button variant="quiet" size="xs" data-testid="concede-not-yet" onclick={() => (notYet = key)}>NOT YET</Button>
    {#if failure}<span class="text" role="alert">{failure}</span>{/if}
  </div>
{/if}

<style>
  .chip {
    position: fixed;
    left: 50%;
    bottom: 200px;
    transform: translateX(-50%);
    z-index: 60;
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-sm);
    height: var(--ds-control-md);
    box-sizing: border-box;
    padding: 0 var(--ds-space-sm) 0 var(--ds-space-lg);
    border-radius: var(--ds-radius-pill);
    background: var(--ds-panel-raised);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-body);
  }
</style>
