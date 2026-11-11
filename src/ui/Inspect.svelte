<!--
  Inspect view (DESIGN "Card manipulation": large upright image with Oracle text, both faces, rulings link;
  "Specification: geometry, layout and motion", Screen layer: 85% of viewport height; "Themes and rendering": inspect
  always shows the original image).
-->
<script lang="ts">
  import type { CardRef } from '../core/types';
  import type { CardData, FaceSource } from '../data/types';
  import { SCREEN_LAYER } from '../core/geometry';
  import type { TextureSource } from '../util/texture';
  import CardFace from './CardFace.svelte';
  import { CARD_ASPECT } from './hand';

  let {
    faces,
    cardRef,
    data,
    back,
    note,
    counters,
    vw,
    vh,
    onclose,
  }: {
    faces: FaceSource;
    cardRef: CardRef | null;
    data: CardData | null;
    back: TextureSource | null;
    note?: string | undefined;
    counters?: Record<string, number>;
    vw: number;
    vh: number;
    onclose: () => void;
  } = $props();

  const DOUBLE_FACED = ['transform', 'modal_dfc', 'reversible_card', 'double_faced_token', 'art_series', 'meld'];
  /** Two images for double-faced cards; split and adventure cards share one image. */
  const faceCount = $derived(data?.card_faces && data.card_faces.length > 1 && (DOUBLE_FACED.includes(data.layout) || !!data.card_faces[0]?.image_uris) ? 2 : 1);
  const TEXT_W = 280;
  const height = $derived(Math.max(120, Math.min(vh * SCREEN_LAYER.inspectViewportFraction, (vw - TEXT_W - 16 * (faceCount + 2)) / (faceCount * CARD_ASPECT))));
  const textFaces = $derived(
    data
      ? data.card_faces && data.card_faces.length > 1
        ? data.card_faces.map((f) => ({ name: f.name, cost: f.mana_cost, type: f.type_line, text: f.oracle_text, pt: f.power !== undefined ? `${f.power}/${f.toughness}` : f.loyalty ? `Loyalty ${f.loyalty}` : '' }))
        : [{ name: data.name, cost: data.mana_cost, type: data.type_line, text: data.oracle_text, pt: data.power !== undefined ? `${data.power}/${data.toughness}` : data.loyalty ? `Loyalty ${data.loyalty}` : '' }]
      : [],
  );
</script>

<div class="overlay" data-testid="inspect" role="dialog" aria-label="Inspect {data?.name ?? 'card'}" tabindex="-1" onclick={onclose} onkeydown={() => {}}>
  <div class="images">
    {#each Array.from({ length: faceCount }, (_, i) => i as 0 | 1) as fi (fi)}
      <div class="img" data-testid="inspect-face" style:height="{height}px" style:width="{height * CARD_ASPECT}px">
        <CardFace {faces} {cardRef} faceIndex={fi} tier="large" {back} alt={data?.card_faces?.[fi]?.name ?? data?.name ?? 'Hidden card'} />
      </div>
    {/each}
  </div>
  <aside class="text" data-testid="inspect-text">
    {#if !cardRef}
      <p class="muted">A hidden card.</p>
    {:else if !data}
      <p class="muted">Loading card data…</p>
    {:else}
      {#each textFaces as f, i (i)}
        <div class="face">
          <h2>{f.name} {#if f.cost}<span class="cost">{f.cost}</span>{/if}</h2>
          {#if f.type}<p class="type">{f.type}</p>{/if}
          {#if f.text}<p class="oracle">{f.text}</p>{/if}
          {#if f.pt}<p class="pt">{f.pt}</p>{/if}
        </div>
      {/each}
      {#if counters && Object.keys(counters).length}
        <p class="extra">Counters: {Object.entries(counters).map(([k, v]) => `${v} × ${k}`).join(', ')}</p>
      {/if}
      {#if note}<p class="extra">Note: {note}</p>{/if}
      <p class="links">
        <a href="https://scryfall.com/card/{data.set}/{data.collector_number}" target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>Rulings on Scryfall</a>
        {#if data.artist}<span class="muted"> · Illustrated by {data.artist}</span>{/if}
      </p>
    {/if}
  </aside>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: rgb(255 255 255 / 0.86);
    color: var(--sp-fg, #111);
    font: var(--sp-font-size, 14px) / 1.45 var(--sp-font, system-ui);
  }
  .images {
    display: flex;
    gap: 16px;
  }
  .img {
    flex: none;
    box-shadow: 0 0 0 1px var(--sp-fg, #111);
    border-radius: 4.76% / 3.41%;
  }
  .text {
    width: 280px;
    max-height: 85vh;
    overflow-y: auto;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size-large, 18px);
  }
  .cost {
    font-family: var(--sp-font-mono, monospace);
    font-weight: normal;
    font-size: var(--sp-font-size, 14px);
  }
  .type {
    margin: 2px 0 6px;
    font-style: italic;
  }
  .oracle {
    white-space: pre-line;
    margin: 0 0 6px;
  }
  .pt {
    margin: 0;
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .face + .face {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--sp-border, #d8d8d8);
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  .extra,
  .links {
    margin: 10px 0 0;
  }
  a {
    color: var(--sp-fg, #111);
  }
</style>
