<!--
  The start page at `#/lobby` (DESIGN "Multiplayer architecture", Rooms and connection: a table is a link with a random
  room id and key in the URL fragment; "Players, seats and formats", Identity: a nickname plus a key pair; PLAN M1-P5
  create table, share link, nickname). Creating a table opens its link, where the in-table lobby shows the chairs.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { TableRecord } from '../../store/types';
  import type { StartPageProps } from '../types';
  import { nicknameProblem, normaliseNickname } from './seats';
  import { isWatchLink } from './spectate';
  import { WATCH } from '../routes';

  let { identity, newRoom, parseLink, savedTables, open }: StartPageProps = $props();

  let nickname = $state('');
  let saved = $state('');
  let loaded = $state(false);
  let pasted = $state('');
  let linkProblem = $state('');
  let tables = $state.raw<TableRecord[]>([]);
  let failure = $state('');
  const problem = $derived(loaded ? nicknameProblem(nickname) : null);

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
  });

  async function saveNickname(): Promise<boolean> {
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
</script>

<section class="start" data-testid="start-page" aria-labelledby="start-title">
  <h1 id="start-title">Play with friends</h1>
  <p class="lead">A table is a link. Create one, send the link to the people you want to play with, and everyone who opens it sits down at the same table. There are no accounts; your browser keeps a key that brings you back to your chair.</p>

  <form
    class="block"
    onsubmit={(e) => {
      e.preventDefault();
      void create();
    }}
  >
    <label for="start-nickname">Your nickname</label>
    <input id="start-nickname" data-testid="nickname" bind:value={nickname} maxlength="40" autocomplete="nickname" aria-invalid={!!problem} aria-describedby="start-nickname-help" />
    <p id="start-nickname-help" class="help" class:error={!!problem}>{problem ?? 'Shown on your chair, your cursor and in the log.'}</p>
    <button type="submit" class="primary" data-testid="create-table" disabled={!loaded || !!problem}>Create a table</button>
  </form>

  <form
    class="block"
    onsubmit={(e) => {
      e.preventDefault();
      void join();
    }}
  >
    <label for="start-link">Join with a link</label>
    <div class="row">
      <input id="start-link" data-testid="join-link" bind:value={pasted} placeholder="Paste a table link" spellcheck="false" />
      <button type="submit" data-testid="join-table" disabled={!pasted.trim() || !loaded || !!problem}>Join</button>
    </div>
    {#if linkProblem}<p class="help error" role="alert" data-testid="link-problem">{linkProblem}</p>{/if}
  </form>

  {#if tables.length}
    <section class="block" aria-label="Your tables">
      <h2>Your tables</h2>
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

  <p class="foot"><a href="#/diag">Check your connection</a></p>
  {#if failure}<p class="help error" role="alert">{failure}</p>{/if}
</section>

<style>
  .start {
    display: grid;
    gap: var(--sp-space-lg, 16px);
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--sp-font-size-large, 18px);
  }
  .lead {
    margin: 0;
    color: var(--sp-muted, #555);
    line-height: 1.5;
  }
  .block {
    display: grid;
    gap: 6px;
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
  }
  label {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  input {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
    min-width: 0;
  }
  input:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 2px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row input {
    flex: 1;
  }
  button {
    font: inherit;
    padding: 8px 14px;
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
  .help {
    margin: 0;
    font-size: var(--sp-font-size-small, 12px);
    color: var(--sp-muted, #555);
  }
  .help.error {
    color: var(--sp-danger, #b00020);
  }
  .tables {
    margin: 0;
    padding-left: 18px;
  }
  .muted {
    color: var(--sp-muted, #555);
  }
  .foot {
    margin: 0;
  }
</style>
