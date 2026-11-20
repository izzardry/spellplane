<!--
  A countdown ring (docs/design/m8/contracts.md Part B; visual.md 2.8 "Match found"): the seconds left in a ring; the
  parent steps `seconds` once a second (nothing runs per frame). Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { seconds, total, size = 56, label, ...rest }: { seconds: number; total: number; size?: number; label: string; [attr: string]: unknown } = $props();
  const deg = $derived(total > 0 ? Math.max(0, Math.min(1, seconds / total)) * 360 : 0);
</script>

<span
  class="ds-count"
  role="timer"
  aria-label="{label}: {seconds}"
  style:width="{size}px"
  style:height="{size}px"
  style:background="conic-gradient(currentColor {deg}deg, transparent 0)"
  {...rest}><span>{seconds}</span></span
>
