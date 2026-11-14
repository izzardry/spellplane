<!--
  The owner's hand as a screen-anchored fan (DESIGN "Table model": screen-anchored fan for the owner; "Specification:
  geometry, layout and motion", Screen layer; "Camera and navigation": dragging a card from the hand crosses into the
  scene at the cursor's table position). On a touch screen (M5-P1; DESIGN "Input and interaction design", Touch: "The
  hand fan scrolls horizontally and lifts cards on touch for reading"): a finger on a card lifts it and it stays lifted
  until a press elsewhere; sliding sideways scrolls the fan (or moves the lift to the card under the finger); dragging
  up out of the fan plays the card into the scene; a long-press opens the radial menu for it.
-->
<script lang="ts">
  import type { CardRef, InstanceId } from '../core/types';
  import type { FaceSource } from '../data/types';
  import type { TextureSource } from '../util/texture';
  import { onDestroy } from 'svelte';
  import { createTouchRecognizer, TOUCH, type TouchGesture } from '../scene/input/touch';
  import { recordGesture } from '../scene/input/pointers';
  import CardFace from './CardFace.svelte';
  import { fanLayout } from './hand';
  import { fanIndexAt, touchFanLayout } from './touch/fan';
  import { NO_EDGE_INSETS, type EdgeInsets } from './touch/radial';

  let {
    ids,
    refOf,
    nameOf,
    faces,
    back,
    hovered,
    focused = null,
    selection,
    vw,
    vh,
    onhover,
    oncontext,
    oninspect,
    ondragout,
    onselect,
    touch = false,
    onradial,
    insets = NO_EDGE_INSETS,
  }: {
    ids: InstanceId[];
    refOf: (id: InstanceId) => CardRef | null;
    nameOf: (id: InstanceId) => string;
    faces: FaceSource;
    back: TextureSource | null;
    hovered: InstanceId | null;
    /** The keyboard-focused card (M5-P4): a dashed focus outline, distinct from the hover lift and the selection. */
    focused?: InstanceId | null;
    selection: readonly InstanceId[];
    vw: number;
    vh: number;
    onhover: (id: InstanceId | null) => void;
    oncontext: (id: InstanceId, x: number, y: number) => void;
    oninspect: (id: InstanceId) => void;
    ondragout: (id: InstanceId, x: number, y: number) => void;
    onselect: (id: InstanceId) => void;
    /** A touch screen: the fan keeps every card a touch target wide and scrolls (ui/touch/fan.ts). */
    touch?: boolean;
    /** A long-press on a card (touch): open the radial menu for it at (x, y); null closes it. */
    onradial?: (id: InstanceId | null, x: number, y: number) => void;
    /** The device's safe-area insets, CSS px (the fan sits above the bottom one and between the side ones). */
    insets?: EdgeInsets;
  } = $props();

  const hoveredIndex = $derived(hovered ? ids.indexOf(hovered) : -1);
  /** Sideways scroll of a touch fan, CSS px (clamped by the layout). */
  let scroll = $state(0);
  const touchFan = $derived(touch ? touchFanLayout(ids.length, vw, vh, hoveredIndex >= 0 ? hoveredIndex : null, scroll, insets) : null);
  const boxes = $derived(touchFan ? touchFan.boxes : fanLayout(ids.length, vw, vh, hoveredIndex >= 0 ? hoveredIndex : null));
  /** Top edge of the resting fan (raised by the bottom safe-area inset); a drag that rises above it leaves the hand. */
  const fanTop = $derived(vh - Math.max(0, insets.bottom) - vh * 0.22);

  let drag: { id: InstanceId; x: number; y: number; pointer: number } | null = null;
  let dragging = $state<InstanceId | null>(null);

  // --- Touch (M5-P1) -----------------------------------------------------------------------------------------------
  /** The card a finger pressed and what its slide does: scroll the fan, or wait to leave it upward (play the card). */
  let finger: { id: InstanceId; pointer: number; mode: 'press' | 'scroll' | 'lift' | 'out'; scroll0: number } | null = null;
  /** The card a finger lifted (it stays lifted until a press elsewhere). */
  let lifted: InstanceId | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** When a finger last touched the fan (performance.now()). */
  let lastTouch = -Infinity;
  const recognizer = createTouchRecognizer((g) => {
    recordGesture(g);
    onFanGesture(g);
  });

  function touchDown(e: PointerEvent, id: InstanceId) {
    if (finger && finger.pointer !== e.pointerId) return;
    lastTouch = performance.now();
    finger = { id, pointer: e.pointerId, mode: 'press', scroll0: scroll };
    lifted = id;
    onhover(id);
    recognizer.down({ id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => recognizer.tick(performance.now()), TOUCH.longPressMs + 20);
  }
  function touchMove(e: PointerEvent) {
    if (finger?.pointer === e.pointerId) recognizer.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });
  }
  function touchEnd(e: PointerEvent) {
    if (finger?.pointer !== e.pointerId) return;
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    if (e.type === 'pointercancel') recognizer.cancel(s);
    else recognizer.up(s);
    finger = null;
    dragging = null;
    lastTouch = performance.now();
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  /** The fan's boxes without a lifted card (where the cards are, for the card under a finger). */
  const flatBoxes = () => (touch ? touchFanLayout(ids.length, vw, vh, null, scroll, insets).boxes : fanLayout(ids.length, vw, vh, null));

  function onFanGesture(g: TouchGesture) {
    const f = finger;
    if (!f) return;
    if (g.kind === 'longPress') {
      onradial?.(f.id, g.at.x, g.at.y);
      return;
    }
    if (g.kind !== 'drag' && g.kind !== 'longPressDrag') return;
    if (g.phase === 'start') {
      if (g.kind === 'longPressDrag') onradial?.(null, g.at.x, g.at.y);
      // The first direction decides: sideways scrolls the fan, otherwise the card may leave it upward.
      f.mode = Math.abs(g.at.x - g.start.x) > Math.abs(g.at.y - g.start.y) && g.kind === 'drag' ? 'scroll' : 'lift';
      f.scroll0 = scroll;
    }
    if (g.phase !== 'start' && g.phase !== 'move') return;
    if (f.mode === 'scroll') {
      if (touchFan && touchFan.maxScroll > 0) scroll = Math.min(Math.max(0, f.scroll0 - (g.at.x - g.start.x)), touchFan.maxScroll);
      // The lift follows the card under the finger (the same card while the fan scrolls with it).
      const i = fanIndexAt(flatBoxes(), g.at.x);
      const id = i >= 0 ? ids[i] : undefined;
      if (id && id !== lifted) {
        lifted = id;
        f.id = id;
        onhover(id);
      }
    } else if (f.mode === 'lift' && g.at.y < fanTop - 4) {
      f.mode = 'out';
      dragging = f.id;
      lifted = null;
      onhover(null);
      ondragout(f.id, g.at.x, g.at.y);
    }
  }

  /** A press anywhere but on the fan lowers the card a finger lifted. */
  function pressElsewhere(e: PointerEvent) {
    if (!lifted) return;
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('[data-testid="hand-card"]')) return;
    if (hovered === lifted) onhover(null);
    lifted = null;
  }

  onDestroy(() => {
    if (longPressTimer) clearTimeout(longPressTimer);
    recognizer.reset();
  });

  function down(e: PointerEvent, id: InstanceId) {
    if (e.pointerType === 'touch') {
      touchDown(e, id);
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey) {
      onselect(id);
      return;
    }
    drag = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  }
  function move(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touchMove(e);
      return;
    }
    if (!drag || e.pointerId !== drag.pointer) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (moved > 6 && e.clientY < fanTop - 4) {
      const id = drag.id;
      drag = null;
      dragging = id;
      onhover(null);
      ondragout(id, e.clientX, e.clientY);
    }
  }
  function up(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touchEnd(e);
      return;
    }
    drag = null;
    dragging = null;
  }
  function aux(e: MouseEvent, id: InstanceId) {
    if (e.button === 1) {
      e.preventDefault();
      oninspect(id);
    }
  }
