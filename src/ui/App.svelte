<script lang="ts">
  import { onMount } from 'svelte';
  import { createStage, type Stage } from '../scene/stage';
  import { registerDebug } from '../util/debug';

  let host: HTMLElement;
  let stage: Stage | null = null;

  onMount(() => {
    stage = createStage(host);
    stage.addCard({
      id: 'smoke-1',
      face: { name: 'Placeholder Bear', cost: '{1}{G}', type: 'Creature — Bear', pt: '2/2', text: 'A card drawn by the test harness.' },
      x: 0,
      y: 0,
      rot: 0,
    });
    stage.render();
    const s = stage;
    registerDebug({
      cards: () =>
        s.cards().map((c) => ({ id: c.id, pose: { x: c.x, y: c.y, rot: c.rot }, screen: s.cardRect(c.id) ?? new DOMRect(), visible: true })),
      camera: () => ({ rig: 'birdseye', fov: s.camera.fov, position: s.camera.position.toArray(), pitch: 90 }),
      frameStats: () => ({ drawCalls: s.renderer.info.render.calls, textureBytes: 0, frameMs: 0 }),
    });
    return () => s.dispose();
  });
</script>

<main class="table" bind:this={host} data-testid="table"></main>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #fff;
    color: #111;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  :global(#app) {
    height: 100%;
  }
  .table {
    position: fixed;
    inset: 0;
  }
</style>
