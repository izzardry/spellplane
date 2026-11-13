<!--
  The protocol-version mismatch banner (PLAN M5-P6; PLAN Milestone 5, owner decisions, Version mismatch: "A peer on a
  different protocol version gets a clear message naming both versions and what to do (reload after the game, or wait
  for the table to update), never a silent failure"; DESIGN "Specification: network protocol and secrecy": "peers with a
  different `v` are refused with a visible version-mismatch notice"). Shown over every stage of a networked table while
  the engine knows a connected peer of another protocol version (NetEngine.versionMismatch); the same text is in the
  log. It can be hidden for this mismatch; a new one (another peer or version) shows again (./dismiss.ts).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { versionAdvice, versionNotice, type VersionMismatch } from '../../net/version';
  import type { TableSession } from '../../session/types';
  import { hide, isHidden, learnPeer, type HiddenMismatch } from './dismiss';

  let { session }: { session: TableSession } = $props();

  /** How often the banner reads the engine (a mismatch need not change the connection status, so polling is simplest). */
  const POLL_MS = 1000;

  let mismatch = $state.raw<VersionMismatch | null>(null);
  let hidden = $state.raw<HiddenMismatch | null>(null);
  const key = (m: VersionMismatch): string => `${m.peerId}|${m.theirs}`;

  function read(): void {
    // TableSession has no typed version API yet (session/types.ts is a contract file): the networked session's engine
    // is read where it has one.
    const engine = (session as Partial<{ engine: { versionMismatch?(): VersionMismatch | null } }>).engine;
    const next = engine?.versionMismatch?.() ?? null;
    hidden = learnPeer(hidden, next);
    if (next === null ? mismatch !== null : mismatch === null || key(next) !== key(mismatch) || next.nickname !== mismatch.nickname) mismatch = next;
  }

  onMount(() => {
    read();
    const offNet = session.subscribeNet(read);
    const timer = setInterval(read, POLL_MS);
    return () => {
      offNet();
      clearInterval(timer);
    };
  });
</script>

{#if mismatch && !isHidden(hidden, mismatch)}
  <section class="version" role="alert" data-testid="version-mismatch" data-advice={versionAdvice(mismatch)} data-mine={mismatch.mine} data-theirs={mismatch.theirs}>
    <p>{versionNotice(mismatch)}</p>
    <button type="button" data-testid="version-mismatch-hide" onclick={() => mismatch && (hidden = hide(mismatch))}>Hide</button>
  </section>
{/if}

<style>
  .version {
    position: fixed;
    z-index: 70;
    top: max(8px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    width: min(620px, calc(100vw - 32px));
    box-sizing: border-box;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 2px solid var(--sp-danger, #b3261e);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 10px 14px;
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  p {
    margin: 0;
    flex: 1;
  }
  button {
    font: inherit;
    background: none;
    color: inherit;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 10px;
    cursor: pointer;
  }
</style>
