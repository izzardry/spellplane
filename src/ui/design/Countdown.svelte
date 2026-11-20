<!--
  A countdown ring (docs/design/m8/contracts.md Part B; visual.md 2.8 "Match found"): a conic ring for the time left
  and the seconds inside. The parent steps `seconds` once a second; the ring runs no timer and no animation frame loop
  of its own. Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  let { seconds, total, size = 56, label, ...rest }: { seconds: number; total: number; size?: number; label: string; [attr: string]: unknown } = $props();
  const left = $derived(Math.max(0, Math.min(total, Math.ceil(seconds))));
  const pct = $derived(total > 0 ? (left / total) * 100 : 0);
</script>

<span
  class="ds-count"
  role="timer"
  aria-label="{label}: {left} {left === 1 ? 'second' : 'seconds'}"
  data-seconds={left}
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.32)}px"
  style:background="conic-gradient(var(--ds-ink) 0 {pct}%, var(--ds-chip) {pct}% 100%)"
  {...rest}><span aria-hidden="true">{left}</span></span
>
