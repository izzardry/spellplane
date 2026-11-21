<!--
  The page-wide match-found host (contracts.md Part C; journey.md 4.6; matchmaking.md 2.8), mounted by the shell over
  every shell screen (and by the frame over a solo table). In phase `check` it shows the match-found card, asks for the
  matchFound chime once per match (`chime`; the debug hook counts it) and sets the tab title to `Match found ·
  Spellplane` until the check ends. After a declined, missed or unreachable match it shows the matchmaker's notice as a
  kit toast, taken once: on the next status outside the check and the move, also when the host mounts after it was set
  (a stranded match is decided while a table route shows, where the shell's host is not mounted). The countdown steps once a second, never per frame. M8-P7.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import { toasts } from '../design/toasts';
  import MatchFound from './MatchFound.svelte';
  import { MATCH_FOUND_TITLE, mmNow, ringChime, searchAgain, takeNoticeOf } from './mm-view';

  let {
    matchmaker,
    chime = undefined,
    notices = true,
  }: {
    matchmaker: Matchmaker;
    chime?: (() => void) | undefined;
    /** Show the matchmaker's notices as toasts (false over a solo table, where no toast host is mounted: Home shows them). */
    notices?: boolean;
  } = $props();

  let status = $state.raw<MatchmakerStatus>({ phase: 'off' });
  let now = $state(0);
  let savedTitle: string | null = null;
  let chimed = '';
  let ticker: ReturnType<typeof setInterval> | null = null;

  const off = untrack(() => matchmaker).subscribe((s) => {
    status = s;
    now = mmNow(matchmaker);
    if (s.phase === 'check') {
      if (savedTitle === null && typeof document !== 'undefined') {
        savedTitle = document.title;
        document.title = MATCH_FOUND_TITLE;
      }
      if (chimed !== s.match.matchId) {
        chimed = s.match.matchId;
        ringChime(chime);
      }
      ticker ??= setInterval(() => (now = mmNow(matchmaker)), 1000);
      return;
    }
    if (savedTitle !== null && typeof document !== 'undefined') document.title = savedTitle;
    savedTitle = null;
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    if (s.phase === 'moving' || !notices) return;
    const n = takeNoticeOf(matchmaker);
    if (!n) return;
    if (n.again) toasts.info(n.text, { label: 'SEARCH AGAIN', run: () => searchAgain(matchmaker) });
    else toasts.info(n.text);
  });

  onDestroy(() => {
    off();
    if (ticker !== null) clearInterval(ticker);
    if (savedTitle !== null && typeof document !== 'undefined') document.title = savedTitle;
  });
</script>

{#if status.phase === 'check'}
  <MatchFound {status} {now} onanswer={(a) => matchmaker.answer(a)} />
{/if}
