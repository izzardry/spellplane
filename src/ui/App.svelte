<!--
  App shell with hash routing (PLAN M0-P4): `#/` is the solo table, `#/t/<room>/<key>` a networked table (lobby, then
  the HUD), `#/lobby` the start page and `#/diag` (or `#/diag/<room>/<key>`) the connection check (PLAN M1-P5). Props come
  from main.ts (ui/types.ts AppProps); without a session the shell shows the bootstrap stage. Until main.ts hands in a
  networked session for the room (M1-P8), dev and test builds join it with the stand-in session of ui/lobby/dev-room.ts
  when a dev transport is selected (`?transport=local`).
-->
<script lang="ts">
  import { paper } from '../themes/paper/index';
  import { tokensToCssVars } from '../themes/index';
  import type { TableSession } from '../session/types';
  import type { DeckStore, IdentityStore } from '../store/types';
  import type { AppProps, DiagProps, RoomLink, StartPageProps } from './types';
  import Hud from './Hud.svelte';
  import Smoke from './Smoke.svelte';
  import Diag from './diag/Diag.svelte';
  import StartPage from './lobby/StartPage.svelte';
  import TableRoom from './lobby/TableRoom.svelte';
  import { CONNECT_CHECK_MS, RELAYS_TEXT } from './lobby/connectivity';
  import { pageBase, parseRoomLink } from './lobby/room';
  import { defaultStartProps, lobbyStores } from './lobby/start';
  import { parseRoute, type Route } from './routes';

  let props: Partial<AppProps> = $props();

  let route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));
  const cssVars = Object.entries(tokensToCssVars(paper.tokens))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  // --- #/lobby -------------------------------------------------------------------------------------------------
  let start = $state.raw<StartPageProps | null>(null);
  let startError = $state('');
  $effect(() => {
    if (route.name !== 'lobby' || start) return;
    if (props.start) start = props.start;
    else
      defaultStartProps()
        .then((s) => (start = s))
        .catch((e: unknown) => (startError = `Local storage is unavailable: ${e instanceof Error ? e.message : String(e)}`));
  });

  // --- #/diag ----------------------------------------------------------------------------------------------------
  const diagRoom = $derived(route.name === 'diagJoin' ? { roomId: route.room, roomKey: route.key } : null);
  let diag = $state.raw<DiagProps | null>(null);
  $effect(() => {
    if (route.name !== 'diag' && route.name !== 'diagJoin') return;
    const room = diagRoom;
    if (props.diag) {
      diag = { ...props.diag, room };
      return;
    }
    if (__SPELLPLANE_DEBUG__) {
      void import('./lobby/dev-room').then((m) => (diag = m.devDiagProps(room)));
      return;
    }
    diag = {
      createTransport: () => {
        throw new Error('the peer-to-peer transport is not wired into this build yet');
      },
      room,
      now: () => Date.now(),
    };
  });

  // --- #/t/<room>/<key> ------------------------------------------------------------------------------------------
  type RoomView = { session: TableSession; link: RoomLink; identity: IdentityStore; decks: DeckStore; dispose?: () => void };
  const roomLink = $derived(route.name === 'room' ? parseRoomLink(pageBase(typeof location === 'undefined' ? '' : location.href), `#/t/${route.room}/${route.key}`) : null);
  let room = $state.raw<RoomView | null>(null);
  let roomState = $state<'none' | 'joining' | 'failed'>('none');
  let roomError = $state('');
  $effect(() => {
    const link = roomLink;
    if (!link) return;
    const session = props.session;
    // main.ts handed in the networked session for this room (M1-P8).
    if (session && session.roomId === link.roomId) {
      let cancelled = false;
      const ids = props.identity && props.decks ? Promise.resolve({ identity: props.identity, decks: props.decks }) : lobbyStores().then((s) => ({ identity: s.identity, decks: s.decks }));
      ids.then((x) => {
        if (!cancelled) room = { session, link, ...x };
      }, (e: unknown) => {
        roomState = 'failed';
        roomError = e instanceof Error ? e.message : String(e);
      });
      return () => {
        cancelled = true;
        room = null;
      };
    }
    if (!__SPELLPLANE_DEBUG__ || !props.game || !props.cardData) return;
    const game = props.game;
    const cardData = props.cardData;
    let cancelled = false;
    let opened: RoomView | null = null;
    roomState = 'joining';
    void import('./lobby/dev-room').then(async (m) => {
      if (cancelled || !m.devTransportKind()) {
        roomState = 'none';
        return;
      }
      try {
        const r = await m.openDevRoom(link, { game, cardData, ...(props.parseDecklist ? { parseDecklist: props.parseDecklist } : {}) });
        if (cancelled) return r.session.leave();
        opened = { session: r.session, link, identity: r.identity, decks: r.stores.decks, dispose: () => r.session.leave() };
        room = opened;
        roomState = 'none';
      } catch (e) {
        if (cancelled) return;
        roomState = 'failed';
        roomError = e instanceof Error ? e.message : String(e);
      }
    });
    return () => {
      cancelled = true;
      opened?.dispose?.();
      room = null;
      roomState = 'none';
    };
  });
  // Joining that never completes: the signalling relays are out of reach (DESIGN "Multiplayer architecture": say so plainly).
  let joinSlow = $state(false);
  $effect(() => {
    if (roomState !== 'joining') return;
    const t = setTimeout(() => (joinSlow = true), CONNECT_CHECK_MS);
    return () => {
      clearTimeout(t);
      joinSlow = false;
    };
  });
