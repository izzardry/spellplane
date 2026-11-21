/**
 * M8-P5 acceptance in the browser (PLAN Milestone 8 "M8-P5 Rejoin", E2E; persistence.md section 7; journey.md 4.11):
 * local pages opened by room link (`?transport=local`, distinct `?profile=`), driven through `window.__spellplane`
 * (`session.leave()`, `session.invite(seat)`, `net.setClock`). The click path through the HUD's plate menu is M8-P8's.
 *
 * - The link in Ann's own profile resumes her seat without a claim (her save still has the game).
 * - A fresh profile opens a new link, sits down as Ann (the claim page: warning, no filled button), the address bar
 *   loses `/rejoin/`, the recovery panel opens by itself, and Ben's page shows the seat back with one take-over.
 * - Ann's old profile, reopened from its save after the take-over, is told its seat moved (no old seat handed out).
 * - A second use of that link shows `This link was already used. Ask for a new one.`
 * Timing is never asserted: state is polled through the debug hook; the 30 seconds run on the page clock.
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { TableState } from '../../../src/core/types';
import { seriousViolations } from '../a11y/helpers';
import { hook } from '../helpers/app';
import { decklist, freshProfile, freshRoom, open } from '../lobby/helpers';
import { designAudit } from '../helpers/design-audit';

type Room = { roomId: string; roomKey: string };

const state = (page: Page) => hook<TableState>(page, 'state');
const hashOf = (page: Page) => page.evaluate(() => window.__spellplane!.session!.hash());
const seatOf = (page: Page) => page.evaluate(() => window.__spellplane?.session?.seat() ?? null);

async function join(context: BrowserContext, hash: string, profile: string): Promise<Page> {
  const page = await context.newPage();
  await open(page, hash, { profile, transport: 'local' });
  await expect.poll(() => page.evaluate(() => window.__spellplane?.net?.status() ?? 'none'), { timeout: 20_000 }).toMatch(/connected|alone/);
  return page;
}

async function sameHash(a: Page, b: Page): Promise<void> {
  await expect
    .poll(async () => {
      const [ha, hb] = await Promise.all([hashOf(a), hashOf(b)]);
      return ha === hb ? 'same' : `${ha} != ${hb}`;
    }, { timeout: 20_000 })
    .toBe('same');
}

async function leave(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__spellplane!.session!.saved();
    await window.__spellplane!.session!.leave!();
  });
  await page.close();
}

/** Ben makes a link for Ann once the page clock says she has been away for 30 seconds. */
async function bringBack(b: Page): Promise<string> {
  await expect.poll(async () => (await state(b)).seats.s0!.away === true, { timeout: 10_000 }).toBe(true);
  return b.evaluate(async () => {
    window.__spellplane!.net!.setClock!(Date.now() + 31_000);
    try {
      return await window.__spellplane!.session!.invite!('s0');
    } finally {
      window.__spellplane!.net!.setClock!(null);
    }
  });
}

/** Ann (s0) and Ben (s1) with fixture decks, shuffled and seven cards each, in the match stage. */
async function game(context: BrowserContext, info: TestInfo): Promise<{ a: Page; b: Page; room: Room; profiles: { a: string; b: string } }> {
  const room = freshRoom();
  const profiles = { a: freshProfile(info, 'a'), b: freshProfile(info, 'b') };
  const a = await join(context, `/t/${room.roomId}/${room.roomKey}`, profiles.a);
  const b = await join(context, `/t/${room.roomId}/${room.roomKey}`, profiles.b);
  await expect.poll(async () => Object.values((await state(a)).seats).filter((s) => s.peer !== undefined).length, { timeout: 20_000 }).toBe(2);
  expect(await seatOf(a)).toBe('s0');
  await a.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist('gw-m19-60.txt'));
  await b.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist('ur-m19-60.mtga.txt'));
  await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'stageSet', stage: 'match', by: 's0', cid: 'x' } as never));
  for (const p of [a, b]) await expect.poll(async () => (await state(p)).stage, { timeout: 20_000 }).toBe('match');
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  await sameHash(a, b);
  return { a, b, room, profiles };
}

