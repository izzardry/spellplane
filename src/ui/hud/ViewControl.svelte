<!--
  The View control: the tilt's visible handle (docs/design/m8/m7-adjustments.md, M7-P2 "HUD layout", top right: "a click
  cycles first person → middle → bird's-eye (tiltPresets); press and drag vertically scrubs the tilt (setTilt), 200 px
  for the full range"). A drag of less than 4 px is a click. Arrow keys on the focused control step the tilt by a tenth.
  It writes nothing per frame: one setTilt per pointer move, the scene eases.
-->
<script lang="ts">
  import Icon from '../design/Icon.svelte';
  import { clampTilt, type TiltControls } from '../../scene/types';
  import { nextPreset, SCRUB_RANGE_PX } from './view';

  let { camera }: { camera: () => TiltControls | null } = $props();

  let drag: { id: number; y: number; from: number; moved: boolean } | null = null;

  function down(e: PointerEvent): void {
    const cam = camera();
    if (!cam || e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, from: cam.tilt(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent): void {
    const cam = camera();
    if (!drag || !cam || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    // Up raises the eye toward bird's-eye (drag the view up and over the table).
    cam.setTilt(clampTilt(drag.from - dy / SCRUB_RANGE_PX), { source: 'handle', animate: false });
  }
  function up(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) cycle();
  }
  function cycle(): void {
    const cam = camera();
    if (!cam) return;
    cam.setTilt(nextPreset(cam.tiltPresets(), cam.tilt()).tilt, { source: 'preset' });
  }
  function key(e: KeyboardEvent): void {
    const cam = camera();
    if (!cam) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      cam.setTilt(clampTilt(cam.tilt() + (e.key === 'ArrowUp' ? 0.1 : -0.1)), { source: 'handle' });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      cycle();
    }
  }
</script>

<button
  type="button"
  class="ds-btn ds-icon-btn sp-h-md sp-round view"
  data-testid="view-control"
  aria-label="View: click for the next view, drag up or down to tilt"
  title="View: click for first person, leaning in or bird's-eye; drag up or down to tilt"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  onkeydown={key}><Icon name="view" /></button
>

<style>
  .view {
    pointer-events: auto;
    touch-action: none;
  }
</style>
