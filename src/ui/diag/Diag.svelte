<!--
  The connection check at `#/diag` (PLAN M1 Connectivity check: joins a room through the configured transport and
  reports time to connect, the peers and a ping round trip; DESIGN "Multiplayer architecture", Rooms and connection:
  no relay fallback, so a failure is said plainly with the usual remedies). Open the shown link on a second machine.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { DiagProps, DiagReport } from '../types';
  import { runDiag } from './diag';
  import { pageBase } from '../lobby/room';

  let props: DiagProps = $props();

  let report = $state.raw<DiagReport | null>(null);
  let joinUrl = $state('');
  let copied = $state(false);

  onMount(() => {
    const r = runDiag(props);
    joinUrl = `${pageBase(location.href)}#/diag/${encodeURIComponent(r.roomId)}/${encodeURIComponent(r.roomKey)}`;
    const unsub = r.subscribe((x) => (report = x));
    return () => {
      unsub();
      r.stop();
    };
  });

  const ms = (v: number | null): string => (v === null ? '…' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

  async function copy() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* the field stays selectable */
    }
  }
</script>

<section class="diag" data-testid="diag" aria-labelledby="diag-title">
  <h1 id="diag-title">Connection check</h1>
  <p class="lead">This page joins a test room the way a table does and measures how long it takes. Open the link below on the other computer (or ask your friend to) to check that your two browsers can reach each other directly.</p>

  <div class="row">
    <input readonly value={joinUrl} data-testid="diag-link" aria-label="Link to this check" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
    <button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
  </div>

  <dl class="facts" data-testid="diag-report" data-joined={report?.joinedAfterMs ?? ''} data-peers={report?.peers.length ?? 0}>
    <dt>Room</dt>
    <dd class="mono">{report?.roomId ?? '…'}</dd>
    <dt>Joined the room</dt>
    <dd data-testid="diag-joined">{report?.joinedAfterMs === null || !report ? 'joining…' : `after ${ms(report.joinedAfterMs)}`}</dd>
    <dt>Other browsers</dt>
    <dd>
      {#if !report || report.peers.length === 0}
        <span data-testid="diag-nopeers">none yet</span>
      {:else}
        <ul>
          {#each report.peers as p (p.peer)}
            <li data-testid="diag-peer" data-rtt={p.rttMs ?? ''}>connected after {ms(p.connectedAfterMs)}; round trip {p.rttMs === null ? 'measuring…' : ms(p.rttMs)}</li>
          {/each}
        </ul>
      {/if}
    </dd>
  </dl>

  {#if report?.error}
    <p class="error" role="alert" data-testid="diag-error">{report.error}</p>
  {:else if report && report.peers.some((p) => p.rttMs !== null)}
    <p class="ok" data-testid="diag-ok">Your browsers can reach each other directly. You can play together.</p>
  {/if}
</section>

<style>
  .diag {
    display: grid;
    gap: var(--sp-space-lg, 16px);
  }
  h1 {
    margin: 0;
  }
  .lead {
    margin: 0;
    color: var(--sp-muted, #555);
    line-height: 1.5;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-family: var(--sp-font-mono);
    padding: 6px 8px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
  }
  button {
    font: inherit;
    padding: 6px 12px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    cursor: pointer;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  dd {
    margin: 0;
  }
  dd ul {
    margin: 0;
    padding-left: 18px;
  }
  .mono {
    font-family: var(--sp-font-mono);
  }
  .error {
    margin: 0;
    padding: 12px 16px;
    border: 2px solid var(--sp-danger, #b00020);
    border-radius: var(--sp-radius-lg, 8px);
    line-height: 1.5;
  }
  .ok {
    margin: 0;
    padding: 12px 16px;
    border: 2px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-lg, 8px);
  }
</style>