</script>

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} onpointerdowncapture={pressElsewhere} />

<div class="hand" class:touch data-testid="hand" role="group" aria-label="Your hand" data-scroll={touchFan ? Math.round(touchFan.scroll) : 0} data-max-scroll={touchFan ? Math.round(touchFan.maxScroll) : 0}>
  {#each ids as id, i (id)}
    {@const box = boxes[i]}
    {#if box}
      <div
        class="card"
        class:hovered={id === hovered}
        class:focused={id === focused}
        data-focused={id === focused ? 'true' : undefined}
        class:selected={selection.includes(id)}
        class:dragging={id === dragging}
        data-testid="hand-card"
        data-card={id}
        role="button"
        tabindex="-1"
        aria-label={nameOf(id)}
        style:left="{box.left}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        style:z-index={box.z}
        onpointerenter={(e) => e.pointerType !== 'touch' && onhover(id)}
        onpointerleave={(e) => e.pointerType !== 'touch' && hovered === id && onhover(null)}
        onpointerdown={(e) => down(e, id)}
        oncontextmenu={(e) => {
          e.preventDefault();
          // A long touch has its own menu (the radial menu): the context menu some browsers add to it is not opened.
          if (finger || performance.now() - lastTouch < 800) return;
          oncontext(id, e.clientX, e.clientY);
        }}
        onmousedown={(e) => e.button === 1 && e.preventDefault()}
        onauxclick={(e) => aux(e, id)}
      >
        <CardFace {faces} cardRef={refOf(id)} {back} tier={id === hovered ? 'normal' : 'small'} alt={nameOf(id)} />
      </div>
    {/if}
  {/each}
</div>

<style>
  .hand {
    position: fixed;
    left: 0;
    right: 0;
    /* Above the iPad's home indicator (PLAN Milestone 5, owner decisions: safe-area insets respected). */
    bottom: env(safe-area-inset-bottom, 0px);
    height: 0;
    pointer-events: none;
    z-index: 20;
  }
  .card {
    position: absolute;
    bottom: 0;
    pointer-events: auto;
    transition:
      width 120ms ease-out,
      height 120ms ease-out,
      left 120ms ease-out;
    box-shadow: 0 0 0 1px var(--sp-border, #d8d8d8);
    border-radius: 4.76% / 3.41%;
    cursor: grab;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .card.hovered {
    box-shadow: 0 0 0 2px var(--sp-fg, #111);
  }
  .card.selected {
    box-shadow: 0 0 0 3px var(--sp-focus, #1f6fd1);
  }
  /* Keyboard focus (M5-P4): a dashed outline a little outside the card, like the table's focus ring; hover is a solid
     edge and selection a solid ring, so the three read apart. Never on the face. */
  .card.focused {
    outline: 3px dashed var(--sp-focus, #1f6fd1);
    outline-offset: 4px;
  }
  .card.dragging {
    opacity: 0.35;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
</style>
