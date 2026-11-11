/**
 * PLAN M1-P6 in the browser: a chat message appears in the timeline with a preview on hover; filters hide action lines
 * (DESIGN "Chat and voice", Text chat). Also the attribution flash when someone touches another player's card
 * (DESIGN "Decision log", Permissions), and the M0-G log findings: the owner's log names the card bottomed after a
 * mulligan, and a library search reads "searches their library". Real app on the solo table with fixture card data
 * and placeholder faces; the attribution test also runs on the HUD harness (`?harness=ui`).
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretStore, TableState } from '../../../src/core/types';
import { hook } from '../helpers/app';
import { call, decklist, freshProfile, openSolo } from '../solo/helpers';
import { hoverCard, openHud } from '../ui/harness';

const FIXTURES = new Map<string, string>(
  ['m19.json', 'tm19.json'].flatMap((f) => (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as { id: string; name: string }[]).map((c) => [c.id, c.name] as const)),
);
const sidOf = (name: string) => [...FIXTURES].find(([, n]) => n === name)![0];

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const lines = (page: Page) => page.getByTestId('log-line');

/** Send a chat line the way a player does: Enter focuses the chat, type, Enter sends. */
async function say(page: Page, text: string): Promise<void> {
  await page.mouse.move(720, 120);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
}

