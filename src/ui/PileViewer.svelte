<!--
  Pile viewer (DESIGN "Table model": graveyard opens as an ordered fan, exile beside it, library shows a count only;
  "Card manipulation", Library actions: draw, draw N, shuffle, look at top N, search with shuffle on close, mulligan).
  Also reveal top and mill N. Cards in the viewer take hover keys, the context menu, middle-click inspect and drag out to the table.
-->
<script lang="ts">
  import type { CardRef, InstanceId } from '../core/types';
  import type { FaceSource } from '../data/types';
  import type { TextureSource } from '../util/texture';
  import CardFace from './CardFace.svelte';
  import { CARD_ASPECT } from './hand';

  let {
    title,
    count,
    kind,
    own,
    hidden,
    cards,
    looking,
    shuffleOnClose = $bindable(true),
    faces,
    back,
    hovered,
    vw,
    vh,
    keys,
    onhover,
    oncontext,
    oninspect,
    ondragout,
    onlibrary,
    onclose,
  }: {
    title: string;
    count: number;
    kind: string;
    own: boolean;
    /** A hidden zone (library, another seat's hand): only the count is known unless you look. */
    hidden: boolean;
    /** In display order: bottom first for public piles, top first for a look at the library. */
    cards: { id: InstanceId; ref: CardRef | null; name: string }[];
    /** 'top' after looking at the top N, 'search' while searching, null otherwise. */
    looking: 'top' | 'search' | null;
    shuffleOnClose?: boolean;
    faces: FaceSource;
    back: TextureSource | null;
    hovered: InstanceId | null;
    vw: number;
    vh: number;
    keys: Record<string, string | null>;
    onhover: (id: InstanceId | null) => void;
    oncontext: (id: InstanceId, x: number, y: number) => void;
    oninspect: (id: InstanceId) => void;
    ondragout: (id: InstanceId, x: number, y: number) => void;
    onlibrary: (what: 'draw' | 'drawN' | 'shuffle' | 'look' | 'search' | 'mulligan' | 'mill' | 'revealTop', n?: number) => void;
    onclose: () => void;
  } = $props();

  let lookN = $state(3);
  let panel = $state<HTMLElement | undefined>();
  let drag: { id: InstanceId; x: number; y: number; pointer: number } | null = null;

  const h = $derived(Math.round(vh * 0.2));
  const w = $derived(h * CARD_ASPECT);
  const maxW = $derived(vw * 0.7);
  const step = $derived(cards.length <= 1 ? w : Math.min(w + 6, (maxW - w) / (cards.length - 1)));

  function down(e: PointerEvent, id: InstanceId) {
    if (e.button === 0) drag = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer || !panel) return;
    const r = panel.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      const id = drag.id;
      drag = null;
      onhover(null);
      ondragout(id, e.clientX, e.clientY);
    }
  }
  const k = (a: string) => (keys[a] ? ` (${keys[a]})` : '');
</script>

<svelte:window onpointermove={move} onpointerup={() => (drag = null)} />

<section class="viewer" data-testid="pile-viewer" data-kind={kind} aria-label={title} bind:this={panel}>
  <header>
    <h2>{title} <span class="count" data-testid="pile-count">{count}</span></h2>
    {#if kind === 'library' && own}
      <div class="actions">
        <button type="button" onclick={() => onlibrary('draw')}>Draw{k('draw')}</button>
        <button type="button" onclick={() => onlibrary('drawN')}>Draw N{k('drawN')}</button>
        <button type="button" onclick={() => onlibrary('shuffle')}>Shuffle{k('shuffle')}</button>
        <span class="look">
          <input type="number" min="1" max={count} bind:value={lookN} aria-label="How many cards (N)" data-testid="library-n" />
          <button type="button" data-testid="look-top" onclick={() => onlibrary('look', lookN)}>Look at top N</button>
          <button type="button" data-testid="mill" onclick={() => onlibrary('mill', lookN)}>Mill N</button>
        </span>
        <button type="button" data-testid="reveal-top" onclick={() => onlibrary('revealTop')}>Reveal top</button>
        <button type="button" data-testid="search-library" onclick={() => onlibrary('search')}>Search</button>
        <button type="button" onclick={() => onlibrary('mulligan')}>Mulligan{k('mulligan')}</button>
        {#if looking === 'search'}
          <label><input type="checkbox" bind:checked={shuffleOnClose} data-testid="shuffle-on-close" /> shuffle when closed</label>
        {/if}
      </div>
    {/if}
    <button type="button" class="close" onclick={onclose} aria-label="Close {title}">×</button>
  </header>
  {#if hidden && !looking}
    <p class="hidden-note" data-testid="hidden-note">{own && kind === 'library' ? 'Hidden. Look at the top cards or search to see them.' : 'Hidden. Only the count is known.'}</p>
  {:else if cards.length === 0}
    <p class="hidden-note">Empty.</p>
  {:else}
    <div class="fan" style:height="{h + 18}px" style:width="{w + step * (cards.length - 1)}px">
      {#each cards as c, i (c.id)}
        <div
          class="card"
          class:hovered={c.id === hovered}
          data-testid="pile-card"
          data-card={c.id}
          role="button"
          tabindex="-1"
          aria-label={c.name}
          style:left="{i * step}px"
          style:width="{w}px"
          style:height="{h}px"
          onpointerenter={() => onhover(c.id)}
          onpointerleave={() => hovered === c.id && onhover(null)}
          onpointerdown={(e) => down(e, c.id)}
          oncontextmenu={(e) => {
            e.preventDefault();
            oncontext(c.id, e.clientX, e.clientY);
          }}
          onmousedown={(e) => e.button === 1 && e.preventDefault()}
          onauxclick={(e) => e.button === 1 && oninspect(c.id)}
        >
          <CardFace {faces} cardRef={c.ref} {back} tier="small" alt={c.name} />
          <span class="index">{looking ? i + 1 : i === cards.length - 1 ? 'top' : ''}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .viewer {
    position: fixed;
    z-index: 40;
    left: 50%;
    bottom: calc(22vh + 64px);
    transform: translateX(-50%);
    max-width: 80vw;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 8px 12px;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size, 14px);
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-variant-caps: normal;
    color: var(--sp-muted, #5f5f5f);
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    flex: 1;
  }
  .look input {
    width: 3.5em;
    font: inherit;
  }
  button {
    font: inherit;
    background: none;
    color: inherit;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    cursor: pointer;
  }
  .close {
    margin-left: auto;
    border: 0;
    font-size: 16px;
  }
  .hidden-note {
    margin: 8px 0 2px;
    color: var(--sp-muted, #5f5f5f);
  }
  .fan {
    position: relative;
    margin: 8px auto 0;
    max-width: 100%;
  }
  .card {
    position: absolute;
    top: 0;
    box-shadow: 0 0 0 1px var(--sp-border, #d8d8d8);
    border-radius: 4.76% / 3.41%;
    cursor: grab;
    touch-action: none;
  }
  .card.hovered {
    box-shadow: 0 0 0 2px var(--sp-fg, #111);
    z-index: 2;
  }
  .index {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -16px;
    text-align: center;
    color: var(--sp-muted, #5f5f5f);
  }
</style>
