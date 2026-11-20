/**
 * Booster decks on the decks harness (PLAN M8 "M8-P3 Decks"; decks.md D3, D4, D11, D18, section 3 "D5 Deck page,
 * sealed deck"; contracts.md Part G "Decks" item 1): with a pinned seed OPEN saves a sealed deck of 90 pool cards
 * before any card is shown and ends on a page with 40 cards in MAIN; one undo empties it and SUGGEST A DECK gives the
 * same 40 again; the page has no search field; an edit with a card from outside the pool answers notInPool through the
 * debug hook; CONVERT TO CUSTOM DECK makes a custom copy with a search field and leaves the original byte-equal.
 */
import { expect, test } from '@playwright/test';
import { canonicalJson } from '../../../src/core/hash';
import type { DeckRecord } from '../../../src/store/types';
import { deckAudit } from './audit';
import { decks, faceRatios, go, openDecks, profileOf } from './helpers';

const SEED = 'a1'.repeat(32);

const sortedSids = (d: DeckRecord): string[] => d.main.map((r) => r.sid).sort();

test('OPEN saves the pool first, reveals per pack and ends on a 40-card deck; undo, suggest, seal, convert', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info), hash: '/decks/new' });
  await decks(page, 'nextSeed', SEED);
  let id = '';

  await test.step('OPEN saves a sealed deck of 90 pool cards before any card is shown', async () => {
    await expect(page.getByTestId('open-setup')).toHaveText(/6 × M19/);
    await page.getByTestId('open-boosters').click();
    await expect(page.getByTestId('opening')).toBeVisible();
    // The record existed before the page showed the first card: every pool card is in it and the deck is empty.
    const hash = await page.evaluate(() => location.hash);
    id = decodeURIComponent(hash.replace(/^#\/decks\//, '').replace(/\/open$/, ''));
    const d = (await decks<DeckRecord>(page, 'get', id))!;
    expect(d.kind).toBe('sealed');
    expect(d.seal!.pool).toHaveLength(90);
    expect(d.seal!.seed).toBe(SEED);
    expect(d.main).toHaveLength(0);
    await expect(page.getByTestId('opening-card')).toHaveCount(15);
    await expect(page.getByTestId('opening-pack')).toHaveText('Pack 1 of 6');
    for (const r of await faceRatios(page)) expect(Math.abs(r - 63 / 88) / (63 / 88)).toBeLessThan(0.01);
  });

  await test.step('a reload resumes at the next unopened pack', async () => {
    await page.getByTestId('open-next').click();
    await expect(page.getByTestId('opening-pack')).toHaveText('Pack 2 of 6');
    await page.reload();
    await expect(page.getByTestId('opening-pack')).toHaveText('Pack 3 of 6');
    await expect(page.getByTestId('opening-card')).toHaveCount(15);
  });

  let first: string[] = [];
  await test.step('OPEN ALL ends on the pool page with 40 cards in MAIN', async () => {
    await page.getByTestId('open-all').click();
    await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'sealed');
    await expect(page.getByTestId('deck-count')).toHaveText(/^\s*40 \/ 40\s*$/);
    await expect.poll(async () => (await decks<DeckRecord>(page, 'get', id))!.main.length).toBe(40);
    const d = (await decks<DeckRecord>(page, 'get', id))!;
    expect(d.seal!.revealed).toBe(6);
    expect(d.side).toHaveLength(90 - d.main.filter((r) => d.seal!.pool.some((p) => p.sid === r.sid)).length);
    first = sortedSids(d);
    await expect(page.getByTestId('card-search')).toHaveCount(0);
    await expect(page.getByTestId('pool-grid')).toBeVisible();
  });

  await test.step('the pool page passes the design audit and faces keep 63:88', async () => {
    await page.mouse.move(5, 895);
    expect(await deckAudit(page)).toEqual([]);
    for (const r of await faceRatios(page)) expect(Math.abs(r - 63 / 88) / (63 / 88)).toBeLessThan(0.01);
  });

  await test.step('one undo empties it; SUGGEST A DECK gives the same 40 again', async () => {
    await page.getByTestId('deck-undo').click();
    await expect(page.getByTestId('deck-count')).toHaveText(/^\s*0 \/ 40\s*$/);
    await expect.poll(async () => (await decks<DeckRecord>(page, 'get', id))!.main.length).toBe(0);
    await page.getByTestId('suggest').click();
    await expect(page.getByTestId('deck-count')).toHaveText(/^\s*40 \/ 40\s*$/);
    await expect.poll(async () => sortedSids((await decks<DeckRecord>(page, 'get', id))!)).toEqual(first);
  });

  await test.step('a card from outside the pool answers notInPool through the debug hook', async () => {
    const pool = new Set((await decks<DeckRecord>(page, 'get', id))!.seal!.pool.map((r) => r.sid));
    const outside = await page.evaluate((p) => window.__spellplaneFixtures!.cards.find((c) => c.set === 'm20' && !p.includes(c.id) && !/Basic/.test(c.type_line))!.id, [...pool]);
    expect(await decks(page, 'edit', id, { op: 'add', sid: outside })).toEqual({ ok: false, reason: 'notInPool' });
    // A basic Forest is free.
    const forest = await page.evaluate(() => window.__spellplaneFixtures!.cards.find((c) => c.name === 'Forest' && c.set === 'm19')!.id);
    const r = await decks<{ ok: boolean }>(page, 'edit', id, { op: 'add', sid: forest });
    expect(r.ok).toBe(true);
    await go(page, '#/decks');
    await go(page, `#/decks/${id}`);
    await expect(page.getByTestId('deck-count')).toHaveText(/^\s*41 \/ 40\s*$/);
  });

  await test.step('CONVERT TO CUSTOM DECK makes a custom copy with a search field; the original is byte-equal', async () => {
    const before = canonicalJson((await decks<DeckRecord>(page, 'get', id))!);
    await page.getByTestId('convert-open').click();
    await expect(page.getByTestId('convert-dialog')).toBeVisible();
    await page.getByTestId('convert-go').click();
    await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'custom');
    await expect(page.getByTestId('card-search')).toBeVisible();
    const list = await decks<DeckRecord[]>(page, 'list');
    expect(list).toHaveLength(2);
    const copy = list.find((d) => d.id !== id)!;
    expect(copy.kind).toBe('custom');
    expect(copy.name).toMatch(/\(custom\)$/);
    expect(canonicalJson((await decks<DeckRecord>(page, 'get', id))!)).toBe(before);
  });
});