test.describe('chat in the timeline (DESIGN "Chat and voice", Text chat)', () => {
  test('a chat message appears in the timeline with a [[card]] preview on hover', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openSolo(page, freshProfile(info));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await call(page, 'draw', 2);

    await say(page, 'Watch out for [[leonin warleader]] and [[Not A Real Card]]!');
    const line = lines(page).last();
    await expect(line).toHaveAttribute('data-kind', 'chat');
    const me = (await state(page)).seats.s0!.name;
    await expect(line).toHaveText(`${me}: Watch out for leonin warleader and Not A Real Card!`);
    // The chat line is part of the shared log, after the draws.
    const log = await hook<{ kind: string; action?: { type: string; text?: string } }[]>(page, 'session.log');
    expect(log.at(-1)).toMatchObject({ kind: 'action', action: { type: 'chat', text: 'Watch out for [[leonin warleader]] and [[Not A Real Card]]!' } });
    await expect(lines(page).filter({ hasText: 'draws 2 cards' })).toHaveCount(1);

    // Hovering the bracketed name previews the card face resolved through the card data source.
    const named = line.getByTestId('chat-card');
    await expect(named).toHaveText(['leonin warleader', 'Not A Real Card']);
    await named.first().hover();
    const preview = page.getByTestId('chat-card-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-state', 'found');
    await expect(preview).toHaveAttribute('data-sid', sidOf('Leonin Warleader'));
    await expect(preview.locator('[data-face="up"]')).toBeVisible();
    await expect(preview.getByRole('img')).toHaveAttribute('aria-label', 'Leonin Warleader');

    // An unknown name says so instead of showing a card.
    await named.nth(1).hover();
    await expect(preview).toHaveAttribute('data-state', 'missing');
    await expect(preview).toContainText('No card named “Not A Real Card”');

    // Leaving the name hides the preview; nothing on the table was hovered or changed by it.
    const before = await call<string>(page, 'hash');
    await page.mouse.move(720, 120);
    await expect(preview).toHaveCount(0);
    expect(await call<string>(page, 'hash')).toBe(before);

    // Keyboard: the name is focusable and previews on focus.
    await named.first().focus();
    await expect(preview).toHaveAttribute('data-state', 'found');
    await named.first().blur();
    await expect(preview).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('filters hide action lines (chat only), chat lines (actions only), and All shows both', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await say(page, 'first');
    await call(page, 'draw', 1);
    await say(page, 'second');
    await call(page, 'shuffle');

    const kinds = async () => lines(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    const all = await kinds();
    expect(all.filter((k) => k === 'chat')).toHaveLength(2);
    expect(all.filter((k) => k === 'action').length).toBeGreaterThanOrEqual(3);
    // One timeline: chat lines sit between the actions in the order they happened.
    const texts = await lines(page).allInnerTexts();
    const iFirst = texts.findIndex((t) => t.endsWith(': first'));
    const iDraw = texts.findIndex((t) => t.includes('draws a card'));
    const iSecond = texts.findIndex((t) => t.endsWith(': second'));
    const iShuffle = texts.findIndex((t) => t.includes('shuffles their library'));
    expect([iFirst, iDraw, iSecond, iShuffle].every((i) => i >= 0)).toBe(true);
    expect(iFirst < iDraw && iDraw < iSecond && iSecond < iShuffle).toBe(true);

    const hash = await call<string>(page, 'hash');
    await page.getByTestId('log-filter-chat').click();
    await page.getByTestId('log-filter-actions').click();
    await page.getByTestId('log-filter-chat').click();
    // Filtering is a local view: the shared state does not change.
    expect(await call<string>(page, 'hash')).toBe(hash);
    await expect(page.getByTestId('log-filter-chat')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(kinds).toEqual(['chat', 'chat']);
    await expect(lines(page)).toHaveText([/: first$/, /: second$/]);

    await page.getByTestId('log-filter-actions').click();
    await expect.poll(async () => (await kinds()).includes('chat')).toBe(false);
    expect((await kinds()).length).toBe(all.length - 2);

    // A chat line sent while actions only are shown is in the log but hidden until the filter allows it.
    await say(page, 'third');
    await expect(lines(page).filter({ hasText: 'third' })).toHaveCount(0);
    await page.getByTestId('log-filter-all').click();
    await expect(lines(page).filter({ hasText: 'third' })).toHaveCount(1);
    await expect.poll(async () => (await kinds()).length).toBe(all.length + 1);

    const log = await hook<{ action?: { type: string } }[]>(page, 'session.log');
    expect(log.filter((e) => e.action?.type === 'chat')).toHaveLength(3);
  });

  test('the chat filter on a table without chat shows an empty-state line, not a blank panel', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await page.getByTestId('log-filter-chat').click();
    await expect(page.getByTestId('log-empty')).toHaveText('No chat yet.');
    await say(page, 'hello');
    await expect(page.getByTestId('log-empty')).toHaveCount(0);
    await expect(lines(page)).toHaveCount(1);
  });
});

test.describe('log wording (M0-G findings)', () => {
  test('the owner\'s log names the card it bottoms after a mulligan; a library search reads "searches their library"', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await call(page, 'shuffle');
    await call(page, 'draw', 7);
    await call(page, 'mulligan');
    const hand = (await secrets(page)).hand;
    expect(hand).toHaveLength(7);
    const bottomed = hand.at(-1)!;
    const name = FIXTURES.get((await secrets(page)).identities[bottomed]!.card.sid)!;

    // Wait until the fan shows the new hand and has stopped laying it out, then point low on the card.
    await expect.poll(() => page.getByTestId('hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(hand);
    const el = page.locator(`[data-testid="hand-card"][data-card="${bottomed}"]`);
    let last = '';
    await expect
      .poll(async () => {
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
        const now = JSON.stringify(await el.boundingBox());
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
    const box = (await el.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12, { steps: 4 });
    await expect(el).toHaveClass(/hovered/);
    await page.keyboard.press('Shift+KeyL');
    await expect.poll(async () => (await secrets(page)).libraryOrder.at(-1)).toBe(bottomed);
    await expect(lines(page).last()).toContainText(`puts ${name} on the bottom of their library`);
    // The card stays hidden in shared state: the name comes from this browser only.
    expect((await state(page)).cards[bottomed]!.identity).toBeUndefined();

    await page.mouse.move(720, 120);
    await page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="zone-button"][data-zone="library:s0"]').click();
    await page.getByTestId('search-library').click();
    await expect(page.getByTestId('pile-card')).toHaveCount(54);
    await expect(lines(page).last()).toContainText('searches their library');
    await expect(lines(page).filter({ hasText: 'looks at the top' })).toHaveCount(0);
  });
});

test.describe('attribution flash (DESIGN "Decision log", Permissions: anyone may touch any public card, with attribution)', () => {
  test('touching another player\'s card flashes it in the toucher\'s seat colour with their name; own cards do not flash', async ({ page }, info) => {
    await openSolo(page, freshProfile(info));
    // A token on the other seat's side (its controller is the other seat), and one on our own side.
    await hook(page, 'dispatch', { type: 'createToken', card: 'tok-theirs', zone: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 }, label: 'Their token', controller: 's1' });
    await hook(page, 'dispatch', { type: 'createToken', card: 'tok-mine', zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 }, label: 'My token' });
    await expect.poll(async () => Object.keys((await state(page)).cards).sort()).toEqual(['tok-mine', 'tok-theirs']);
    expect(await hook(page, 'chat.flashes')).toEqual([]);

    await hook(page, 'dispatch', { type: 'tap', card: 'tok-mine', tapped: true });
    await hook(page, 'dispatch', { type: 'tap', card: 'tok-theirs', tapped: true });
    const flashes = await hook<{ card: string; of: string; by: string; seq: number }[]>(page, 'chat.flashes');
    expect(flashes).toHaveLength(1);
    expect(flashes[0]).toMatchObject({ card: 'tok-theirs', of: 's1', by: 's0', seq: (await state(page)).seq });

    // Drawn over the card on the table, and gone after the fade time.
    const ring = page.locator('[data-testid="attribution-flash"][data-card="tok-theirs"]');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute('data-by', 's0');
    const card = (await hook<{ id: string; screen: { x: number; y: number; width: number; height: number } }[]>(page, 'cards')).find((c) => c.id === 'tok-theirs')!;
    const b = (await ring.boundingBox())!;
    const cx = card.screen.x + card.screen.width / 2;
    const cy = card.screen.y + card.screen.height / 2;
    expect(Math.abs(b.x + b.width / 2 - cx)).toBeLessThan(card.screen.width / 2);
    expect(Math.abs(b.y + b.height / 2 - cy)).toBeLessThan(card.screen.height / 2);
    await expect(page.locator('[data-testid="attribution-flash"][data-card="tok-mine"]')).toHaveCount(0);
    await expect(ring).toHaveCount(0, { timeout: 5_000 });
    expect(await hook<unknown[]>(page, 'chat.activeFlashes')).toEqual([]);
  });

  test('on the HUD harness: tapping the opponent\'s creature with T flashes it; tapping an own one does not', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await hoverCard(page, 'opp1');
    await page.keyboard.press('KeyT');
    await expect.poll(() => hook<{ card: string }[]>(page, 'chat.flashes')).toHaveLength(1);
    expect((await hook<{ card: string; of: string; by: string }[]>(page, 'chat.flashes'))[0]).toMatchObject({ card: 'opp1', of: 's1', by: 's0' });
  });
});
