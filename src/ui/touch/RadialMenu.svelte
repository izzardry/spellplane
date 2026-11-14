<!--
  The long-press radial menu (DESIGN "Input and interaction design", Touch: "long-press opens a radial menu with the
  eight most used actions"; PLAN Milestone 5, owner decisions: tap/untap, flip, inspect, +1/+1 counter, to hand, to
  graveyard, exile, to stack). Eight thumb-sized slots around the long-press point; a slot that does not apply to the
  card is shown disabled. The centre opens the card's full context menu, so every other card action stays reachable by
  touch. A press anywhere outside closes it, as does Esc.
-->
<script lang="ts">
  import type { InstanceId } from '../../core/types';
  import type { ActionId } from '../../games/types';
  import type { RadialSlot } from './actions';
  import { RADIAL_RADIUS_PX, RADIAL_SLOT_PX, radialLayout, slotAction, type EdgeInsets } from './radial';

  let {
    card,
    title,
    at,
    vw,
    vh,
    insets,
    applies,
    onrun,
    onmore,
    onclose,
  }: {
    card: InstanceId;
    title: string;
    at: { x: number; y: number };
    vw: number;
    vh: number;
    insets: EdgeInsets;
    applies: (action: ActionId) => boolean;
    onrun: (card: InstanceId, action: ActionId) => void;
    onmore: (card: InstanceId, x: number, y: number) => void;
    onclose: () => void;
  } = $props();

  const layout = $derived(radialLayout(at, vw, vh, insets));
  let el = $state<HTMLElement | undefined>();
  /**
   * The menu opens under the finger that long-pressed: the click a browser may send when that finger lifts must not
   * pick a slot. Only a press that starts on the menu after it opened (or a keyboard activation) runs anything.
   */
  let armed = false;

  function outside(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) onclose();
  }
  function pick(e: MouseEvent, slot: RadialSlot) {
    if (!armed && e.detail > 0) return;
    const action = slotAction(slot, applies);
    if (!action) return;
    // Read before closing: closing unmounts the menu and its props.
    const c = card;
    onclose();
    onrun(c, action);
  }
  function more(e: MouseEvent) {
    if (!armed && e.detail > 0) return;
    const c = card;
    const { x, y } = layout.centre;
    onclose();
    onmore(c, x, y);
  }
</script>

<svelte:window onpointerdown={outside} />

<div
  class="radial"
  role="menu"
  aria-label={title}
  data-testid="radial-menu"
  tabindex="-1"
  bind:this={el}
  style:--slot="{RADIAL_SLOT_PX}px"
  style:--radius="{RADIAL_RADIUS_PX}px"
  onpointerdown={() => (armed = true)}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="ring" style:left="{layout.centre.x}px" style:top="{layout.centre.y}px"></div>
  {#each layout.slots as s (s.slot.id)}
    {@const enabled = slotAction(s.slot, applies) !== null}
    <button
      type="button"
      role="menuitem"
      class="slot"
      data-testid="radial-{s.slot.id}"
      data-slot={s.slot.id}
      disabled={!enabled}
      aria-label={s.slot.label}
      style:left="{s.x}px"
      style:top="{s.y}px"
      onclick={(e) => pick(e, s.slot)}>{s.slot.label}</button
    >
  {/each}
  <button type="button" role="menuitem" class="slot more" data-testid="radial-more" aria-label="More actions" style:left="{layout.centre.x}px" style:top="{layout.centre.y}px" onclick={more}>⋯</button>
</div>

<style>
  .radial {
    position: fixed;
    inset: 0;
    z-index: 62;
    pointer-events: none;
  }
  .ring {
    position: absolute;
    width: calc(2 * var(--radius) + var(--slot));
    height: calc(2 * var(--radius) + var(--slot));
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: color-mix(in srgb, var(--sp-surface, #fff) 70%, transparent);
    border: 1px solid var(--sp-border, #d8d8d8);
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.18);
    pointer-events: auto;
  }
  .slot {
    position: absolute;
    width: var(--slot);
    height: var(--slot);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px solid var(--sp-fg, #111);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font: 600 10px / 1.1 var(--sp-font, system-ui);
    padding: 2px;
    text-align: center;
    pointer-events: auto;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
  }
  .slot:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .slot.more {
    width: 44px;
    height: 44px;
    font-size: 18px;
    border-color: var(--sp-border, #d8d8d8);
  }
</style>
