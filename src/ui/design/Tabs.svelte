<!--
  Tabs (PLAN Milestone 7, A1): a segmented row with arrow-key movement (role tablist).
-->
<script lang="ts" generics="T extends string">
  import './kit';
  let { tabs, value, onchange, label, testid = null }: { tabs: readonly { id: T; label: string }[]; value: T; onchange: (id: T) => void; label: string; testid?: string | null } = $props();
  const buttons: HTMLButtonElement[] = [];
  function key(e: KeyboardEvent, i: number): void {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    const t = tabs[next];
    if (!t) return;
    onchange(t.id);
    buttons[next]?.focus();
  }
</script>

<div class="ds-tabs" role="tablist" aria-label={label} data-testid={testid}>
  {#each tabs as t, i (t.id)}
    <button type="button" class="ds-tab" role="tab" data-tab={t.id} aria-selected={t.id === value} tabindex={t.id === value ? 0 : -1} bind:this={buttons[i]} onclick={() => onchange(t.id)} onkeydown={(e) => key(e, i)}>{t.label}</button>
  {/each}
</div>
