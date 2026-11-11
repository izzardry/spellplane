<!--
  The `#/t/<room>/<key>` route (PLAN M1-P5): the networked table (TableRoom: lobby, then the HUD) once a session for the
  room is at hand, otherwise a page saying what is happening. The session comes from main.ts (AppProps.session whose
  roomId matches, M1-P8); until then dev and test builds with a dev transport (`?transport=local`) join through the
  stand-in session of ui/lobby/dev-room.ts, lazily imported and absent from production. The share link is
  AppProps.link when main.ts hands one for this room, else it is derived from the fragment.
-->
<script lang="ts">
  import type { TableSession } from '../../session/types';
  import type { DeckStore, IdentityStore } from '../../store/types';
  import type { AppProps, RoomLink } from '../types';
  import TableRoom from './TableRoom.svelte';
  import { CONNECT_CHECK_MS, RELAYS_TEXT } from './connectivity';
  import { pageBase, parseRoomLink } from './room';
  import { lobbyStores } from './start';

  let { app, room: roomId, roomKey, cssVars }: { app: Partial<AppProps>; room: string; roomKey: string; cssVars: string } = $props();

  type RoomView = { session: TableSession; link: RoomLink; identity: IdentityStore; decks: DeckStore; dispose?: () => void };
  const link = $derived.by((): RoomLink | null => {
    const given = app.link;
    if (given && given.roomId === roomId && given.roomKey === roomKey) return given;
    return parseRoomLink(pageBase(typeof location === 'undefined' ? '' : location.href), `#/t/${roomId}/${roomKey}`);
  });
  let room = $state.raw<RoomView | null>(null);
  let joinState = $state<'none' | 'joining' | 'failed'>('none');
  let error = $state('');

  $effect(() => {
    const l = link;
    if (!l) return;
    const session = app.session;
    // main.ts handed in the networked session for this room (M1-P8).
    if (session && session.roomId === l.roomId) {
      let cancelled = false;
      const stores = app.identity && app.decks ? Promise.resolve({ identity: app.identity, decks: app.decks }) : lobbyStores().then((s) => ({ identity: s.identity, decks: s.decks }));
      stores.then(
        (x) => {
          if (!cancelled) room = { session, link: l, ...x };
        },
        (e: unknown) => {
          joinState = 'failed';
          error = e instanceof Error ? e.message : String(e);
        },
      );
      return () => {
        cancelled = true;
        room = null;
      };
    }
    if (!__SPELLPLANE_DEBUG__ || !app.game || !app.cardData) return;
    const game = app.game;
    const cardData = app.cardData;
    const parseDecklist = app.parseDecklist;
    let cancelled = false;
    let opened: RoomView | null = null;
    joinState = 'joining';
    void import('./dev-room').then(async (m) => {
      if (cancelled || !m.devTransportKind()) {
        joinState = 'none';
        return;
      }
      try {
        const r = await m.openDevRoom(l, { game, cardData, ...(parseDecklist ? { parseDecklist } : {}) });
        if (cancelled) return r.session.leave();
        opened = { session: r.session, link: l, identity: r.identity, decks: r.stores.decks, dispose: () => r.session.leave() };
        room = opened;
        joinState = 'none';
      } catch (e) {
        if (cancelled) return;
        joinState = 'failed';
        error = e instanceof Error ? e.message : String(e);
      }
    });
    return () => {
      cancelled = true;
      opened?.dispose?.();
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
      <p>Joining tables by link arrives with peer-to-peer play (milestone 1).</p>
    {/if}
    <p><a href="#/">Back to the solo table</a></p>
  </main>
{/if}

<style>
  .fill {
    height: 100%;
  }
</style>
