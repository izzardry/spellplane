<!--
  The table frame (docs/design/m8/contracts.md Part C "Table frame"): every table route renders it. By stage and kind it
  chooses the waiting room (through ui/flow/Stage.svelte), the matched entry (when a MatchRecord exists for the code),
  Versus (while the automatic setup runs), the draft and build stages, the HUD (inside Gathering when `gather`), and
  GameOver once TableState.result is set. It builds HudShellProps from `onleave`, menu-top.ts, SeatMenu, SeatBadge,
  presence.ts, the notice store and `extraShell`, and starts the checkpointer on mount. While the HUD does not honour
  the shell props (HUD_SHELL false) a fallback bar (`frame-bar`: Leave, the primaryOverride button, the status) stands
  in, except in the sandbox. A simple working version by M8-C; M8-P8 finishes it.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { MatchRecord, SeatId, TableState } from '../../core/types';
  import { createCheckpointer } from '../../session/checkpoint';
  import { createSessionMuster } from '../../session/muster';
  import { startAutoSetup } from '../../session/entry';
  import { concede } from '../../session/result';
  import type { SessionNetStatus } from '../../session/types';
  import { paper } from '../../themes/paper/index';
  import { parsePlainList } from '../deck';
  import Stage from '../flow/Stage.svelte';
  import Gathering from '../gather/Gathering.svelte';
  import Hud from '../Hud.svelte';
  import { HUD_SHELL } from '../hud/shell';
  import SpectatorPanel from '../lobby/SpectatorPanel.svelte';
  import SpectatorView from '../lobby/SpectatorView.svelte';
  import ConcedeChip from '../play/ConcedeChip.svelte';
  import GameOver from '../play/GameOver.svelte';
  import MatchedEntry from '../play/MatchedEntry.svelte';
  import Versus from '../play/Versus.svelte';
  import type { HudShellProps } from '../props';
  import RecoveryPanel from '../recovery/RecoveryPanel.svelte';
  import SeatBadge from '../seat/SeatBadge.svelte';
  import SeatMenu from '../seat/SeatMenu.svelte';
  import { seatPresence } from '../seat/presence';
  import { themeContext } from '../settings/theme';
  import Hints from '../storage/Hints.svelte';
  import UpdateNotice from '../storage/UpdateNotice.svelte';
  import VersionNotice from '../version/VersionNotice.svelte';
  import { tableDeps } from './context';
  import { menuTop } from './menu-top';
  import { notices, type TableNotice } from './notices';
  import type { TableFrameProps } from './types';

  let props: TableFrameProps = $props();

  const deps = $derived(props.deps ?? tableDeps());
  const session = $derived(props.session);
  const networked = $derived(props.kind === 'room' || props.kind === 'matched');
  const gather = $derived(props.gather ?? networked);

  let st = $state.raw<TableState>(untrack(() => props.session.getState()));
  onMount(() => props.session.subscribe((s) => (st = s)));
  let net = $state.raw<SessionNetStatus>(untrack(() => props.session.netStatus()));
  onMount(() => props.session.subscribeNet((s) => (net = s)));
  let notice = $state.raw<TableNotice | null>(null);
  onMount(() => notices.subscribe((n) => (notice = n)));

  // The viewer's theme (PLAN M4-P6); Paper where no app shell provides the choice (a harness).
  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));

  // Saving (persistence.md section 2): the checkpointer runs while the frame is mounted (a stub until M8-P2).
  const checkpointer = untrack(() => createCheckpointer(props.session, props.games));
  onMount(() => () => checkpointer.stop());
  const muster = untrack(() => createSessionMuster(props.session));
  // The automatic setup (contracts.md Part D, session/entry.ts): deals and rolls once per seat and game at a table with
  // `autoSetup`; does nothing at a table opened the old way. Not in the sandbox.
  onMount(() => (props.kind === 'sandbox' ? undefined : startAutoSetup(props.session)));

  // A MatchRecord for this code makes the table a matched one (matchmaking.md 2.9).
  let record = $state.raw<MatchRecord | null>(null);
  $effect(() => {
    const code = props.code;
    const matches = deps?.matches;
    if (!code || !matches || !networked) return;
    let cancelled = false;
    matches.get(code).then(
      (r) => {
        if (!cancelled) record = r;
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  });

  let readOnly = $state(false);

  async function leave(): Promise<void> {
    await checkpointer.now('leave').catch(() => undefined);
    props.onleave();
  }

  const me = $derived<SeatId | null>(session.seat);
  const presence = $derived.by((): Readonly<Record<SeatId, 'here' | 'away'>> | undefined => {
    if (!gather) return undefined;
    const all = seatPresence(st, net.peers, me);
    const out: Record<SeatId, 'here' | 'away'> = {};
    for (const [seat, p] of Object.entries(all)) out[seat] = p === 'away' ? 'away' : 'here';
    return out;
  });

  const shell = $derived.by((): HudShellProps => {
    const own: HudShellProps = {
      onleave: () => void leave(),
      menuTop: () => menuTop(props.kind, st, me, { leave: () => void leave(), concede: me ? () => void concede(session) : undefined }),
      sandbox: props.kind === 'sandbox',
      notice,
      readOnly,
      ...(gather ? { seatPresence: presence, plateMenuTop, plateBadge } : {}),
    };
    return { ...own, ...(props.extraShell ?? {}) };
  });
  const override = $derived(shell.primaryOverride ?? null);
  const dealing = $derived(!!st.settings.autoSetup && st.stage === 'match' && !!me && st.seats[me]?.dealt !== (st.games ?? 0));
</script>

{#snippet plateMenuTop(seat: SeatId, close: () => void)}
  <SeatMenu table={st} {seat} {me} {muster} onleave={seat === me ? () => (close(), void leave()) : undefined} />
{/snippet}
{#snippet plateBadge(seat: SeatId)}
  <SeatBadge table={st} {seat} {me} />
{/snippet}

{#snippet hud()}
  {#if deps}
    {#key st.games ?? 0}
      <Hud session={props.session} createScene={deps.createScene} faces={deps.faces} cardData={deps.cardData} game={deps.game} {theme} settings={deps.settings} parseDecklist={deps.parseDecklist} {...shell} />
    {/key}
  {/if}
{/snippet}

{#snippet table()}
  {#if networked && deps}
    {#if record && st.stage === 'lobby'}
      <MatchedEntry session={props.session} {record} decks={deps.decks ?? null} ratings={deps.ratings ?? null} matches={deps.matches ?? null} onleave={() => void leave()} />
    {:else if props.link && deps.identity && deps.decks}
      <Stage
        session={props.session}
        game={deps.game}
        link={props.link}
        identity={deps.identity}
        decks={deps.decks}
        cardData={deps.cardData}
        parseDecklist={deps.parseDecklist}
        createScene={deps.createScene}
        faces={deps.faces}
        settings={deps.settings}
        sets={deps.sets}
        {shell}
      />
    {:else}
      {@render hud()}
    {/if}
  {:else}
    {@render hud()}
  {/if}
{/snippet}

<div class="table-frame" data-testid="table-frame" data-kind={props.kind}>
  {#if networked && props.session.role === 'spectator' && deps && props.link && deps.identity && deps.decks}
    <SpectatorView session={props.session} game={deps.game} link={props.link} identity={deps.identity} decks={deps.decks} cardData={deps.cardData} parseDecklist={deps.parseDecklist} createScene={deps.createScene} faces={deps.faces} settings={deps.settings} />
  {:else}
    {#if gather}
      <Gathering {muster} table={st} code={props.code} onhome={() => void leave()} onreadonly={(on) => (readOnly = on)}>
        {@render table()}
      </Gathering>
    {:else}
      {@render table()}
    {/if}

    {#if dealing}<Versus session={props.session} creator={me === 's0'} />{/if}
    <ConcedeChip session={props.session} />
    {#if st.result}<GameOver session={props.session} onhome={() => void leave()} />{/if}

    {#if networked && deps}
      <RecoveryPanel session={props.session} cardData={deps.cardData} parse={deps.parseDecklist ?? parsePlainList} />
      {#if st.stage !== 'lobby'}<SpectatorPanel session={props.session} />{/if}
    {/if}
  {/if}

  {#if networked}
    <!-- M5-P3: a new version waits for the lobby (never mid-game), and the Home Screen hint shows in the lobby only, away from play. -->
    <UpdateNotice update={deps?.update} place={{ route: 'room', stage: st.stage }} />
    {#if st.stage === 'lobby'}<Hints settings={deps?.settings} hints={['installHomeScreen']} placement="corner" />{/if}
    <VersionNotice session={props.session} />
  {/if}

  {#if !HUD_SHELL && props.kind !== 'sandbox'}
    <!-- The fallback bar while the HUD does not show the shell's slots (contracts.md Part C; PLAN "If a package is parked"). -->
    <div class="frame-bar ds-root" data-testid="frame-bar">
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--xs" data-testid="frame-leave" onclick={() => void leave()}>Leave</button>
      {#if override}
        <button type="button" class="ds-btn ds-btn--xs {override.quiet ? 'ds-btn--quiet' : 'ds-btn--primary'}" data-testid="frame-primary" onclick={() => override.run()}>{override.label}</button>
      {/if}
      {#if shell.status}<span class="frame-status">{@render shell.status()}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .table-frame {
    position: relative;
    height: 100%;
  }
  .frame-bar {
    position: fixed;
    z-index: 30;
    top: 8px;
    left: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .frame-status {
    display: inline-flex;
    align-items: center;
  }
</style>
