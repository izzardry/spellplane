<!--
  A life total (docs/design/m7-hud-proposal.md, My plate and Life steppers; PLAN Milestone 7, Owner decisions: "life
  totals you click or scrub"; DESIGN "Turn flow and confirmation", Life and player counters). Large numerals; − and +
  beside them on hover or focus (always on a touch screen); drag on the number to scrub (up or right gains); a click or
  Enter types a value; arrow keys step it. One life change is dispatched per scrub, on release.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../design/Icon.svelte';
  import { LifeScrub } from './scrub';

  let { life, name, readonly = false, size = 'large', onlife }: { life: number; name: string; readonly?: boolean; size?: 'large' | 'small'; onlife: (delta: number) => void } = $props();

  let editing = $state<string | null>(null);
  let input = $state<HTMLInputElement | undefined>();
  /** Points scrubbed so far in a running scrub (shown live), else 0. */
  let pending = $state(0);
  let scrubbing = $state(false);
  const scrub = new LifeScrub();

  async function edit(): Promise<void> {
    editing = String(life);
    await tick();
    input?.select();
  }
  function commit(): void {
    if (editing === null) return;
    const text = editing.trim();
    const v = Number(text);
    editing = null;
    if (text !== '' && Number.isFinite(v) && Number.isInteger(v) && v !== life) onlife(v - life);
  }
  function down(e: PointerEvent): void {
    if (readonly || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    scrub.down(e.clientX, e.clientY, e.timeStamp);
  }
  function move(e: PointerEvent): void {
    if (!scrub.active) return;
    const steps = scrub.move(e.clientX, e.clientY);
    if (scrub.scrubbing !== scrubbing) scrubbing = scrub.scrubbing;
    if (steps !== pending) pending = steps;
  }
  function up(e: PointerEvent): void {
    if (!scrub.active) return;
    const r = scrub.up(e.clientX, e.clientY, e.timeStamp);
    pending = 0;
    scrubbing = false;
    if (r.kind === 'scrub') onlife(r.steps);
    else if (r.kind === 'click') void edit();
  }
  function cancel(): void {
    scrub.cancel();
    pending = 0;
    scrubbing = false;
  }
  function key(e: KeyboardEvent): void {
    if (readonly) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onlife(1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onlife(-1);
    else if (e.key === 'PageUp') onlife(5);
    else if (e.key === 'PageDown') onlife(-5);
    else if (e.key === 'Enter' || e.key === 'F2') void edit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function wheel(e: WheelEvent): void {
    if (readonly) return;
    e.preventDefault();
    if (e.deltaY < 0) onlife(1);
    else if (e.deltaY > 0) onlife(-1);
  }
</script>

<div class="life {size}" class:readonly class:scrubbing data-testid="life-plate" onwheel={wheel}>
  {#if !readonly}
    <button type="button" class="ds-btn ds-btn--quiet sp-h-xs step" aria-label="Lose 1 life" title="Lose 1 life" data-testid="life-minus" onclick={() => onlife(-1)}><Icon name="minus" size={16} /></button>
  {/if}
  {#if editing !== null}
    <input
      bind:this={input}
      class="value ds-numeral"
      data-testid="life-input"
      inputmode="numeric"
      enterkeyhint="done"
      aria-label="{name}'s life total"
      bind:value={editing}
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') editing = null;
      }}
      onblur={() => commit()}
    />
  {:else if readonly}
    <span class="value ds-numeral" data-testid="life" aria-label="{name}: {life} life">{life}</span>
  {:else}
    <span
      class="value ds-numeral ds-focusable"
      data-testid="life"
      role="spinbutton"
      tabindex="0"
      aria-label="{name}'s life"
      aria-valuenow={life + pending}
      aria-valuetext="{life + pending} life"
      title="Drag up or down to change, click to type"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={cancel}
      onlostpointercapture={() => scrub.active && cancel()}
      ondblclick={() => void edit()}
      onkeydown={key}>{life + pending}</span
    >
    {#if pending !== 0}<span class="delta" aria-hidden="true">{pending > 0 ? `+${pending}` : pending}</span>{/if}
  {/if}
  {#if !readonly}
    <button type="button" class="ds-btn ds-btn--quiet sp-h-xs step" aria-label="Gain 1 life" title="Gain 1 life" data-testid="life-plus" onclick={() => onlife(1)}><Icon name="plus" size={16} /></button>
  {/if}
</div>

<style>
  .life {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .value {
    display: inline-block;
    min-width: 1.6em;
    text-align: center;
    font-size: var(--ds-type-display);
    line-height: 1;
    color: var(--ds-ink);
    cursor: ns-resize;
    touch-action: none;
    border-radius: var(--ds-radius-sm);
  }
  .large .value {
    font-size: var(--ds-type-display);
  }
  .small .value {
    font-size: var(--ds-type-heading);
    min-width: 1.4em;
  }
  .readonly .value {
    cursor: default;
  }
  input.value {
    width: 2.6em;
    padding: 0;
    border: 1px solid var(--ds-focus);
    background: var(--ds-panel-raised);
    font-family: var(--ds-font-numeral);
    font-size: var(--ds-type-heading);
    cursor: text;
  }
  .scrubbing .value {
    transform: scale(1.08);
  }
  .delta {
    position: absolute;
    top: -14px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--ds-type-small);
    font-weight: var(--ds-weight-bold);
    color: var(--ds-ink);
  }
  .step {
    display: inline-grid;
    place-items: center;
    width: var(--ds-control-xs);
    height: var(--ds-control-xs);
    min-height: var(--ds-control-xs);
    padding: 0;
    border-radius: 50%;
    background: var(--ds-chip);
    box-shadow: none;
    opacity: 0;
    transition: opacity var(--ds-duration-fast) var(--ds-ease-standard);
    pointer-events: auto;
  }
  .life:hover .step,
  .life:focus-within .step {
    opacity: 1;
  }
  /* A touch screen has no hover: the steppers stay (docs/design/m7-hud-proposal.md, iPad: 44 pt targets). */
  @media (hover: none) {
    .step {
      opacity: 1;
      width: var(--ds-control-md);
      height: var(--ds-control-md);
      min-height: var(--ds-control-md);
    }
  }
  :global(.touch-ui) .step {
    opacity: 1;
    width: var(--ds-control-md);
    height: var(--ds-control-md);
    min-height: var(--ds-control-md);
  }
</style>
