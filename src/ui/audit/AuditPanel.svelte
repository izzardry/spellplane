<!--
  The audit panel (DESIGN "Multiplayer architecture", Hidden information 6: peers replay the published nonces and order
  history and confirm that every draw came from the committed order; PLAN M5-P2: "show a per-player verdict and any
  mismatch"; PLAN Milestone 5, owner decisions: automatic at game end, "could not be checked: records missing" shown
  neutrally). One row per player of the finished game: verified (shuffles and draws checked), mismatch (every finding:
  which shuffle, reorder or draw, expected against found), could not be checked, or waiting for the player's records.
  It opens by itself when a game ends, can be closed, and reopened from its button; earlier games of the evening are
  one click away; it steps aside while a match is played. Not modal. Implementer: M5-P2.
-->
<script lang="ts">
  import SeatGlyph from '../a11y/SeatGlyph.svelte';
  import { onMount, untrack } from 'svelte';
  import { AUDIT_STATUS_TEXT } from '../../core/audit';
  import { verifiedDetail, type AuditControls, type AuditGameView, type AuditSeatView } from '../../net/audit';
  import { gamesSeen } from './panel';

  /**
   * `playing`: a match is on; the panel and its button step aside (the verdicts stay in the log). `lobby`: the table is
   * in its lobby, whose settings column fills the top right; the panel docks at the bottom right instead (M5 gate: it
   * covered the packs field on the iPad).
   */
  let { audit, playing = false, lobby = false }: { audit: AuditControls; playing?: boolean; lobby?: boolean } = $props();

  let games = $state.raw<AuditGameView[]>(untrack(() => audit.games()));
  // A game that ended before this page opened (a reload) does not pop the panel up again.
  let seen = untrack(() => games.length);
  let open = $state(untrack(() => games.at(-1)?.done === false));
  /** The game shown; null: the latest. */
  let picked = $state<number | null>(null);

  onMount(() =>
    audit.subscribe(() => {
      games = audit.games();
      const next = gamesSeen(seen, games.length);
      seen = next.seen;
      if (next.opens) {
        picked = null;
        open = true;
      }
    }),
  );

  // A new match closes the panel: the table needs the room, and the next game's audit opens it again.
  $effect(() => {
    if (playing) open = false;
  });

  const shown = $derived(picked === null ? games.at(-1) : games.find((g) => g.game.game === picked));

  function status(s: AuditSeatView): string {
    return s.verdict === null ? 'waiting for records' : AUDIT_STATUS_TEXT[s.verdict.status];
  }

  /** The sentence under the heading: what the rows show, true for whatever state they are in. */
  function about(g: AuditGameView): string {
    if (g.done && g.seats.every((s) => s.verdict?.status !== 'unverifiable')) return 'Every player published their shuffle nonces and orders; this table replayed them against the log.';
    return 'Published shuffle nonces and orders are replayed against the log; a player without records is shown as such, never as a mismatch.';
  }
</script>

{#if shown && !playing}
  {#if open}
    <section class="audit" class:docked={lobby} aria-label="Audit" data-testid="audit-panel" data-game={shown.game.game}>
      <header>
        <h2>Audit of game {shown.game.game}</h2>
        <button type="button" class="close" aria-label="Close the audit" data-testid="audit-close" onclick={() => (open = false)}>×</button>
      </header>
      <p class="about" data-testid="audit-about">{about(shown)}</p>
      <ul class="seats">
        {#each shown.seats as s (s.seat)}
          <li data-testid="audit-row" data-seat={s.seat} data-status={s.verdict?.status ?? 'pending'} class={s.verdict?.status ?? 'pending'}>
            <div class="line">
              <span class="swatch" style="background: var(--sp-seat-{s.colour}, #888)" aria-hidden="true"></span><SeatGlyph colour={s.colour} />
              <span class="name">{s.name}</span>
              <span class="status" data-testid="audit-status">{status(s)}</span>
            </div>
            {#if s.verdict === null && s.note}
              <p class="detail" data-testid="audit-note">{s.note}</p>
            {:else if s.verdict?.status === 'verified'}
              <p class="detail">{verifiedDetail(s.verdict)}</p>
            {:else if s.verdict?.status === 'unverifiable'}
              <p class="detail">{s.verdict.detail}</p>
            {:else if s.verdict?.status === 'mismatch'}
              <ul class="findings">
                {#each s.verdict.mismatches as m, i (i)}
                  <li data-testid="audit-mismatch" data-kind={m.kind}>{m.detail}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      {#if games.length > 1}
        <nav class="games" aria-label="Games of the evening">
          {#each games as g (g.game.game)}
            <button type="button" aria-pressed={g.game.game === shown.game.game} data-testid="audit-game" onclick={() => (picked = g.game.game)}>Game {g.game.game}</button>
          {/each}
        </nav>
      {/if}
    </section>
  {:else}
    <button type="button" class="toggle" data-testid="audit-toggle" onclick={() => (open = true)}>Audit</button>
  {/if}
{/if}

<style>
  .audit,
  .toggle {
    position: absolute;
    z-index: 25;
    /* Below the top bars of the builder and the lobby, so their buttons (Ready) stay reachable. */
    top: 56px;
    right: 12px;
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    color: var(--sp-fg, #111);
  }
  .audit {
    box-sizing: border-box;
    width: min(400px, calc(100vw - 24px));
    max-height: calc(100% - 68px);
    overflow-y: auto;
    padding: 10px 14px 12px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.2);
  }
  .audit.docked {
    top: auto;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    max-height: 36vh;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size-large, 16px);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .about {
    margin: 4px 0 8px;
    color: var(--sp-muted, #5f5f5f);
    font-size: var(--sp-font-size-small, 12px);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .seats > li {
    padding: 6px 0;
    border-top: 1px solid var(--sp-border, #ddd);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid var(--sp-border, #ccc);
  }
  .name {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .status {
    margin-left: auto;
    text-align: right;
  }
  .verified .status::before {
    content: '✓ ';
  }
  .mismatch .status {
    color: var(--sp-danger, #b3261e);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .mismatch .status::before {
    content: '✗ ';
  }
  .unverifiable .status,
  .pending .status {
    color: var(--sp-muted, #5f5f5f);
  }
  .detail,
  .findings {
    margin: 2px 0 0 20px;
    font-size: var(--sp-font-size-small, 12px);
  }
  .findings {
    list-style: disc;
    padding-left: 16px;
    color: var(--sp-danger, #b3261e);
  }
  .games {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-bg, #fff);
    color: inherit;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--sp-accent, #2b6cb0);
  }
  .close {
    padding: 0 8px;
    line-height: 1.4;
  }
  .toggle {
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus, #2b6cb0);
    outline-offset: 2px;
  }
</style>
