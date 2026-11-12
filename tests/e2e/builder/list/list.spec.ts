/**
 * The builder's list view in real browsers (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "Two
 * views of the same pool, switchable at any time … List view. A compact two-column list (pool and deck) with filters
 * and counts, for quick edits and for tablets"; Constructed decks: Scryfall search and build; Local deck library).
 * PLAN M2-P6 acceptance: a deck built in the table view appears identically in the list view and back; export then
 * import reproduces the deck. Behaviour is asserted on the shared DeckBuild (window.__listHarness), not on pixels.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import { card, freshProfile, getBuild, openList, searchOnlyCards, setBuild, tableBuild } from './bundle';

/** `count name` of every row of a column, in display order. */
async function rows(page: Page, column: 'pool' | 'deck'): Promise<string[]> {
  return page
    .getByTestId(`list-${column}`)
    .getByTestId('list-row')
    .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-count')} ${e.querySelector('.name')!.textContent!.replace('✦', '').trim()}${e.getAttribute('data-foil') ? ' (foil)' : ''}`));
}

function row(page: Page, column: 'pool' | 'deck', name: string): Locator {
  return page.getByTestId(`list-${column}`).getByTestId('list-row').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*✦?$`) }) });
}

async function showList(page: Page): Promise<void> {
  await page.getByTestId('view-list').click();
  await expect(page.getByTestId('builder-list')).toBeVisible();
}

test.describe('deck built in the table view, edited in the list view (PLAN M2-P6 acceptance)', () => {
  test('appears identically in the list view and back, with nothing of the table view lost', async ({ context }, info) => {
    const { page, external } = await openList(context, { profile: freshProfile(info) });
    const original = tableBuild();
    // The builder table hands over the build it made.
    await setBuild(page, original);
    await expect(page.getByTestId('fake-table')).toContainText('8 of 13');
    await showList(page);

    // Card for card the same deck and the same rest of the pool.
    expect(await rows(page, 'deck')).toEqual(['1 Shock (foil)', '1 Sarkhan, Fireblood', '2 Llanowar Elves', '1 Draconic Disciple', '3 Forest']);
    expect(await rows(page, 'pool')).toEqual(['1 Cancel', '1 Divination', '1 Shock', '1 Meteor Golem', '1 Detection Tower']);
    await expect(page.getByTestId('list-deck-count')).toHaveText('8');
    await expect(page.getByTestId('list-pool-count')).toHaveText('5');
    await expect(page.getByTestId('list-deck-lands')).toHaveText('3 lands');
    await expect(page.getByTestId('list-minimum-hint')).toHaveText('40-card minimum: 32 to go');
    // Looking writes nothing back.
    expect(await page.evaluate(() => window.__listHarness!.changes())).toBe(0);
    expect(await getBuild(page)).toEqual(original);

    // A quick edit: Divination into the deck, the foil Shock out.
    await row(page, 'pool', 'Divination').getByRole('button', { name: /Move one to the deck/ }).click();
    await row(page, 'deck', 'Shock').getByRole('button', { name: /Move one to the pool/ }).click();
    await expect(page.getByTestId('list-deck-count')).toHaveText('8');
    const edited = await getBuild(page);
    expect(edited.main).toEqual(['p6', 'p1', 'b1', 'p4', 'p5', 'b2', 'p11', 'p3']);
    // Everything else the table view knows is untouched: ids, cards, positions.
    expect(edited.cards).toEqual(original.cards);
    expect(edited.poses).toEqual(original.poses);

    // Back to the table view and to the list again: the same deck, nothing lost.
    await page.getByTestId('view-table').click();
    await expect(page.getByTestId('fake-table')).toContainText('8 of 13');
    expect(await getBuild(page)).toEqual(edited);
    await showList(page);
    expect(await rows(page, 'deck')).toEqual(['1 Divination', '1 Sarkhan, Fireblood', '2 Llanowar Elves', '1 Draconic Disciple', '3 Forest']);
    expect(await rows(page, 'pool')).toEqual(['1 Cancel', '1 Shock', '1 Shock (foil)', '1 Meteor Golem', '1 Detection Tower']);

    // And the reverse edit gives the table view its original build back, exactly.
    await row(page, 'deck', 'Divination').getByRole('button', { name: /Move one/ }).click();
    await row(page, 'pool', 'Shock').and(page.locator('[data-foil="true"]')).getByRole('button', { name: /Move one/ }).click();
    const back = await getBuild(page);
    expect(back.cards).toEqual(original.cards);
    expect(back.poses).toEqual(original.poses);
    expect([...back.main].sort()).toEqual([...original.main].sort());
    expect(external).toEqual([]);
  });

  test('a change made in the table view while the list is open shows at once', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    await setBuild(page, tableBuild());
    await showList(page);
    const b = tableBuild();
    b.main = b.main.filter((id) => id !== 'p6');
    await setBuild(page, b);
    await expect(row(page, 'pool', 'Sarkhan, Fireblood')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('list-deck-count')).toHaveText('7');
  });
});

test.describe('filters, sort and counts', () => {
  test('filters narrow both columns and survive switching to the table view and back', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    await setBuild(page, tableBuild());
    await showList(page);

    await page.getByTestId('list-filter-colour').and(page.locator('[data-colour="R"]')).click();
    await expect(page.locator('[data-colour="R"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await rows(page, 'deck')).toEqual(['1 Shock (foil)', '1 Sarkhan, Fireblood', '1 Draconic Disciple']);
    expect(await rows(page, 'pool')).toEqual(['1 Shock']);
    await expect(page.getByTestId('list-deck-shown')).toHaveText('showing 3');
    // The totals stay what they are.
    await expect(page.getByTestId('list-deck-count')).toHaveText('8');

    await page.getByTestId('list-filter-kind').selectOption('instant');
    expect(await rows(page, 'deck')).toEqual(['1 Shock (foil)']);
    await page.getByTestId('list-filter-kind').selectOption('all');
    await page.getByTestId('list-filter-text').fill('fireblood');
    expect(await rows(page, 'deck')).toEqual(['1 Sarkhan, Fireblood']);
    await expect(page.getByTestId('list-pool')).toContainText('No card matches the filters.');

    // Typing in the filter is text, never a key command on the list (DESIGN "Input and interaction design").
    await page.getByTestId('list-filter-text').press('Enter');
    expect(await page.evaluate(() => window.__listHarness!.changes())).toBe(0);

    await page.getByTestId('view-table').click();
    await showList(page);
    await expect(page.getByTestId('list-filter-text')).toHaveValue('fireblood');
    await expect(page.locator('[data-colour="R"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await rows(page, 'deck')).toEqual(['1 Sarkhan, Fireblood']);

    await page.getByTestId('list-filter-clear').click();
    expect(await rows(page, 'deck')).toHaveLength(5);
    await expect(page.getByTestId('list-deck-shown')).toHaveCount(0);
  });

  test('a card whose data arrives while a filter is set shows up once it matches', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    const bat = searchOnlyCards().find((c) => c.name === 'Kelinore Bat')!;
    const b = tableBuild();
    // A pool card the page's card data does not know yet (its data comes with the search below).
    b.cards.push({ id: 'x1', ref: { sid: bat.id } });
    await setBuild(page, b);
    await showList(page);
    await page.getByTestId('list-filter-text').fill('kelinore');
    await expect(page.getByTestId('list-pool')).toContainText('No card matches the filters.');

    const search = page.getByTestId('list-search');
    await search.getByTestId('list-search-query').fill('Kelinore Bat');
    await search.getByTestId('list-search-go').click();
    await expect(search.getByTestId('list-search-result')).toHaveCount(1);
    // Nothing else changes: the filter and the build stay as they are, and the row appears by itself.
    await expect(row(page, 'pool', 'Kelinore Bat')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('list-pool-shown')).toHaveText('showing 1');
    expect(await page.evaluate(() => window.__listHarness!.changes())).toBe(0);
  });

  test('sorting groups by colour, mana value and type; the list follows the builder\'s sort until it picks its own', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    await setBuild(page, tableBuild());
    await showList(page);
    const groups = (column: 'pool' | 'deck') => page.getByTestId(`list-${column}`).getByTestId('list-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
    expect(await groups('deck')).toEqual(['R', 'G', 'M', 'L']);
    await page.evaluate(() => window.__listHarness!.sort('type'));
    expect(await groups('deck')).toEqual(['creature', 'planeswalker', 'instant', 'land']);
    await page.getByTestId('list-sort').selectOption('manaValue');
    expect(await groups('deck')).toEqual(['mv1', 'mv3', 'land']);
    expect(await groups('pool')).toEqual(['mv1', 'mv3', 'mv7', 'land']);
    // Sorting is a view: the build is unchanged.
    expect(await getBuild(page)).toEqual(tableBuild());
  });

  test('move all, the basic-land dispenser and keyboard use', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    await setBuild(page, tableBuild());
    await showList(page);

    // One more Forest from the dispenser, then all Forests out: dispensed ones go back to the dispenser.
    await row(page, 'deck', 'Forest').getByTestId('list-more-basic').click();
    await expect(row(page, 'deck', 'Forest')).toHaveAttribute('data-count', '4');
    const withMore = await getBuild(page);
    const added = withMore.cards.at(-1)!;
    expect(added).toEqual({ id: 'list-basic-1', ref: { sid: card('Forest').id }, basic: true });
    expect(withMore.main.at(-1)).toBe('list-basic-1');
    await row(page, 'deck', 'Forest').getByTestId('list-move-all').click();
    await expect(row(page, 'deck', 'Forest')).toHaveCount(0);
    expect(await rows(page, 'pool')).toContain('1 Forest');
    const out = await getBuild(page);
    expect(out.cards.map((c) => c.id)).toEqual(tableBuild().cards.filter((c) => !c.basic).map((c) => c.id));
    expect(Object.keys(out.poses!)).not.toContain('b1');

    // Shift-click moves every copy; a row button works from the keyboard.
    await row(page, 'deck', 'Llanowar Elves').getByRole('button', { name: /Move one/ }).click({ modifiers: ['Shift'] });
    await expect(row(page, 'pool', 'Llanowar Elves')).toHaveAttribute('data-count', '2');
    await row(page, 'pool', 'Cancel').getByRole('button', { name: /Move one/ }).focus();
    await page.keyboard.press('Enter');
    await expect(row(page, 'deck', 'Cancel')).toHaveCount(1);
  });
});

test.describe('Scryfall search-and-add (fixture-backed)', () => {
  test('finds cards and adds them to the deck or the pool; basic lands come from the dispenser', async ({ context }, info) => {
    const { page, searches, external } = await openList(context, { profile: freshProfile(info) });
    await setBuild(page, tableBuild());
    await showList(page);

    const search = page.getByTestId('list-search');
    // An M10 card: not in the page's card data, so only the search can bring it in.
    await search.getByTestId('list-search-query').fill('Kelinore Bat');
    await search.getByTestId('list-search-query').press('Enter');
    await expect(search.getByTestId('list-search-result')).toHaveCount(1);
    await search.getByRole('button', { name: 'Add Kelinore Bat to the deck' }).click();
    await expect(row(page, 'deck', 'Kelinore Bat')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('list-deck-count')).toHaveText('9');
    await search.getByRole('button', { name: 'Add Kelinore Bat to the pool' }).click();
    await expect(row(page, 'pool', 'Kelinore Bat')).toHaveAttribute('data-count', '1');
    await expect(search.getByTestId('list-search-result')).toContainText('×2');
    const b = await getBuild(page);
    expect(b.cards.slice(-2).map((c) => c.id)).toEqual(['list-add-1', 'list-add-2']);
    expect(b.main.at(-1)).toBe('list-add-1');

    await search.getByTestId('list-search-query').fill('Island');
    await search.getByTestId('list-search-go').click();
    await search.getByTestId('list-search-result').filter({ hasText: /^Island/ }).getByTestId('list-search-add-deck').click();
    expect((await getBuild(page)).cards.at(-1)).toMatchObject({ id: 'list-basic-1', basic: true });

    // No match, and a failing Scryfall, are reported inline.
    await search.getByTestId('list-search-query').fill('Zzyzx');
    await search.getByTestId('list-search-go').click();
    await expect(search.getByTestId('list-search-empty')).toContainText('No cards match');
    await search.getByTestId('list-search-query').fill('fail');
    await search.getByTestId('list-search-go').click();
    await expect(search.getByTestId('list-search-error')).toContainText('Search failed');
    expect(searches).toEqual(['Kelinore Bat', 'Island', 'Zzyzx', 'fail']);
    expect(external).toEqual([]);

    // The search box and its results are still there after a trip to the table view.
    await page.getByTestId('view-table').click();
    await showList(page);
    await expect(search.getByTestId('list-search-query')).toHaveValue('fail');
    await expect(search.getByTestId('list-search-error')).toContainText('Search failed');
  });
});

test.describe('local deck and pool library', () => {
  test('save, reload, export, import into another browser profile: the deck comes back the same', async ({ context, browser }, info) => {
    const profile = freshProfile(info);
    const { page } = await openList(context, { profile, query: { origin: 'M19,M19,M19' } });
    const original = tableBuild();
    await setBuild(page, original);
    await showList(page);

    const lib = page.getByTestId('deck-library');
    await lib.getByTestId('library-name').fill('M19 draft, Gruul');
    await lib.getByTestId('library-save').click();
    await expect(lib.getByTestId('library-status')).toContainText('Saved “M19 draft, Gruul”');
    await expect(lib.getByTestId('library-record')).toHaveCount(1);
    await expect(lib.getByTestId('library-record')).toContainText('pool');
    await expect(lib.getByTestId('library-record')).toContainText('8 + 5 cards');

    // Edit and save again: the same record is updated, not a second one added.
    await row(page, 'pool', 'Cancel').getByRole('button', { name: /Move one/ }).click();
    await lib.getByTestId('library-save').click();
    await expect(lib.getByTestId('library-status')).toContainText('Saved changes');
    await expect(lib.getByTestId('library-record')).toHaveCount(1);
    await expect(lib.getByTestId('library-record')).toContainText('9 + 4 cards');
    const saved = await getBuild(page);

    // The library is kept by the browser: a reload finds it.
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.body.dataset.ready === '1')).toBe(true);
    await showList(page);
    await expect(page.getByTestId('library-record')).toHaveCount(1);

    // Export the deck as a file.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('library-export').click()]);
    expect(download.suggestedFilename()).toBe('m19-draft-gruul.spellplane.json');
    const file = info.outputPath('deck.json');
    await download.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { format: string; decks: { name: string; origin: unknown; source: string }[] };
    expect(json.format).toBe('spellplane-decks');
    expect(json.decks).toHaveLength(1);
    expect(json.decks[0]).toMatchObject({ name: 'M19 draft, Gruul', source: 'drafted', origin: { format: 'pass', sets: ['M19', 'M19', 'M19'] } });

    // Another browser profile (its own IndexedDB) imports the file and opens the deck: the same build.
    const other = await browser.newContext();
    try {
      const { page: p2 } = await openList(other, { profile: freshProfile(info) });
      await showList(p2);
      const lib2 = p2.getByTestId('deck-library');
      await lib2.getByTestId('library-import').setInputFiles(file);
      await expect(lib2.getByTestId('library-status')).toContainText('Imported 1 deck.');
      await lib2.getByTestId('library-open').click();
      expect(await getBuild(p2)).toEqual(saved);
      expect(await rows(p2, 'deck')).toEqual(['1 Cancel', '1 Shock (foil)', '1 Sarkhan, Fireblood', '2 Llanowar Elves', '1 Draconic Disciple', '3 Forest']);
      expect(await rows(p2, 'pool')).toEqual(['1 Divination', '1 Shock', '1 Meteor Golem', '1 Detection Tower']);

      // Importing the same file again adds nothing.
      await lib2.getByTestId('library-import').setInputFiles(file);
      await expect(lib2.getByTestId('library-status')).toContainText('1 already in the library');
      await expect(lib2.getByTestId('library-record')).toHaveCount(1);
    } finally {
      await other.close();
    }
  });

  test('a new pool on the same page is saved as a new record; the earlier pool is kept', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info), query: { origin: 'M19' } });
    const first = tableBuild();
    await setBuild(page, first);
    await showList(page);
    const lib = page.getByTestId('deck-library');
    await lib.getByTestId('library-name').fill('Tuesday pool');
    await lib.getByTestId('library-save').click();
    await expect(lib.getByTestId('library-status')).toContainText('Saved “Tuesday pool”');
    await expect(lib.getByTestId('library-save')).toHaveText('Save changes');

    // A new draft on the same link, without a reload: the builder table hands over another pool.
    await page.getByTestId('view-table').click();
    const second = tableBuild();
    const drafted = second.cards.filter((c) => !c.basic);
    const refs = drafted.map((c) => c.ref);
    drafted.forEach((c, i) => (c.ref = refs[(i + 1) % refs.length]!));
    second.main = ['p1', 'p2'];
    await setBuild(page, second);
    await showList(page);
    await expect(lib.getByTestId('library-save')).toHaveText('Save to library');
    await expect(lib.getByTestId('library-save-new')).toHaveCount(0);
    await expect(lib.getByTestId('library-name')).toHaveValue('');
    await lib.getByTestId('library-save').click();
    await expect(lib.getByTestId('library-status')).toContainText('Saved “M19 pool');
    await expect(lib.getByTestId('library-record')).toHaveCount(2);

    // The earlier pool is in the library as it was saved.
    const tuesday = lib.getByTestId('library-record').filter({ hasText: 'Tuesday pool' });
    await expect(tuesday).toContainText('8 + 5 cards');
    await tuesday.getByTestId('library-open').click();
    await tuesday.getByTestId('library-confirm').click();
    expect(await getBuild(page)).toEqual(first);
    // Opened, it is the current record again: an edit saves into it.
    await expect(lib.getByTestId('library-save')).toHaveText('Save changes');
    await expect(lib.getByTestId('library-name')).toHaveValue('Tuesday pool');
  });

  test('opening a saved deck asks inline before replacing the builder\'s cards; delete asks too', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    const original = tableBuild();
    await setBuild(page, original);
    await showList(page);
    const lib = page.getByTestId('deck-library');
    await lib.getByTestId('library-save').click();
    await expect(lib.getByTestId('library-record')).toHaveCount(1);
    await expect(lib.getByTestId('library-record-name')).toHaveText(/^Deck \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    // The builder moves on (the table view takes everything out of the deck)…
    await setBuild(page, { ...original, main: [] });
    await lib.getByTestId('library-open').click();
    // …and opening asks first; the list stays live under the question.
    await expect(lib.getByText("Replace the builder's cards?")).toBeVisible();
    expect((await getBuild(page)).main).toEqual([]);
    await lib.getByRole('button', { name: 'Cancel' }).click();
    expect((await getBuild(page)).main).toEqual([]);
    await lib.getByTestId('library-open').click();
    await lib.getByTestId('library-confirm').click();
    expect(await getBuild(page)).toEqual(original);

    await lib.getByTestId('library-delete').click();
    await expect(lib.getByTestId('library-record')).toHaveCount(1);
    await lib.getByTestId('library-confirm').click();
    await expect(lib.getByTestId('library-record')).toHaveCount(0);
    await expect(lib.getByTestId('library-status')).toContainText('Deleted');
  });

  test('a damaged file imports what it can and lists what it skipped', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info) });
    await showList(page);
    const good = { id: 'g1', name: 'Good', main: [{ sid: card('Shock').id }], side: [], source: 'pasted', createdAt: 1, updatedAt: 2 };
    const bad = { id: 'b1', name: 'Broken', main: 'everything', side: [], source: 'pasted', createdAt: 1, updatedAt: 2 };
    const lib = page.getByTestId('deck-library');
    await lib.getByTestId('library-import').setInputFiles({ name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'spellplane-decks', version: 1, exportedAt: 0, decks: [good, bad] })) });
    await expect(lib.getByTestId('library-status')).toContainText('Imported 1 deck.');
    await expect(lib.getByTestId('library-problems')).toContainText('Deck 2 "Broken" was skipped');
    await expect(lib.getByTestId('library-record-name')).toHaveText('Good');

    await lib.getByTestId('library-import').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') });
    await expect(lib.getByTestId('library-status')).toContainText('Nothing was imported.');
    await expect(lib.getByTestId('library-problems')).toContainText('not JSON');
    await expect(lib.getByTestId('library-record')).toHaveCount(1);
  });

  test('without browser storage the list view works and offers no library', async ({ context }, info) => {
    const { page } = await openList(context, { profile: freshProfile(info), query: { storage: 'off' } });
    await setBuild(page, tableBuild());
    await showList(page);
    await expect(page.getByTestId('list-deck-count')).toHaveText('8');
    await expect(page.getByTestId('deck-library')).toHaveCount(0);
  });
});

test('tablet width: two columns side by side, touch-sized rows', async ({ context }, info) => {
  const { page } = await openList(context, { profile: freshProfile(info) });
  await page.setViewportSize({ width: 820, height: 1180 });
  await setBuild(page, tableBuild());
  await showList(page);
  const pool = (await page.getByTestId('list-pool').boundingBox())!;
  const deck = (await page.getByTestId('list-deck').boundingBox())!;
  expect(deck.x).toBeGreaterThan(pool.x + pool.width - 1);
  expect(Math.abs(deck.y - pool.y)).toBeLessThan(2);
  const button = (await row(page, 'deck', 'Shock').getByRole('button', { name: /Move one/ }).boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(32);
  // No horizontal scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
