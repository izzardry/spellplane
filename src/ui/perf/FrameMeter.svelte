<!--
  The on-screen frame meter (PLAN M7 A0): fps, frame time p50 and p95 and the longest gap over the last two seconds,
  the canvas's render size and pixel ratio, the theme and quality level, and whether the loop is idle. Shown with
  `?fps` or the "Show frame rate" setting. It reads util/frame-meter.ts four times a second and writes one text node:
  no per-frame DOM or Svelte work, no blur or shadow over the canvas, no pointer events.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { frameMeter, frameMeterApi } from '../../util/frame-meter';
  import { meterLines, meterShown, onMeterShown } from './meter';

  let shown = $state(meterShown());
  let text = $state('');

  onMount(() => onMeterShown((on) => (shown = on)));

  $effect(() => {
    if (!shown) return;
    window.__spellplaneFps = frameMeterApi;
    const update = () => {
      const next = meterLines(frameMeter.snapshot(performance.now())).join('\n');
      if (next !== text) text = next;
    };
    update();
    const timer = setInterval(update, 250);
    return () => {
      clearInterval(timer);
      if (window.__spellplaneFps === frameMeterApi) delete window.__spellplaneFps;
    };
  });
</script>

{#if shown}
  <pre class="meter" data-testid="frame-meter" aria-hidden="true">{text}</pre>
{/if}

<style>
  .meter {
    position: fixed;
    left: calc(env(safe-area-inset-left, 0px) + 6px);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 6px);
    z-index: 2147483000;
    margin: 0;
    padding: 3px 6px;
    font: 10px/1.35 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #e8f0e8;
    background: rgba(0, 0, 0, 0.62);
    border-radius: 3px;
    pointer-events: none;
    user-select: none;
    white-space: pre;
    contain: layout paint;
  }
</style>
