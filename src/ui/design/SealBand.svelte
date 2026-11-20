<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { packs, label = undefined, ...rest }: { packs: string; label?: string | undefined; [key: string]: unknown } = $props();
</script>

<span class="ds-seal" title={label ?? 'Built from boosters. Convert it to a custom deck to add other cards.'} {...rest}>🔒 {packs}</span>

<style>
  .ds-seal { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 4px; background: var(--ds-ink); color: var(--ds-panel); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
</style>
