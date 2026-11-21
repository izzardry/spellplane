<!--
  The table frame (docs/design/m8/contracts.md Part C "Table frame"): every table route renders it. By stage and kind it
  chooses the waiting room (through ui/flow/Stage.svelte), the matched entry (when a MatchRecord exists for the code),
  Versus (while the automatic setup runs), the draft and build stages, the HUD (inside Gathering when `gather`), and
  GameOver once TableState.result is set. It builds HudShellProps from `onleave`, menu-top.ts, SeatMenu, SeatBadge,
  presence.ts, the notice store and `extraShell`, and starts the checkpointer on mount. While the HUD does not honour
  the shell props (HUD_SHELL false) a fallback bar (`frame-bar`: Leave, the primaryOverride button, the status) stands
  in, except in the sandbox. A simple working version by M8-C; finished by M8-P8: the "This game" menu with `Invite…`
  (the invite sheet; private networked tables only) and `Concede` behind one confirm; the browser's Back leaves like
  the arrow (App asks the frame through the leave guard of ui/table/context.ts); the checkpointer goes to leave.ts with
  the leave; a cover in the look's backdrop cross-fades to the table (150 ms, opacity only) once the scene drew its
  first frame (contracts.md Part G "Journey and Home" item 4).
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
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
  import Button from '../design/Button.svelte';
  import Dialog from '../design/Dialog.svelte';
  import InviteSheet from '../lobby/InviteSheet.svelte';
  import { codeLabel } from '../lobby/waiting';
  import { leaveGuardHost, tableDeps } from './context';
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
  onDestroy(() => checkpointer.stop());
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

  // The rating line of the game-over overlay (matchmaking.md 2.4): the rating watcher (session/match-room.ts) writes
  // `rated` into the MatchRecord once the result is in, so the record is read again until it carries it (ranked only).
  const resultAt = $derived(st.result?.atSeq ?? null);
  $effect(() => {
    const at = resultAt;
    const code = props.code;
    const matches = deps?.matches;
    if (at === null || !code || !matches || !networked) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      matches.get(code).then(
        (r) => {
          if (cancelled) return;
          record = r;
          if (r && r.queue.endsWith('.ranked') && !r.rated && ++tries < 40) timer = setTimeout(read, 250);
        },
        () => undefined,
      );
    };
    read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  });

  let readOnly = $state(false);

  // Leaving (journey.md 4.10 "Leaving"): the arrow, `Leave to home`, the own plate's `Leave table`, GameOver's HOME and
  // the browser's Back all take this one path, once. leave.ts saves (the checkpointer), leaves, disposes, goes Home and
  // shows the one toast.
  let left = false;
  const guardHost = untrack(() => (props.kind === 'sandbox' ? null : leaveGuardHost()));
  function leave(): Promise<void> {
    if (left) return Promise.resolve();
    left = true;
    guardHost?.(null);
    return Promise.resolve(props.onleave({ checkpointer })).then(
      () => undefined,
      () => undefined,
    );
  }
  // The browser's Back (or any hash change the frame did not make) leaves like the arrow: App holds the table route
  // until this ran. The sandbox lives for the page and is not guarded.
  onMount(() => {
    guardHost?.(leave);
    return () => {
      if (!left) guardHost?.(null);
    };
  });

  // `Concede` asks once (journey.md 4.10, 4.13).
  let conceding = $state(false);
  function confirmConcede(): void {
    conceding = false;
    void concede(session);
  }
  // `Invite…` opens the invite sheet of a private networked table (not a matched or computer one).
  let inviting = $state(false);
  const inviteLink = $derived(props.kind === 'room' && !st.settings.matched && props.link ? props.link : null);
  const openSeats = $derived(Object.values(st.seats).filter((x) => x.peer === undefined).length);

  // The cover (contracts.md Part G "Journey and Home" item 4): the look's backdrop over the table until the scene drew
  // its first frame, then a 150 ms fade of its opacity. A stage without a scene (the waiting room) fades at once; it
  // never waits longer than 3 s. Nothing runs per frame after that.
  let frameEl = $state<HTMLElement | undefined>();
  let covered = $state(true);
  let coverGone = $state(false);
  onMount(() => {
    let done = false;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let observer: MutationObserver | null = null;
    const reveal = (): void => {
      if (done) return;
      done = true;
      observer?.disconnect();
      covered = false;
      timers.push(setTimeout(() => (coverGone = true), 400));
    };
    // The scene draws on the animation frame after its canvas is in the page: two frames after it appears, it drew.
    const afterCanvas = (): void => {
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(reveal)));
    };
    const hasCanvas = (): boolean => !!frameEl?.querySelector('canvas');
    if (hasCanvas()) afterCanvas();
    else if (frameEl && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (!hasCanvas()) return;
        observer?.disconnect();
        observer = null;
        afterCanvas();
      });
      observer.observe(frameEl, { childList: true, subtree: true });
      // A stage with no scene (waiting room, draft, an error page): reveal soon.
      timers.push(setTimeout(() => (hasCanvas() ? undefined : reveal()), 600));
    } else reveal();
    timers.push(setTimeout(reveal, 3000));
    return () => {
      done = true;
      observer?.disconnect();
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
    };
  });

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
      menuTop: () =>
        menuTop(props.kind, st, me, {
          leave: () => void leave(),
          concede: me ? () => (conceding = true) : undefined,
          invite: inviteLink && openSeats > 0 ? () => (inviting = true) : undefined,
        }),
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

<div class="table-frame" bind:this={frameEl} data-testid="table-frame" data-kind={props.kind}>
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
    {#if st.result}<GameOver session={props.session} {record} onhome={() => void leave()} />{/if}

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

  {#if inviting && inviteLink}
    <div class="frame-sheet ds-root" data-testid="frame-invite">
      <InviteSheet
        title="Invite players"
        text="Send this link, or let them scan the code. Whoever opens it sits down at your table."
        link={inviteLink.url}
        code={codeLabel(inviteLink.roomId)}
        status={openSeats > 0 ? `${openSeats} open ${openSeats === 1 ? 'seat' : 'seats'}` : 'Every seat is taken'}
        onclose={() => (inviting = false)}
      />
    </div>
  {/if}

  {#if conceding}
    <div class="ds-root">
      <Dialog open={conceding} label="Concede this game?" onclose={() => (conceding = false)} testid="concede-confirm">
        <p class="ds-t-reading">The others see that you conceded. The table stays open for a rematch.</p>
        {#snippet footer()}
          <Button variant="ghost" size="md" onclick={() => (conceding = false)} data-testid="concede-cancel">CANCEL</Button>
          <Button variant="danger" size="md" onclick={confirmConcede} data-testid="concede-ok">CONCEDE</Button>
        {/snippet}
      </Dialog>
    </div>
  {/if}

  {#if !coverGone && props.kind !== 'sandbox'}
    <div class="frame-cover" class:revealed={!covered} aria-hidden="true" data-testid="frame-cover" data-covered={covered}></div>
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
  .frame-sheet {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .frame-sheet > :global(*) {
    pointer-events: auto;
  }
  /* The look's backdrop over the table until its first frame; a fade of opacity only (visual.md motion). */
  .frame-cover {
    position: fixed;
    z-index: 25;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 60%, var(--ds-mat), var(--ds-frame));
    opacity: 1;
    transition: opacity 150ms ease-out;
  }
  .frame-cover.revealed {
    opacity: 0;
  }
  .frame-status {
    display: inline-flex;
    align-items: center;
  }
</style>
