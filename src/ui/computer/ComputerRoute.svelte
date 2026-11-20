<!--
  `#/c/<room>`: a game against Sparring (computer.md section 3; contracts.md Part G "Computer opponent" item 5): opens
  the computer game and renders the table frame with `kind: 'computer'`, `gather: false` and `extraShell`. Stub by
  M8-C: the computer game is not in this build, so the route says so and offers Home. M8-P6 owns the file.
-->
<script lang="ts">
  import { resumeComputerGame } from '../../session/computer';

  let { room, go = (h: string) => (location.hash = h) }: { room: string; go?: (hash: string) => void } = $props();
  let error = $state('');
  $effect(() => {
    let cancelled = false;
    resumeComputerGame(room).then(
      (g) => {
        if (cancelled) {
          g.handle.dispose();
          g.session.dispose();
        }
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

<main class="ds-page" data-testid="route-computer">
  <h1 class="ds-t-heading">Sparring</h1>
  <p class="ds-t-reading" role="status">{error ? 'Sparring is not in this build yet.' : 'Opening the game…'}</p>
  <button type="button" class="ds-btn ds-btn--secondary ds-btn--md" onclick={() => go('#/')}>Home</button>
</main>
