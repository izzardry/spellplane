/**
 * PLAN M5-P5 acceptance: key remapping in the settings panel — a remapped key works, a conflict is shown; every action
 * of the keymap is listed; reset; the talk key takes Ctrl alone (PLAN Milestone 5, owner decisions, Talk key: "the key
 * stays remappable in M5-P5's key-remapping UI"); the cheat sheet reflects remaps (DESIGN "Input and interaction
 * design": all keys remappable, no chord twice within one context, keys never fire while a text field has focus).
 * Runs on the HUD harness (`?harness=ui`: fake session, fake DOM scene, the real key engine).
 */
import { expect, test, type Page } from '@playwright/test';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { drafts, hoverCard, openHud, ui } from '../ui/harness';
import { openHudSettings } from './helpers';

const row = (page: Page, action: string, context = 'table') => page.locator(`[data-testid="key-row"][data-action="${action}"][data-context="${context}"]`);

async function change(page: Page, action: string, press: () => Promise<void>, context = 'table'): Promise<void> {
  await row(page, action, context).getByTestId('key-change').click();
  await expect(page.getByTestId('key-capture')).toBeVisible();
  await press();
}

test.describe('key remapping in the settings panel', () => {
  test('lists every action of the keymap with its key', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    const want = [...new Set(MTG_KEYMAP.map((b) => `${b.context}|${b.action}`))].sort();
    const got = await page.getByTestId('key-row').evaluateAll((rows) => rows.map((r) => `${(r as HTMLElement).dataset.context}|${(r as HTMLElement).dataset.action}`));
    expect(got.sort()).toEqual(want);
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['T']);
    await expect(row(page, 'counterAdd').getByTestId('key-current')).toHaveText(['+', '=']);
  });

  test('a remapped key works on the table, the old one no longer does, the cheat sheet shows it, and it survives a reload', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    await change(page, 'tap', () => page.keyboard.press('KeyJ'));
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['J']);
    await expect(row(page, 'tap')).toHaveAttribute('data-remapped', 'true');
    await expect(row(page, 'tap').getByTestId('key-default')).toHaveText('default T');
    // Capturing the key ran nothing on the table.
    expect(await ui(page, 'actions')).toEqual([]);
    expect(await ui(page, 'settingsWrites')).toEqual([{ name: 'keymap', value: [{ action: 'tap', context: 'table', chord: { key: 'j' } }] }]);
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('settings')).toHaveCount(0);

    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyJ');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);

    // The cheat sheet reads the same keymap.
    await page.getByTestId('open-cheat-sheet').click();
    await expect(page.locator('[data-testid="cheat-row"][data-action="tap"]').getByTestId('cheat-key')).toHaveText(['J']);
    await page.keyboard.press('Escape');

    await openHud(page, { keepSettings: true });
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyJ');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
  });

  test('a key another action holds is refused and named; nothing changes until the player swaps', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    await change(page, 'tap', () => page.keyboard.press('KeyG'));
    const conflict = page.getByTestId('key-conflict');
    await expect(conflict).toContainText('G is already “To graveyard”');
    await expect(conflict).toHaveAttribute('data-holder', 'toGraveyard');
    await expect(row(page, 'toGraveyard')).toHaveClass(/clash/);
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['T']);
    expect(await ui(page, 'settingsWrites')).toEqual([]);

    // A reserved key is refused too.
    await change(page, 'tap', () => page.keyboard.press('KeyU'));
    await expect(conflict).toContainText('Untap all and draw');
    await expect(page.getByTestId('key-swap')).toHaveCount(0);

    // Back to the G conflict, then swap.
    await change(page, 'tap', () => page.keyboard.press('KeyG'));
    await page.getByTestId('key-swap').click();
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['G']);
    await expect(row(page, 'toGraveyard').getByTestId('key-current')).toHaveText(['T']);
    await page.getByTestId('settings-close').click();
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyG');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);
    await page.evaluate(() => window.__uiHarness!.clear());
    await hoverCard(page, 'bf2');
    await page.keyboard.press('KeyT');
    await expect.poll(() => drafts(page)).toEqual([expect.objectContaining({ type: 'move', card: 'bf2', to: 'graveyard:s0' })]);
  });

  test('reset one action, then all keys', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    await change(page, 'tap', () => page.keyboard.press('KeyJ'));
    await change(page, 'draw', () => page.keyboard.press('F9'));
    await expect(row(page, 'draw').getByTestId('key-current')).toHaveText(['F9']);
    await row(page, 'tap').getByTestId('key-reset').click();
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['T']);
    await expect(row(page, 'tap').getByTestId('key-reset')).toHaveCount(0);
    await expect(row(page, 'draw').getByTestId('key-current')).toHaveText(['F9']);
    await page.getByTestId('keys-reset-all').click();
    await expect(row(page, 'draw').getByTestId('key-current')).toHaveText(['D']);
    await expect(page.locator('[data-testid="key-row"][data-remapped="true"]')).toHaveCount(0);
    expect((await ui<{ name: string; value: unknown }[]>(page, 'settingsWrites')).at(-1)).toEqual({ name: 'keymap', value: [] });
  });

  test('the talk key takes Ctrl alone; other actions refuse a bare Ctrl; Ctrl+T stays the token key', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    await change(page, 'talk', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.up('Control');
    });
    await expect(row(page, 'talk').getByTestId('key-current')).toHaveText([/^(Ctrl|Control)$/]);
    expect((await ui<{ name: string; value: unknown }[]>(page, 'settingsWrites')).at(-1)).toEqual({ name: 'keymap', value: [{ action: 'talk', context: 'table', chord: { key: 'Control' } }] });

    // A bare Ctrl for tapping is refused with the reason.
    await change(page, 'tap', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.up('Control');
    });
    await expect(page.getByTestId('key-conflict')).toContainText('can only be the talk key');
    await expect(row(page, 'tap').getByTestId('key-current')).toHaveText(['T']);

    // Ctrl held with T is the Ctrl+T chord, which "Create token" holds.
    await change(page, 'talk', () => page.keyboard.press('Control+KeyT'));
    await expect(page.getByTestId('key-conflict')).toContainText('“Create token”');
    await expect(row(page, 'talk').getByTestId('key-current')).toHaveText([/^(Ctrl|Control)$/]);
  });

  test('while a row waits for its key nothing reaches the table; Esc cancels the capture, then closes the panel', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    // A card clear of the panel (bf1 sits under it).
    await hoverCard(page, 'bf2');
    await row(page, 'flip').getByTestId('key-change').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('key-capture')).toHaveCount(0);
    await expect(page.getByTestId('settings')).toBeVisible();
    await expect(row(page, 'flip').getByTestId('key-current')).toHaveText(['F']);
    expect(await ui(page, 'actions')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);
  });

  test('the filter finds an action by name or key; typing in it fires no table key', async ({ page }) => {
    await openHud(page);
    await openHudSettings(page, 'keys');
    await hoverCard(page, 'bf2');
    await page.getByTestId('key-filter').fill('graveyard');
    await expect(page.getByTestId('key-row')).toHaveCount(1);
    await expect(row(page, 'toGraveyard')).toBeVisible();
    await page.getByTestId('key-filter').fill('zzzz');
    await expect(page.getByTestId('key-filter-empty')).toBeVisible();
    expect(await ui(page, 'actions')).toEqual([]);
  });
});
