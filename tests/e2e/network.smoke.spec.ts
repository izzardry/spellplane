/**
 * The real Trystero transport over public Nostr relays (DESIGN "Multiplayer architecture", Rooms and connection;
 * "Specification: network protocol and secrecy", Room). Tagged @network: excluded from `pnpm e2e`, the gates and CI,
 * because public relays are not deterministic (PLAN B0.5). Run on demand with `pnpm e2e:network`, before a playtest.
 *
 * Two browser contexts (two separate "browsers": no shared BroadcastChannel or storage) join one random room with
 * the room key as Trystero password, complete the ECDSA handshake over WebRTC, and agree on a state hash after each
 * proposes an action through the sequencer.
 */
import { expect, test } from '@playwright/test';
import { harness, openHarness, routeHarness } from './net/bundle';

test.describe.configure({ timeout: 120_000 });

test('two browsers connect over Trystero on public relays and converge @network', async ({ browser }) => {
  const room = `smoke-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 100}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    await routeHarness(ctxA, 'smoke-page.ts');
    await routeHarness(ctxB, 'smoke-page.ts');
    const a = await openHarness(ctxA, 'smoke-a');
    const b = await openHarness(ctxB, 'smoke-b');
    const ida = await harness(a, 'identity', 'Smoke A');
    const idb = await harness(b, 'identity', 'Smoke B');
    const t0 = Date.now();
    await harness(a, 'start', room, [ida.peerId, idb.peerId], 'trystero');
    await harness(b, 'start', room, [ida.peerId, idb.peerId], 'trystero');
    await expect.poll(async () => [(await harness(a, 'info')).status, (await harness(b, 'info')).status], { timeout: 90_000, intervals: [500] }).toEqual(['connected', 'connected']);
    test.info().annotations.push({ type: 'time to connect', description: `${Date.now() - t0} ms` });
    expect((await harness(b, 'info')).sequencer).toBe(ida.peerId);
    await harness(a, 'propose', { type: 'life', by: 's0', cid: 'smoke-a', seat: 's0', delta: -1 });
    await harness(b, 'propose', { type: 'life', by: 's1', cid: 'smoke-b', seat: 's1', delta: -2 });
    await expect
      .poll(async () => {
        const [ia, ib] = [await harness(a, 'info'), await harness(b, 'info')];
        return ia.seq === 2 && ib.seq === 2 && ia.pending === 0 && ib.pending === 0 && (await harness(a, 'hash')) === (await harness(b, 'hash'));
      }, { timeout: 30_000 })
      .toBe(true);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
