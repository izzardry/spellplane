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
    glyph,
    zones,
    onlife,
    oncounter,
    onopenzone,
  }: {
    seat: Seat;
    life: number;
    me: boolean;
    active: boolean;
    responding: boolean;
    glyph: string;
    zones: { id: ZoneId; label: string; count: number }[];
    onlife: (delta: number) => void;
    oncounter: (kind: string, delta: number) => void;
    onopenzone: (zone: ZoneId) => void;
  } = $props();

  let editing = $state<string | null>(null);
  let newCounter = $state<string | null>(null);
  let lifeInput = $state<HTMLInputElement | undefined>();
  let counterInput = $state<HTMLInputElement | undefined>();

  const counters = $derived(Object.entries({ poison: 0, ...seat.counters }).sort(([a], [b]) => (a === 'poison' ? -1 : b === 'poison' ? 1 : a.localeCompare(b))));

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
    e.preventDefault();
    if (e.deltaY < 0) onlife(1);
    else if (e.deltaY > 0) onlife(-1);
  }
</script>

<section class="avatar" class:active class:me data-testid="avatar" data-seat={seat.id} aria-label="{seat.name}{me ? ' (you)' : ''}" style:--seat="var(--sp-seat-{seat.colour}, #111)">
  <header>
    <span class="glyph {glyph}" aria-hidden="true"></span>
    <span class="name">{seat.name}</span>
    {#if active}<span class="tag" title="Active player">turn</span>{/if}
    {#if responding}<span class="tag" data-testid="responding">responding</span>{/if}
    {#if seat.autoPass}<span class="tag" title="Passing until end of turn">auto-pass</span>{/if}
  </header>
  <div class="life" onwheel={wheel}>
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
  </div>
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
      {:else}
        <button type="button" class="add" onclick={() => (newCounter = '')}>+ counter</button>
      {/if}
    </li>
  </ul>
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
  .tag {
    font-variant: small-caps;
    border: 1px solid currentColor;
    border-radius: var(--sp-radius-sm, 2px);
    padding: 0 3px;
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
