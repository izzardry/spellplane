<!--
  The `#/t/<room>/<key>` route (PLAN M1-P5, M1-P8): the networked table (TableRoom: lobby, then the HUD) once a session
  for the room is at hand, otherwise a page saying what is happening. The session is main.ts's (AppProps.session when
  its roomId matches this room), or the one `app.openRoom` (main.ts, see RoomOpener) joins for this link; the route leaves a session it
  opened when it goes away. The share link is AppProps.link when main.ts hands one for this room, else it is derived
  from the fragment.
-->
<script lang="ts">
  import type { NetSession, TableSession } from '../../session/types';
  import type { DeckStore, IdentityStore } from '../../store/types';
  import type { AppProps, RoomLink } from '../types';
  import TableRoom from './TableRoom.svelte';
  import { CONNECT_CHECK_MS, RELAYS_TEXT } from './connectivity';
  import { pageBase, parseRoomLink } from './room';
  import { lobbyStores } from './start';

  /**
   * Joins the networked table of a room link and resolves once this browser holds a chair (main.ts, over the page's
   * transport). Handed by main.ts next to AppProps and declared here, not in the ui/types.ts contract (decision M1-P8):
   * the integrator may take it into AppProps.
   */
  type RoomOpener = { openRoom?: (link: RoomLink) => Promise<NetSession> };
  let { app, room: roomId, roomKey, cssVars }: { app: Partial<AppProps> & RoomOpener; room: string; roomKey: string; cssVars: string } = $props();

  type RoomView = { session: TableSession; link: RoomLink; identity: IdentityStore; decks: DeckStore };
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
    const given = app.session;
    const openRoom = app.openRoom;
    if (!(given && given.roomId === l.roomId) && !openRoom) return;
    let cancelled = false;
    let opened: { leave(): void } | null = null;
    joinState = 'joining';
    // main.ts handed in the session for this room, or the route joins the room itself (M1-P8).
    const session: Promise<TableSession> =
      given && given.roomId === l.roomId
        ? Promise.resolve(given)
        : openRoom!(l).then((s) => {
            if (cancelled) s.leave();
            else opened = s;
            return s;
          });
    Promise.all([session, lobbyDeps()]).then(
      ([s, deps]) => {
        if (cancelled) return;
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

  // Joining that never completes: the signalling relays are out of reach (DESIGN "Multiplayer architecture": say so plainly).
  let joinSlow = $state(false);
  $effect(() => {
    if (joinState !== 'joining') return;
    const t = setTimeout(() => (joinSlow = true), CONNECT_CHECK_MS);
    return () => {
      clearTimeout(t);
      joinSlow = false;
    };
  });
</script>

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
      />
    {/key}
  </div>
{:else}
  <main class="sp-page" style={cssVars} data-testid="route-room">
    <h1>Table {roomId}</h1>
    {#if !link}
      <p role="alert">This is not a valid table link: the key at its end should be 22 letters, digits, dashes or underscores. Ask for the link again.</p>
    {:else if joinState === 'joining'}
      <p role="status" data-testid="room-joining">Joining the table…</p>
      {#if joinSlow}<p role="alert" data-testid="connectivity-problem">{RELAYS_TEXT}</p>{/if}
    {:else if joinState === 'failed'}
      <p role="alert" data-testid="room-error">Could not join this table: {error}</p>
    {:else}
      <p>This page cannot join tables.</p>
    {/if}
    <p><a href="#/">Back to the solo table</a></p>
  </main>
{/if}

<style>
  .fill {
    height: 100%;
  }
</style>
