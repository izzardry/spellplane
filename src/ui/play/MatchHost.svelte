<!--
  Mounted once by App.svelte over every shell screen and solo table (contracts.md Part C): in phase `check` it shows
  the match-found card, plays the matchFound chime once per match and sets the tab title to `Match found ·
  Spellplane` until the check ends; a short notice follows a declined or missed match. The countdown is stepped once a
  second, never per frame. M8-P7.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import MatchFound from './MatchFound.svelte';
  import { MATCH_FOUND_TITLE, mmNow } from './mm-view';

  let { matchmaker, chime }: { matchmaker: Matchmaker; chime?: () => void } = $props();

  let status = $state<MatchmakerStatus>({ phase: 'off' });
  let now = $state(0);
  let notice: string | null = $state(null);
  let savedTitle: string | null = null;
  let chimed = '';
  let ticker: ReturnType<typeof setInterval> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  const noticeOf = (): string | null => {
    const n = (matchmaker as Matchmaker & { notice?: () => string | null }).notice;
    return typeof n === 'function' ? n.call(matchmaker) : null;
  };

  const off = matchmaker.subscribe((s) => {
    const was = status.phase;
    status = s;
    now = mmNow(matchmaker);
    if (s.phase === 'check') {
      if (savedTitle === null && typeof document !== 'undefined') {
        savedTitle = document.title;
        document.title = MATCH_FOUND_TITLE;
      }
      if (chimed !== s.match.matchId) {
        chimed = s.match.matchId;
        chime?.();
      }
      ticker ??= setInterval(() => (now = mmNow(matchmaker)), 1000);
    } else {
      if (savedTitle !== null && typeof document !== 'undefined') document.title = savedTitle;
      savedTitle = null;
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
      if (was === 'check' || (was === 'moving' && (s.phase === 'connecting' || s.phase === 'seeking'))) {
        const n = noticeOf();
        if (n) {
          notice = n;
          if (noticeTimer !== null) clearTimeout(noticeTimer);
          noticeTimer = setTimeout(() => (notice = null), 5000);
        }
      }
    }
  });

  onDestroy(() => {
    off();
    if (ticker !== null) clearInterval(ticker);
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    if (savedTitle !== null && typeof document !== 'undefined') document.title = savedTitle;
  });
</script>

{#if status.phase === 'check'}
  <MatchFound {status} {now} onanswer={(a) => matchmaker.answer(a)} />
{/if}
{#if notice}
  <div class="mm-notice" role="status" data-testid="mm-notice">{notice}</div>
{/if}

<style>
  .mm-notice {
    position: fixed;
    left: 50%;
    bottom: var(--ds-space-xl);
    transform: translateX(-50%);
    z-index: 890;
    max-width: calc(100% - 32px);
    padding: var(--ds-space-sm) var(--ds-space-md);
    border-radius: var(--ds-radius-pill);
    background: var(--ds-ink);
    color: var(--ds-on-ink);
    box-shadow: var(--ds-elevation-pop);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-small);
  }
</style>
