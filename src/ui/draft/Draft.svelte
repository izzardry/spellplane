<!--
  The draft HUD around the draft surface (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction: the
  current pack as a fan or grid on the private table, click a card to mark it, click again or press Enter to confirm,
  picks fly to the pool which sorts by colour and stays visible, waiting packs queue visibly behind each seat; Rochester
  and Grid picks on the shared table; "Specification: card data, packs and draft formats", pick timer). Not modal: the
  table stays live under the status bar. Keys: Enter confirms the marked cards, Escape clears the marks (or closes the
  inspect view), the arrow keys move the mark through the pack (Shift adds the next card in Pick-Two), 0 fits the
  table, hold Space over a card to inspect it; keys never fire while a text field has focus.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardRef, InstanceId, TableState } from '../../core/types';
  import type { DraftPrivateView } from '../../draft/types';
  import { mtg } from '../../games/index';
  import { picksNeeded } from '../../scene/draft';
  import type { DraftSurface } from '../../scene/types';
  import { tokensToCssVars } from '../../themes/index';
  import Inspect from '../Inspect.svelte';
  import type { DraftProps } from '../types';
  import { formatClock, remainingMs, SeqClock, URGENT_MS } from './timer';
  import { draftStatus, Prefetch, seatChips, shownSids, stepMark, surfaceView } from './view';

  let { session, draft, createSurface, faces, cardData, theme, game: gameProp }: DraftProps = $props();

  const game = untrack(() => gameProp ?? mtg);
  const me = untrack(() => session.seat);
  const cssVars = $derived(
    Object.entries(tokensToCssVars(theme.tokens))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; '),
  );
  const back = $derived(theme.cardDressing.back ?? game.cardBack);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let pv = $state.raw<DraftPrivateView>(untrack(() => draft.view()));
  let now = $state(Date.now());
  let note = $state('');
  let inspectRef = $state.raw<CardRef | null>(null);
  let inspectBySpace = false;
  let spaceHeld = false;
  let vw = $state(1280);
  let vh = $state(800);
  let host: HTMLDivElement | undefined = $state();
  let surface: DraftSurface | null = null;
  let surfaceError = $state('');
  const clock = new SeqClock();
  clock.observe(untrack(() => st.seq), Date.now());

  const status = $derived(draftStatus(st, pv, me));
  const chips = $derived(seatChips(st, pv, me));
  const remaining = $derived(pv.timer ? remainingMs(pv.timer, clock, now) : null);
  const need = $derived(pv.pack ? picksNeeded(pv.picks, pv.pack.cards.length) : 0);
  const winstonTurn = $derived(pv.format === 'winston' && pv.waitingOn.includes(me) && !!pv.pile);
  const seatColour = (i: number): string => theme.tokens.colours.seats[i]?.colour ?? theme.tokens.colours.fg;

  /** Card data for every ref on the surface, fetched once; the surface re-sorts the pool when it arrives. */
  const prefetcher = new Prefetch();
  function prefetch(): void {
    const missing = prefetcher.take(shownSids(st, pv), (s) => !!cardData.peek(s));
    if (!missing.length) return;
    void cardData
      .getMany(missing)
      .then(() => push())
      .catch(() => {});
  }

  function push(): void {
    if (!surface) return;
    surface.update(st, surfaceView(st, pv, reducedMotion));
  }

  function flash(text: string): void {
    note = text;
    const shown = text;
    setTimeout(() => {
      if (note === shown) note = '';
    }, 3000);
  }

  function confirm(cards: readonly InstanceId[]): void {
    if (!cards.length) return;
    if (!draft.pick(cards)) flash(pv.pack?.public ? 'It is not your pick yet.' : 'That pick was not taken.');
  }

  function confirmMarked(): void {
    if (status.confirmable) confirm(pv.marked.slice(0, need));
  }

  function takeLine(line: 'row' | 'col', index: 0 | 1 | 2): void {
    if (!draft.gridTake(line, index)) flash('It is not your turn to take from the grid.');
  }

  function pile(take: boolean): void {
    if (!draft.pileLook(take)) flash('It is not your turn.');
  }

  const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

  function onkeydowncapture(e: KeyboardEvent): void {
    if (e.code === 'Space' && !typing(e.target)) spaceHeld = true;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
      // A focused button answers Enter itself.
      if (e.target instanceof HTMLButtonElement) return;
      if (status.confirmable) {
        e.preventDefault();
        confirmMarked();
      }
    } else if (e.key === 'Escape') {
      if (inspectRef) inspectRef = null;
      else if (pv.marked.length) draft.mark([]);
    } else if (e.key === '0') {
      surface?.camera.fit();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && pv.pack) {
      e.preventDefault();
      draft.mark(stepMark(pv.pack.cards.map((c) => c.id), pv.marked, need, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey));
    }
  }

  function onkeyup(e: KeyboardEvent): void {
    if (e.code === 'Space') spaceHeld = false;
    if (e.code === 'Space' && inspectBySpace) {
      inspectBySpace = false;
      inspectRef = null;
    }
  }

  onMount(() => {
    const unsubState = session.subscribe((s) => {
      clock.observe(s.seq, Date.now());
      st = s;
      push();
      prefetch();
    });
    const unsubView = draft.subscribe((v) => {
      pv = v;
      push();
      prefetch();
    });
    try {
      surface = createSurface(host!, {
        game,
        layout: game.layout(st.format),
        viewerSeat: me,
        theme,
        faces,
        card: (ref) => cardData.peek(ref.sid),
        events: {
          mark: (cards) => draft.mark(cards),
          confirm: (cards) => confirm(cards),
          takeLine: (line, index) => takeLine(line, index),
          inspect: (ref) => {
            inspectRef = ref;
            inspectBySpace = spaceHeld;
          },
        },
      });
      push();
    } catch (e) {
      surfaceError = e instanceof Error ? e.message : String(e);
    }
    prefetch();
    const timer = setInterval(() => {
      if (pv.timer) now = Date.now();
    }, 250);
    return () => {
      unsubState();
      unsubView();
      clearInterval(timer);
      surface?.dispose();
      surface = null;
    };
  });
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} {onkeydowncapture} {onkeydown} {onkeyup} />

