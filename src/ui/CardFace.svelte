<!--
  One card picture in the HUD (DESIGN "Card data and images"; "Themes and rendering": card faces are never recoloured,
  cropped or distorted). A known card shows its face from the FaceSource (Scryfall URL or placeholder canvas); an
  unknown one shows the game's neutral back.
-->
<script lang="ts">
  import type { CardRef } from '../core/types';
  import type { FaceImage, FaceSource, ImageTier } from '../data/types';
  import { drawPlaceholderFace } from '../scene/placeholder';
  import type { TextureSource } from '../util/texture';

  let {
    faces,
    cardRef,
    faceIndex = 0,
    tier = 'normal',
    back = null,
    dim = false,
    alt = '',
  }: {
    faces: FaceSource;
    cardRef: CardRef | null;
    faceIndex?: 0 | 1;
    tier?: ImageTier;
    back?: TextureSource | null;
    dim?: boolean;
    alt?: string;
  } = $props();

  let image = $state<FaceImage | null>(null);
  let canvas = $state<HTMLCanvasElement | undefined>();

  $effect(() => {
    const ref = cardRef;
    const fi = faceIndex;
    const t = tier;
    image = null;
    if (!ref) return;
    let live = true;
    faces
      .faceFor(ref, fi, t)
      .then((f) => {
        if (live) image = f;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  $effect(() => {
    const c = canvas;
    if (!c) return;
    if (image?.kind === 'placeholder') {
      drawPlaceholderFace(image.face, c);
      return;
    }
    if (!cardRef) {
      const w = back?.width ?? 488;
      const h = back?.height ?? 680;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      try {
        if (!back) throw new Error('no back');
        back.draw(ctx, w, h);
      } catch {
        ctx.fillStyle = '#e9e9e9';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 8;
        ctx.strokeRect(24, 24, w - 48, h - 48);
      }
    }
  });
</script>

<div class="face" class:dim role="img" aria-label={alt || (cardRef ? 'Card' : 'Card back')} data-face={cardRef ? 'up' : 'back'}>
  {#if image?.kind === 'url'}
    <img src={image.url} alt="" draggable="false" />
  {:else}
    <canvas bind:this={canvas}></canvas>
  {/if}
</div>

<style>
  .face {
    width: 100%;
    height: 100%;
    border-radius: 4.76% / 3.41%;
    overflow: hidden;
    background: var(--sp-surface, #fff);
  }
  .face.dim {
    opacity: 0.55;
  }
  img,
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }
</style>
