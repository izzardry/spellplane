/**
 * M8-P7: the queue chip and the match-found card on `?harness=match` over a fake matchmaker status (contracts.md Part C;
 * journey.md 4.5, 4.6; visual.md 2.8). Enter accepts, Escape does nothing, the tab title reads `Match found ·
 * Spellplane` while the card shows, the chime is asked for once per match, the countdown steps with the clock.
 */
import { expect, test, type Page } from '@playwright/test';

type Opts = { waitedMs?: number; alone?: boolean; secondsLeft?: number; accepted?: string[]; mine?: boolean; queue?: string; looking?: number; notice?: string | null };
const set = (page: Page, phase: string, o: Opts = {}) => page.evaluate(([p, x]) => window.__matchHarness!.set(p as never, x as never), [phase, o] as const);
const api = <T,>(page: Page, fn: 'answers' | 'cancels' | 'homes' | 'chimes' | 'title') => page.evaluate((f) => window.__matchHarness![f]() as unknown, fn) as Promise<T>;

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?faces=placeholder&harness=match');
  await expect(page.getByTestId('harness-match')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the queue chip: SEARCHING, the mode, the timer and the count; ONLY YOU SO FAR; CANCEL; a click goes Home', async ({ page }) => {
  await expect(page.getByTestId('queue-chip')).toHaveCount(0);
  await test.step('connecting', async () => {
    await set(page, 'connecting');
    await expect(page.getByTestId('queue-chip')).toContainText('CONNECTING…');
  });
  await test.step('seeking for 42 s with three others in the queue', async () => {
    await set(page, 'seeking', { waitedMs: 42_000, looking: 3, queue: '1v1.constructed.ranked' });
    const chip = page.getByTestId('queue-chip');
    await expect(chip).toHaveAttribute('data-phase', 'seeking');
    await expect(chip).toContainText('SEARCHING');
    await expect(page.getByTestId('queue-chip-mode')).toHaveText('1V1 RANKED');
    await expect(page.getByTestId('queue-chip-time')).toHaveText('0:42');
    await expect(page.getByTestId('queue-chip-count')).toHaveText('3 LOOKING');
    // Every control on the bar is one of the kit's heights.
    for (const id of ['queue-chip-home', 'queue-cancel']) {
      const h = Math.round((await page.getByTestId(id).boundingBox())!.height);
      expect([28, 36, 44, 56], id).toContain(h);
    }
  });
  await test.step('alone', async () => {
    await set(page, 'seeking', { waitedMs: 75_000, alone: true, queue: 'ffa4.constructed.casual' });
    await expect(page.getByTestId('queue-chip-mode')).toHaveText('4 FREE-FOR-ALL CASUAL');
    await expect(page.getByTestId('queue-chip-time')).toHaveText('1:15');
    await expect(page.getByTestId('queue-chip-count')).toHaveText('ONLY YOU SO FAR');
  });
  await test.step('a click on the bar goes Home; CANCEL cancels and the bar closes', async () => {
    await page.getByTestId('queue-chip-home').click();
    expect(await api<number>(page, 'homes')).toBe(1);
    await page.getByTestId('queue-cancel').click();
    expect(await api<number>(page, 'cancels')).toBe(1);
    await expect(page.getByTestId('queue-chip')).toHaveCount(0);
  });
  await test.step('the bar is hidden while the card shows', async () => {
    await set(page, 'check');
    await expect(page.getByTestId('match-found')).toBeVisible();
    await expect(page.getByTestId('queue-chip')).toHaveCount(0);
  });
});

test('match found: seats with rating in ranked, the countdown, Enter accepts, Escape does nothing, the tab title and the chime', async ({ page }) => {
  expect(await api<string>(page, 'title')).toBe('Spellplane');
  await set(page, 'check', { secondsLeft: 20, queue: '1v1.constructed.ranked' });
  const card = page.getByTestId('match-found');
  await expect(card).toBeVisible();
  await expect(card).toContainText('MATCH FOUND');
  await expect(page.getByTestId('match-found-queue')).toHaveText('1V1 RANKED · CUSTOM DECKS');
  await expect(page.getByTestId('match-found-seat')).toHaveCount(2);
  await expect(page.getByTestId('match-found-rating')).toHaveText(['1512', '1540']);
  await expect(page.getByTestId('match-found-accepted')).toHaveText(['… not yet', '… not yet']);
  await expect(page.getByTestId('match-found-countdown')).toHaveText('20');
  expect(await api<string>(page, 'title')).toBe('Match found · Spellplane');
  expect(await api<number>(page, 'chimes')).toBe(1);

  await test.step('the countdown steps with the clock', async () => {
    await page.evaluate(() => window.__matchHarness!.advance(3_000));
    await expect(page.getByTestId('match-found-countdown')).toHaveText('17');
  });
  await test.step('Escape does nothing', async () => {
    await page.keyboard.press('Escape');
    await expect(card).toBeVisible();
    expect(await api<boolean[]>(page, 'answers')).toEqual([]);
  });
  await test.step('Enter accepts: WAITING FOR BEN…, my check shows', async () => {
    await page.keyboard.press('Enter');
    expect(await api<boolean[]>(page, 'answers')).toEqual([true]);
    await expect(page.getByTestId('match-accept')).toHaveText('WAITING FOR BEN…');
    await expect(page.getByTestId('match-accept')).toBeDisabled();
    await expect(page.getByTestId('match-found-accepted').first()).toHaveAttribute('data-accepted', 'true');
    // Enter again answers nothing more.
    await page.keyboard.press('Enter');
    expect(await api<boolean[]>(page, 'answers')).toEqual([true]);
  });
  await test.step('the card closes, the title comes back; the next match chimes again', async () => {
    await set(page, 'seeking', { waitedMs: 5_000 });
    await expect(card).toHaveCount(0);
    expect(await api<string>(page, 'title')).toBe('Spellplane');
    await set(page, 'check', { queue: '1v1.constructed.casual' });
    await expect(page.getByTestId('match-found-rating')).toHaveCount(0);
    expect(await api<number>(page, 'chimes')).toBe(2);
  });
});

test('ACCEPT and DECLINE by pointer; a notice after a match that fell through', async ({ page }) => {
  await set(page, 'check', { queue: 'ffa4.limited.casual' });
  await expect(page.getByTestId('match-found-queue')).toHaveText('4 FREE-FOR-ALL CASUAL · BOOSTER DECKS');
  await expect(page.getByTestId('match-accept')).toHaveText('ACCEPT');
  // The `lg` height once the card has scaled in.
  await expect.poll(async () => Math.round((await page.getByTestId('match-accept').boundingBox())!.height)).toBe(56);
  await page.getByTestId('match-decline').click();
  expect(await api<boolean[]>(page, 'answers')).toEqual([false]);
  await expect(page.getByTestId('match-found')).toHaveCount(0);

  await set(page, 'check');
  await page.getByTestId('match-accept').click();
  expect(await api<boolean[]>(page, 'answers')).toEqual([false, true]);
  await set(page, 'seeking', { notice: 'Ben did not accept. Back in the queue.' });
  await expect(page.getByTestId('toast')).toContainText('Ben did not accept. Back in the queue.');
});
