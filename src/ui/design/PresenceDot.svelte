<!--
  A presence dot (docs/design/m8/contracts.md Part B; visual.md 2.7): solid green here, hollow and pulsing while
  connecting, hollow and still when away; always next to a word (`label`, or the state's own word). Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  const WORDS = { here: 'here', connecting: 'connecting', away: 'away' } as const;
  let { state, label = undefined, ...rest }: { state: 'here' | 'connecting' | 'away'; label?: string | undefined; [attr: string]: unknown } = $props();
</script>

<span class="ds-presence" data-state={state} {...rest}><span class="ds-dot ds-dot--{state}" aria-hidden="true"></span><span>{label ?? WORDS[state]}</span></span>