</script>

<svelte:window onhashchange={() => (route = parseRoute(location.hash))} />

{#if route.name === 'solo'}
  {#if props.session && props.createScene && props.faces && props.cardData && props.game}
    <Hud
      session={props.session}
      createScene={props.createScene}
      faces={props.faces}
      cardData={props.cardData}
      game={props.game}
      theme={paper}
      settings={props.settings}
      parseDecklist={props.parseDecklist}
    />
  {:else}
    <Smoke />
  {/if}
{:else if route.name === 'room' && room && props.createScene && props.faces && props.cardData && props.game}
  <div class="fill" style={cssVars} data-testid="route-room">
    {#key room}
      <TableRoom
        session={room.session}
        game={props.game}
        link={room.link}
        identity={room.identity}
        decks={room.decks}
        cardData={props.cardData}
        parseDecklist={props.parseDecklist}
        createScene={props.createScene}
        faces={props.faces}
        settings={props.settings}
      />
    {/key}
  </div>
{:else}
  <main class="page" style={cssVars} data-testid="route-{route.name === 'diagJoin' ? 'diag' : route.name}">
    {#if route.name === 'room'}
      <h1>Table {route.room}</h1>
      {#if !roomLink}
        <p role="alert">This is not a valid table link: the key at its end should be 22 letters, digits, dashes or underscores. Ask for the link again.</p>
      {:else if roomState === 'joining'}
        <p role="status" data-testid="room-joining">Joining the table…</p>
        {#if joinSlow}<p role="alert" data-testid="connectivity-problem">{RELAYS_TEXT}</p>{/if}
      {:else if roomState === 'failed'}
        <p role="alert" data-testid="room-error">Could not join this table: {roomError}</p>
      {:else}
        <p>Joining tables by link arrives with peer-to-peer play (milestone 1).</p>
      {/if}
    {:else if route.name === 'lobby'}
      {#if start}
        <StartPage {...start} />
      {:else if startError}
        <h1>Play with friends</h1>
        <p role="alert">{startError}</p>
      {:else}
        <h1>Play with friends</h1>
      {/if}
    {:else if route.name === 'diag' || route.name === 'diagJoin'}
      {#if diag}
        {#key diag}
          <Diag {...diag} />
        {/key}
      {:else}
        <h1>Connection check</h1>
      {/if}
    {:else}
      <h1>Not found</h1>
      <p>There is nothing at {route.hash}.</p>
    {/if}
    <p><a href="#/">Back to the solo table</a></p>
  </main>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #fff;
    color: #111;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  :global(#app) {
    height: 100%;
  }
  .fill {
    height: 100%;
  }
  .page {
    box-sizing: border-box;
    max-width: 40em;
    max-height: 100%;
    overflow-y: auto;
    margin: 0 auto;
    padding: 48px 16px;
    font-family: var(--sp-font);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .page a {
    color: var(--sp-fg);
  }
</style>
