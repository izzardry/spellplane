<!--
  A spectator's page (PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: "joins by the same link without
  taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may reveal their hand to a
  named spectator"). In the match it is the table HUD over the spectator's session, seen from seat 0's side (the scene
  treats a viewer without a chair so), with a bar at the bottom that says it is watching and lists the cards a player
  showed this spectator. Before the match it says which stage the evening is in and who sits at the table. The
  session decides what this page may do: chat and ping reach the table, every other action is refused by the
  sequencer. A page whose key pair holds a chair at this table leaves the room (session/spectator.ts `heldChair`) and
  offers that chair instead.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SecretStore, TableState } from '../../core/types';
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import type { CreateTableScene } from '../../scene/types';
  import type { SessionNetStatus } from '../../session/types';
  import type { SettingsStore } from '../../store/types';
  import { paper } from '../../themes/paper/index';
  import { tokensToCssVars } from '../../themes/index';
  import Hud from '../Hud.svelte';
  import type { LobbyProps } from '../types';
  import { hasFreeChair, heldChairOf, playHash, seatedPlayers, shownToMe, stageText, watchers } from './spectate';

  let props: LobbyProps & { createScene: CreateTableScene; faces: FaceSource; cardData: CardDataSource; settings?: SettingsStore | undefined; sets?: SetDataSource | undefined } = $props();

  const session = untrack(() => props.session);
  const theme = paper;
  const cssVars = Object.entries(tokensToCssVars(theme.tokens))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  let st = $state.raw<TableState>(session.getState());
  let secrets = $state.raw<SecretStore>(session.secrets());
  let net = $state.raw<SessionNetStatus>(session.netStatus());
  let held = $state<string | null>(heldChairOf(session));
  onMount(() => {
    const a = session.subscribe((s) => {
      st = s;
      secrets = session.secrets();
      held = heldChairOf(session);
    });
    const b = session.subscribeNet((n) => (net = n));
    return () => {
      a();
      b();
    };
  });

  const stage = $derived(st.stage);
  const shown = $derived(shownToMe(st, secrets));
  const players = $derived(seatedPlayers(st));
  const others = $derived(watchers(net.peers));
  const connected = $derived(net.peers.some((p) => p.role === 'player' && p.status === 'connected'));
  const nameOf = (sid: string): string => session.cardData({ sid })?.name ?? 'Card';
</script>

<div class="watch" style={cssVars} data-testid="spectator-view" data-stage={stage}>
  {#if held !== null}
    <main class="waiting" aria-labelledby="watch-title">
      <h1 id="watch-title">Watching table <span class="room">{props.link.roomId}</span></h1>
      <p role="alert" data-testid="spectator-held-chair">
        This browser holds a chair at this table{st.seats[held]?.name ? ` (${st.seats[held]?.name})` : ''}, so it cannot also watch it: one browser identity is in one place at a table.
      </p>
      <p><a href={playHash(props.link)} data-testid="take-chair-instead">Take your chair</a> · <a href="#/">Back to the solo table</a></p>
    </main>
  {:else if stage === 'match'}
    {#key st.games ?? 0}
      <Hud session={props.session} createScene={props.createScene} faces={props.faces} cardData={props.cardData} game={props.game} {theme} settings={props.settings} parseDecklist={props.parseDecklist} />
    {/key}
  {:else}
    <main class="waiting" aria-labelledby="watch-title">
      <h1 id="watch-title">Watching table <span class="room">{props.link.roomId}</span></h1>
      <p data-testid="spectator-stage">{stageText(stage)}</p>
      {#if !connected}<p class="muted" role="status" data-testid="spectator-alone">Waiting for a player of this table to connect…</p>{/if}
      <h2>At the table</h2>
      {#if players.length === 0}
        <p class="muted">Nobody has taken a chair yet.</p>
      {:else}
        <ul data-testid="spectator-players">
          {#each players as p (p.seat)}
            <li data-seat={p.seat}>{p.name}{p.ready ? ' · Ready' : ''}{p.away ? ' · away' : ''}</li>
          {/each}
        </ul>
      {/if}
      {#if others.length}<p class="muted">Also watching: {others.map((o) => o.nickname || 'Spectator').join(', ')}</p>{/if}
      <p><a href={playHash(props.link)} data-testid="take-chair-instead">Take a chair instead</a> · <a href="#/">Back to the solo table</a></p>
    </main>
  {/if}

  {#if held === null}
    <aside class="bar" aria-label="Spectator" data-testid="spectator-bar">
      <span class="badge" data-testid="spectator-badge">Watching</span>
      <span class="hint" data-testid="spectator-hint">{stage === 'match' ? 'Public view. You can chat and ping; you cannot move cards.' : 'Public view. Chat and pings open once the match is on the table.'}</span>
      {#each shown as g (g.seat)}
        <span class="shown" data-testid="spectator-shown" data-seat={g.seat}>
          {g.name} showed you:
          {#each g.cards as c, i (c.id)}<span class="card" data-testid="spectator-shown-card" data-card={c.id}>{nameOf(c.ref.sid)}</span>{i < g.cards.length - 1 ? ', ' : ''}{/each}
        </span>
      {/each}
      {#if stage === 'match' && hasFreeChair(st)}<a href={playHash(props.link)} class="play" data-testid="take-chair">Take a chair</a>{/if}
    </aside>
  {/if}
</div>

<style>
  .watch {
    position: relative;
    height: 100%;
    font-family: var(--sp-font);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .waiting {
    box-sizing: border-box;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 16px 96px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 24px;
  }
  h2 {
    margin: 16px 0 4px;
    font-size: var(--sp-font-size-large, 18px);
  }
  .room {
    font-family: var(--sp-font-mono);
  }
  .muted {
    color: var(--sp-muted, #555);
  }
  .bar {
    position: absolute;
    z-index: 22;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    max-width: min(760px, calc(100vw - 32px));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 12px;
    font-size: 13px;
    background: var(--sp-surface, #fff);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
  }
  .badge {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint {
    color: var(--sp-muted, #555);
  }
  .card {
    font-weight: 600;
  }
</style>