test('the setup sheet opens 3 packs; an unfinished opening resumes from its tile', async ({ page }, info) => {
  await openDecks(page, { profile: profileOf(info), hash: '/decks/new/boosters' });
  const sheet = page.getByTestId('booster-setup');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-mode', 'deck');
  await expect(sheet.getByTestId('setup-packs')).toContainText('6 packs');
  for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: 'Fewer packs' }).click();
  // The range is 3 to 12.
  await expect(sheet.getByTestId('setup-packs')).toContainText('3 packs');
  await page.getByTestId('setup-open').click();
  await expect(page.getByTestId('opening-pack')).toHaveText('Pack 1 of 3');
  const id = decodeURIComponent((await page.evaluate(() => location.hash)).replace(/^#\/decks\//, '').replace(/\/open$/, ''));
  expect((await decks<DeckRecord>(page, 'get', id))!.seal!.pool).toHaveLength(45);
  await go(page, '#/decks');
  const tile = page.locator(`[data-deck-id="${id}"]`);
  await expect(tile.getByTestId('tile-opening')).toHaveText('1 of 3 opened');
  await tile.dblclick();
  await expect(page.getByTestId('opening-pack')).toHaveText('Pack 2 of 3');
  await page.getByTestId('open-next').click();
  await expect(page.getByTestId('open-next')).toHaveText('Build deck');
  await page.getByTestId('open-next').click();
  await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'sealed');
  await expect.poll(async () => (await decks<DeckRecord>(page, 'get', id))!.main.length).toBeGreaterThan(0);
});
