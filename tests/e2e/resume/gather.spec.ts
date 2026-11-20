/**
 * M8-P5 acceptance in the browser (PLAN Milestone 8 "M8-P5 Rejoin", E2E): two local pages opened by room link
 * (`?transport=local`, distinct `?profile=`), driven through `window.__spellplane.session` (`leave()`, `muster()`,
 * `invite(seat)`, `playOn([...])`). A leaves, B's state marks A away; B plays three actions; A reopens the link and is
 * live with B's state hash; both closed, B back alone is on standby and proposes nothing; `playOn` makes B live;
 * `invite('s0')` on B returns a link. Timing is never asserted: state is polled through the debug hook.
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import type { MusterStatus } from '../../../src/session/types';
import { hook } from '../helpers/app';
import { freshProfile, freshRoom, open } from '../lobby/helpers';

type Room = { roomId: string; roomKey: string };

const state = (page: Page) => hook<TableState>(page, 'state');
const hashOf = (page: Page) => page.evaluate(() => window.__spellplane!.session!.hash());
const muster = (page: Page) => page.evaluate(() => window.__spellplane!.session!.muster!()) as Promise<MusterStatus>;

async function join(context: BrowserContext, room: Room, profile: string): Promise<Page> {
  const page = await context.newPage();
  await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile, transport: 'local' });
  await expect.poll(() => page.evaluate(() => window.__spellplane?.net?.status() ?? 'none'), { timeout: 20_000 }).toMatch(/connected|alone/);
  await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toMatch(/^s\d$/);
  return page;
}

async function sameHash(a: Page, b: Page): Promise<string> {
  await expect
    .poll(async () => {
      const [ha, hb] = await Promise.all([hashOf(a), hashOf(b)]);
      return ha === hb ? ha : `${ha} != ${hb}`;
    }, { timeout: 20_000 })
    .toMatch(/^[A-Za-z0-9_-]{20,}$/);
  return hashOf(a);
}

async function leave(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__spellplane!.session!.saved();
    await window.__spellplane!.session!.leave!();
  });
  await page.close();
}

/** Ann (s0) and Ben (s1) at one table in the match stage. */
async function table(context: BrowserContext, info: TestInfo): Promise<{ a: Page; b: Page; room: Room; profiles: { a: string; b: string } }> {
  const room = freshRoom();
  const profiles = { a: freshProfile(info, 'a'), b: freshProfile(info, 'b') };
  const a = await join(context, room, profiles.a);
  const b = await join(context, room, profiles.b);
  await expect.poll(async () => Object.values((await state(a)).seats).filter((s) => s.peer !== undefined).length, { timeout: 20_000 }).toBe(2);
  expect(await a.evaluate(() => window.__spellplane!.session!.seat())).toBe('s0');
  await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'stageSet', stage: 'match', by: 's0', cid: 'x' } as never));
  for (const p of [a, b]) await expect.poll(async () => (await state(p)).stage, { timeout: 20_000 }).toBe('match');
  await sameHash(a, b);
  return { a, b, room, profiles };
}

test('A leaves, B plays on, A comes back live with B’s hash; alone on standby B proposes nothing until it plays on', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const t = await table(context, info);
    let a = t.a;
    const { b, room, profiles } = t;
    await test.step('A leaves: B marks A away', async () => {
      await leave(a);
      await expect.poll(async () => (await state(b)).seats.s0!.away === true, { timeout: 10_000 }).toBe(true);
    });
    await test.step('B plays three actions', async () => {
      for (let i = 0; i < 3; i++) await b.evaluate(() => window.__spellplane!.dispatch!({ type: 'life', seat: 's1', delta: -1, by: 's1', cid: 'x' } as never));
      await expect.poll(async () => (await state(b)).seats.s1!.life, { timeout: 10_000 }).toBe(17);
    });
    await test.step('A reopens the link and is live with B’s state hash', async () => {
      a = await join(context, room, profiles.a);
      await expect.poll(async () => (await muster(a)).live, { timeout: 20_000 }).toBe(true);
      await sameHash(a, b);
      expect((await state(a)).seats.s1!.life).toBe(17);
    });
    await test.step('A leaves again: B can bring A back by link once A was away for 30 s on its clock', async () => {
      await leave(a);
      await expect.poll(async () => (await state(b)).seats.s0!.away === true, { timeout: 10_000 }).toBe(true);
    });
    await test.step('invite through the hook returns the link', async () => {
      const link = await b.evaluate(async () => {
        window.__spellplane!.net!.setClock!(31_000);
        return window.__spellplane!.session!.invite!('s0');
      });
      expect(link).toMatch(new RegExp(`#/t/${room.roomId}/${room.roomKey}/rejoin/s0/[\\w-]{22}$`));
      expect((await state(b)).seats.s0!.invite).toBeDefined();
    });
  } finally {
    await context.close();
  }
});

test('a returning browser whose copy shows the other player present waits on standby; playOn makes it live', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const { a, b, room, profiles } = await table(context, info);
    // Ben leaves while Ann is there (his copy shows Ann present); Ann plays on and leaves too.
    await leave(b);
    await expect.poll(async () => (await state(a)).seats.s1!.away === true, { timeout: 20_000 }).toBe(true);
    await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'life', seat: 's0', delta: -1, by: 's0', cid: 'x' } as never));
    await expect.poll(async () => (await state(a)).seats.s0!.life, { timeout: 10_000 }).toBe(19);
    await leave(a);
    const ben = await join(context, room, profiles.b);
    await test.step('standby: waiting for Ann, nothing proposed', async () => {
      await expect.poll(async () => (await muster(ben)).waitingFor, { timeout: 10_000 }).toEqual(['s0']);
      expect((await muster(ben)).live).toBe(false);
      const before = await hashOf(ben);
      await ben.evaluate(() => window.__spellplane!.dispatch!({ type: 'life', seat: 's1', delta: -1, by: 's1', cid: 'x' } as never));
      expect((await state(ben)).seats.s1!.life).toBe(20);
      expect(await hashOf(ben)).toBe(before);
    });
    await test.step('PLAY ON WITHOUT ANN makes Ben live', async () => {
      await ben.evaluate(() => window.__spellplane!.session!.playOn!(['s0']));
      await expect.poll(async () => (await muster(ben)).live, { timeout: 10_000 }).toBe(true);
      expect((await state(ben)).seats.s0!.away).toBe(true);
      await ben.evaluate(() => window.__spellplane!.dispatch!({ type: 'life', seat: 's1', delta: -1, by: 's1', cid: 'x' } as never));
      await expect.poll(async () => (await state(ben)).seats.s1!.life, { timeout: 10_000 }).toBe(19);
    });
  } finally {
    await context.close();
  }
});
