<!--
  A deck tile (visual.md 2.8 "Deck tile", mock board 2; decks.md section 3 D1 with the ruling "no summary panel"):
  220 × 268, a dotted well with the whole cover card (96 px, −3°) and one card back behind it, the seal band of a
  booster deck below the cover card's lower edge (contracts.md Part G "Decks" item 5), then the name, the pips, size,
  kind and strength, and a meta line with the curve sparkline. Click selects; double-click or Enter opens; the action
  row (PLAY, EDIT, ⋯) shows on hover, on keyboard focus and on the selected tile. With `locked` (the picker's `allow`
  refused) text and well dim and a badge gives the reason; the card face keeps full opacity (Part G item 4).
  Implementer: M8-P3.
-->
<script lang="ts">
  import { bandNumber } from '../../../data/deck/strength';
  import { isOpening } from '../../../data/deck/seal';
  import { countNote, sizeOf } from '../../../data/deck/summary';
  import type { FaceSource } from '../../../data/types';
  import type { DeckRecord } from '../../../store/types';
  import Badge from '../../design/Badge.svelte';
  import Button from '../../design/Button.svelte';
  import IconButton from '../../design/IconButton.svelte';
  import Pip from '../../design/Pip.svelte';
  import SealBand from '../../design/SealBand.svelte';
  import Sparkline from '../../design/Sparkline.svelte';
  import StrengthPips from '../../design/StrengthPips.svelte';
  import CardImage from './CardImage.svelte';

  let {
    deck,
    faces,
    selected = false,
    playing = false,
    locked = null,
    actions = true,
    onselect,
    onopen = undefined,
    onplay = undefined,
    onmenu = undefined,
  }: {
    deck: DeckRecord;
    faces: FaceSource;
    selected?: boolean;
    playing?: boolean;
    /** The reason this deck may not be picked, or null. */
    locked?: string | null;
    /** Show the PLAY · EDIT · ⋯ row. */
    actions?: boolean;
    onselect: () => void;
    onopen?: (() => void) | undefined;
    onplay?: (() => void) | undefined;
    onmenu?: ((anchor: HTMLElement) => void) | undefined;
  } = $props();

  const s = $derived(deck.summary ?? null);
  const kind = $derived(deck.kind ?? 'custom');
  const size = $derived(sizeOf(deck));
  const cards = $derived(s?.cards ?? deck.main.length);
  const band = $derived(s?.strength ? bandNumber(s.strength.band) : null);
  const packs = $derived(deck.seal ? packsLabel(deck.seal.sets) : '');
  const note = $derived(countNote(cards, size));
  const opening = $derived(isOpening(deck));
  const meta = $derived(note ?? (deck.lastPlayedAt ? `played ${ago(deck.lastPlayedAt)}` : kind === 'sealed' ? 'from boosters' : 'never played'));
  let more = $state<HTMLElement | undefined>();

  function packsLabel(sets: readonly string[]): string {
    const distinct = [...new Set(sets)];
    return distinct.length === 1 ? `${distinct[0]} × ${sets.length}` : `MIXED × ${sets.length}`;
  }
  function ago(t: number): string {
    const d = new Date(t);
    return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
  }
  function key(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (onopen) onopen();
      else onselect();
    } else if (e.key === ' ') {
      e.preventDefault();
      onselect();
    }
  }
</script>

<!-- In a picker the tile is an option of its listbox; in the library it carries PLAY, EDIT and ⋯, so it is a group of
     its own (an option may not hold buttons) and says "selected" in its name (M8 gate, axe). It keeps its tab stop:
     Enter and Space select it, as a click does. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="tile"
  class:selected
  class:locked={!!locked}
  class:incomplete={!!note}
  role={actions ? 'group' : 'option'}
  aria-selected={actions ? undefined : selected}
  aria-disabled={locked ? 'true' : undefined}
  aria-label="{deck.name}, {kind === 'sealed' ? 'booster deck' : 'custom deck'}, {cards} cards{locked ? `, ${locked}` : ''}{actions && selected ? ', selected' : ''}"
  tabindex="0"
  data-testid="deck-tile"
  data-deck-id={deck.id}
  data-kind={kind}
  onclick={onselect}
  ondblclick={() => onopen?.()}
  onkeydown={key}
