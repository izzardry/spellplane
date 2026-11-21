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
  import MatchHost from '../play/MatchHost.svelte';
  import QueueChip from '../play/QueueChip.svelte';
  import { launchDeps } from '../home/deps';
  import { FakeMatchmaker } from '../fakes';
  import { findAgain, soloAgain, soloAgainLabel } from './again';
  import { leaveGuardHost, tableDeps } from './context';
  import { menuTop } from './menu-top';
  import { notices, type TableNotice } from './notices';
  import type { TableFrameProps } from './types';

  let props: TableFrameProps = $props();
  /** How long Versus stays after it is done, ms: its "goes first" line is read (decision M8-P8). */
  const VERSUS_READ_MS = 600;
  /** How long a notice stays in the slot, ms: as long as the HUD's toast shows it (Hud.svelte, 6 s; 10 s with an action). */
  const NOTICE_MS = 6000;
  const NOTICE_ACTION_MS = 10000;

  // The page's context, read once at init (getContext): a route that passes its own `deps` (TableRoom, the computer
  // route) still gets the page's matchmaker and practice opener from it.
  const pageDeps = tableDeps();
  const deps = $derived(props.deps ?? pageDeps);
  const session = $derived(props.session);
  const networked = $derived(props.kind === 'room' || props.kind === 'matched');
  const gather = $derived(props.gather ?? networked);

  let st = $state.raw<TableState>(untrack(() => props.session.getState()));
  onMount(() => props.session.subscribe((s) => (st = s)));
  let net = $state.raw<SessionNetStatus>(untrack(() => props.session.netStatus()));
  onMount(() => props.session.subscribeNet((s) => (net = s)));
  // The page's notice slot is this table's while the frame is mounted: a notice of an earlier table (or an earlier
  // frame of this one) never shows here, and a notice leaves the slot once the HUD's toast for it has run out, so a
  // HUD mounted again later (a rematch, a stage change) does not show it a second time.
  notices.clear();
  let notice = $state.raw<TableNotice | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() =>
    notices.subscribe((n) => {
      notice = n;
      clearTimeout(noticeTimer);
      if (n) noticeTimer = setTimeout(() => notices.clear(n.id), n.action ? NOTICE_ACTION_MS : NOTICE_MS);
    }),
  );
  onDestroy(() => {
    clearTimeout(noticeTimer);
    notices.clear();
  });

  // The viewer's theme (PLAN M4-P6); Paper where no app shell provides the choice (a harness).
  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));

  // Saving (persistence.md section 2): the checkpointer runs while the frame is mounted (a stub until M8-P2).
  // A spectator's watching is not a game of theirs: nothing goes into History. A networked table's key is the link's,
  // never read from the address at leave time (the browser's Back has already changed it).
  const spectator = untrack(() => props.session.role === 'spectator');
  const checkpointer = untrack(() => createCheckpointer(props.session, spectator ? null : props.games, props.link ? { key: props.link.roomKey } : {}));
  onDestroy(() => checkpointer.stop());
  const muster = untrack(() => createSessionMuster(props.session));
  // The automatic setup (contracts.md Part D, session/entry.ts): deals and rolls once per seat and game at a table with
  // `autoSetup`; does nothing at a table opened the old way. Not in the sandbox.
  onMount(() => (props.kind === 'sandbox' ? undefined : startAutoSetup(props.session)));

  // A MatchRecord for this code makes the table a matched one (matchmaking.md 2.9). Until the lookup settled, a
  // networked table in the lobby stage shows nothing under the cover: a matched table never shows its waiting room.
  let record = $state.raw<MatchRecord | null>(null);
  let recordChecked = $state(untrack(() => !props.code || !deps?.matches || !networked));
  $effect(() => {
    const code = props.code;
    const matches = deps?.matches;
    if (!code || !matches || !networked) {
      recordChecked = true;
      return;
    }
    let cancelled = false;
    matches.get(code).then(
      (r) => {
        if (cancelled) return;
        record = r;
        recordChecked = true;
      },
      () => {
        if (!cancelled) recordChecked = true;
      },
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
  // A spectator holds no seat and has nothing to save: the Back leaves the page at once, as before M8-P8.
  const guardHost = untrack(() => (props.kind === 'sandbox' || spectator ? null : leaveGuardHost()));
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
  let covered = $state(true);
  let coverGone = $state(false);
  /** The frame's root watches for the scene's canvas (an action: it gets the node at mount). */
  function firstFrame(node: HTMLElement): { destroy(): void } {
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
    const hasCanvas = (): boolean => !!node.querySelector('canvas');
    if (hasCanvas()) afterCanvas();
    else if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (!hasCanvas()) return;
        observer?.disconnect();
        observer = null;
        afterCanvas();
      });
      observer.observe(node, { childList: true, subtree: true });
      // A stage with no scene (waiting room, draft, an error page): reveal soon.
      timers.push(setTimeout(() => (hasCanvas() ? undefined : reveal()), 600));
    } else reveal();
    timers.push(setTimeout(reveal, 3000));
    return {
      destroy() {
        observer?.disconnect();
        cancelAnimationFrame(raf);
        for (const t of timers) clearTimeout(t);
      },
    };
  }

  const me = $derived<SeatId | null>(session.seat);
  // Seat presence (presence.ts): the plate menu's connection line reads connecting too; the HUD's plates here or away.
  const allPresence = $derived(gather ? seatPresence(st, net.peers, me) : null);
  const presence = $derived.by((): Readonly<Record<SeatId, 'here' | 'away'>> | undefined => {
    if (!allPresence) return undefined;
    const out: Record<SeatId, 'here' | 'away'> = {};
    for (const [seat, p] of Object.entries(allPresence)) out[seat] = p === 'away' ? 'away' : 'here';
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
  // Versus (journey.md 4.7) comes up while this seat's deal runs and stays until the screen itself says it is done
  // (every player connected and dealt, at least 1.2 s on screen), then a short moment more, so its last line (who goes
  // first) is read before the table opens.
  let versus = $state(false);
  let versusHold: ReturnType<typeof setTimeout> | undefined;
  // Networked tables only: a computer game has its own shorter start (computer.md 2.2), a practice table none.
  $effect(() => {
    if (dealing && networked) versus = true;
  });
  function versusDone(): void {
    clearTimeout(versusHold);
    versusHold = setTimeout(() => (versus = false), VERSUS_READ_MS);
  }
  onDestroy(() => clearTimeout(versusHold));

  // The game-over overlay's primary (journey.md 4.13): a matched game searches again with the same setup; a solo table
  // opens a new game of its kind (REMATCH against Sparring, AGAIN alone). Each leaves this table first.
  const solo = $derived(props.kind === 'computer' || props.kind === 'practice' ? props.kind : null);
  const matchmaker = $derived(deps?.matchmaker ?? pageDeps?.matchmaker ?? null);
  function findAnother(): void {
    const r = record;
    void leave().then(() => void findAgain(matchmaker, r));
  }
  const again = $derived.by(() => {
    const k = solo;
    const code = props.code;
    if (!k || !code || !deps) return undefined;
    const page = deps;
    const games = props.games;
    return {
      label: soloAgainLabel(k),
      run: () =>
        void leave()
          .then(() =>
            soloAgain(
              launchDeps({}, { games, go: (h) => (location.hash = h), openPractice: page.openPractice ?? pageDeps?.openPractice, now: () => Date.now(), page, matchmaker: matchmaker ?? new FakeMatchmaker() }),
              k,
              code,
            ),
          )
          .catch(() => undefined),
    };
  });
</script>

{#snippet plateMenuTop(seat: SeatId, close: () => void)}
  <SeatMenu table={st} {seat} {me} {muster} presence={allPresence?.[seat]} onleave={seat === me ? () => (close(), void leave()) : undefined} />
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
    {#if st.stage === 'lobby' && !recordChecked}
      <!-- Looking up the MatchRecord: the cover is over the table; neither the waiting room nor the matched entry yet. -->
    {:else if record && st.stage === 'lobby'}
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

<div class="table-frame" use:firstFrame data-testid="table-frame" data-kind={props.kind}>
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

    {#if versus}<Versus session={props.session} creator={me === 's0'} ondone={versusDone} onhome={() => void leave()} />{/if}
    <ConcedeChip session={props.session} />
    {#if st.result}<GameOver session={props.session} {record} kind={solo ? 'solo' : undefined} onfind={networked ? findAnother : undefined} {again} onhome={() => void leave()} />{/if}
    {#if solo && matchmaker}
      <!-- Practise while you wait (journey.md 4.5; computer.md D15): the queue bar at the table's top edge and the match
           found card over the table; ACCEPT moves to the match's room, and the leave guard saves this game first. -->
      <div class="frame-queue"><QueueChip {matchmaker} onhome={() => void leave()} /></div>
      <MatchHost {matchmaker} />
    {/if}

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
          <Button variant="ghost" size="md" onclick={() => (conceding = false)} data-testid="concede-cancel">KEEP PLAYING</Button>
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
  .frame-queue {
    position: fixed;
    z-index: 35;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .frame-queue > :global(*) {
    pointer-events: auto;
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
