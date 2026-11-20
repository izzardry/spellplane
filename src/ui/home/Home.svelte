<!--
  Home (`#/`; journey.md 4.1): the deck hero, the four modes, their options, one filled button and the CONTINUE strip.
  Stub by M8-C: PLAY opens a practice table, CREATE TABLE a private table, and the recent games below. M8-P2 owns the
  file.
-->
<script lang="ts">
  import type { Matchmaker } from '../../session/types';
  import type { GameStore, GameSummary } from '../../store/types';
  import Button from '../design/Button.svelte';
  import HistoryList from '../history/HistoryList.svelte';
  import { newPracticeRoom, practiceHash, summaryHash } from '../play/launch';
  import type { RoomLink } from '../types';

  let {
    matchmaker: _matchmaker,
    games = null,
    newRoom = undefined,
    go = (h: string) => (location.hash = h),
  }: {
    matchmaker: Matchmaker;
    games?: GameStore | null;
    /** A fresh private table this browser creates (main.ts marks it created here). */
    newRoom?: (() => RoomLink) | undefined;
    go?: (hash: string) => void;
  } = $props();

  function create(): void {
    const link = newRoom?.();
    if (link) go(`#/t/${encodeURIComponent(link.roomId)}/${encodeURIComponent(link.roomKey)}`);
  }
</script>

<section class="home" data-testid="home">
  <h1 class="ds-t-display">Spellplane</h1>
  <div class="home-actions">
    <Button variant="primary" size="lg" data-testid="home-primary" onclick={() => go(practiceHash(newPracticeRoom()))}>Play</Button>
    {#if newRoom}<Button variant="secondary" size="md" data-testid="home-create" onclick={create}>Create table</Button>{/if}
  </div>
  <h2 class="ds-t-eyebrow">Recent games</h2>
  <HistoryList {games} limit={3} onopen={(g: GameSummary) => go(summaryHash(g))} />
</section>

<style>
  .home {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--ds-space-xxl) var(--ds-space-lg);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--ds-space-xl);
  }
  .home-actions {
    display: flex;
    gap: var(--ds-space-md);
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
</style>
