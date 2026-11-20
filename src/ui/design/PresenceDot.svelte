<!--
  A presence dot of the kit (docs/design/m8/contracts.md Part B; visual.md 2.7): here (filled), connecting (pulsing
  ring), away (ring). Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { state, label = undefined, ...rest }: { state: 'here' | 'connecting' | 'away'; label?: string | undefined; [attr: string]: unknown } = $props();
</script>

<span class="ds-presence" data-state={state} {...rest}><span class="ds-dot ds-dot--{state}" role="img" aria-label={label ?? state}></span></span>
