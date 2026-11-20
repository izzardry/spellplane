/**
 * M8-P2 acceptance on `?harness=home` (PLAN Milestone 8, "M8-P2 Shell, Home and History"; journey.md 4.1, 4.5,
 * section 6): a fresh profile, a seeded deck, modes surviving a reload, Draft night, the CONTINUE strip, searching with
 * the fake matchmaker, the first-run sheet, 390 px, the lifecycle counts and the design audit.
 */
import { expect, test } from '@playwright/test';
import { shot } from '../helpers/app';
import { designAudit } from '../helpers/design-audit';
import { fixtureDeck, fixtureGame, openHomeHarness, seedDecks, seedGames } from '../helpers/home';

const uniq = (label: string): string => `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

test('a fresh profile sees Home, the nav, the empty hero and PLAY enabled; nothing is alive; the design audit passes', async ({ page }) => {
  await openHomeHarness(page, { profile: uniq('fresh') });
  await expect(page.getByTestId('home')).toBeVisible();
  const nav = page.getByTestId('shell-nav');
  await expect(nav.getByRole('radio', { name: 'PLAY' })).toHaveAttribute('aria-checked', 'true');
  await expect(nav.getByRole('radio', { name: 'DECKS' })).toBeVisible();
  await expect(nav.getByRole('radio', { name: 'HISTORY' })).toBeVisible();
  await expect(page.getByTestId('home-empty-hero')).toContainText('NO DECK YET');
  await expect(page.getByTestId('home-primary')).toHaveText('PLAY');
  await expect(page.getByTestId('home-primary')).toBeEnabled();
  await expect(page.getByTestId('home-status')).toHaveText('No deck yet: you get a starter deck.');
  // The profile chip carries a made-up nickname.
  await expect(page.getByTestId('profile-name-chip')).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  // No CONTINUE strip and no recent games without a game.
  await expect(page.getByTestId('home-continue')).toHaveCount(0);
  expect(Object.values(await page.evaluate(() => window.__homeHarness!.live())).every((n) => n === 0)).toBe(true);
  // No WebGL context on Home: no canvas at all.
  await expect(page.locator('canvas')).toHaveCount(0);
  await designAudit(page);
});

test('with a fixture deck the hero shows name, count and curve; switching mode changes the primary and survives a reload', async ({ page }) => {
  const profile = uniq('deck');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy', 60)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('hero-name')).toHaveText('Gruul Stompy');
  await expect(page.getByTestId('hero-facts')).toContainText('CUSTOM DECK · 60 CARDS');
  await expect(page.getByTestId('hero-curve')).toHaveAttribute('aria-label', 'Mana curve 0 to 7+: 0, 6, 10, 8, 5, 3, 1, 1');
  await expect(page.getByTestId('home-primary')).toHaveText('PLAY');

  await test.step('mode cards change the label', async () => {
    await page.getByTestId('mode-private').click();
    await expect(page.getByTestId('home-primary')).toHaveText('CREATE TABLE');
    await designAudit(page);
    // JOIN A GAME… opens the lobby package's sheet; while that part draws nothing it says so.
    await page.getByTestId('home-join').click();
    await expect.poll(() => page.evaluate(() => window.__homeHarness!.toasts())).toContain('Joining by a pasted link is not in this build yet. Open the link itself.');
    // The mode cards are a radio group: the arrow keys move the mode.
    await page.getByTestId('mode-private').press('ArrowLeft');
    await expect(page.getByTestId('mode-quick')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mode-quick')).toBeFocused();
    await expect(page.getByTestId('home-primary')).toHaveText('FIND MATCH');
    await expect(page.getByTestId('home-status')).toHaveText('Connects your browser directly to other players who are looking. They see your name and network address.');
    await page.getByTestId('opt-ranked').getByRole('radio', { name: 'RANKED', exact: true }).click();
    await expect(page.getByTestId('home-status')).toHaveText('Ranked counts only when the loser concedes.');
  });

  await test.step('the mode survives a reload', async () => {
    await expect.poll(() => page.evaluate(async () => ((await window.__homeHarness!.homePrefs()) as { mode: string }).mode)).toBe('quick');
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
    await expect(page.getByTestId('mode-quick')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('home-primary')).toHaveText('FIND MATCH');
  });
  await designAudit(page);
});

test('the deck arrows and Left / Right step the library; Draft night shows three boosters and no deck arrows', async ({ page }) => {
  const profile = uniq('draft');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('a', 'Alpha Deck', 60, { updatedAt: 3 }), fixtureDeck('b', 'Beta Deck', 60, { updatedAt: 2 })]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('hero-eyebrow')).toHaveText('YOUR DECK · 1 OF 2');
  await page.getByTestId('home-next').click();
  await expect(page.getByTestId('hero-name')).toHaveText('Beta Deck');
  await page.getByTestId('hero-row').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('hero-name')).toHaveText('Alpha Deck');

  await page.getByTestId('mode-draft').click();
  await expect(page.getByTestId('home-primary')).toHaveText('OPEN DRAFT TABLE');
  await expect(page.getByTestId('home-boosters').locator('svg')).toHaveCount(3);
  await expect(page.getByTestId('home-boosters').locator('svg').first()).toHaveAttribute('aria-label', 'M19 booster');
  await expect(page.getByTestId('home-prev')).toHaveCount(0);
  await expect(page.getByTestId('home-next')).toHaveCount(0);
  await expect(page.getByTestId('hero-name')).toHaveCount(0);
  await designAudit(page);
  // CHANGE BOOSTERS opens the decks package's booster setup sheet; while that part draws nothing it says so.
  await page.getByTestId('home-change-boosters').click();
  await expect.poll(() => page.evaluate(() => window.__homeHarness!.toasts())).toContain('Changing the boosters is not in this build yet.');
  await expect(page.getByTestId('home-booster-sheet')).toHaveCount(0);
});

test('with an unfinished game the CONTINUE strip names it and the primary still reads PLAY', async ({ page }) => {
  const profile = uniq('cont');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy', 60)]);
  await seedGames(page, [fixtureGame('amber-fox-river-93', Date.now() - 60_000)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('home-continue-game')).toHaveText("VS BEN · Turn 3 · Ben's turn");
  await expect(page.getByTestId('home-continue-time')).toHaveText('1 min');
  await expect(page.getByTestId('home-primary')).toHaveText('PLAY');
  await expect(page.getByTestId('home-recent').getByTestId('history-row')).toHaveCount(1);
  await page.getByTestId('home-continue').click();
  await expect(page.getByTestId('harness-table')).toHaveAttribute('data-hash', '#/t/amber-fox-river-93/a2V5LWtleS1rZXkta2V5AA');
});

test('removing the game from the recent list takes the CONTINUE strip with it', async ({ page }) => {
  const profile = uniq('cont-rm');
  await openHomeHarness(page, { profile });
  await seedGames(page, [fixtureGame('amber-fox-river-93', Date.now() - 60_000)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('home-continue')).toBeVisible();
  await page.getByTestId('home-recent').locator('[data-code="amber-fox-river-93"]').getByTestId('history-remove').click();
  await expect(page.getByTestId('home-recent').getByTestId('history-row')).toHaveCount(0);
  await expect(page.getByTestId('home-continue')).toHaveCount(0);
});

test('PLAY with a deck of the library records when the deck was last played', async ({ page }) => {
  const profile = uniq('touch');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy', 60)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await page.getByTestId('home-primary').click();
  await expect(page.getByTestId('harness-table')).toHaveAttribute('data-hash', /^#\/p\/p-/);
  await expect.poll(async () => (await page.evaluate(() => window.__homeHarness!.decks())).find((d) => d.id === 'gruul')?.lastPlayedAt ?? 0).toBeGreaterThan(0);
});

test('STARTER DECK in Quick match builds and selects a starter deck and stays on Home', async ({ page }) => {
  const profile = uniq('starter');
  await openHomeHarness(page, { profile });
  await page.getByTestId('mode-quick').click();
  await expect(page.getByTestId('home-primary')).toBeDisabled();
  await page.getByTestId('home-starter-deck').click();
  await expect(page.getByTestId('hero-name')).toHaveText('Starter · Green');
  await expect(page.getByTestId('home-primary')).toHaveText('FIND MATCH');
  await expect(page.getByTestId('harness-table')).toHaveCount(0);
  const decks = await page.evaluate(() => window.__homeHarness!.decks());
  expect(decks.map((d) => d.name)).toEqual(['Starter · Green']);
  expect(await page.evaluate(() => window.__homeHarness!.games())).toEqual([]);
  await expect.poll(() => page.evaluate(async () => ((await window.__homeHarness!.homePrefs()) as { deckId: string | null }).deckId)).toBe(decks[0]!.id);
});

test('searching: the pill is pressed with the timer, the deck is locked, and the queue bar follows to Decks and History', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-20T10:00:00Z') });
  const profile = uniq('seek');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('a', 'Alpha Deck', 60, { updatedAt: 3 }), fixtureDeck('b', 'Beta Deck', 60, { updatedAt: 2 })]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await page.getByTestId('mode-quick').click();

  await test.step('FIND MATCH seeks with the deck and the queue of the prefs', async () => {
    await page.getByTestId('home-primary').click();
    await expect.poll(() => page.evaluate(() => window.__homeHarness!.seeks())).toEqual([{ queues: ['1v1.constructed.casual'], deckId: 'a' }]);
  });

  await test.step('seeking', async () => {
    await page.clock.pauseAt(new Date('2026-11-20T10:30:00Z'));
    await page.evaluate((since) => {
      window.__homeHarness!.setStatus({
        phase: 'seeking',
        lobby: { shard: 0, nat: 'open', seekers: [], byQueue: { '1v1.constructed.casual': 1 }, unreachable: 0, otherVersion: 0, full: false } as never,
        since,
        window: { rating: null, band: null },
        alone: false,
        deckId: 'a',
        queues: ['1v1.constructed.casual'],
      });
    }, new Date('2026-11-20T10:30:00Z').getTime());
    const pill = page.getByTestId('home-primary');
    await expect(pill).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('home-timer')).toHaveText('0:00');
    await page.clock.runFor(42_000);
    await expect(page.getByTestId('home-timer')).toHaveText('0:42');
    await expect(page.getByTestId('home-prev')).toBeDisabled();
    await expect(page.getByTestId('home-next')).toBeDisabled();
    await expect(page.getByTestId('home-change-deck')).toBeDisabled();
    await expect(page.getByTestId('mode-solo')).toBeDisabled();
    // The option row is locked too (journey.md 4.5): every Format and Ranked option.
    for (const row of ['opt-quick-format', 'opt-ranked']) {
      const radios = page.getByTestId(row).getByRole('radio');
      await expect(radios).not.toHaveCount(0);
      for (const r of await radios.all()) await expect(r).toBeDisabled();
    }
    await expect.poll(() => page.evaluate(async () => (await window.__homeHarness!.homePrefs()) as { quick: { format: string } })).toMatchObject({ quick: { format: '1v1' } });
    await expect(page.getByTestId('home-cancel')).toBeVisible();
    await expect(page.getByTestId('home-queued')).toHaveText('QUICK MATCH · 1V1 · UNRANKED');
    // Home shows the search itself; the bar follows the player everywhere else (journey.md 4.5).
    await expect(page.getByTestId('queue-bar')).toHaveCount(0);
  });

  await test.step('the queue bar on Decks and History', async () => {
    await page.getByTestId('shell-nav').getByRole('radio', { name: 'DECKS' }).click();
    await expect(page.getByTestId('harness-stub-decks')).toBeVisible();
    // The bar's content is the queue chip (M8-P7's; a stub that draws nothing here): the slot is there.
    await expect(page.getByTestId('queue-bar')).toHaveCount(1);
    await page.getByTestId('shell-nav').getByRole('radio', { name: 'HISTORY' }).click();
    await expect(page.getByTestId('history-page')).toBeVisible();
    await expect(page.getByTestId('queue-bar')).toHaveCount(1);
    await page.getByTestId('shell-nav').getByRole('radio', { name: 'PLAY' }).click();
    await page.getByTestId('home-cancel').click();
    await expect.poll(() => page.evaluate(() => window.__homeHarness!.status().phase)).toBe('off');
    await page.getByTestId('shell-nav').getByRole('radio', { name: 'HISTORY' }).click();
    await expect(page.getByTestId('history-page')).toBeVisible();
    await expect(page.getByTestId('queue-bar')).toHaveCount(0);
  });
});

test('offline: the modes that need the network say so; Solo still plays', async ({ page, context }) => {
  await openHomeHarness(page, { profile: uniq('offline') });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy', 60)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await page.getByTestId('mode-private').click();
  await context.setOffline(true);
  await expect(page.getByTestId('home-primary')).toHaveText('OFFLINE');
  await expect(page.getByTestId('home-primary')).toBeDisabled();
  await expect(page.getByTestId('home-status')).toHaveText('You are offline. Solo works with decks you have opened before.');
  await page.getByTestId('mode-solo').click();
  await expect(page.getByTestId('home-primary')).toHaveText('PLAY');
  await expect(page.getByTestId('home-primary')).toBeEnabled();
  await context.setOffline(false);
  await page.getByTestId('mode-private').click();
  await expect(page.getByTestId('home-primary')).toHaveText('CREATE TABLE');
});

test('Quick match while the matchmaker is a stub: disabled with its line', async ({ page }) => {
  await openHomeHarness(page, { profile: uniq('nomm'), query: { mm: 'off' } });
  await seedDecks(page, [fixtureDeck('a', 'Alpha Deck', 60)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await page.getByTestId('mode-quick').click();
  await expect(page.getByTestId('home-primary')).toBeDisabled();
  await expect(page.getByTestId('home-status')).toHaveText('Matchmaking is not in this build yet.');
});

test('first run: one PLAY builds and saves a starter deck and opens a practice table; a failing source offers the sheet', async ({ page }) => {
  const profile = uniq('first');
  await openHomeHarness(page, { profile, query: { starter: 'fail' } });
  await test.step('the source fails', async () => {
    await page.getByTestId('home-primary').click();
    const sheet = page.getByTestId('first-run-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'TRY AGAIN' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'PASTE A DECK LIST' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'OPEN AN EMPTY TABLE' })).toBeVisible();
    await designAudit(page);
  });
  await test.step('TRY AGAIN with the source back', async () => {
    await page.evaluate(() => window.__homeHarness!.starter('ok'));
    await page.getByTestId('first-run-retry').click();
    await expect(page.getByTestId('harness-table')).toHaveAttribute('data-hash', /^#\/p\/p-/);
    const decks = await page.evaluate(() => window.__homeHarness!.decks());
    expect(decks.map((d) => d.name)).toEqual(['Starter · Green']);
    const games = await page.evaluate(() => window.__homeHarness!.games());
    expect(games[0]).toMatchObject({ kind: 'solo', opponent: 'dummy', deck: { name: 'Starter · Green' } });
  });
});

test('at 390 px nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHomeHarness(page, { profile: uniq('narrow') });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy With A Long Name', 60)]);
  await seedGames(page, [fixtureGame('amber-fox-river-93', Date.now() - 60_000)]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('hero-name')).toBeVisible();
  for (const hash of ['#/', '#/history']) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('the real app opens at ./ on Home, not a table: shell, nav, primary; no canvas and nothing alive', async ({ page }) => {
  await page.goto(`./?profile=${uniq('app')}&faces=placeholder&transport=local`);
  await expect(page.getByTestId('route-home')).toBeVisible();
  await expect(page.getByTestId('shell')).toBeVisible();
  await expect(page.getByTestId('shell-nav').getByRole('radio', { name: 'PLAY' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('home-primary')).toBeVisible();
  await expect(page.getByTestId('scene-host')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__spellplane?.home?.route())).toBe('home');
  const counts = await page.evaluate(() => window.__spellplane?.home?.live?.() ?? null);
  expect(counts).not.toBeNull();
  expect(Object.values(counts!).every((n) => n === 0)).toBe(true);
});

test('the profile chip: a made-up nickname, renamed in the popover and kept over a reload; the gear opens Settings', async ({ page }) => {
  const profile = uniq('nick');
  await openHomeHarness(page, { profile });
  const chip = page.getByTestId('profile-name-chip');
  await expect(chip).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  await page.getByTestId('profile-chip').click();
  const popover = page.getByTestId('profile-popover');
  await expect(popover).toBeVisible();
  await designAudit(page);
  const field = popover.getByRole('textbox', { name: 'Nickname' });
  await field.fill('Quiet Heron');
  await field.press('Enter');
  await expect(chip).toHaveText('Quiet Heron');
  await expect.poll(() => page.evaluate(() => window.__homeHarness!.nickname())).toBe('Quiet Heron');
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('profile-name-chip')).toHaveText('Quiet Heron');
  await page.getByTestId('shell-gear').click();
  await page.getByTestId('gear-menu').getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByTestId('harness-stub-settings')).toBeVisible();
});

test('screenshots of Home, Draft night and History (evidence, not baselines)', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const profile = uniq('shots');
  await openHomeHarness(page, { profile });
  await seedDecks(page, [fixtureDeck('gruul', 'Gruul Stompy', 60), fixtureDeck('b', 'Beta Deck', 60, { updatedAt: 1 })]);
  await seedGames(page, [fixtureGame('amber-fox-river-93', Date.now() - 12 * 60_000), fixtureGame('reed-owl-cliff-12', Date.now() - 2 * 3_600_000, { format: 'ffa4', active: 's2', turn: 11, players: [
    { seat: 's0', name: 'Ann', colour: 0, life: 18, away: false, me: true },
    { seat: 's1', name: 'Ben', colour: 1, life: 12, away: true, me: false },
    { seat: 's2', name: 'Cleo', colour: 2, life: 20, away: false, me: false },
    { seat: 's3', name: 'Dan', colour: 3, life: 7, away: false, me: false },
  ] })]);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
  await expect(page.getByTestId('hero-name')).toHaveText('Gruul Stompy');
  await shot(page, 'M8', 'home', info.project.name);
  await page.getByTestId('mode-draft').click();
  await expect(page.getByTestId('home-boosters')).toBeVisible();
  await shot(page, 'M8', 'home-draft', info.project.name);
  await page.evaluate(() => (location.hash = '#/history'));
  await expect(page.getByTestId('history-row')).toHaveCount(2);
  await shot(page, 'M8', 'history', info.project.name);
});
