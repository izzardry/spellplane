<!--
  The start page at `#/lobby` (DESIGN "Multiplayer architecture", Rooms and connection: a table is a link with a random
  room id and key in the URL fragment; "Players, seats and formats", Identity: a nickname plus a key pair; PLAN M1-P5
  create table, share link, nickname). M7-P2 (docs/design/m7-directions.html, start page; critique, Start page): a name
  and a picture of what Spellplane is, three ways in side by side (host a table, play alone, join with a link), the
  player's decks and tables, and housekeeping in the footer (StartRoute). The nickname's problem shows only once the
  player has typed or tried to go on.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { DeckRecord, TableRecord } from '../../store/types';
  import type { StartPageProps } from '../types';
  import Icon from '../design/Icon.svelte';
  import { nicknameProblem, normaliseNickname } from './seats';
  import { isWatchLink } from './spectate';
  import { WATCH } from '../routes';

  let { identity, newRoom, parseLink, savedTables, open, savedDecks }: StartPageProps & { /** Added by M7-P2: the profile's saved decks, newest first. */ savedDecks?: (() => Promise<DeckRecord[]>) | undefined } = $props();

  let nickname = $state('');
  let saved = $state('');
  let loaded = $state(false);
  let touched = $state(false);
  let pasted = $state('');
  let linkProblem = $state('');
  let tables = $state.raw<TableRecord[]>([]);
  let decks = $state.raw<DeckRecord[]>([]);
  let failure = $state('');
  const problem = $derived(loaded ? nicknameProblem(nickname) : null);
  /** Shown once the player typed or pressed on (critique, Start page 2: no error before anything was typed). */
  const shownProblem = $derived(touched ? problem : null);

  onMount(() => {
    void identity
      .get()
      .then((me) => {
        // A nickname the player typed before the identity finished loading is kept (M3 gate: a fresh profile's empty
        // stored nickname used to wipe it, leaving Join and Create disabled).
        if (nickname === '') nickname = me.nickname;
        saved = me.nickname;
      })
      .catch((e: unknown) => (failure = `Your identity could not be loaded: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => (loaded = true));
    void savedTables()
      .then((t) => (tables = t))
      .catch(() => (tables = []));
    void savedDecks?.()
      .then((d) => (decks = [...d].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => (decks = []));
  });

  async function saveNickname(): Promise<boolean> {
    touched = true;
    if (problem) return false;
    const n = normaliseNickname(nickname);
    nickname = n;
    if (n !== saved) {
      await identity.setNickname(n);
      saved = n;
    }
    return true;
  }

  async function create() {
    if (!(await saveNickname())) return;
    open(newRoom());
  }

  async function join() {
    const link = parseLink(pasted);
    if (!link) {
      linkProblem = 'That is not a table link. A table link ends in #/t/<room>/<key>.';
      return;
    }
    linkProblem = '';
    if (!(await saveNickname())) return;
    // A spectator's link (`…/watch`, M3-P5) opens the same table to watch without a chair.
    open(isWatchLink(pasted) ? { ...link, url: `${link.url}/${WATCH}` } : link);
  }
  const cards = (d: DeckRecord): number => d.main.length;
</script>

<section class="start ds-root" data-testid="start-page" data-loaded={loaded ? 'true' : 'false'} aria-labelledby="start-brand">
  <header class="hero">
    <h1 id="start-brand" class="brand ds-heading">Spellplane</h1>
    <p class="lead">A card table for friends, in the browser. Bring your own deck, sit down, play. No accounts, no rules engine: the table is yours.</p>
  </header>

  <div class="ways">
    <form
      class="way ds-panel host"
      aria-labelledby="start-host"
      onsubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <span class="mark" aria-hidden="true"><Icon name="host" size={22} /></span>
      <h2 id="start-host" class="ds-heading">Play with friends</h2>
      <p class="what">Host a table and send its link. Everyone who opens it sits down at the same table.</p>
      <label class="ds-label" for="start-nickname">Your nickname</label>
      <input id="start-nickname" class="field" data-testid="nickname" bind:value={nickname} maxlength="40" autocomplete="nickname" aria-invalid={!!shownProblem} aria-describedby="start-nickname-help" oninput={() => (touched = true)} />
      <p id="start-nickname-help" class="help" class:error={!!shownProblem}>{shownProblem ?? 'Shown on your chair, your cursor and in the log.'}</p>
      <button type="submit" class="ds-btn ds-btn--primary" data-testid="create-table" disabled={!loaded || !!problem}>Create a table</button>
    </form>

    <div class="way ds-panel" aria-labelledby="start-solo" role="group">
      <span class="mark" aria-hidden="true"><Icon name="play" size={22} /></span>
      <h2 id="start-solo" class="ds-heading">Play alone</h2>
      <p class="what">Try the table with your own deck: import a decklist and play a few turns. Nothing to set up.</p>
      <a class="ds-btn" href="#/" data-testid="play-alone">Open the table</a>
    </div>

    <form
      class="way ds-panel"
      aria-labelledby="start-join"
      onsubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <span class="mark" aria-hidden="true"><Icon name="join" size={22} /></span>
      <h2 id="start-join" class="ds-heading">Join a table</h2>
      <p class="what">Got a link from a friend? Paste it here, or just open it.</p>
      <label class="ds-label" for="start-link">Table link</label>
      <input id="start-link" class="field" data-testid="join-link" bind:value={pasted} placeholder="Paste a table link" spellcheck="false" />
      {#if linkProblem}<p class="help error" role="alert" data-testid="link-problem">{linkProblem}</p>{/if}
      <button type="submit" class="ds-btn" data-testid="join-table" disabled={!pasted.trim() || !loaded || !!problem}>Join</button>
    </form>
  </div>

  <section class="shelf" aria-labelledby="start-decks" data-testid="start-decks">
    <h2 id="start-decks" class="ds-heading">Your decks</h2>
    {#if decks.length}
      <ul class="boxes">
        {#each decks as d (d.id)}
          <li class="box ds-panel" data-testid="saved-deck"><b>{d.name}</b><span class="muted">{cards(d)} cards{d.side.length ? ` · ${d.side.length} sideboard` : ''}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty" data-testid="no-decks">No saved decks yet. Decks you build or draft are kept here; at the table, Menu › Import deck takes a decklist.</p>
    {/if}
  </section>

  {#if tables.length}
    <section class="shelf" aria-labelledby="start-tables">
      <h2 id="start-tables" class="ds-heading">Your tables</h2>
      <ul class="tables">
        {#each tables as t (t.roomId)}
          {@const link = parseLink(`#/t/${t.roomId}/${t.roomKey}`)}
          {#if link}
            <li><a href={link.url} data-testid="saved-table">{t.roomId}</a> <span class="muted">{t.stage}, {new Date(t.updatedAt).toLocaleDateString()}</span></li>
          {/if}
        {/each}
      </ul>
    </section>
  {/if}

  {#if failure}<p class="help error" role="alert">{failure}</p>{/if}
</section>

<style>
  .start {
    display: grid;
    gap: var(--ds-space-xxl);
  }
  .hero {
    display: grid;
    gap: var(--ds-space-sm);
  }
  .brand {
    font-size: var(--ds-type-brand);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--ds-ink);
  }
  .lead {
    margin: 0;
    max-width: 34em;
    font-size: var(--ds-type-title);
    line-height: 1.45;
    color: var(--ds-ink);
  }
  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--ds-space-lg);
    align-items: stretch;
  }
  .way {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xl);
    border-radius: var(--ds-radius-md);
  }
  .way > :global(.ds-btn) {
    margin-top: auto;
    align-self: flex-start;
    text-decoration: none;
  }
  .way.host {
    border-color: var(--ds-ornament);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--ds-chip);
    color: var(--ds-ink);
  }
  h2 {
    font-size: var(--ds-type-heading);
  }
  .what {
    margin: 0 0 var(--ds-space-sm);
    color: var(--ds-muted);
    line-height: 1.45;
  }
  .field {
    font: inherit;
    min-height: var(--ds-control-height);
    padding: 0 var(--ds-space-md);
    color: var(--ds-ink);
    background: var(--ds-panel-raised);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-sm);
  }
  .field:focus-visible {
    outline: 2px solid var(--ds-focus);
    outline-offset: 1px;
  }
  .help {
    margin: 0;
    font-size: var(--ds-type-small);
    color: var(--ds-muted);
    min-height: 1.35em;
  }
  .error {
    color: var(--ds-danger);
    font-weight: var(--ds-weight-bold);
  }
  .shelf {
    display: grid;
    gap: var(--ds-space-md);
  }
  .boxes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--ds-space-md);
  }
  .box {
    display: grid;
    gap: 2px;
    padding: var(--ds-space-md) var(--ds-space-lg);
    border-left: 4px solid var(--ds-ornament);
  }
  .tables {
    margin: 0;
    padding-left: 1.2em;
  }
  .tables a {
    color: var(--ds-ink);
  }
  .muted {
    color: var(--ds-muted);
  }
  /* On the mat (outside a panel) secondary text keeps the ink colour: the muted tone is for panels. */
  .shelf > .muted,
  .tables .muted {
    color: var(--ds-ink);
  }
  .empty {
    margin: 0;
  }
</style>
