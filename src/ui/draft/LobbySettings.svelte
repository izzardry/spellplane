<!--
  The lobby settings panel (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings: acquisition mode, set per
  pack with core sets listed first and a different set per pack allowed, packs per player, picks per pass, optional
  pick timer (off by default), pass timer length; "Specification: card data, packs and draft formats": the ten featured
  sets head the list). The host edits; everyone else sees the same settings read-only, straight from shared state
  (`TableState.lobby`, written by `lobbySet`; the pass timer is `TableSettings.passTimerMs`, written by `settings`).
  Not modal.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { GAME_START, hostSeat } from '../../core/stage';
  import type { Format, LobbySettings, SetCode, TableState } from '../../core/types';
  import type { SetSummary } from '../../data/types';
  import type { LobbySettingsProps } from '../types';
  import Select from '../design/Select.svelte';
  import {
    currentLobby,
    fieldLabel,
    fieldRange,
    fieldsOf,
    fieldValue,
    hasPickTimer,
    lobbyEditable,
    lobbyModes,
    mixedSets,
    modeLabel,
    modeName,
    modeOf,
    packCount,
    passTimerChoices,
    passTimerLabel,
    seatHint,
    setOptions,
    setsPerPack,
    withMode,
    withNumber,
    withPackSet,
    withSet,
    type LobbyMode,
    type NumberField,
  } from './settings';

  let { session, evening, sets }: LobbySettingsProps = $props();

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let list = $state.raw<SetSummary[]>([]);
  let listState = $state<'loading' | 'ready' | 'failed'>('loading');
  let wantPerPack = $state(false);
  let failure = $state('');

  const me = untrack(() => session.seat);
  const lobby = $derived(currentLobby(st));
  const editable = $derived(lobbyEditable(st, me));
  const host = $derived(hostSeat(st));
  const hostName = $derived(host ? st.seats[host]?.name || host : 'nobody yet');
  const mode = $derived(modeOf(lobby.draft));
  const modes = $derived(lobbyModes(st.format));
  const fields = $derived(fieldsOf(lobby.draft));
  const packs = $derived(packCount(lobby.draft));
  const perPack = $derived(packs !== null && packs > 1 && (mixedSets(lobby) || (editable && wantPerPack)));
  const packSets = $derived(setsPerPack(lobby));
  const options = $derived(setOptions(list, lobby.sets));
  const hint = $derived(seatHint(mode, st));
  const passTimer = $derived(st.settings.passTimerMs);
  // The table format (DESIGN "Pre-game", Lobby settings: "Format (1v1, free-for-all, Two-Headed Giant)"; M3-P1): the host
  // picks it with the other settings; `formatSet` rebuilds the chairs, teams and life totals.
  const FORMAT_NAMES: Readonly<Record<Format, string>> = { '1v1': 'One versus one', ffa3: 'Free-for-all, three players', ffa4: 'Free-for-all, four players', '2hg': 'Two-Headed Giant' };
  const FORMATS = Object.keys(FORMAT_NAMES) as Format[];
  /** The choices as the select shows them: short enough for the side column's 36 px pill, never cut (gate M8 F5). */
  const FORMAT_CHOICES: Readonly<Record<Format, string>> = { '1v1': 'One versus one', ffa3: 'Free-for-all · 3', ffa4: 'Free-for-all · 4', '2hg': 'Two-Headed Giant' };
  const formatName = $derived(FORMAT_NAMES[st.format]);

  function write(next: LobbySettings): void {
    if (!editable) return;
    failure = '';
    try {
      evening.setLobby(next);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  // The controls are bound one way: after a write each shows what the table holds, so a refused write (or one that
  // changes nothing) does not leave the rejected choice on screen.
  const held = (): LobbySettings => currentLobby(session.getState());

  function onMode(e: Event): void {
    const el = e.currentTarget as HTMLSelectElement;
    write(withMode(lobby, el.value as LobbyMode));
    el.value = modeOf(held().draft);
  }

  function onFormat(e: Event): void {
    const el = e.currentTarget as HTMLSelectElement;
    const format = el.value as Format;
    if (!editable || !FORMATS.includes(format) || format === st.format) return;
    failure = '';
    // The starting life of the format; the reducer holds no game definition (core/stage.ts GAME_START mirrors it).
    const life = (Object.hasOwn(GAME_START, st.game) ? GAME_START[st.game]!.life[format] : undefined) ?? 20;
    try {
      session.dispatch({ type: 'formatSet', format, life });
      // A Two-Headed Giant mode does not suit another table, and the reverse: fall back to the first mode offered.
      if (!lobbyModes(format).includes(mode)) write(withMode(lobby, lobbyModes(format)[0]!));
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    el.value = session.getState().format;
  }

  function onNumber(field: NumberField, e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const next = withNumber(lobby, field, Number(input.value));
    write(next);
    // Show what the table holds (clamped, or unchanged when refused), not what was typed.
    input.value = String(fieldValue(currentLobby(session.getState()).draft, field) ?? '');
  }

  function onSet(e: Event): void {
    const el = e.currentTarget as HTMLSelectElement;
    write(withSet(lobby, el.value as SetCode));
    el.value = held().sets[0] ?? '';
  }

  function onPackSet(index: number, e: Event): void {
    const el = e.currentTarget as HTMLSelectElement;
    write(withPackSet(lobby, index, el.value as SetCode));
    el.value = setsPerPack(held())[index] ?? '';
  }

  function onPerPack(e: Event): void {
    const on = (e.currentTarget as HTMLInputElement).checked;
    wantPerPack = on;
    // One set again: every pack takes the first pack's set.
    if (!on && mixedSets(lobby)) write(withSet(lobby, packSets[0] ?? lobby.sets[0]!));
  }

  function onPickTimer(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    write({ ...lobby, pickTimer: el.checked });
    el.checked = held().pickTimer;
  }

  function onPassTimer(e: Event): void {
    if (!editable) return;
    const el = e.currentTarget as HTMLSelectElement;
    const v = el.value;
    const ms = v === 'off' ? null : Number(v);
    try {
      session.dispatch({ type: 'settings', settings: { passTimerMs: ms } });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    const now = session.getState().settings.passTimerMs;
    el.value = now === null ? 'off' : String(now);
  }

  const setLabel = (s: SetSummary): string => (s.name && s.name !== s.code ? `${s.name} (${s.code})` : s.code);

  onMount(() => {
    const unsub = session.subscribe((s) => (st = s));
    let live = true;
    sets
      .listSets()
      .then((l) => {
        if (!live) return;
        list = l;
        listState = 'ready';
      })
      .catch(() => {
        if (live) listState = 'failed';
      });
    return () => {
      live = false;
      unsub();
    };
  });
</script>

{#snippet setSelect(value: SetCode, testid: string, onchange: (e: Event) => void, label: string, pack?: number)}
  <Select data-testid={testid} data-pack={pack} aria-label={label} disabled={!editable} {value} {onchange}>
    {#if options.featured.length}
      <optgroup label="Core sets">
        {#each options.featured as s (s.code)}<option value={s.code} selected={s.code === value}>{setLabel(s)}</option>{/each}
      </optgroup>
    {/if}
    {#if options.others.length}
      <optgroup label="All sets">
        {#each options.others as s (s.code)}<option value={s.code} selected={s.code === value}>{setLabel(s)}</option>{/each}
      </optgroup>
    {/if}
  </Select>
{/snippet}

<section class="settings" data-testid="lobby-settings" data-editable={editable ? 'true' : 'false'} aria-labelledby="lobby-settings-title">
  <p class="ds-t-eyebrow eyebrow">Setup</p>
  <h2 id="lobby-settings-title" class="ds-t-title">Table rules</h2>
  {#if !editable}
    <p class="hint" data-testid="lobby-settings-readonly">{st.stage === 'lobby' ? `The host, ${hostName}, chooses these.` : 'Fixed for this evening’s draft.'}</p>
  {/if}

  <label class="row">
    <span class="key">Table</span>
    {#if editable && st.stage === 'lobby'}
      <Select data-testid="lobby-format-select" aria-label="Table format" title={formatName} value={st.format} onchange={onFormat}>
        {#each FORMATS as f (f)}<option value={f} selected={f === st.format}>{FORMAT_CHOICES[f]}</option>{/each}
      </Select>
    {:else}
      <span data-testid="lobby-format">{formatName}</span>
    {/if}
  </label>

  <label class="row">
    <span class="key">Mode</span>
    <Select data-testid="lobby-mode" disabled={!editable} title={modeName(mode)} value={mode} onchange={onMode}>
      {#each modes as m (m)}<option value={m} selected={m === mode}>{modeLabel(m)}</option>{/each}
    </Select>
  </label>
  {#if hint}<p class="hint warn" data-testid="lobby-seat-hint">{hint}</p>{/if}

  {#each fields as f (f)}
    {@const range = fieldRange(f)}
    <label class="row">
      <span class="key">{fieldLabel(f, lobby.draft)}</span>
      <input type="number" inputmode="numeric" data-testid="lobby-{f}" min={range.min} max={range.max} step="1" disabled={!editable} value={fieldValue(lobby.draft, f)} onchange={(e) => onNumber(f, e)} />
    </label>
  {/each}

  {#if lobby.draft}
    <div class="row sets">
      <span class="key">{perPack ? 'Sets' : 'Set'}</span>
      <div class="set-list">
        {#if perPack}
          {#each packSets as code, i (i)}
            <label class="pack-set">
              <span>Pack {i + 1}</span>
              {@render setSelect(code, 'lobby-pack-set', (e) => onPackSet(i, e), `Set of pack ${i + 1}`, i)}
            </label>
          {/each}
        {:else}
          {@render setSelect(lobby.sets[0] ?? '', 'lobby-set', onSet, 'Set')}
        {/if}
        {#if packs !== null && packs > 1}
          <label class="check">
            <span>A different set per pack</span>
            <input type="checkbox" data-testid="lobby-per-pack" disabled={!editable} checked={perPack} onchange={onPerPack} />
          </label>
        {/if}
        {#if listState === 'loading'}<span class="hint" data-testid="lobby-sets-loading">Loading the set list…</span>{/if}
        {#if listState === 'failed'}<span class="hint warn" data-testid="lobby-sets-failed">The set list is unavailable; the chosen set stays.</span>{/if}
      </div>
    </div>
  {/if}

  <fieldset class="timers">
    <legend class="ds-t-eyebrow">Timers</legend>
    {#if hasPickTimer(lobby.draft)}
      <label class="check row">
        <span class="key">Pick timer</span>
        <input type="checkbox" data-testid="lobby-pick-timer" disabled={!editable} checked={lobby.pickTimer} onchange={onPickTimer} />
      </label>
      <p class="hint">45 s for a pack’s first pick, 3 s less for each pick after, at least 10 s; when it runs out the marked card, or else the first, is taken.</p>
    {/if}
    <label class="row">
      <span class="key">Pass timer</span>
      <Select data-testid="lobby-pass-timer" disabled={!editable} value={passTimer === null ? 'off' : String(passTimer)} onchange={onPassTimer}>
        {#each passTimerChoices(passTimer) as ms (ms ?? 'off')}<option value={ms === null ? 'off' : String(ms)} selected={ms === passTimer}>{passTimerLabel(ms)}</option>{/each}
      </Select>
    </label>
  </fieldset>

  {#if failure}<p class="hint warn" role="status" data-testid="lobby-settings-error">{failure}</p>{/if}
</section>

<style>
  /* A sheet in the waiting room's side column (board 5, visual.md 2.5 A5: settings rows put the label left and the
     control right, 44 high). The selects are the kit's (a raised 36 px pill over the platform's list), the numbers sit
     in the kit's well; a row never grows past the sheet: a long choice is cut inside its pill (gate M8 finding F5). */
  .settings {
    box-sizing: border-box;
    display: grid;
    gap: var(--ds-space-xs);
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-sheet);
    box-shadow: var(--ds-elevation-sheet);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-body);
    color: var(--ds-ink);
    background: var(--ds-panel);
    min-width: 0;
  }
  .eyebrow {
    margin: 0;
  }
  h2 {
    margin: 0 0 var(--ds-space-sm);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-md);
    min-width: 0;
    min-height: var(--ds-control-md);
  }
  .row > :global(.ds-select) {
    flex: 0 1 auto;
  }
  .sets {
    align-items: start;
    padding-top: var(--ds-space-xs);
  }
  .key {
    flex: none;
    color: var(--ds-muted);
  }
  .set-list {
    display: grid;
    gap: var(--ds-space-sm);
    justify-items: end;
    min-width: 0;
  }
  .pack-set {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    min-width: 0;
    max-width: 100%;
  }
  .pack-set span {
    flex: none;
    color: var(--ds-muted);
  }
  input[type='number'] {
    box-sizing: border-box;
    flex: 0 1 auto;
    height: var(--ds-control-sm);
    font: inherit;
    padding: 0 var(--ds-space-md);
    border: 0;
    border-radius: var(--ds-radius-pill);
    background: var(--ds-chip);
    box-shadow: var(--ds-elevation-well);
    color: var(--ds-ink);
    min-width: 0;
    max-width: 100%;
  }
  input:focus-visible {
    outline: 2px solid var(--ds-focus);
    outline-offset: 2px;
  }
  input[type='number'] {
    width: 5em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  input:disabled {
    color: var(--ds-ink);
    opacity: 0.75;
  }
  /* A checkbox row: its words left, the box right, on one line. */
  .check {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-md);
    min-height: var(--ds-control-sm);
    cursor: pointer;
  }
  .check input {
    flex: none;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--ds-ink);
  }
  .timers {
    display: grid;
    gap: var(--ds-space-xs);
    margin: var(--ds-space-md) 0 0;
    padding: var(--ds-space-md) 0 0;
    border: 0;
    border-top: 1px solid var(--ds-line);
    min-width: 0;
  }
  legend {
    float: left;
    width: 100%;
    padding: 0;
    margin-bottom: var(--ds-space-xs);
  }
  .hint {
    margin: 0;
    color: var(--ds-muted);
    font-size: var(--ds-type-small);
  }
  .warn {
    color: var(--ds-warning);
  }
</style>