<div class="root" style={cssVars} data-testid="draft">
  <div class="surface" data-testid="draft-surface" data-fit-insets="76 0 0 0" bind:this={host}></div>
  {#if surfaceError}<p class="error" role="status">Draft table unavailable: {surfaceError}</p>{/if}

  <header class="bar" data-testid="draft-bar">
    <div class="line">
      <span class="title" data-testid="draft-title">{status.title}</span>
      {#if status.step}<span class="step" data-testid="draft-step">{status.step}</span>{/if}
      {#if remaining !== null}
        <span class="timer" class:urgent={remaining <= URGENT_MS} data-testid="pick-timer" data-ms={remaining} title="Pick timer: on expiry the marked card, or else the first card, is taken">{formatClock(remaining)}</span>
      {/if}
      <span class="spacer"></span>
      <ul class="seats" aria-label="Packs waiting at each seat">
        {#each chips as c (c.seat)}
          <li
            class="seat"
            class:picking={c.picking}
            class:self={c.self}
            data-testid="draft-seat"
            data-seat={c.seat}
            data-packs={c.packs ?? undefined}
            data-pool={c.pool}
            data-picking={c.picking ? 'true' : 'false'}
            title={c.packs === null
              ? `${c.self ? 'You' : c.name}: ${c.pool} ${c.pool === 1 ? 'card' : 'cards'} drafted${c.picking ? ', picking' : ''}`
              : `${c.self ? 'You' : c.name}: ${c.packs} ${c.packs === 1 ? 'pack' : 'packs'} waiting, ${c.pool} ${c.pool === 1 ? 'card' : 'cards'} drafted`}
          >
            <span class="dot" style:background={seatColour(c.colour)}></span>
            <span class="name">{c.self ? `${c.name} (you)` : c.name}</span>
            {#if c.packs !== null}
              <span class="packs" data-testid="draft-seat-packs" aria-label="{c.packs} {c.packs === 1 ? 'pack' : 'packs'} waiting">
                <span class="pack-icon" aria-hidden="true"></span>{c.packs}
              </span>
            {:else}
              <span class="pool" data-testid="draft-seat-pool" aria-label="{c.pool} {c.pool === 1 ? 'card' : 'cards'} drafted">{c.pool}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
    <div class="line">
      <span class="prompt" class:turn={status.myTurn} data-testid="draft-prompt" aria-live="polite">{status.prompt}</span>
      <span class="spacer"></span>
      {#if note}<span class="note" role="status" data-testid="draft-note">{note}</span>{/if}
      {#if winstonTurn}
        <button type="button" data-testid="pile-take" onclick={() => pile(true)}>Take this pile</button>
        <button type="button" data-testid="pile-pass" onclick={() => pile(false)}>Add a card, next pile</button>
      {/if}
      {#if pv.pack}
        {#if pv.marked.length}
          <button type="button" class="quiet" data-testid="draft-clear" onclick={() => draft.mark([])} title="Escape">Clear</button>
        {/if}
        <button type="button" class="primary" data-testid="draft-confirm" disabled={!status.confirmable} onclick={confirmMarked} title="Enter">
          {need > 1 ? `Take ${need}` : 'Take'}
        </button>
      {/if}
    </div>
  </header>

  {#if inspectRef}
    <Inspect {faces} cardRef={inspectRef} data={cardData.peek(inspectRef.sid)} {back} {vw} {vh} onclose={() => (inspectRef = null)} />
  {/if}
</div>

<style>
  .root {
    position: fixed;
    inset: 0;
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .surface {
    position: absolute;
    inset: 0;
  }
  .error {
    position: absolute;
    top: 90px;
    left: 16px;
    color: var(--sp-danger);
  }
  .bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    min-height: 68px;
    padding: 6px 16px;
    display: grid;
    gap: 4px;
    background: color-mix(in srgb, var(--sp-bg) 92%, transparent);
    border-bottom: 1px solid var(--sp-border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .title {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .step {
    color: var(--sp-muted);
  }
  .timer {
    font-family: var(--sp-font-mono);
    padding: 0 6px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-sm, 4px);
  }
  .timer.urgent {
    color: var(--sp-danger);
    border-color: var(--sp-danger);
  }
  .prompt {
    color: var(--sp-muted);
  }
  .prompt.turn {
    color: var(--sp-fg);
  }
  .note {
    color: var(--sp-warning);
  }
  .seats {
    display: flex;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
    flex-wrap: wrap;
  }
  .seat {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    font-size: var(--sp-font-size-small, 12px);
  }
  .seat.picking {
    border-color: var(--sp-fg);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .pool {
    font-family: var(--sp-font-mono);
    color: var(--sp-muted);
  }
  .packs {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--sp-font-mono);
  }
  .pack-icon {
    display: inline-block;
    width: 7px;
    height: 10px;
    border: 1px solid currentColor;
    border-radius: 1px;
    box-shadow: 2px -2px 0 -1px var(--sp-bg), 2px -2px 0 0 currentColor;
  }
  button {
    font: inherit;
    padding: 4px 12px;
    border-radius: var(--sp-radius-sm, 4px);
    border: 1px solid var(--sp-border);
    background: var(--sp-bg);
    color: var(--sp-fg);
    cursor: pointer;
  }
  button.primary {
    border-color: var(--sp-fg);
    font-weight: var(--sp-font-weight-bold, 600);
  }
  button.quiet {
    color: var(--sp-muted);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
</style>
