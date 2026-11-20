<!--
  One whole card face in Deck mode (decks.md D28): never cropped, blurred, tinted, dimmed or stretched. The box keeps
  the card's 63:88 ratio and the image is scaled uniformly inside it; without a card, before the face arrives, or when
  its image fails to load, the box shows the neutral back. Implementer: M8-P3.
-->
<script lang="ts">
  import type { CardRef } from '../../../core/types';
  import type { FaceSource, ImageTier } from '../../../data/types';
  import { faceUrl, forgetFaceUrl } from './face-url';

  let {
    faces,
    cardRef,
    alt = '',
    tier = 'normal',
    lazy = true,
  }: { faces: FaceSource; cardRef: CardRef | null; alt?: string; tier?: ImageTier; lazy?: boolean } = $props();

  let src = $state<string | null>(null);

  $effect(() => {
    const ref = cardRef;
    src = null;
    if (!ref) return;
    let live = true;
    faceUrl(faces, ref, tier)
      .then((u) => {
        if (live) src = u;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });
</script>

<span class="face" data-face={cardRef ? 'up' : 'back'}>
  {#if src}
    <img
      {src}
      {alt}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      draggable="false"
      data-card-face
      onerror={() => {
        // A face that cannot be loaded shows the neutral back, never the browser's broken-image box (DESIGN "Deck
        // building mode", failure behaviour).
        if (src) forgetFaceUrl(src);
        src = null;
      }}
    />
  {:else}
    <span class="back" role="img" aria-label={alt || 'Card back'}></span>
  {/if}
</span>

<style>
  .face {
    display: block;
    width: 100%;
    aspect-ratio: 63 / 88;
    position: relative;
  }
  img,
  .back {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 4.75% / 3.4%;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }
  .back {
    box-sizing: border-box;
    background: var(--ds-ink);
    border: 6px solid var(--ds-panel);
    box-shadow: 0 0 0 1px var(--ds-line);
  }
</style>
