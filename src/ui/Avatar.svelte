<!--
  A player's avatar with life total and counters (DESIGN "Turn flow and confirmation", Life and player counters: click or
  scroll to change, typed value on double-click; poison and free-form named counters; "Input and interaction design",
  Accessibility: seat colours paired with a glyph).
-->
<script lang="ts">
  import type { Seat, ZoneId } from '../core/types';

  let {
    seat,
    life,
    me,
    active,
    responding,
    asking = false,
    speaking = false,
    glyph,
    zones,
    onlife,
    oncounter,
    onopenzone,
    ongoto,
    readonly = false,
    compact = false,
  }: {
    seat: Seat;
    life: number;
    me: boolean;
    active: boolean;
    responding: boolean;
    /** Added by M1-P3: this seat asked a manual round that still waits; its avatar pulses (DESIGN "Turn flow and confirmation", Prompt). */
    asking?: boolean;
    /** Added by M3-P3: this player is speaking; the avatar shows a speaking ring (DESIGN "Chat and voice", Live voice). */
    speaking?: boolean;
    glyph: string;
    zones: { id: ZoneId; label: string; count: number }[];
    onlife: (delta: number) => void;
    oncounter: (kind: string, delta: number) => void;
    onopenzone: (zone: ZoneId) => void;
    /** Added by M3-P1: a tap on the name moves the camera to this seat (DESIGN "Camera and navigation": go to another seat, tap an avatar). */
    ongoto?: () => void;
    /** A spectator's view: life and counters are shown without the controls to change them (DESIGN "Players, seats and formats", Spectators: "cannot move cards"). */
    readonly?: boolean;
    /**
     * Added by the M3 gate fixes: a shorter panel for the column of other players at a four-seat table, so it fits the
     * screen layer's left column (DESIGN "Specification: geometry, layout and motion", Screen layer). Counters at zero
     * are left out and "+ counter" becomes a small button in the header.
     */
    compact?: boolean;
  } = $props();

  let editing = $state<string | null>(null);
  let newCounter = $state<string | null>(null);
  let lifeInput = $state<HTMLInputElement | undefined>();
  let counterInput = $state<HTMLInputElement | undefined>();

  const allCounters = $derived(Object.entries({ poison: 0, ...seat.counters }).sort(([a], [b]) => (a === 'poison' ? -1 : b === 'poison' ? 1 : a.localeCompare(b))));
  const counters = $derived(compact || readonly ? allCounters.filter(([, n]) => n !== 0) : allCounters);

  $effect(() => {
    if (editing !== null) lifeInput?.select();
  });
  $effect(() => {
    if (newCounter !== null) counterInput?.focus();
  });

  function commitLife() {
    const v = Number((editing ?? '').trim());
    editing = null;
    if (Number.isFinite(v) && Number.isInteger(v) && v !== life) onlife(v - life);
  }
  function wheel(e: WheelEvent) {
    if (readonly) return;
    e.preventDefault();
    if (e.deltaY < 0) onlife(1);
    else if (e.deltaY > 0) onlife(-1);
  }
</script>

