<!--
  The `#/t/<room>/<key>` route (PLAN M1-P5, M1-P8): the networked table (TableRoom: lobby, then the HUD) once a session
  for the room is at hand, otherwise a page saying what is happening. With `/watch` appended (M3-P5; DESIGN "Players,
  seats and formats", Spectators: "joins by the same link without taking a chair") the page joins as a spectator; a
  player's join that fails or takes long offers to watch instead. The session is main.ts's (AppProps.session when
  its roomId matches this room), or the one `app.openRoom` (main.ts, see RoomOpener) joins for this link; the route leaves a session it
  opened when it goes away. The share link is AppProps.link when main.ts hands one for this room, else it is derived
  from the fragment.
-->
<script lang="ts">
  import { EMPTY_STATES } from '../empty/states';
  import type { NetSession, TableSession } from '../../session/types';
  import type { DeckStore, IdentityStore } from '../../store/types';
  import type { AppProps, RoomLink } from '../types';
  import TableRoom from './TableRoom.svelte';
  import { CONNECT_CHECK_MS, RELAYS_TEXT } from './connectivity';
  import { pageBase, parseRoomLink } from './room';
  import { parseRoute, routeHash } from '../routes';
  import { lobbyStores } from './start';
  import { applyPendingSetup } from '../play/launch';
  import Button from '../design/Button.svelte';

  /** After this long a join reads `Still connecting…` (journey.md 4.9). */
  const STILL_CONNECTING_MS = 10_000;

  /**
   * Joins the networked table of a room link and resolves once this browser holds a chair (main.ts, over the page's
   * transport). Handed by main.ts next to AppProps and declared here, not in the ui/types.ts contract (decision M1-P8):
   * the integrator may take it into AppProps.
   */
  type RoomOpener = { openRoom?: (link: RoomLink, as?: { watch?: boolean }) => Promise<NetSession> };
  let { app, room: roomId, roomKey, cssVars }: { app: Partial<AppProps> & RoomOpener; room: string; roomKey: string; cssVars: string } = $props();

  type RoomView = { session: TableSession; link: RoomLink; identity: IdentityStore; decks: DeckStore };
  /** Whether the fragment is this room's spectator link (`#/t/<room>/<key>/watch`); App keys this route by room and key only. */
  const watchingIn = (hash: string): boolean => {
    const r = parseRoute(hash);
    return r.name === 'room' && r.room === roomId && r.key === roomKey && r.watch === true;
  };
  let watching = $state(typeof location === 'undefined' ? false : watchingIn(location.hash));
  const watchHash = $derived(routeHash({ name: 'room', room: roomId, key: roomKey, watch: true }));
  const link = $derived.by((): RoomLink | null => {
    const given = app.link;
    if (given && given.roomId === roomId && given.roomKey === roomKey) return given;
    return parseRoomLink(pageBase(typeof location === 'undefined' ? '' : location.href), `#/t/${roomId}/${roomKey}`);
  });
  let room = $state.raw<RoomView | null>(null);
  let joinState = $state<'none' | 'joining' | 'failed'>('none');
  let error = $state('');

  function lobbyDeps(): Promise<{ identity: IdentityStore; decks: DeckStore }> {
    return app.identity && app.decks ? Promise.resolve({ identity: app.identity, decks: app.decks }) : lobbyStores().then((s) => ({ identity: s.identity, decks: s.decks }));
  }

  $effect(() => {
    const l = link;
    if (!l) return;
    const watch = watching;
    // main.ts hands a seated session only; a spectator's page always joins the room itself.
    const given = watch ? undefined : app.session;
    const openRoom = app.openRoom;
    if (!(given && given.roomId === l.roomId) && !openRoom) return;
    let cancelled = false;
    let opened: { leave(): void } | null = null;
    joinState = 'joining';
    // main.ts handed in the session for this room, or the route joins the room itself (M1-P8).
    const session: Promise<TableSession> =
      given && given.roomId === l.roomId
        ? Promise.resolve(given)
        : openRoom!(l, { watch }).then((s) => {
            if (cancelled) s.leave();
            else opened = s;
            return s;
          });
    Promise.all([session, lobbyDeps()]).then(
      ([s, deps]) => {
        if (cancelled) return;
        // A room Home just created (PRIVATE GAME, DRAFT NIGHT): its creator applies the automatic setup, the format and
        // the lobby settings of the booster setup once (ui/play/launch.ts; contracts.md Part C). Nothing for a joiner.
        if (!watch && s.seat) applyPendingSetup(s);
        room = { session: s, link: l, ...deps };
        joinState = 'none';
      },
      (e: unknown) => {
        if (cancelled) return;
        joinState = 'failed';
        error = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
      opened?.leave();
      room = null;
      joinState = 'none';
    };
  });

  // Joining that never completes: after 10 s `Still connecting…` (journey.md 4.9), then the signalling relays are out
  // of reach (DESIGN "Multiplayer architecture": say so plainly).
  let joinLong = $state(false);
  let joinSlow = $state(false);
  $effect(() => {
    if (joinState !== 'joining') return;
    const long = setTimeout(() => (joinLong = true), STILL_CONNECTING_MS);
    const t = setTimeout(() => (joinSlow = true), CONNECT_CHECK_MS);
    return () => {
      clearTimeout(long);
      clearTimeout(t);
      joinLong = false;
      joinSlow = false;
    };
  });
  /** A join refused because every chair is taken (session/net.ts: before the game, or once it has started). */
  const full = $derived(/\bfull\b/i.test(error));
  const startedFull = $derived(/started and every chair is taken/i.test(error));

  /**
   * Follow `/watch` being added or dropped on this room's link. A change to another page is not followed: App may keep
   * this route mounted while its leave guard runs, and reading such a change as "not watching" would sit a spectator
   * down at the table (M8-P8).
   */
  function followHash(): void {
    const r = parseRoute(location.hash);
    if (r.name === 'room' && r.room === roomId && r.key === roomKey) watching = r.watch === true;
  }
</script>

<svelte:window onhashchange={followHash} />

{#if room && app.createScene && app.faces && app.cardData && app.game}
  <div class="fill" style={cssVars} data-testid="route-room">
    {#key room}
      <TableRoom
        session={room.session}
        game={app.game}
        link={room.link}
        identity={room.identity}
        decks={room.decks}
        cardData={app.cardData}
        parseDecklist={app.parseDecklist}
        createScene={app.createScene}
        faces={app.faces}
        settings={app.settings}
        sets={app.sets}
        update={app.update}
        games={app.games ?? null}
        matches={app.matches ?? null}
        ratings={app.ratings ?? null}
      />
    {/key}
  </div>
{:else}
  <!-- Joining and failure pages (journey.md 4.9): kit type and buttons, one way Home, WATCH where a chair cannot be had. -->
  <main class="ds-page ds-root join-page" style={cssVars} data-testid="route-room">
    <p class="ds-t-eyebrow">Table</p>
    {#if !link}
      <p class="ds-t-reading" role="alert" data-testid="room-malformed">This is not a complete table link. Ask for it again.</p>
    {:else if joinState === 'joining'}
      <p class="ds-t-reading" role="status" data-testid="room-joining">{joinLong ? 'Still connecting…' : watching ? 'Joining the table as a spectator…' : 'Joining the table…'}</p>
      {#if joinSlow}<p class="ds-t-reading" role="alert" data-testid="connectivity-problem"><strong>{EMPTY_STATES.relayUnreachable.title}.</strong> {RELAYS_TEXT}</p>{/if}
    {:else if joinState === 'failed'}
      <p class="ds-t-reading" role="alert" data-testid="room-error">
        {startedFull
          ? "This game has started and every seat is taken. If one of them is yours, ask a player at the table to bring you back from your name's menu."
          : full
            ? 'This table is full.'
            : `Could not join this table: ${error}`}
      </p>
    {:else}
      <p class="ds-t-reading">This page cannot join tables.</p>
    {/if}
    <div class="ds-row join-actions">
      {#if link && !watching && (joinState === 'failed' || joinLong)}
        <Button href={watchHash} size="md" data-testid="watch-instead">{joinState === 'failed' ? 'WATCH' : 'WATCH INSTEAD'}</Button>
      {:else if link && !watching && joinState === 'joining'}
        <Button href={watchHash} size="md" variant="quiet" data-testid="watch-instead">WATCH WITHOUT A CHAIR</Button>
      {/if}
      <Button href="#/" size="md" variant="ghost" data-testid="room-home">HOME</Button>
    </div>
  </main>
{/if}

<style>
  .fill {
    height: 100%;
  }
  .join-page {
    max-width: 40em;
    margin: 0 auto;
    padding: 48px 16px;
    display: grid;
    gap: 16px;
  }
  .join-actions {
    gap: 8px;
  }
</style>