test('bring Ann back: her own profile resumes without a claim; a fresh profile sits down and recovers; a second use is refused', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const g = await game(context, info);
    let a: Page | null = g.a;
    const { b, room, profiles } = g;
    const annPeer = (await state(b)).seats.s0!.peer;

    await test.step('Ann leaves; Ben makes a link; Ann opens it in her own profile and resumes her seat without a claim', async () => {
      await leave(a!);
      const link = await bringBack(b);
      expect(link).toMatch(new RegExp(`#/t/${room.roomId}/${room.roomKey}/rejoin/s0/[\\w-]{22}$`));
      a = await join(context, link.slice(link.indexOf('#') + 1), profiles.a);
      await expect.poll(() => seatOf(a!), { timeout: 20_000 }).toBe('s0');
      await expect(a.getByTestId('claim-page')).toHaveCount(0);
      await expect.poll(() => a!.evaluate(() => location.hash), { timeout: 10_000 }).not.toContain('/rejoin/');
      await expect.poll(async () => (await state(b)).seats.s0!.away ?? false, { timeout: 20_000 }).toBe(false);
      const seat = (await state(b)).seats.s0!;
      expect(seat.peer).toBe(annPeer);
      expect(seat.takeovers ?? 0).toBe(0);
      // Her own browser came back: the open link is void.
      expect(seat.invite).toBeUndefined();
      await sameHash(a, b);
    });

    let link = '';
    await test.step('Ann leaves again and her browser is lost; Ben makes a new link', async () => {
      await leave(a!);
      a = null;
      link = await bringBack(b);
    });

    await test.step('a fresh profile opens the link, sits down as Ann, the address is clean, the recovery panel opens', async () => {
      const fresh = await context.newPage();
      await open(fresh, link.slice(link.indexOf('#') + 1), { profile: freshProfile(info, 'fresh'), transport: 'local' });
      const claim = fresh.getByTestId('claim-page');
      await expect(claim).toBeVisible({ timeout: 30_000 });
      await expect(claim.getByTestId('claim-warning')).toHaveText('If another browser of yours still has this game, open the link there. Sitting down here discards that hand.');
      // journey.md 4.11 (gate M8 finding N8): SIT DOWN AS ANN is the card's one filled button, WATCH INSTEAD beside it.
      await expect(claim.locator('.ds-btn--primary')).toHaveCount(1);
      await expect(claim.locator('.ds-btn--primary')).toHaveAttribute('data-testid', 'claim-sit');
      await expect(claim.getByTestId('claim-watch')).toBeVisible();
      await designAudit(fresh);
      expect(await seriousViolations(fresh, '[data-testid="claim-page"]')).toEqual([]);
      expect(await fresh.evaluate(() => location.hash)).not.toContain('/rejoin/');
      await claim.getByTestId('claim-sit').click();
      await expect.poll(() => seatOf(fresh), { timeout: 20_000 }).toBe('s0');
      await expect(fresh.getByTestId('claim-page')).toHaveCount(0);
      await expect(fresh.getByTestId('recovery')).toHaveAttribute('data-phase', 'lost', { timeout: 20_000 });
      expect(await seriousViolations(fresh, '[data-testid="recovery"]')).toEqual([]);
      await designAudit(fresh);
      const seat = (await state(b)).seats.s0!;
      expect(seat.takeovers).toBe(1);
      expect(seat.peer).not.toBe(annPeer);
      expect(seat.away).toBeUndefined();
      await sameHash(fresh, b);
      await fresh.close();
    });

    await test.step("Ann's old profile opens the table again from its save: its seat was taken over, the page says so", async () => {
      const old = await context.newPage();
      await open(old, `/t/${room.roomId}/${room.roomKey}`, { profile: profiles.a, transport: 'local' });
      await expect(old.getByTestId('room-error')).toContainText(/Your seat was taken over from another browser \(link made by [^)]+\)\. Your saved hand for this game can no longer be used./, { timeout: 30_000 });
      expect(await seatOf(old)).toBeNull();
      expect((await state(b)).seats.s0!.peer).not.toBe(annPeer);
      await old.close();
    });

    await test.step('a second use of the link shows This link was already used', async () => {
      const again = await context.newPage();
      await open(again, link.slice(link.indexOf('#') + 1), { profile: freshProfile(info, 'again'), transport: 'local' });
      await expect(again.getByTestId('claim-refusal')).toHaveText('This link was already used. Ask for a new one.', { timeout: 30_000 });
      await expect(again.getByTestId('claim-home')).toBeVisible();
      await again.close();
    });
  } finally {
    await context.close();
  }
});
