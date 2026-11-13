/**
 * PLAN M3-P2 in the browser: four pages at a Two-Headed Giant table (real networked sessions over BroadcastChannel,
 * real Web Crypto identities, one IndexedDB per profile). DESIGN "Players, seats and formats", Two-Headed Giant:
 * "Each teammate's hand is visible live to the other, shown as a second, smaller fan above the player's own", "one
 * shared life total", "A team channel carries voice and text only between teammates". The pages mount the real HUD.
 * Asserted on the harness (state, secrets, received messages) and on the fan's and chat panel's DOM, never on pixels;
 * screenshots of the teammate's fan and the team chat are kept as evidence.
 */
import { expect, test, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { scan } from '../../leak/scan';
import { shot } from '../helpers/app';
import { openTeamPage, th } from './bundle';

type Card = { id: string; sid: string };
const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];

/** Every page has applied the same seq with nothing of its own pending. */
async function converged(pages: Page[]): Promise<void> {
  await expect
    .poll(async () => {
      const s = await Promise.all(pages.map((p) => th<{ seq: number; pending: number }>(p, 'sync')));
      return s.every((x) => x.pending === 0 && x.seq === s[0]!.seq);
    }, { timeout: 30_000 })
    .toBe(true);
}

/** Send a chat line on `tab` through the HUD's chat panel, as a player does. */
async function say(page: Page, tab: 'table' | 'team', text: string): Promise<void> {
  await page.getByTestId(`chat-tab-${tab}`).click();
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
}

/** The chat lines a page's chat panel shows on `tab` that contain `text`. */
async function shown(page: Page, tab: 'table' | 'team', text: string): Promise<number> {
  await page.getByTestId(`chat-tab-${tab}`).click();
  return page.locator('[data-testid=log-line][data-kind=chat]').filter({ hasText: text }).count();
}

/** The teammate fan as the page draws it: card ids, Scryfall ids and verdicts in fan order. */
function fan(page: Page, seat: string): Promise<{ id: string; sid: string; verified: string }[]> {
  return page
    .locator(`[data-testid=team-hand][data-seat=${seat}] [data-testid=team-hand-card]`)
    .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-card') ?? '', sid: e.getAttribute('data-sid') ?? '', verified: e.getAttribute('data-verified') ?? '' })));
}

