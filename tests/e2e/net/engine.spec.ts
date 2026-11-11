/**
 * The net engine in real browsers (Chromium and WebKit) over the BroadcastChannel transport (?transport=local), with
 * the real ECDSA P-256 handshake (DESIGN "Multiplayer architecture"; "Specification: network protocol and secrecy":
 * Handshake, Sequencing, Liveness, Sync). Engine behaviour is asserted on state hashes and the engine's own reports,
 * never on pixels. Identities persist in IndexedDB on Chromium; Playwright's WebKit hangs when a CryptoKey is
 * written to IndexedDB, so WebKit pages keep their key pair in memory (decision M1-P1, reported to the integrator).
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { harness, openHarness, routeHarness } from './bundle';

test.describe.configure({ timeout: 90_000 });

const life = (seat: string, cid: string, delta: number) => ({ type: 'life', by: seat, cid, seat, delta });

function profile(name: string, info: TestInfo): string {
  return `net-${name}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${Math.random().toString(36).slice(2, 8)}`;
}

const persist = (info: TestInfo): boolean => info.project.name === 'chromium';

/** Every page connected, nothing pending, one state hash (and `seq` when given). */
async function settled(pages: Page[], seq?: number): Promise<string> {
  let hash = '';
  await expect
    .poll(
      async () => {
        const infos = await Promise.all(pages.map((p) => harness(p, 'info')));
        const hashes = await Promise.all(pages.map((p) => harness(p, 'hash')));
        hash = hashes[0]!;
        return infos.every((i) => i.status === 'connected' && i.pending === 0 && (seq === undefined || i.seq === seq)) && new Set(hashes).size === 1;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return hash;
}

async function twoPages(context: BrowserContext, info: TestInfo): Promise<{ a: Page; b: Page; seats: string[]; room: string; pa: string }> {
  await routeHarness(context);
  const room = `room-${Math.random().toString(36).slice(2, 8)}`;
  const pa = profile('a', info);
  const a = await openHarness(context, pa);
  const b = await openHarness(context, profile('b', info));
  const ida = await harness(a, 'identity', 'Anna', persist(info));
  const idb = await harness(b, 'identity', 'Ben', persist(info));
  expect(ida.peerId).toMatch(/^[0-9a-f]{16}$/);
  expect(idb.peerId).not.toBe(ida.peerId);
  const seats = [ida.peerId, idb.peerId];
  await harness(a, 'start', room, seats);
  await harness(b, 'start', room, seats);
  return { a, b, seats, room, pa };
}

test('two pages verify each other with real keys, sequence through the lowest seat and converge', async ({ context }, info) => {
  const { a, b, seats } = await twoPages(context, info);
  await expect.poll(async () => (await harness(b, 'info')).status, { timeout: 15_000 }).toBe('connected');
  const ib = await harness(b, 'info');
  expect(ib.sequencer).toBe(seats[0]);
  expect(ib.seat).toBe('s1');
  expect((await harness(a, 'info')).sequencing).toBe(true);

  // B's actions apply at once on B (optimistic) and go through A's sequencer.
  for (let i = 0; i < 5; i++) expect(await harness(b, 'propose', life('s1', `b-${i}`, -1))).toBe(true);
  expect(await harness(a, 'propose', life('s0', 'a-0', 2))).toBe(true);
  await settled([a, b], 6);
  const state = await a.evaluate(() => window.__spellplane!.state!());
  expect(state.seats.s1!.life).toBe(15);
  expect(state.seats.s0!.life).toBe(22);
  // The debug hook's net part reports the handshake and the sequenced actions.
  const kinds = await b.evaluate(() => window.__spellplane!.net!.messages().map((m) => `${m.dir}:${m.msg.t}`));
  expect(kinds).toEqual(expect.arrayContaining(['out:hello', 'in:hello', 'out:welcome', 'in:welcome', 'out:propose', 'in:seq']));
  expect(await b.evaluate(() => window.__spellplane!.net!.sequencer())).toBe(seats[0]);
});

test('when the sequencer leaves, the other page takes over; when it comes back it catches up and sequences again', async ({ context }, info) => {
  const { a, b, seats, room } = await twoPages(context, info);
  for (let i = 0; i < 3; i++) await harness(b, 'propose', life('s1', `before-${i}`, -1));
  await settled([a, b], 3);

  await harness(a, 'close'); // bye, as closing the tab sends
  await expect.poll(async () => (await harness(b, 'info')).sequencing, { timeout: 3000 }).toBe(true);
  for (let i = 0; i < 4; i++) expect(await harness(b, 'propose', life('s1', `alone-${i}`, -1))).toBe(true);
  await expect.poll(async () => (await harness(b, 'info')).pending).toBe(0);
  const bSeq = (await harness(b, 'info')).seq;
  expect(bSeq).toBeGreaterThanOrEqual(7); // 3 + the handover record + 4

  // A comes back with the same key pair and nothing saved (seq 0).
  await harness(a, 'start', room, seats);
  const h = await settled([a, b]);
  const ia = await harness(a, 'info');
  expect(ia.seat).toBe('s0');
  expect(ia.sequencing).toBe(true); // the lowest seat sequences again, from the history B kept
  expect(ia.seq).toBeGreaterThanOrEqual(bSeq);
  expect(await harness(b, 'hash')).toBe(h);
  expect((await a.evaluate(() => window.__spellplane!.state!())).seats.s1!.life).toBe(13);
  await harness(b, 'propose', life('s1', 'after', 5));
  await settled([a, b]);
  expect((await b.evaluate(() => window.__spellplane!.state!())).seats.s1!.life).toBe(18);
});

test('a reopened page finds its identity in IndexedDB and reclaims its seat', async ({ context }, info) => {
  test.skip(!persist(info), 'Playwright WebKit hangs when a CryptoKey is written to IndexedDB');
  const { a: first, b, seats, room, pa } = await twoPages(context, info);
  await settled([first, b]);
  await first.close({ runBeforeUnload: true });
  await expect.poll(async () => (await harness(b, 'info')).sequencing, { timeout: 10_000 }).toBe(true);
  await harness(b, 'propose', life('s1', 'meanwhile', -4));
  const a = await openHarness(context, pa);
  const again = await harness(a, 'identity', 'Anna', true);
  expect(again.peerId).toBe(seats[0]);
  await harness(a, 'start', room, seats);
  await settled([a, b]);
  expect((await harness(a, 'info')).seat).toBe('s0');
  expect((await a.evaluate(() => window.__spellplane!.state!())).seats.s1!.life).toBe(16);
});

test('a page that drops off without a word is marked away after 6 s and the other page takes over', async ({ context }, info) => {
  const { a, b } = await twoPages(context, info);
  await settled([a, b]);
  await a.evaluate(() => window.__spellplane!.net!.kill());
  const t0 = Date.now();
  await expect.poll(async () => (await harness(b, 'info')).sequencing, { timeout: 15_000, intervals: [200] }).toBe(true);
  const took = Date.now() - t0;
  expect(took).toBeGreaterThanOrEqual(5000);
  expect(took).toBeLessThan(11_000);
  expect((await b.evaluate(() => window.__spellplane!.net!.peers()))[0]!.status).toBe('away');
  expect(await harness(b, 'propose', life('s1', 'x', -1))).toBe(true);
  await expect.poll(async () => (await harness(b, 'info')).pending).toBe(0);
});
