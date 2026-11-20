<!--
  The booster setup sheet (journey.md 4.4; decks.md D3, D8): for a booster deck (`mode: 'deck'`) only the set and the
  number of packs (3 to 12, default 6); for a draft night (`mode: 'draft'`) also how (booster draft or sealed), picks
  per pass and the pick timer. The set stepper goes through the latest core set first, then the other core sets, then
  every other set with booster data, newest first. The value is a BoosterSetup; `onchange` reports every change, DONE
  (or OPEN in `deck` mode, through `onopen`) closes. Implementer: M8-P3.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { boosterSetOrder, FEATURED_SET_INFO, latestCoreSet } from '../../data/sets';
  import type { SetDataSource, SetSummary } from '../../data/types';
  import type { BoosterSetup } from '../../store/types';
  import BoosterFan from '../design/BoosterFan.svelte';
  import Button from '../design/Button.svelte';
  import Segmented from '../design/Segmented.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import Stepper from '../design/Stepper.svelte';

  let {
    value,
    mode,
    sets = null,
    onchange = undefined,
    onclose = undefined,
    onopen = undefined,
    busy = false,
    failure = null,
  }: {
    value: BoosterSetup;
    mode: 'deck' | 'draft';
    /** The set list (MTGJSON); the featured sets are listed without it. */
    sets?: SetDataSource | null;
    onchange?: ((value: BoosterSetup) => void) | undefined;
    onclose?: (() => void) | undefined;
    /** `deck` mode: OPEN with the value. */
    onopen?: ((value: BoosterSetup) => void) | undefined;
    busy?: boolean;
    /** Why the last OPEN failed (no booster data for the set, or no connection). */
    failure?: string | null;
  } = $props();

  let list = $state.raw<SetSummary[]>(boosterSetOrder(FEATURED_SET_INFO));
  let latest = $state<string>(latestCoreSet(FEATURED_SET_INFO));

  onMount(() => {
    if (!sets) return;
    void sets
      .listSets()
      .then((s) => {
        if (s.length === 0) return;
        list = boosterSetOrder(s);
        latest = latestCoreSet(s);
      })
      .catch(() => undefined);
  });

  const range = $derived(mode === 'deck' ? { min: 3, max: 12 } : { min: 1, max: 6 });
  const set = $derived(value.sets[0] ?? latest);
  const index = $derived(Math.max(0, list.findIndex((s) => s.code === set)));
  const info = $derived(list.find((s) => s.code === set) ?? null);
  const sub = $derived(set === latest ? 'latest core set' : info ? info.releaseDate.slice(0, 4) : '');

  function change(next: Partial<BoosterSetup>): void {
    const v = { ...value, ...next };
    onchange?.(v);
  }
  function stepSet(d: number): void {
    if (list.length === 0) return;
    const next = list[(index + d + list.length) % list.length]!;
    change({ sets: [next.code] });
  }
  function stepPacks(d: number): void {
    change({ packs: Math.min(range.max, Math.max(range.min, value.packs + d)) });
  }
</script>

<div class="ds-scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose?.()}>
  <div
    data-ds-layer="sheet"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="ds-sheet setup"
    aria-label="Boosters"
    data-testid="booster-setup"
    data-mode={mode}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose?.();
      }
    }}
  >
    <div class="ds-sheet__head">
      <h2 class="ds-t-title">Boosters</h2>
      {#if onclose}<Button variant="quiet" size="sm" aria-label="Close" onclick={onclose}>×</Button>{/if}
    </div>
    <div class="fan"><BoosterFan sets={Array.from({ length: Math.min(3, value.packs) }, () => set)} count={value.packs} width={80} label="{value.packs} boosters of {set}" /></div>
    {#if mode === 'draft'}
      <div class="row">
        <span class="ds-t-eyebrow">How</span>
        <Segmented
          label="How"
          value={value.how === 'sealed' ? 'sealed' : 'pass'}
          onchange={(v) => change({ how: v as BoosterSetup['how'] })}
          data-testid="setup-how"
          options={[
            { value: 'pass', label: 'Booster draft' },
            { value: 'sealed', label: 'Sealed' },
          ]}
        />
      </div>
    {/if}
    <Stepper eyebrow="Set · {sub}" value="{info?.name ?? set} ({set})" onprev={() => stepSet(-1)} onnext={() => stepSet(1)} prevLabel="Previous set" nextLabel="Next set" data-testid="setup-set" />
    <Stepper
      eyebrow={mode === 'deck' ? `about ${value.packs * 14} cards for a 40-card deck` : 'per player'}
      value="{value.packs} packs"
      onprev={() => stepPacks(-1)}
      onnext={() => stepPacks(1)}
      prevLabel="Fewer packs"
      nextLabel="More packs"
      data-testid="setup-packs"
    />
    {#if mode === 'draft' && value.how !== 'sealed'}
      <Stepper eyebrow="Picks per pass" value={String(value.picks)} onprev={() => change({ picks: Math.max(1, value.picks - 1) })} onnext={() => change({ picks: Math.min(3, value.picks + 1) })} prevLabel="Fewer picks" nextLabel="More picks" />
      <div class="row">
        <span class="ds-t-eyebrow">Timer</span>
        <Segmented
          label="Pick timer"
          value={value.pickTimer ? 'on' : 'off'}
          onchange={(v) => change({ pickTimer: v === 'on' })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
      </div>
    {/if}
    {#if failure}<StatusLine tone="danger" data-testid="setup-failure">{failure}</StatusLine>{/if}
    <div class="ds-sheet__foot">
      {#if mode === 'deck' && onopen}
        <Button variant="primary" size="lg" data-testid="setup-open" disabled={busy} waiting={busy} onclick={() => onopen?.(value)}>{busy ? 'Opening…' : 'Open'}</Button>
      {:else}
        <Button variant="primary" data-testid="setup-done" onclick={() => onclose?.()}>Done</Button>
      {/if}
    </div>
  </div>
</div>

<style>
  .setup {
    width: min(480px, calc(100vw - 32px));
    align-items: stretch;
  }
  .fan {
    display: flex;
    justify-content: center;
    min-height: 150px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-md);
  }
  .ds-sheet__foot {
    justify-content: center;
  }
</style>
