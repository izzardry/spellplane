<!--
  The in-table lobby while the stage is 'lobby' (DESIGN "Players, seats and formats", Seats: the table from above with
  empty chairs, click a chair, pick a seat colour; Identity; "Multiplayer architecture", Rooms and connection: share
  link, connectivity check per pair said plainly; Hidden information 1: Ready publishes the deck commitment;
  "Specification: card data, packs and draft formats", Evening stages: the host advances from the lobby). Not modal.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import { toViewerFrame } from '../../games/frame';
  import type { DeckRecord } from '../../store/types';
  import type { SessionNetStatus } from '../../session/types';
  import { paper } from '../../themes/paper/index';
  import { tokensToCssVars } from '../../themes/index';
  import { checkDeck, parsePlainList, type CheckedDeck } from '../deck';
  import type { LobbyProps } from '../types';
  import { ConnectivityCheck, type ConnectivityReport } from './connectivity';
  import { pastedDeckId, readyVerdict } from './ready';
  import SpectatorPanel from './SpectatorPanel.svelte';
  import { chairChoice, chairs, colourClash, colourTakenBy, hostSeat, nicknameProblem, normaliseNickname, pickColour, readiness, seatOf, startProblem, SEAT_COLOURS, teamGroups } from './seats';

  let { session, game, link, identity, decks, cardData, parseDecklist }: LobbyProps = $props();

  const theme = paper;
  const cssVars = Object.entries(tokensToCssVars(theme.tokens))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  const seatColours = theme.tokens.colours.seats;

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  let net = $state.raw<SessionNetStatus>(untrack(() => session.netStatus()));
  let selfPeer = $state('');
  let nickname = $state('');
  let savedNickname = $state('');
  let preferredColour = $state(0);
  let now = $state(Date.now());
  const check = new ConnectivityCheck();

  let savedDecks = $state.raw<DeckRecord[]>([]);
  let deckChoice = $state<string>('paste');
  let deckText = $state('');
  let checked = $state.raw<CheckedDeck | null>(null);
  let checkedText = $state('');
  let busy = $state(false);
  let failure = $state('');
  let copied = $state(false);

  const mySeat = $derived(selfPeer ? seatOf(st, selfPeer) : null);
  const me = $derived(mySeat ? st.seats[mySeat] : undefined);
  const list = $derived(chairs(st, selfPeer));
  /** Two-Headed Giant: the chairs by team; sitting down joins a team (M3-P2, ui/lobby/seats.ts). */
  const teams = $derived(teamGroups(st, selfPeer));
  const ready = $derived(readiness(st));
  const report: ConnectivityReport = $derived(selfPeer ? check.observe(net, st, selfPeer, now) : { overall: 'checking', pairs: [], problems: [] });
  const present = (seat: SeatId): boolean => {
    const peer = st.seats[seat]?.peer;
    if (!peer) return false;
    if (peer === selfPeer) return true;
    return net.peers.some((p) => p.peerId === peer && p.status === 'connected');
  };
  const host = $derived(hostSeat(st, present));
  const startBlocked = $derived(startProblem(st, mySeat, host));
  const nickProblem = $derived(nicknameProblem(nickname));

  // The table from above, turned so the own chair is at the bottom (DESIGN "Players, seats and formats").
  const layout = $derived(game.layout(st.format));
  const viewerAngle = $derived(mySeat ? (layout.seats[st.seats[mySeat]?.index ?? 0]?.angle ?? 0) : 0);
  const MARGIN = 110;
  const box = $derived(((viewerAngle / 90) % 2 === 1 ? { w: layout.table.d, d: layout.table.w } : { w: layout.table.w, d: layout.table.d }));
  const outer = $derived({ w: box.w + 2 * MARGIN, d: box.d + 2 * MARGIN });
  function place(x: number, y: number): { left: number; top: number } {
    const p = toViewerFrame({ x, y, rot: 0 }, viewerAngle);
    return { left: ((p.x + outer.w / 2) / outer.w) * 100, top: ((outer.d / 2 - p.y) / outer.d) * 100 };
  }
  const territories = $derived(
    layout.seats.map((s) => {
      const r = toViewerFrame({ x: s.territory.x, y: s.territory.y, rot: s.territory.rot }, viewerAngle);
      const turned = Math.round(r.rot / 90) % 2 === 1;
      const w = turned ? s.territory.d : s.territory.w;
      const d = turned ? s.territory.w : s.territory.d;
      return { index: s.index, x: r.x - w / 2, y: -r.y - d / 2, w, d };
    }),
  );
  /** The teams' joint territories (games/types.ts TeamLayout; M3-P2). */
  const teamAreas = $derived(
    (layout.teams ?? []).map((t) => {
      const r = toViewerFrame({ x: t.territory.x, y: t.territory.y, rot: t.territory.rot }, viewerAngle);
      const turned = Math.round(r.rot / 90) % 2 === 1;
      const w = turned ? t.territory.d : t.territory.w;
      const d = turned ? t.territory.w : t.territory.d;
      return { index: t.index, x: r.x - w / 2, y: -r.y - d / 2, w, d };
    }),
  );

  const deckRefs = $derived.by(() => {
    if (deckChoice === 'paste') return checked && checkedText === deckText && checked.resolved.main.length ? { main: checked.resolved.main, side: checked.resolved.side } : null;
    const d = savedDecks.find((x) => x.id === deckChoice);
    return d && d.main.length ? { main: d.main, side: d.side } : null;
  });

  onMount(() => {
    const unsub = session.subscribe((s) => (st = s));
    const unsubNet = session.subscribeNet((n) => (net = n));
    st = session.getState();
    net = session.netStatus();
    const timer = setInterval(() => (now = Date.now()), 1000);
    void identity.get().then((r) => {
      selfPeer = r.peerId;
      nickname = r.nickname;
      savedNickname = r.nickname;
      preferredColour = r.seatColour;
    });
    void decks
      .list()
      .then((d) => {
        savedDecks = d;
        if (d.length && deckChoice === 'paste' && !deckText) deckChoice = d[0]!.id;
      })
      .catch(() => (savedDecks = []));
    return () => {
      unsub();
      unsubNet();
      clearInterval(timer);
    };
  });

  // Two players who picked the same colour at once: the later chair gives way (ui/lobby/seats.ts colourClash).
  let clashFixed = '';
  $effect(() => {
    if (!mySeat) return;
    const next = colourClash(st, mySeat);
    const key = `${st.seq}:${next}`;
    if (next === null || clashFixed === key) return;
    clashFixed = key;
    untrack(() => session.takeSeat(mySeat, next));
  });

  async function saveNickname() {
    if (nickProblem) return;
    const n = normaliseNickname(nickname);
    nickname = n;
    if (n === savedNickname) return;
    await identity.setNickname(n);
    savedNickname = n;
    if (mySeat && me) session.takeSeat(mySeat, me.colour);
  }

  function takeChair(seat: SeatId) {
    failure = '';
    const ok = chairChoice(st, seat, selfPeer);
    if (!ok.ok) {
      failure = ok.reason;
      return;
    }
    if (seat === mySeat) return;
    session.takeSeat(seat, pickColour(st, seat, me?.colour ?? preferredColour, mySeat));
  }

  async function pickSeatColour(c: number) {
    if (!mySeat || colourTakenBy(st, c, mySeat) !== null) return;
    preferredColour = c;
    session.takeSeat(mySeat, c);
    await identity.setSeatColour(c).catch(() => undefined);
  }

  async function checkPasted() {
    busy = true;
    failure = '';
    try {
      checkedText = deckText;
      checked = await checkDeck(deckText, parseDecklist ?? parsePlainList, cardData);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      checked = null;
    } finally {
      busy = false;
    }
  }

  /** The pasted text whose unresolved lines the player already agreed to leave out (second press on Ready). */
  let confirmedText = $state<string | null>(null);
  async function pressReady() {
    failure = '';
    if (deckChoice === 'paste' && (!checked || checkedText !== deckText)) await checkPasted();
    if (!mySeat) return;
    if (deckChoice === 'paste') {
      if (failure) return;
      const verdict = readyVerdict(checked && checkedText === deckText ? checked : null, deckText, confirmedText);
      if (verdict.kind !== 'go') {
        failure = verdict.message;
        if (verdict.kind === 'confirm') confirmedText = deckText;
        return;
      }
    }
    const deck = deckRefs;
    if (!deck) {
      failure = 'This deck has no cards. Choose another deck or paste a list.';
      return;
    }
    busy = true;
    try {
      await session.importDeck({ main: [...deck.main], side: [...deck.side] });
      // Saved once Ready went through, under an id derived from the text, so a retried Ready never saves it twice.
      if (deckChoice === 'paste') {
        const at = Date.now();
        const first = deckText.split(/\r?\n/).find((l) => l.trim() && !/^(deck|sideboard|main)/i.test(l.trim()));
        await decks
          .put({ id: pastedDeckId(deckText), name: first ? `Deck with ${first.replace(/^\s*\d+x?\s+/, '').trim()}` : 'Pasted deck', main: deck.main, side: deck.side, source: 'pasted', text: deckText, createdAt: at, updatedAt: at })
          .catch(() => undefined);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (startBlocked) return;
    session.dispatch({ type: 'stageSet', stage: 'match' });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      linkInput?.select();
    }
  }
  let linkInput = $state<HTMLInputElement | undefined>();

  function statusOf(seat: SeatId, peer: string | null): string {
    if (!peer) return '';
    if (peer === selfPeer) return 'you';
    const pair = report.pairs.find((p) => p.peer === peer);
    if (pair) return pair.state === 'failed' ? 'cannot connect' : pair.state;
    return st.seats[seat]?.away ? 'away' : 'connecting';
  }
</script>

<main class="lobby" style={cssVars} data-testid="lobby" aria-labelledby="lobby-title">
  <header class="top">
    <h1 id="lobby-title">Table <span class="room">{link.roomId}</span></h1>
    <a href="#/lobby" class="muted">New table</a>
  </header>

  <section class="share block" aria-label="Share this table">
    <label for="lobby-link">Send this link to the people you want to play with. Anyone with the link can join.</label>
    <div class="row">
      <input id="lobby-link" data-testid="share-link" readonly value={link.url} bind:this={linkInput} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
      <button type="button" data-testid="copy-link" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  </section>

  <SpectatorPanel {session} {link} inline />

  {#if report.problems.length}
    <section class="problems" role="alert" data-testid="connectivity-problem">
      {#each report.problems as p (p.kind + (p.peer ?? ''))}
        <p>{p.text}</p>
      {/each}
    </section>
  {:else if report.notice}
    <p class="notice" role="status" data-testid="connectivity-waiting">{report.notice}</p>
  {/if}

  <div class="cols">
    <section class="block table-view" aria-label="Chairs">
      <h2>Chairs</h2>
      <div class="table-box" style="aspect-ratio: {outer.w} / {outer.d}">
        <svg viewBox="{-outer.w / 2} {-outer.d / 2} {outer.w} {outer.d}" aria-hidden="true">
          <rect class="table" x={-box.w / 2} y={-box.d / 2} width={box.w} height={box.d} rx="18" />
          {#each teamAreas as t (t.index)}
            <rect class="team-area" x={t.x - 10} y={t.y - 10} width={t.w + 20} height={t.d + 20} rx="14" />
          {/each}
          {#each territories as t (t.index)}
            {@const seat = Object.values(st.seats).find((s) => s.index === t.index)}
            <rect class="territory" x={t.x} y={t.y} width={t.w} height={t.d} rx="8" style={seat && list.find((c) => c.seat === seat.id)?.occupied ? `stroke: ${seatColours[seat.colour]?.colour}` : ''} />
          {/each}
        </svg>
        {#each list as c (c.seat)}
          {@const a = layout.seats[c.index]?.zones.avatar}
          {@const pos = a ? place(a.x, a.y) : { left: 50, top: 50 }}
          {@const sc = seatColours[c.colour]}
          <button
            type="button"
            class="chair"
            class:free={!c.occupied}
            class:mine={c.mine}
            style="left: {pos.left}%; top: {pos.top}%; {c.occupied ? `--seat: ${sc?.colour}` : ''}"
            data-testid="chair"
            data-seat={c.seat}
            data-occupied={c.occupied}
            data-mine={c.mine}
            data-ready={c.ready}
            data-colour={c.occupied ? c.colour : ''}
            data-team={c.team ?? ''}
            aria-pressed={c.mine}
            disabled={!c.occupied ? !chairChoice(st, c.seat, selfPeer).ok : false}
            onclick={() => takeChair(c.seat)}
          >
            {#if c.occupied}
              <span class="glyph {sc?.glyph}" aria-hidden="true"></span>
              <span class="name">{c.name}{c.mine ? ' (you)' : ''}</span>
              <span class="state">{c.ready ? 'Ready' : 'Choosing a deck'}{statusOf(c.seat, c.peer) && !c.mine ? ` · ${statusOf(c.seat, c.peer)}` : ''}</span>
            {:else}
              <span class="name">Free chair</span>
              <span class="state">{mySeat ? 'Move here' : 'Sit here'}</span>
            {/if}
            {#if c.team !== null}
              <span class="team" data-testid="chair-team">{teams.find((g) => g.team === c.team)?.label ?? ''}</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if teams.length > 0}
        <ul class="teams" data-testid="lobby-teams" aria-label="Teams">
          {#each teams as g (g.team)}
            <li data-team={g.team} data-mine={g.mine} data-full={g.full}>
              <strong>{g.label}{g.mine ? ' (your team)' : ''}</strong>: {g.chairs.map((c) => (c.occupied ? c.name : 'free chair')).join(' & ')}
            </li>
          {/each}
        </ul>
        <p class="muted" data-testid="lobby-teams-hint">Two-Headed Giant: sit in a chair to join its team, or move to a free chair of the other team to switch. Teammates share one life total, one turn and see each other's hand.</p>
      {/if}
    </section>

    <section class="block you" aria-label="You">
      <h2>You</h2>
      <label for="lobby-nickname">Nickname</label>
      <input
        id="lobby-nickname"
        data-testid="lobby-nickname"
        bind:value={nickname}
        maxlength="40"
        aria-invalid={!!nickProblem}
        onblur={saveNickname}
        onkeydown={(e) => {
          if (e.key === 'Enter') void saveNickname();
        }}
      />
      {#if nickProblem}<p class="help error">{nickProblem}</p>{/if}

      <fieldset class="colours" disabled={!mySeat}>
        <legend>Seat colour</legend>
        {#each Array.from({ length: SEAT_COLOURS }, (_, i) => i) as c (c)}
          {@const sc = seatColours[c]}
          {@const takenBy = colourTakenBy(st, c, mySeat)}
          <label class="swatch" style="--seat: {sc?.colour}" title={takenBy ? `Taken by ${st.seats[takenBy]?.name}` : `Colour ${c + 1}`}>
            <input type="radio" name="seat-colour" value={c} checked={me?.colour === c} disabled={takenBy !== null} data-testid="colour" data-colour={c} onchange={() => pickSeatColour(c)} />
            <span class="glyph {sc?.glyph}" aria-hidden="true"></span>
            <span class="sr">Colour {c + 1}{takenBy ? `, taken by ${st.seats[takenBy]?.name}` : ''}</span>
          </label>
        {/each}
      </fieldset>

      <h3>Deck</h3>
      {#if me?.ready}
        <p data-testid="ready-done">You are ready. Your deck of {st.commitments[mySeat ?? '']?.instanceIds.length ?? 0} cards is committed and locked to your chair.</p>
      {:else}
        <div class="decks" role="radiogroup" aria-label="Choose a deck">
          {#each savedDecks as d (d.id)}
            <label><input type="radio" name="deck" value={d.id} bind:group={deckChoice} data-testid="saved-deck" /> {d.name} <span class="muted">({d.main.length} cards)</span></label>
          {/each}
          <label><input type="radio" name="deck" value="paste" bind:group={deckChoice} data-testid="paste-deck" /> Paste a decklist</label>
        </div>
        {#if deckChoice === 'paste'}
          <textarea bind:value={deckText} rows="8" spellcheck="false" aria-label="Decklist" data-testid="lobby-deck-text" placeholder="4 Llanowar Elves&#10;20 Forest"></textarea>
          <button type="button" data-testid="lobby-deck-check" disabled={busy || !deckText.trim()} onclick={checkPasted}>Check</button>
          {#if checked && checkedText === deckText}
            <p data-testid="lobby-deck-summary">
              {checked.resolved.main.length} cards in the deck{#if checked.resolved.side.length}, {checked.resolved.side.length} in the sideboard{/if}.{#if checked.errors.length}
                {checked.errors.length} line{checked.errors.length === 1 ? '' : 's'} not found: {checked.errors.map((e) => `line ${e.line}`).join(', ')}.{/if}
            </p>
          {/if}
        {/if}
        <button type="button" class="primary" data-testid="ready" disabled={busy || !mySeat || (deckChoice !== 'paste' && !deckRefs) || (deckChoice === 'paste' && !deckText.trim())} onclick={pressReady}>Ready</button>
        <p class="help">Ready locks your deck and publishes a commitment to it; the others learn its size and nothing else.</p>
      {/if}
      {#if failure}<p class="help error" role="alert" data-testid="lobby-failure">{failure}</p>{/if}
    </section>
  </div>

  <section class="block startbar" aria-label="Start">
    <p data-testid="ready-count">{ready.ready} of {Object.keys(st.seats).length} players ready.</p>
    {#if startBlocked}
      <p class="muted" data-testid="start-blocked">{startBlocked}</p>
    {:else}
      <button type="button" class="primary" data-testid="start-game" onclick={start}>Start the game</button>
    {/if}
  </section>

  <p class="foot"><a href="#/">Back to the solo table</a> · <a href="#/diag">Check your connection</a></p>
</main>

<style>
  .lobby {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: 24px 16px 48px;
    max-width: 1100px;
    margin: 0 auto;
    display: grid;
    gap: var(--sp-space-lg, 16px);
    align-content: start;
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .room {
    font-family: var(--sp-font-mono);
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--sp-font-size-large, 18px);
  }
  h3 {
    margin: 12px 0 4px;
    font-size: var(--sp-font-size, 14px);
  }
  .block {
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
  }
  .share {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row input {
    flex: 1;
    min-width: 0;
    font-family: var(--sp-font-mono);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(260px, 2fr);
    gap: var(--sp-space-lg, 16px);
  }
  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .table-box {
    position: relative;
    width: 100%;
  }
  .table-box svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .table {
    fill: var(--sp-bg, #fff);
    stroke: var(--sp-fg, #111);
    stroke-width: 4;
  }
  .team-area {
    fill: color-mix(in srgb, var(--sp-fg, #111) 4%, transparent);
    stroke: var(--sp-muted, #555);
    stroke-width: 3;
  }
  .chair .team {
    font-size: 0.75em;
    color: var(--sp-muted, #555);
  }
  .teams {
    margin: 8px 0 0;
    padding-left: 18px;
  }
  .teams li[data-mine='true'] {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .territory {
    fill: none;
    stroke: var(--sp-border, #ccc);
    stroke-width: 3;
    stroke-dasharray: 14 10;
  }
  .chair {
    position: absolute;
    transform: translate(-50%, -50%);
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 132px;
    padding: 8px 12px;
    border: 2px solid var(--seat, var(--sp-fg, #111));
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font: inherit;
    cursor: pointer;
  }
  .chair.free {
    border-style: dashed;
    color: var(--sp-muted, #555);
  }
  .chair.mine {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--seat, #111) 30%, transparent);
  }
  .chair:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .chair .name {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .chair .state {
    font-size: var(--sp-font-size-small, 12px);
    color: var(--sp-muted, #555);
  }
  .you {
    display: grid;
    gap: 6px;
    align-content: start;
  }
  input,
  textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
  }
  textarea {
    font-family: var(--sp-font-mono);
    resize: vertical;
  }
  button {
    font: inherit;
    padding: 6px 12px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    cursor: pointer;
    justify-self: start;
  }
  button.primary {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  :focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 2px;
  }
  .colours {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border: 0;
    padding: 0;
    margin: 8px 0 0;
  }
  .colours legend {
    font-weight: var(--sp-font-weight-bold, 600);
    margin-bottom: 4px;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--seat);
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .swatch:has(input:checked) {
    outline: 3px solid var(--sp-fg, #111);
    outline-offset: 2px;
  }
  .swatch:has(input:disabled) {
    opacity: 0.25;
    cursor: not-allowed;
  }
  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 3px;
  }
  .swatch .glyph {
    background: #fff;
  }
  .glyph {
    display: inline-block;
    width: 12px;
    height: 12px;
    background: var(--seat, currentColor);
  }
  .glyph.circle {
    border-radius: 50%;
  }
  .glyph.triangle {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .glyph.diamond {
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
  .glyph.star {
    clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  }
  .glyph.hexagon {
    clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  }
  .glyph.cross {
    clip-path: polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%);
  }
  .glyph.ring {
    border-radius: 50%;
    background: transparent !important;
    border: 3px solid #fff;
    box-sizing: border-box;
  }
  .chair .glyph.ring {
    border-color: var(--seat);
  }
  .decks {
    display: grid;
    gap: 4px;
  }
  .help {
    margin: 0;
    font-size: var(--sp-font-size-small, 12px);
    color: var(--sp-muted, #555);
  }
  .help.error {
    color: var(--sp-danger, #b00020);
  }
  .problems {
    padding: 12px 16px;
    border: 2px solid var(--sp-danger, #b00020);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
  }
  .problems p {
    margin: 0;
    line-height: 1.5;
  }
  .problems p + p {
    margin-top: 8px;
  }
  .notice {
    margin: 0;
    padding: 12px 16px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    color: var(--sp-muted, #555);
    line-height: 1.5;
  }
  .startbar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .startbar p {
    margin: 0;
  }
  .muted {
    color: var(--sp-muted, #555);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .foot {
    margin: 0;
  }
  a {
    color: var(--sp-fg, #111);
  }
</style>
