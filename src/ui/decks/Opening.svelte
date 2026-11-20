<!--
  D4, opening a booster deck's packs (decks.md section 3 "D4 Opening", with the ruling "a simple reveal instead of the
  full opening animation"): the pool was saved before this page shows anything; each pack is shown face up, one at a
  time (only the current pack's cards are in the DOM), `seal.revealed` is saved after each, so a reload resumes at the
  first unopened pack. NEXT PACK, then BUILD DECK; OPEN ALL goes straight to the deck page, where the suggestion is
  applied as its first edit (contracts.md Part G "Decks" item 1). Implementer: M8-P3.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardRef, SetCode } from '../../core/types';
  import type { SetData } from '../../data/types';
  import { packsOfSeal } from '../../draft/solo-sealed';
  import type { DeckRecord } from '../../store/types';
  import Button from '../design/Button.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import type { DecksEnv } from './env';
  import CardImage from './parts/CardImage.svelte';
  import { markSuggest, saveRevealed } from './state/open';

  let { env, id }: { env: DecksEnv; id: string } = $props();

  let deck = $state.raw<DeckRecord | null>(null);
  let packs = $state.raw<CardRef[][]>([]);
  let shown = $state(0);
  let gone = $state(false);
  let busy = $state(false);

  async function load(): Promise<void> {
    const d = await env.decks.get(id).catch(() => null);
    if (!d || !d.seal) {
      gone = true;
      return;
    }
    const total = d.seal.sets.length;
    if (d.seal.revealed >= total) {
      env.go(`#/decks/${encodeURIComponent(d.id)}`);
      return;
    }
    const data = new Map<SetCode, SetData>();
    for (const code of new Set(d.seal.sets)) {
      const s = env.sets.peek(code) ?? (await env.sets.get(code).catch(() => null));
      if (s) data.set(code, s);
    }
    const generated = packsOfSeal(d.seal, data);
    if (generated && generated.length === total) {
      packs = generated.map((p) => p.cards.map((c) => (c.ref.foil ? { sid: c.ref.sid, foil: true as const } : { sid: c.ref.sid })));
    } else {
      // Without the set data the pool is split evenly, in pack order.
      const per = Math.ceil(d.seal.pool.length / total);
      packs = Array.from({ length: total }, (_, i) => d.seal!.pool.slice(i * per, (i + 1) * per));
    }
    void env.cardData.getMany([...new Set(d.seal.pool.map((r) => r.sid))]).catch(() => ({}));
    deck = d;
    shown = d.seal.revealed;
    // Showing a pack counts it as revealed.
    deck = await saveRevealed(env.decks, d, shown + 1, env.now());
  }

  async function next(): Promise<void> {
    if (!deck?.seal || busy) return;
    busy = true;
    try {
      const total = deck.seal.sets.length;
      if (shown + 1 >= total) return await build();
      shown++;
      deck = await saveRevealed(env.decks, deck, shown + 1, env.now());
    } finally {
      busy = false;
    }
  }
  async function build(): Promise<void> {
    if (!deck?.seal) return;
    deck = await saveRevealed(env.decks, deck, deck.seal.sets.length, env.now());
    markSuggest(deck.id);
    env.go(`#/decks/${encodeURIComponent(deck.id)}`);
  }

  const total = $derived(deck?.seal?.sets.length ?? 0);
  const current = $derived(packs[shown] ?? []);
  const seen = $derived(packs.slice(0, shown + 1).reduce((s, p) => s + p.length, 0));
  const rares = $derived.by(() => {
    let n = 0;
    for (const p of packs.slice(0, shown + 1)) for (const r of p) if (/^(rare|mythic)$/.test(env.cardData.peek(r.sid)?.rarity ?? '')) n++;
    return n;
  });

  onMount(() => {
    void load();
  });
</script>

<div class="opening" data-testid="opening">
  {#if gone}
    <p class="ds-t-reading">This deck is gone.</p>
    <Button onclick={() => env.go('#/decks')}>Back to decks</Button>
  {:else if deck}
    <header class="top">
      <span class="ds-t-eyebrow" data-testid="opening-pack">Pack {shown + 1} of {total}</span>
      <span class="ds-t-title">{deck.name}</span>
      <span class="grow"></span>
      <Button variant="ghost" data-testid="open-all" onclick={() => void build()}>Open all</Button>
      <Button variant="primary" data-testid="open-next" disabled={busy} onclick={() => void next()}>{shown + 1 >= total ? 'Build deck' : 'Next pack'}</Button>
    </header>
    <div class="grid" data-testid="opening-grid">
      {#each current as r, i (`${shown}:${i}`)}
        <span class="cell" data-testid="opening-card"><CardImage faces={env.faces} cardRef={r} alt={env.cardData.peek(r.sid)?.name ?? 'Card'} lazy={false} /></span>
      {/each}
    </div>
    <StatusLine data-testid="opening-totals">Pack {shown + 1} of {total} · {seen} cards · {rares} {rares === 1 ? 'rare' : 'rares'}</StatusLine>
  {/if}
</div>

<style>
  .opening {
    box-sizing: border-box;
    min-height: 100vh;
    padding: var(--ds-space-xl) var(--ds-space-xxl);
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-lg);
    background: var(--ds-panel);
    color: var(--ds-ink);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    min-height: 44px;
  }
  .grow {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 160px));
    gap: var(--ds-space-lg);
    justify-content: center;
  }
  .cell {
    display: block;
    animation: rise var(--ds-duration-base) var(--ds-ease-enter) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cell {
      animation: none;
    }
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .opening {
      padding: var(--ds-space-md);
    }
  }
</style>
