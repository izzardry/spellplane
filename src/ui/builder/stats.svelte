<!--
  The builder's live readout (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "A live readout shows
  card count, mana curve, colour split and land count"; the 40-card limited minimum as a hint, never enforced).
  Computed from the main deck only (ui/builder/stats.ts). Implementer: M2-P5.
-->
<script lang="ts">
  import { CURVE_MAX, type BuilderStats } from '../types';
  import { cardsToGo, MANA_COLOUR_LABELS, MANA_COLOURS } from './stats';

  let { stats }: { stats: BuilderStats } = $props();

  const toGo = $derived(cardsToGo(stats));
  const peak = $derived(Math.max(1, ...stats.curve));
  const symbols = $derived(MANA_COLOURS.reduce((n, c) => n + stats.colours[c], 0));
  const split = $derived(MANA_COLOURS.filter((c) => stats.colours[c] > 0));
  const curveLabel = (i: number): string => (i === CURVE_MAX ? `${CURVE_MAX}+` : String(i));
</script>

<section class="stats" data-testid="builder-stats" aria-label="Deck readout">
  <div class="counts">
    <span class="big" data-testid="stats-cards" data-value={stats.cards}>{stats.cards}</span>
    <span class="unit">{stats.cards === 1 ? 'card' : 'cards'}</span>
    <span class="lands" data-testid="stats-lands" data-value={stats.lands}>{stats.lands} {stats.lands === 1 ? 'land' : 'lands'}</span>
  </div>
  <p class="hint" class:met={!stats.belowMinimum} data-testid="stats-hint" data-below={stats.belowMinimum ? 'true' : 'false'}>
    {stats.belowMinimum ? `40-card minimum: ${toGo} to go` : '40-card minimum reached'}
  </p>

  <h3>Mana curve <span class="sub">non-land cards</span></h3>
  <ol class="curve" data-testid="stats-curve" data-values={stats.curve.join(',')}>
    {#each stats.curve as n, i (i)}
      <li title="Mana value {curveLabel(i)}: {n} {n === 1 ? 'card' : 'cards'}">
        <span class="n">{n || ''}</span>
        <span class="bar" style:height="{(n / peak) * 100}%"></span>
        <span class="mv">{curveLabel(i)}</span>
      </li>
    {/each}
  </ol>

  <h3>Colours <span class="sub">mana symbols</span></h3>
  {#if symbols === 0}
    <p class="none" data-testid="stats-colours" data-values="">No coloured symbols yet</p>
  {:else}
    <div class="split" aria-hidden="true">
      {#each split as c (c)}
        <span class="seg c-{c}" style:flex-grow={stats.colours[c]}></span>
      {/each}
    </div>
    <ul class="colours" data-testid="stats-colours" data-values={MANA_COLOURS.map((c) => `${c}${stats.colours[c]}`).join(',')}>
      {#each split as c (c)}
        <li data-colour={c} title="{MANA_COLOUR_LABELS[c]}: {stats.colours[c]} {stats.colours[c] === 1 ? 'symbol' : 'symbols'}">
          <span class="pip c-{c}">{c}</span>{stats.colours[c]}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .stats {
    display: grid;
    gap: 6px;
    font-size: var(--sp-font-size-small, 12px);
  }
  .counts {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .big {
    font-size: 22px;
    font-weight: var(--sp-font-weight-bold, 600);
    font-family: var(--sp-font-mono);
  }
  .lands {
    margin-left: auto;
    font-family: var(--sp-font-mono);
  }
  .hint {
    margin: 0;
    color: var(--sp-warning, #a60);
  }
  .hint.met {
    color: var(--sp-muted);
  }
  h3 {
    margin: 6px 0 0;
    font-size: inherit;
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .sub {
    font-weight: normal;
    color: var(--sp-muted);
  }
  .curve {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
    height: 72px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .curve li {
    display: grid;
    grid-template-rows: 14px 1fr 14px;
    align-items: end;
    text-align: center;
    min-width: 0;
  }
  .curve .n {
    font-family: var(--sp-font-mono);
  }
  .curve .bar {
    display: block;
    min-height: 1px;
    background: var(--sp-fg);
    opacity: 0.7;
    border-radius: 2px 2px 0 0;
  }
  .curve .mv {
    color: var(--sp-muted);
    font-family: var(--sp-font-mono);
  }
  .split {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--sp-border);
  }
  .seg {
    flex-basis: 0;
  }
  .colours {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--sp-font-mono);
  }
  .colours li {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .pip {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    font-size: 9px;
    border: 1px solid var(--sp-border);
  }
  .none {
    margin: 0;
    color: var(--sp-muted);
  }
  /* Mana colours as the game prints them; the HUD's own tokens stay in charge of everything else. */
  .c-W {
    background: #f6f1d8;
    color: #222;
  }
  .c-U {
    background: #aed4ef;
    color: #222;
  }
  .c-B {
    background: #9b928f;
    color: #111;
  }
  .c-R {
    background: #ec9b80;
    color: #222;
  }
  .c-G {
    background: #9cc9a5;
    color: #222;
  }
  .c-C {
    background: #ccc6c3;
    color: #222;
  }
</style>
