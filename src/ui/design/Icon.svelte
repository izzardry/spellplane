<!--
  One icon of the design system's set (ui/design/icons.ts), stroked in the text colour around it. Decorative: the
  control that carries it always has a label (visible or aria-label).
-->
<script lang="ts">
  import { ICONS, type IconName } from './icons';

  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg class="ds-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICONS[name]} /></svg>

<style>
  .ds-icon {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