<section
  class="avatar"
  class:active
  class:me
  class:away={seat.away === true}
  class:speaking
  class:compact
  data-speaking={speaking ? 'true' : 'false'}
  data-testid="avatar"
  data-seat={seat.id}
  data-line-seat={seat.id}
  data-away={seat.away === true ? 'true' : 'false'}
  aria-label="{seat.name}{me ? ' (you)' : ''}{seat.away ? ' (away)' : ''}" style:--seat="var(--sp-seat-{seat.colour}, #111)" style:--seat-ink="var(--sp-seat-{seat.colour}-ink, #fff)">
  <header>
    <span class="glyph {glyph}" aria-hidden="true"></span>
    {#if ongoto}
      <button type="button" class="name goto" data-testid="avatar-goto" title="Go to {me ? 'your' : 'this'} seat" onclick={ongoto}>{seat.name}</button>
    {:else}
      <span class="name">{seat.name}</span>
    {/if}
    {#if seat.away}<span class="tag away-tag" data-testid="away" title="Disconnected: public cards stay; hand and library are unavailable until this player returns">away</span>{/if}
    {#if active}<span class="tag" title="Active player">turn</span>{/if}
    {#if responding}<span class="tag" data-testid="responding">responding</span>{/if}
    {#if asking}<span class="tag asking" data-testid="asking">asks</span>{/if}
    {#if seat.autoPass}<span class="tag" title="Passing until end of turn">auto-pass</span>{/if}
    {#if compact && !readonly}<button type="button" class="add-small" aria-label="Add a counter" title="Add a counter" data-testid="add-counter" onclick={() => (newCounter = '')}>+</button>{/if}
  </header>
  <div class="life" onwheel={wheel}>
    {#if readonly}
      <span class="value" data-testid="life">{life}</span>
    {:else}
      <button type="button" aria-label="Lose 1 life" data-testid="life-minus" onclick={() => onlife(-1)}>−</button>
      {#if editing !== null}
        <input
          bind:this={lifeInput}
          class="life-input"
          data-testid="life-input"
          inputmode="numeric"
          aria-label="Life total"
          bind:value={editing}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitLife();
            else if (e.key === 'Escape') editing = null;
          }}
          onblur={() => (editing = null)}
        />
      {:else}
        <span class="value" data-testid="life" role="button" tabindex="0" title="Click ± or scroll to change; double-click to type" ondblclick={() => (editing = String(life))} onkeydown={(e) => e.key === 'F2' && (editing = String(life))}>{life}</span>
      {/if}
      <button type="button" aria-label="Gain 1 life" data-testid="life-plus" onclick={() => onlife(1)}>+</button>
    {/if}
  </div>
  {#if readonly}
    <ul class="counters">
      {#each counters as [kind, n] (kind)}
        <li data-testid="player-counter" data-kind={kind}><span>{kind}</span><span class="n">{n}</span></li>
      {/each}
    </ul>
  {:else}
    <ul class="counters">
      {#each counters as [kind, n] (kind)}
        <li data-testid="player-counter" data-kind={kind}>
          <span>{kind}</span>
          <button type="button" aria-label="Remove one {kind}" disabled={n <= 0 && kind === 'poison'} onclick={() => oncounter(kind, -1)}>−</button>
          <span class="n">{n}</span>
          <button type="button" aria-label="Add one {kind}" onclick={() => oncounter(kind, 1)}>+</button>
        </li>
      {/each}
      <li>
        {#if newCounter !== null}
          <input
            bind:this={counterInput}
            data-testid="counter-name"
            placeholder="energy, cmd:Ben…"
            aria-label="New counter name"
            bind:value={newCounter}
            onkeydown={(e) => {
              if (e.key === 'Enter' && newCounter?.trim()) {
                oncounter(newCounter.trim(), 1);
                newCounter = null;
              } else if (e.key === 'Escape') newCounter = null;
            }}
            onblur={() => (newCounter = null)}
          />
        {:else if !compact}
          <button type="button" class="add" onclick={() => (newCounter = '')}>+ counter</button>
        {/if}
      </li>
    </ul>
  {/if}
  <nav class="zones">
    {#each zones as z (z.id)}
      <button type="button" data-testid="zone-button" data-zone={z.id} onclick={() => onopenzone(z.id)}>{z.label} <b>{z.count}</b></button>
    {/each}
  </nav>
</section>

<style>
  .avatar {
    width: 150px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-left: 4px solid var(--seat);
    border-radius: var(--sp-radius-md, 4px);
    padding: 6px 8px;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
    pointer-events: auto;
  }
  .avatar.away {
    border-style: dashed;
    border-left-style: solid;
    color: var(--sp-muted, #5f5f5f);
  }
  .avatar.away .life,
  .avatar.away .counters {
    opacity: 0.6;
  }
  .away-tag {
    background: var(--sp-fg, #111);
    color: var(--sp-surface, #fff);
    border-color: var(--sp-fg, #111);
  }
  /* The speaking ring (M3-P3): a thick outline in the seat colour, so it reads without hue as well. */
  .avatar.speaking {
    outline: 3px solid var(--seat);
    outline-offset: 2px;
  }
  .avatar.active {
    border-color: var(--sp-fg, #111);
    border-left-color: var(--seat);
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .name {
    font-weight: var(--sp-font-weight-bold, 600);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .goto {
    background: none;
    border: 0;
    padding: 0;
    min-width: 0;
    text-align: left;
    color: inherit;
    font: inherit;
    font-weight: var(--sp-font-weight-bold, 600);
    cursor: pointer;
  }
  .goto:hover {
    text-decoration: underline;
  }
  .tag {
    font-variant: small-caps;
    border: 1px solid currentColor;
    border-radius: var(--sp-radius-sm, 2px);
    padding: 0 3px;
  }
  .tag.asking {
    animation: ask-pulse 900ms ease-in-out infinite alternate;
  }
  @keyframes ask-pulse {
    from {
      background: transparent;
    }
    to {
      background: var(--seat);
      color: var(--seat-ink);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tag.asking {
      animation: none;
      background: var(--seat);
      color: var(--seat-ink);
    }
  }
  .glyph {
    width: 10px;
    height: 10px;
    background: var(--seat);
    flex: none;
  }
  .glyph.circle {
    border-radius: 50%;
  }
  .glyph.triangle {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .glyph.diamond {
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
  .glyph.star {
    clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  }
  .glyph.hexagon {
    clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  }
  .glyph.cross {
    clip-path: polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%);
  }
  .glyph.ring {
    background: none;
    border: 3px solid var(--seat);
    border-radius: 50%;
    box-sizing: border-box;
  }
  .life {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 2px 0;
  }
  .value {
    font-size: 28px;
    font-weight: var(--sp-font-weight-bold, 600);
    min-width: 2.2em;
    text-align: center;
    cursor: ns-resize;
    font-variant-numeric: tabular-nums;
  }
  .compact .value {
    font-size: 20px;
  }
  .compact .life {
    margin: 0;
  }
  .add-small {
    margin-left: auto;
    color: var(--sp-muted, #5f5f5f);
    line-height: 1.2;
  }
  .life-input {
    width: 3em;
    font-size: 22px;
    text-align: center;
  }
  button {
    font: inherit;
    background: none;
    color: inherit;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    cursor: pointer;
    padding: 0 5px;
  }
  .counters {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .counters li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .counters li > span:first-child {
    flex: 1;
  }
  .n {
    min-width: 1.5em;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .add {
    border: 0;
    color: var(--sp-muted, #5f5f5f);
    padding: 0;
  }
  .counters input {
    width: 100%;
    font: inherit;
  }
  .zones {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }
  .zones button {
    font-size: 11px;
  }
</style>
