<!--
  The deck page's sample hand (decks.md D5 "Sample hand"; visual.md board 3's SAMPLE HAND): seven whole cards from the
  shuffled main deck over a flat scrim, the line `7 CARDS · 3 LANDS`, and three pills in one row: MULLIGAN (one card
  fewer, down to 4), DRAW (the next card) and NEW HAND, the one filled button, last. Randomness is `Math.random` in the
  UI; nothing is stored. Escape, the close button or a press on the scrim close it. Added by M8-R3.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardRef } from '../../../core/types';
  import { isLandCard } from '../../../data/deck/analyse';
  import type { CardData, FaceSource } from '../../../data/types';
  import Button from '../../design/Button.svelte';
  import IconButton from '../../design/IconButton.svelte';
  import CardImage from './CardImage.svelte';

  let {
    main,
    faces,
    lookup,
    onclose,
  }: {
    main: readonly CardRef[];
    faces: FaceSource;
    lookup: (r: CardRef) => CardData | null;
    onclose: () => void;
  } = $props();

  const HAND = 7;
  const FLOOR = 4;
  let order = $state.raw<CardRef[]>([]);
  let size = $state(HAND);
  let shown = $state(HAND);

  function shuffled(): CardRef[] {
    const a = [...main];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  function deal(n: number): void {
    order = shuffled();
    size = n;
    shown = Math.min(n, order.length);
  }
  const hand = $derived(order.slice(0, shown));
  const lands = $derived(hand.filter((r) => {
    const c = lookup(r);
    return c ? isLandCard(c) : false;
  }).length);

  onMount(() => {
    deal(HAND);
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      }
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  });
</script>

<div class="scrim" role="presentation" data-testid="sample-hand-layer" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="ds-sheet sheet" role="dialog" aria-modal="true" aria-labelledby="sample-hand-title" data-testid="sample-hand">
    <div class="head">
      <h2 id="sample-hand-title" class="ds-t-title">Sample hand</h2>
      <IconButton size="sm" variant="quiet" icon="close" label="Close the sample hand" data-testid="sample-close" onclick={onclose} />
    </div>
    <ul class="cards" aria-label="The hand">
      {#each hand as r, i (i)}
        <li class="card" data-testid="sample-card" data-sid={r.sid}><CardImage {faces} cardRef={r} alt={lookup(r)?.name ?? 'Card'} lazy={false} /></li>
      {/each}
    </ul>
    <div class="foot">
      <span class="ds-t-eyebrow" data-testid="sample-line">{shown} {shown === 1 ? 'card' : 'cards'} · {lands} {lands === 1 ? 'land' : 'lands'}</span>
      <span class="grow"></span>
      <Button variant="ghost" size="sm" data-testid="sample-mulligan" disabled={size <= FLOOR} onclick={() => deal(Math.max(FLOOR, size - 1))}>Mulligan</Button>
      <Button variant="ghost" size="sm" data-testid="sample-draw" disabled={shown >= order.length} onclick={() => (shown = Math.min(order.length, shown + 1))}>Draw</Button>
      <Button variant="primary" size="sm" data-testid="sample-new" data-autofocus onclick={() => deal(HAND)}>New hand</Button>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: var(--ds-space-lg);
    background: var(--ds-overlay);
  }
  .sheet {
    width: min(1040px, 100%);
    max-height: calc(100vh - 2 * var(--ds-space-lg));
    overflow-y: auto;
    box-shadow: var(--ds-elevation-dialog, var(--ds-elevation-pop));
  }
  .head,
  .foot {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
  }
  .head {
    justify-content: space-between;
  }
  .head h2 {
    margin: 0;
  }
  .grow {
    flex: 1;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: var(--ds-space-md);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    min-width: 0;
  }
</style>
