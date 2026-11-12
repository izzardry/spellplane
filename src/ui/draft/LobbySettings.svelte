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
  import { hostSeat } from '../../core/stage';
  import type { LobbySettings, SetCode, TableState } from '../../core/types';
  import type { SetSummary } from '../../data/types';
  import type { LobbySettingsProps } from '../types';
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
  const formatName = $derived(({ '1v1': 'One versus one', ffa3: 'Free-for-all, three players', ffa4: 'Free-for-all, four players', '2hg': 'Two-Headed Giant' } as const)[st.format]);

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
  <select data-testid={testid} data-pack={pack} aria-label={label} disabled={!editable} {value} {onchange}>
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
  </select>
{/snippet}

<section class="settings" data-testid="lobby-settings" data-editable={editable ? 'true' : 'false'} aria-labelledby="lobby-settings-title">
  <h2 id="lobby-settings-title">Game settings</h2>
  {#if !editable}
    <p class="hint" data-testid="lobby-settings-readonly">{st.stage === 'lobby' ? `The host, ${hostName}, chooses these.` : 'Fixed for this evening’s draft.'}</p>
  {/if}

  <div class="row">
    <span class="key">Table</span>
    <span data-testid="lobby-format">{formatName}</span>
  </div>

  <label class="row">
    <span class="key">Mode</span>
    <select data-testid="lobby-mode" disabled={!editable} value={mode} onchange={onMode}>
      {#each modes as m (m)}<option value={m} selected={m === mode}>{modeLabel(m)}</option>{/each}
    </select>
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
            <input type="checkbox" data-testid="lobby-per-pack" disabled={!editable} checked={perPack} onchange={onPerPack} />
            A different set per pack
          </label>
        {/if}
        {#if listState === 'loading'}<span class="hint" data-testid="lobby-sets-loading">Loading the set list…</span>{/if}
        {#if listState === 'failed'}<span class="hint warn" data-testid="lobby-sets-failed">The set list is unavailable; the chosen set stays.</span>{/if}
      </div>
    </div>
  {/if}

  <fieldset class="timers">
    <legend>Timers</legend>
    {#if hasPickTimer(lobby.draft)}
      <label class="check">
        <input type="checkbox" data-testid="lobby-pick-timer" disabled={!editable} checked={lobby.pickTimer} onchange={onPickTimer} />
        Pick timer
        <span class="hint">45 s for a pack’s first pick, 3 s less for each pick after, at least 10 s; when it runs out the marked card, or else the first, is taken.</span>
      </label>
    {/if}
    <label class="row">
      <span class="key">Pass timer</span>
      <select data-testid="lobby-pass-timer" disabled={!editable} value={passTimer === null ? 'off' : String(passTimer)} onchange={onPassTimer}>
        {#each passTimerChoices(passTimer) as ms (ms ?? 'off')}<option value={ms === null ? 'off' : String(ms)} selected={ms === passTimer}>{passTimerLabel(ms)}</option>{/each}
      </select>
    </label>
  </fieldset>

  {#if failure}<p class="hint warn" role="status" data-testid="lobby-settings-error">{failure}</p>{/if}
</section>

<style>
  .settings {
    display: grid;
    gap: var(--sp-space-sm, 8px);
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    color: var(--sp-fg);
    background: var(--sp-bg);
    min-width: 0;
  }
  h2 {
    margin: 0 0 4px;
    font-size: var(--sp-font-size-large, 18px);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .sets {
    align-items: start;
  }
  .key {
    color: var(--sp-muted);
  }
  .set-list {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .pack-set {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  select,
  input[type='number'] {
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-sm, 4px);
    background: var(--sp-bg);
    color: var(--sp-fg);
    min-width: 0;
    max-width: 100%;
  }
  input[type='number'] {
    width: 6em;
  }
  select:disabled,
  input:disabled {
    color: var(--sp-fg);
    opacity: 0.75;
  }
  .check {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }
  .timers {
    display: grid;
    gap: 8px;
    margin: 4px 0 0;
    padding: 8px 12px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-md, 6px);
  }
  legend {
    color: var(--sp-muted);
    padding: 0 4px;
  }
  .hint {
    margin: 0;
    color: var(--sp-muted);
    font-size: var(--sp-font-size-small, 12px);
  }
  .warn {
    color: var(--sp-warning);
  }
</style>