>
  <div class="well" data-testid="tile-well">
    <span class="behind" aria-hidden="true"></span>
    <span class="cover" data-testid="tile-cover"><CardImage {faces} cardRef={s?.cover ?? null} alt={deck.name} tier="normal" /></span>
    {#if deck.seal}<span class="band" data-testid="seal-band"><SealBand packs={packs} /></span>{/if}
    {#if locked}<span class="reason" data-testid="tile-reason"><Badge tone="muted">{locked}</Badge></span>
    {:else if opening}<span class="reason" data-testid="tile-opening"><Badge>{deck.seal?.revealed ?? 0} of {deck.seal?.sets.length ?? 0} opened</Badge></span>{/if}
    {#if actions && !locked}
      <div class="actions" data-testid="tile-actions">
        <Button size="sm" data-testid="tile-play" onclick={(e) => (e.stopPropagation(), onplay?.())}>Play</Button>
        <Button size="sm" data-testid="tile-edit" onclick={(e) => (e.stopPropagation(), onopen?.())}>Edit</Button>
        <span bind:this={more} class="more"
          ><IconButton size="sm" label="More for {deck.name}" icon="more" data-testid="tile-more" onclick={(e) => (e.stopPropagation(), more && onmenu?.(more))} /></span
        >
      </div>
    {/if}
  </div>
  <div class="text">
    <div class="name ds-t-list" title={deck.name}>
      <!-- A converted copy keeps its "(custom)" suffix in sight: only the name before it is cut (gate M8 finding F14). -->
      {#if deck.name.endsWith(' (custom)') && deck.name.length > 9}<span class="label">{deck.name.slice(0, -9)}</span><span class="suffix" data-testid="tile-suffix">(custom)</span>{:else}<span class="label">{deck.name}</span>{/if}
      <!-- Selected (the deck Home plays with): one round ink check after the name, which keeps the room (gate M8 N6). -->
      {#if selected}<span class="sel" data-testid="tile-selected" title="Selected: Home plays with this deck" aria-hidden="true">✓</span>
      {:else if playing}<span class="check" aria-label="playing">✓</span>{/if}
    </div>
    <div class="row ds-t-eyebrow">
      <span class="facts">
        {#each s?.colours ?? [] as c (c)}<Pip colour={c} size={14} />{/each}
        {#if s && s.colours.length === 0 && cards > 0}<Pip colour="C" size={14} />{/if}
        <span>{cards}</span>
        <span data-testid="tile-kind">{kind === 'sealed' ? 'Booster' : 'Custom'}</span>
      </span>
      <!-- The bars and the number; the band's name is on the deck page (the row fits the tile, gate M8 N6). -->
      <span class="strength"><StrengthPips {band} score={s?.strength?.score} text={false} />{#if band}<span>{s?.strength?.score ?? ''}</span>{/if}</span>
    </div>
    <div class="row">
      {#if s?.simple && !note}<span class="ds-t-meta meta simple" data-testid="simple-chip">Simple deck</span>{:else}<span class="ds-t-meta meta" class:warn={!!note}>{meta}</span>{/if}
      <Sparkline values={(s?.curve ?? [0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 7)} label="Mana curve" />
    </div>
  </div>
</div>

<style>
  .tile {
    box-sizing: border-box;
    position: relative;
    width: 220px;
    height: 268px;
    padding: var(--ds-space-sm);
    border-radius: var(--ds-radius-panel);
    background: var(--ds-panel-raised);
    box-shadow: var(--ds-elevation-sheet);
    color: var(--ds-ink);
    cursor: pointer;
    outline: none;
    transition: transform var(--ds-duration-base) var(--ds-ease-standard);
  }
  .tile:hover {
    transform: translateY(-2px);
    box-shadow: var(--ds-elevation-pop);
  }
  .tile:focus-visible {
    box-shadow: 0 0 0 3px var(--ds-focus), var(--ds-elevation-sheet);
  }
  .tile.selected {
    box-shadow: 0 0 0 2px var(--ds-ink), var(--ds-elevation-raised);
  }
  .tile.incomplete .well {
    outline: 1px dashed var(--ds-muted);
    outline-offset: -1px;
  }
  .well {
    position: relative;
    height: 176px;
    border-radius: var(--ds-radius-card);
    background: var(--ds-chip);
    background-image: radial-gradient(var(--ds-line) 1px, transparent 1.2px);
    background-size: 8px 8px;
    box-shadow: var(--ds-elevation-well);
    overflow: hidden;
  }
  /* A locked tile dims its well with a veil under the cards and its text; never the card face. */
  .locked .well::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--ds-panel);
    opacity: 0.6;
    z-index: 0;
  }
  .locked .text {
    opacity: 0.45;
  }
  .locked {
    cursor: not-allowed;
  }
  .cover,
  .behind {
    position: absolute;
    top: 4px;
    left: 50%;
    width: 96px;
    margin-left: -48px;
    z-index: 1;
  }
  .cover {
    transform: rotate(-3deg);
    z-index: 2;
    transition: transform var(--ds-duration-base) var(--ds-ease-standard);
  }
  .behind {
    aspect-ratio: 63 / 88;
    transform: translateX(10px) rotate(4deg);
    border-radius: 4.75% / 3.4%;
    background: var(--ds-ink);
    box-shadow: var(--ds-elevation-raised);
  }
  .tile:hover .cover {
    transform: rotate(0deg) translateY(-2px);
  }
  /* The seal band at −3° across the well's foot (board 0's band), wider than the well so its ends run off the edges, and
     low enough that it never crosses the cover card's face. */
  .band {
    position: absolute;
    left: -8px;
    right: -8px;
    bottom: -6px;
    z-index: 3;
    transform: rotate(-3deg);
  }
  .band :global(.ds-seal) {
    box-shadow: var(--ds-elevation-raised);
  }
  .reason {
    position: absolute;
    left: var(--ds-space-sm);
    top: var(--ds-space-sm);
    z-index: 3;
  }
  .actions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--ds-space-sm);
    display: flex;
    justify-content: center;
    gap: var(--ds-space-xs);
    z-index: 4;
    opacity: 0;
    transition: opacity var(--ds-duration-fast) var(--ds-ease-standard);
  }
  .tile:hover .actions,
  .tile:focus-within .actions {
    opacity: 1;
  }
  @media (pointer: coarse) {
    .tile.selected .actions {
      opacity: 1;
    }
  }
  /* The text under the well fits the tile's 76 px: a 24 px name row and two 20 px rows (gate M8 finding N6). */
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--ds-space-xs) var(--ds-space-sm) 0;
  }
  .name {
    display: flex;
    align-items: center;
    min-height: 24px;
    gap: 4px;
    font-weight: var(--ds-weight-bold);
    min-width: 0;
  }
  .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .suffix {
    flex: none;
    white-space: nowrap;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-xs);
    min-width: 0;
    height: 20px;
  }
  .strength {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .simple {
    color: var(--ds-ink);
  }
  .facts {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .meta {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta.warn {
    color: var(--ds-danger);
  }
  .sel {
    margin-left: auto;
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ds-accent);
    color: var(--ds-accent-ink);
    font-size: var(--ds-type-label);
    font-weight: var(--ds-weight-bold);
  }
</style>
