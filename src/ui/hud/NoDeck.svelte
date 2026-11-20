<!--
  A table without the viewer's deck (docs/design/m8/m7-adjustments.md D7 and M7-P2 "Above the hand"): one line, "No deck
  on this table.", and "Choose a deck": the shell's picker (HudShellProps.onchoosedeck) or, in the sandbox, the paste
  dialog. Without either there is only the line.
-->
<script lang="ts">
  let { onchoose, onpaste }: { onchoose?: (() => void) | undefined; onpaste?: (() => void) | undefined } = $props();
</script>

<div class="ds-pop no-deck" role="status" data-testid="no-deck">
  <span>No deck on this table.</span>
  {#if onchoose}
    <button type="button" class="ds-btn sp-h-sm sp-pill" data-testid="choose-deck" onclick={onchoose}>Choose a deck</button>
  {:else if onpaste}
    <button type="button" class="ds-btn sp-h-sm sp-pill" data-testid="empty-import-deck" onclick={onpaste}>Choose a deck</button>
  {/if}
</div>

<style>
  .no-deck {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    padding: var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-xs) var(--ds-space-lg);
    border-radius: var(--ds-radius-pill);
    font-size: var(--ds-type-body);
    pointer-events: auto;
  }
</style>
