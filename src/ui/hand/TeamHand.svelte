<!--
  The teammate's hand as a second, smaller fan above the player's own (DESIGN "Players, seats and formats",
  Two-Headed Giant: "Each teammate's hand is visible live to the other, shown as a second, smaller fan above the
  player's own"; "Specification: network protocol and secrecy", Commitments: a card that does not match its owner's
  commitment is flagged, never shown as genuine). Read-only: the cards are the teammate's to play. Middle-click or
  Enter inspects a card. M3-P2.
-->
<script lang="ts">
  import CardFace from '../CardFace.svelte';
  import { TEAM_FAN_HEIGHT, type TeamHandProps } from '../types';
  import { teamFanBottom, teamFanLayout } from './team';

  let { seat, state: table, cards, faces, inspect, vw, vh }: TeamHandProps & { vw: number; vh: number } = $props();

  let hovered = $state<string | null>(null);
  const hoveredIndex = $derived(hovered === null ? -1 : cards.findIndex((c) => c.id === hovered));
  const boxes = $derived(teamFanLayout(cards.length, vw, vh, hoveredIndex >= 0 ? hoveredIndex : null));
  const owner = $derived(table.seats[seat]);
  const label = $derived(`${owner?.name || seat}'s hand`);
</script>

<div class="team-hand" data-testid="team-hand" data-seat={seat} aria-label={label} role="group" style:--seat="var(--sp-seat-{owner?.colour ?? 0}, #111)">
  {#if cards.length > 0}
    <div class="label" style:bottom="{teamFanBottom(vh) + vh * TEAM_FAN_HEIGHT + 4}px" data-testid="team-hand-label">
      <span class="dot" aria-hidden="true"></span>{label} · {cards.length}
    </div>
  {/if}
  {#each cards as c, i (c.id)}
    {@const box = boxes[i]}
    {#if box}
      <div
        class="card"
        class:suspect={!c.verified}
        data-testid="team-hand-card"
        data-card={c.id}
        data-sid={c.ref.sid}
        data-verified={c.verified ? 'true' : 'false'}
        role="button"
        tabindex="0"
        aria-label={c.verified ? `${label}: card ${i + 1}` : `${label}: card ${i + 1}, does not match the deck commitment`}
        style:left="{box.left}px"
        style:bottom="{box.bottom}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        style:z-index={box.z}
        onpointerenter={() => (hovered = c.id)}
        onpointerleave={() => hovered === c.id && (hovered = null)}
        onmousedown={(e) => e.button === 1 && e.preventDefault()}
        onauxclick={(e) => {
          if (e.button === 1) inspect?.(c.ref);
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') inspect?.(c.ref);
        }}
      >
        <CardFace {faces} cardRef={c.ref} tier={c.id === hovered ? 'normal' : 'small'} alt={label} />
        {#if !c.verified}<span class="badge" title="Does not match the deck commitment">?</span>{/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .team-hand {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0;
    pointer-events: none;
    z-index: 19;
  }
  .label {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font: 12px/1.2 system-ui, sans-serif;
    color: var(--sp-fg, #111);
    background: var(--sp-panel, rgba(255, 255, 255, 0.85));
    border: 1px solid var(--seat);
    border-radius: 4px;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--seat);
    margin-right: 4px;
  }
  .card {
    position: absolute;
    pointer-events: auto;
    transition:
      width 120ms ease-out,
      height 120ms ease-out,
      left 120ms ease-out;
    box-shadow: 0 0 0 1px var(--seat);
    border-radius: 4.76% / 3.41%;
  }
  .card.suspect {
    box-shadow: 0 0 0 3px var(--sp-warn, #c62828);
  }
  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    background: var(--sp-warn, #c62828);
    color: #fff;
    font: bold 11px/16px system-ui, sans-serif;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
</style>
