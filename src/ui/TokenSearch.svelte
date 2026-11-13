<!--
  Token search (DESIGN "Card manipulation": Ctrl+T searches tokens, the hovered card's related tokens listed first;
  "Card data and images", Tokens).
-->
<script lang="ts">
  import type { CardData, CardDataSource } from '../data/types';
  import EmptyState from './empty/EmptyState.svelte';

  let { cardData, near, onpick, onclose }: { cardData: CardDataSource; near: CardData | null; onpick: (token: CardData) => void; onclose: () => void } = $props();

  let query = $state('');
  let related = $state<CardData[]>([]);
  let results = $state<CardData[]>([]);
  /** The search for the current query: running, done, or failed (Scryfall unreachable; M5-P5 empty and error states). */
  let searching = $state<'idle' | 'running' | 'done' | 'failed'>('idle');
  let input = $state<HTMLInputElement | undefined>();
  let seq = 0;

  $effect(() => {
    input?.focus();
  });
  $effect(() => {
    const c = near;
    related = [];
    if (!c) return;
    let live = true;
    cardData
      .relatedTokens(c)
      .then((r) => {
        if (live) related = r;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });
  // Debounced search; the cleanup cancels a pending search when the query changes or the panel closes.
  $effect(() => {
    const q = query.trim();
    if (!q) {
      results = [];
      searching = 'idle';
      return;
    }
    const my = ++seq;
    searching = 'running';
    const timer = setTimeout(() => {
      cardData
        .searchTokens(q)
        .then((r) => {
          if (my !== seq) return;
          results = r;
          searching = 'done';
        })
        .catch(() => {
          if (my !== seq) return;
          results = [];
          searching = 'failed';
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      seq++;
    };
  });

  const shownRelated = $derived(related.filter((t) => !query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase())));
  const shownResults = $derived(results.filter((t) => !shownRelated.some((r) => r.id === t.id)));
  const all = $derived([...shownRelated, ...shownResults]);
</script>

<section class="dialog" data-testid="token-search" aria-label="Create a token">
  <input
    bind:this={input}
    bind:value={query}
    data-testid="token-query"
    placeholder="Search tokens"
    aria-label="Search tokens"
    onkeydown={(e) => {
      if (e.key === 'Escape') onclose();
      else if (e.key === 'Enter' && all[0]) onpick(all[0]);
    }}
  />
  {#if shownRelated.length}
    <h3>Related to {near?.name}</h3>
    <ul>
      {#each shownRelated as t (t.id)}
        <li><button type="button" data-testid="token-result" data-related="true" onclick={() => onpick(t)}>{t.name} <span class="muted">{t.type_line}{t.power !== undefined ? ` ${t.power}/${t.toughness}` : ''}</span></button></li>
      {/each}
    </ul>
  {/if}
  {#if shownResults.length}
    <h3>Tokens</h3>
    <ul>
      {#each shownResults as t (t.id)}
        <li><button type="button" data-testid="token-result" onclick={() => onpick(t)}>{t.name} <span class="muted">{t.type_line}{t.power !== undefined ? ` ${t.power}/${t.toughness}` : ''}</span></button></li>
      {/each}
    </ul>
  {:else if query.trim() && !shownRelated.length}
    {#if searching === 'failed'}
      <EmptyState id="searchUnreachable" compact />
    {:else if searching === 'done'}
      <EmptyState id="noCardsFound" text="No token matches “{query.trim()}”. Check the spelling, or try part of the name." compact />
    {:else}
      <p class="muted" role="status">Searching…</p>
    {/if}
  {/if}
</section>

<style>
  .dialog {
    position: fixed;
    z-index: 65;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    width: min(380px, 92vw);
    max-height: 60vh;
    overflow-y: auto;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 8px 12px;
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
  }
  h3 {
    margin: 8px 0 2px;
    font-size: inherit;
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    width: 100%;
    text-align: left;
    font: inherit;
    background: none;
    color: inherit;
    border: 0;
    padding: 2px 4px;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  button:hover .muted {
    color: inherit;
  }
</style>
