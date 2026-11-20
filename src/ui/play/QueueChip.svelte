<!--
  Stub at a fixed seam path (PLAN M8 "Fixed paths of the seams": QueueChip is M8-P7's), written by M8-P2 because
  M8-C's UI commit did not land; M8-P7's file replaces it. Shows the search and a CANCEL.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';

  let { matchmaker, onhome = undefined }: { matchmaker: Matchmaker; onhome?: (() => void) | undefined } = $props();
  let status: MatchmakerStatus = $state(matchmaker.status());
  const off = matchmaker.subscribe((s) => (status = s));
  onDestroy(off);
</script>

<div class="qchip" data-testid="queue-chip">
  <button type="button" class="qchip__go" onclick={() => onhome?.()}>◌ {status.phase === 'connecting' ? 'CONNECTING…' : 'SEARCHING'}</button>
  <button type="button" class="qchip__cancel" onclick={() => matchmaker.cancel()}>CANCEL</button>
</div>

<style>
  .qchip { display: inline-flex; align-items: center; gap: 12px; height: 44px; box-sizing: border-box; padding: 0 4px 0 16px; border-radius: 999px; background: var(--ds-ink); color: var(--ds-panel); box-shadow: var(--ds-elevation-primary); }
  .qchip__go { border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; letter-spacing: 0.1em; cursor: pointer; height: 36px; }
  .qchip__cancel { height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--ds-muted); color: var(--ds-panel); font: inherit; font-size: 12px; cursor: pointer; }
</style>