test('a teammate’s page shows the partner’s hand live; an opponent’s page never receives it; life is one team total; team chat reaches only the teammate', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const room = `team-room-${crypto.randomBytes(4).toString('hex')}-42`;
  const key = crypto.randomBytes(16).toString('base64url');
  const pages: Page[] = [];
  try {
    for (const [i, name] of NAMES.entries()) {
      const page = await context.newPage();
      await openTeamPage(page, `tm-${i}-${info.project.name.slice(0, 3)}-${crypto.randomBytes(4).toString('hex')}`);
      expect(await th<string>(page, 'start', room, key, name, i, i === 0)).toBe(`s${i}`);
      pages.push(page);
    }
    const [anna, ben, cleo, dan] = pages as [Page, Page, Page, Page];
    await expect.poll(() => th<{ peers: number }>(anna, 'sync').then((s) => s.peers), { timeout: 30_000 }).toBe(3);
    await converged(pages);
    expect(await th(anna, 'teammates')).toEqual(['s1']);
    expect(await th(cleo, 'teammates')).toEqual(['s3']);

    for (const [i, p] of pages.entries()) await th(p, 'ready', i);
    await converged(pages);
    await Promise.all(pages.map((p) => th(p, 'shuffle')));
    for (const p of pages) await th(p, 'draw', 7);
    await converged(pages);

    // Ben's page draws Anna's seven cards, in her arrangement, verified against her deck commitment, and vice versa.
    const annaHand = await th<Card[]>(anna, 'hand');
    expect(annaHand).toHaveLength(7);
    await expect.poll(() => fan(ben, 's0'), { timeout: 20_000 }).toEqual(annaHand.map((c) => ({ ...c, verified: 'true' })));
    const benHand = await th<Card[]>(ben, 'hand');
    await expect.poll(() => fan(anna, 's1'), { timeout: 20_000 }).toEqual(benHand.map((c) => ({ ...c, verified: 'true' })));
    await expect(ben.getByTestId('team-hand-label')).toContainText('Anna');
    // The opponents see only their own teammate's fan.
    await expect.poll(() => fan(dan, 's2'), { timeout: 20_000 }).toHaveLength(7);
    for (const p of [cleo, dan]) {
      expect(await fan(p, 's0')).toEqual([]);
      expect(await fan(p, 's1')).toEqual([]);
      expect(await th(p, 'teamHand', 's0')).toEqual([]);
    }
    // The fan sits above the own fan's band (the bottom 22 % of the viewport) and is smaller than it.
    const box = await ben.locator('[data-testid=team-hand-card]').first().boundingBox();
    const vh = ben.viewportSize()!.height;
    expect(box!.y + box!.height).toBeLessThan(vh * 0.78);
    expect(box!.height).toBeLessThan(vh * 0.22);
    await shot(ben, 'M3', 'team-hand', info.project.name);

    // Live: Anna plays a card, Ben's fan drops it.
    const played = annaHand[0]!.id;
    await th(anna, 'play', played);
    await converged(pages);
    await expect.poll(() => fan(ben, 's0').then((f) => f.map((c) => c.id)), { timeout: 20_000 }).toEqual(annaHand.slice(1).map((c) => c.id));

    // One shared life total: either teammate changes it, every page shows the same team total.
    await th(ben, 'life', 's1', -2);
    await th(anna, 'life', 's0', -1);
    await th(cleo, 'life', 's0', -3);
    await converged(pages);
    for (const p of pages) expect(await th(p, 'teamLife')).toEqual({ t0: 24, t1: 30 });

    // Team chat (DESIGN "A team channel carries voice and text only between teammates"; "Chat and voice": team text
    // chat is a tab in the chat panel): Anna's line shows on her and Ben's team tab, never on the table tab, and the
    // opponents' pages neither show nor receive it. Ben's answer reaches Anna.
    const plan = `team-plan-${crypto.randomBytes(4).toString('hex')}`;
    const answer = `team-answer-${crypto.randomBytes(4).toString('hex')}`;
    await say(anna, 'team', plan);
    await expect.poll(() => shown(ben, 'team', plan), { timeout: 20_000 }).toBe(1);
    await say(ben, 'team', answer);
    await expect.poll(() => shown(anna, 'team', answer), { timeout: 20_000 }).toBe(1);
    expect(await shown(anna, 'team', plan)).toBe(1);
    expect(await shown(ben, 'team', answer)).toBe(1);
    for (const p of [anna, ben]) expect(await shown(p, 'table', 'team-')).toBe(0);
    await say(cleo, 'team', 'cleo-to-dan');
    await expect.poll(() => shown(dan, 'team', 'cleo-to-dan'), { timeout: 20_000 }).toBe(1);
    for (const p of [cleo, dan]) {
      expect(await shown(p, 'team', 'team-')).toBe(0);
      expect(await shown(p, 'table', 'team-')).toBe(0);
      expect(scan(await th<unknown[]>(p, 'observed'), [plan, answer])).toEqual([]);
    }
    for (const p of [anna, ben]) expect(await shown(p, 'team', 'cleo-to-dan')).toBe(0);
    expect(scan(await th<unknown[]>(ben, 'observed'), [plan]).length).toBeGreaterThan(0);
    await shot(ben, 'M3', 'team-chat', info.project.name);

    // Leak: nothing the opponents received or hold (messages, state, log, secrets, IndexedDB) carries a hidden card of
    // Anna or Ben; the teammate did receive them (the scan is not vacuous).
    const hiddenA = await th<string[]>(anna, 'hidden');
    const hiddenB = await th<string[]>(ben, 'hidden');
    expect(hiddenA.length).toBeGreaterThan(60);
    for (const p of [cleo, dan]) {
      const seen = await th<unknown[]>(p, 'observed');
      expect(scan(seen, [...hiddenA, ...hiddenB])).toEqual([]);
    }
    // Every teamHand a page received came from its teammate only.
    expect(await th(anna, 'teamHandsFrom')).toEqual(['s1']);
    expect(await th(ben, 'teamHandsFrom')).toEqual(['s0']);
    expect(await th(cleo, 'teamHandsFrom')).toEqual(['s3']);
    expect(await th(dan, 'teamHandsFrom')).toEqual(['s2']);
    expect(scan(await th<unknown[]>(ben, 'observed'), hiddenA).length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
