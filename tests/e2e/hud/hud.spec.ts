/**
 * PLAN M7-P2 acceptance: the HUD of docs/design/m7-hud-proposal.md. Always visible only a five-step turn tracker with a
 * clear "your turn" state, one context-aware primary button, Menu, Undo, the log ticker and the plates; rare tools one
 * step away in the Menu; no keyboard shortcut text in the primary UI (tooltips may show keys); life plates you click
 * or scrub; counters only when not zero; every function reachable without keys.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { menuItem, openLog, openZone, plateDetails } from '../helpers/hud';
import { call } from '../solo/helpers';
import { drafts, openHud } from '../ui/harness';
import { LOOKS, soloWithDeck, state } from './helpers';
import { LOOKS as LOOK_TOKENS } from '../../../src/ui/design/tokens';

/** Text of the HUD's always-visible controls (the menu, drawers and dialogs closed). */
async function primaryUiText(page: Page): Promise<string> {
  return page.getByTestId('hud').evaluate((root) => {
    const parts = ['.top-left', '.top-centre', '.right', '.own-avatar', '.bottom-right'].map((s) => root.querySelector(s));
    return parts.map((p) => (p as HTMLElement | null)?.innerText ?? '').join('\n');
  });
}

test.describe('always visible (docs/design/m7-hud-proposal.md)', () => {
  test('Menu, Undo, the turn tracker, the primary button, the own plate and the activity button; nothing else', async ({ page }, info) => {
    await soloWithDeck(page, info, { hand: 7 });
    await expect(page.getByTestId('open-menu')).toBeVisible();
    await expect(page.getByTestId('undo')).toBeVisible();
    await expect(page.getByTestId('turn-strip')).toBeVisible();
    await expect(page.getByTestId('primary-action')).toBeVisible();
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"]')).toBeVisible();
    await expect(page.getByTestId('open-log')).toBeVisible();
    // Rare tools are one step away, not on the screen.
    for (const id of ['open-deck-import', 'open-token', 'clip-tray', 'open-cheat-sheet', 'open-settings', 'open-theme-settings', 'perspective']) await expect(page.getByTestId(id)).toHaveCount(0);
    // The log is a ticker, not a column: no chat field, no log lines until the drawer opens.
    await expect(page.getByTestId('chat-input')).toHaveCount(0);
    // No shortcut text in the primary UI: no <kbd>, no "Ctrl+", no key letters in brackets.
    await expect(page.locator('[data-testid="hud"] kbd:visible')).toHaveCount(0);
    expect(await primaryUiText(page)).not.toMatch(/Ctrl\+|Shift\+|⌘|\bTab\b|Enter/);
    // Zero counters are noise: no "poison 0" on the plate.
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"] [data-testid="counter-chip"]')).toHaveCount(0);
    // Tooltips still teach the keys.
    await expect(page.getByTestId('undo')).toHaveAttribute('title', /Ctrl\+Z|⌘Z/);
  });

  test('the turn tracker shows five grouped steps and says whose turn it is', async ({ page }) => {
    await openHud(page);
    const strip = page.getByTestId('turn-strip');
    await expect(strip.locator('[data-step]')).toHaveCount(5);
    await expect(strip.locator('[data-step]')).toHaveText(['Beginning', 'Main', 'Combat', 'Main 2', 'End']);
    await expect(strip.getByTestId('whose-turn')).toHaveText(/Your turn|'s turn/);
    // Every one of the seven phases is still one press away (any player moves the marker, DESIGN "Turn flow").
    await expect(strip.locator('[data-phase]')).toHaveCount(7);
    await strip.locator('[data-step="combat"]').click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'phaseSet', phase: 'combat' });
    await strip.locator('[data-step="beginning"]').hover();
    await strip.locator('[data-phase="upkeep"]').click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'phaseSet', phase: 'upkeep' });
  });
});

test.describe('the primary button follows the turn', () => {
  test('to combat, main 2, end turn; the new turn offers untap and draw on a press; never a key', async ({ page }, info) => {
    await soloWithDeck(page, info, { hand: 7 });
    await page.evaluate(() => window.__spellplane!.input!.reset());
    const primary = page.getByTestId('primary-action');
    const strip = page.getByTestId('turn-strip');
    await expect(strip.getByTestId('whose-turn')).toHaveText('Your turn');
    await strip.locator('[data-step="main"]').click();
    await expect(primary).toHaveText('To combat ▸');
    await primary.click();
    await expect.poll(async () => (await state(page)).turn.phase).toBe('combat');
    await expect(primary).toHaveText('Main 2 ▸');
    await primary.click();
    await expect.poll(async () => (await state(page)).turn.phase).toBe('main2');
    await expect(primary).toHaveText('End turn ▸');
    const turn = (await state(page)).turn.number;
    const hand = (await state(page)).zones['hand:s0']!.ids.length;
    await primary.click();
    // The solo table's empty chair is passed over: End turn hands the next turn straight back.
    await expect.poll(async () => (await state(page)).turn.number).toBe(turn + 1);
    await expect.poll(async () => (await state(page)).turn.active).toBe('s0');
    // The new turn: the offer is open and the button takes it on a deliberate press.
    await expect(page.getByTestId('untap-offer')).toBeVisible();
    await expect(primary).toHaveText('Untap & draw ▸');
    await primary.click();
    await expect.poll(async () => (await state(page)).zones['hand:s0']!.ids.length).toBe(hand + 1);
    await expect.poll(async () => (await state(page)).turn.phase).toBe('main1');
    await expect(page.getByTestId('untap-offer')).toHaveCount(0);
    await expect(primary).toHaveText('To combat ▸');
    expect(await hook<number>(page, 'input.keydowns')).toBe(0);
  });

  test("on another player's turn the button waits for them", async ({ page }) => {
    await openHud(page);
    await page.evaluate(() => window.__uiHarness!.update((s) => void (s.turn.active = 's1')));
    await expect(page.getByTestId('primary-action')).toHaveText('Waiting for Ben');
    await expect(page.getByTestId('primary-action')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('whose-turn')).toHaveText("Ben's turn");
  });

  test('a turn left with an empty chair is passed on by the button, and the tracker says so', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        // Ben's seat as the sandbox's empty chair: no name, no peer, no cards.
        s.seats['s1']!.name = '';
        delete s.seats['s1']!.peer;
        for (const [id, c] of Object.entries(s.cards)) if (c.owner === 's1') delete s.cards[id];
        for (const z of Object.values(s.zones)) if (z.owner === 's1') z.ids = [];
        s.turn = { number: 4, active: 's1', phase: 'end' };
      }),
    );
    const primary = page.getByTestId('primary-action');
    await expect(page.getByTestId('whose-turn')).toHaveText("Empty seat's turn");
    await expect(primary).toHaveText('Next turn ▸');
    await expect(primary).not.toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => window.__uiHarness!.clear());
    await primary.click();
    expect(await drafts(page)).toEqual([{ type: 'turnPass', to: 's0' }]);
  });
});

test.describe('the Menu: rare tools one step away', () => {
  test('opens grouped, every item opens its tool, Esc closes and gives focus back', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-menu').click();
    const pop = page.getByTestId('menu-popover');
    await expect(pop).toBeVisible();
    for (const g of ['game', 'tools', 'view', 'help']) await expect(pop.locator(`[data-group="${g}"]`)).toBeVisible();
    // No Deck group: `Import deck…` left the Menu (journey.md 4.10; gate M8 N10).
    await expect(pop.locator('[data-group="deck"]')).toHaveCount(0);
    // Keys show in muted type on the right, not in labels.
    await expect(pop.getByTestId('open-token').locator('.ds-key')).not.toHaveText('');
    // Keyboard: the first item has focus, arrows move it, Esc closes and returns focus to the Menu button.
    await expect(pop.locator('[role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(pop.locator('[role="menuitem"]').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.getByTestId('open-menu')).toBeFocused();

    // `Import deck…` left the Menu (journey.md 4.10; gate M8 N10): the no-deck line opens the paste dialog.
    await page.getByTestId('open-menu').click();
    await expect(pop).toBeVisible();
    await expect(pop.getByTestId('open-deck-import')).toHaveCount(0);
    await expect(pop).not.toContainText('Import deck');
    await page.keyboard.press('Escape');
    const opens: [string, string][] = [
      ['open-token', 'token-search'],
      ['open-cheat-sheet', 'cheat-sheet'],
      ['open-settings', 'settings'],
      ['menu-draw-n', 'draw-n'],
    ];
    for (const [item, panel] of opens) {
      await menuItem(page, item);
      await expect(page.getByTestId(panel)).toBeVisible();
      await expect(page.getByTestId('menu-popover')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.mouse.click(720, 450);
    }
  });

  test('a press outside closes it', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('menu-popover')).toBeVisible();
    await page.mouse.click(700, 500);
    await expect(page.getByTestId('menu-popover')).toHaveCount(0);
  });
});

test.describe('plates: life you click or scrub, counters only when used', () => {
  test('± on hover, a drag scrubs, a click types a value, arrows step it', async ({ page }) => {
    await openHud(page);
    const me = page.locator('[data-testid="avatar"][data-seat="s0"]');
    const life = me.getByTestId('life');
    await expect(life).toHaveText('20');
    await me.getByTestId('life-plus').click();
    await me.getByTestId('life-minus').click();
    expect((await drafts(page)).map((a) => a.delta)).toEqual([1, -1]);
    // Scrub: 5 points up in one drag, one life change on release.
    const box = (await life.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 30, { steps: 4 });
    await page.mouse.move(at.x, at.y - 64, { steps: 4 });
    await expect(life).toHaveText('25');
    await page.mouse.up();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'life', seat: 's0', delta: 5 });
    await expect(life).toHaveText('25');
    // Down loses.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 40, { steps: 5 });
    await page.mouse.up();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'life', seat: 's0', delta: -3 });
    // A click types a value.
    await life.click();
    const input = me.getByTestId('life-input');
    await expect(input).toBeFocused();
    await input.fill('7');
    await input.press('Enter');
    await expect(life).toHaveText('7');
    expect((await drafts(page)).at(-1)).toEqual({ type: 'life', seat: 's0', delta: -15 });
    // Keyboard: the life total is a spin button.
    await life.focus();
    await page.keyboard.press('ArrowUp');
    expect((await drafts(page)).at(-1)).toEqual({ type: 'life', seat: 's0', delta: 1 });
    await expect(life).toHaveAttribute('role', 'spinbutton');
  });

  test("counters show as chips once not zero; the plate's ⋯ holds every counter and the piles", async ({ page }) => {
    await openHud(page);
    const me = page.locator('[data-testid="avatar"][data-seat="s0"]');
    await expect(me.getByTestId('counter-chip')).toHaveCount(0);
    const plate = await plateDetails(page, 's0');
    await plate.locator('[data-testid="player-counter"][data-kind="poison"]').getByRole('button', { name: /add/i }).click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'playerCounter', seat: 's0', kind: 'poison', delta: 1 });
    await expect(me.locator('[data-testid="counter-chip"][data-kind="poison"]')).toContainText('1');
    await plate.getByTestId('add-counter').click();
    await plate.getByTestId('counter-name').fill('energy');
    await plate.getByTestId('counter-name').press('Enter');
    expect((await drafts(page)).at(-1)).toEqual({ type: 'playerCounter', seat: 's0', kind: 'energy', delta: 1 });
    // The piles are there with their counts and open their viewer.
    await openZone(page, 'graveyard:s0');
    await expect(page.getByTestId('pile-viewer')).toBeVisible();
  });

  test('the plate menu closes on Esc after a mouse click opened it; "Set life…" opens the life field', async ({ page }) => {
    await openHud(page);
    const ben = await plateDetails(page, 's1');
    await page.keyboard.press('Escape');
    await expect(ben.getByTestId('plate-details')).toHaveCount(0);
    const me = await plateDetails(page, 's0');
    await me.getByTestId('plate-set-life').click();
    await expect(me.getByTestId('plate-details')).toHaveCount(0);
    const input = me.getByTestId('life-input');
    await expect(input).toBeFocused();
    await input.fill('12');
    await input.press('Enter');
    expect((await drafts(page)).at(-1)).toEqual({ type: 'life', seat: 's0', delta: -8 });
    // Another player's menu has no "Set life…".
    await expect((await plateDetails(page, 's1')).getByTestId('plate-set-life')).toHaveCount(0);
  });

  test("another player's plate shows their hand count", async ({ page }) => {
    await openHud(page);
    const ben = page.locator('[data-testid="avatar"][data-seat="s1"]');
    const n = await page.evaluate(() => window.__uiHarness!.state().zones['hand:s1']!.ids.length);
    await expect(ben.getByTestId('hand-count')).toHaveText(String(n));
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('hand-count')).toHaveCount(0);
  });
});

test.describe('the log: a ticker that expands to the full log and chat', () => {
  test('new lines tick in with an unread count; the drawer shows the timeline and chat; closing it resets the count', async ({ page }, info) => {
    await soloWithDeck(page, info);
    await expect(page.getByTestId('log-ticker')).toBeAttached();
    await call(page, 'draw', 2);
    await expect(page.getByTestId('log-ticker').locator('li').first()).toBeAttached();
    await expect(page.getByTestId('open-log').locator('.ds-badge')).toHaveText(/\d+/);
    await openLog(page);
    await expect(page.getByTestId('log-line').last()).toContainText(/draws/);
    await page.getByTestId('chat-input').fill('hello table');
    await page.getByTestId('chat-input').press('Enter');
    await expect(page.getByTestId('log-line').last()).toContainText('hello table');
    await page.getByTestId('close-log').click();
    await expect(page.getByTestId('chat-input')).toHaveCount(0);
    await expect(page.getByTestId('open-log').locator('.ds-badge')).toHaveCount(0);
  });
});

test.describe('three looks switch the HUD skin with the table', () => {
  test('"Look…" in the Menu opens the look settings', async ({ page }, info) => {
    await soloWithDeck(page, info);
    await menuItem(page, 'open-theme-settings');
    await expect(page.getByTestId('theme-settings')).toBeVisible();
  });

  for (const look of LOOKS) {
    test(`${look}: the primary button wears the accent and the panels the look's surface`, async ({ page }, info) => {
      await soloWithDeck(page, info, { look });
      const hex = LOOK_TOKENS[look].colour.accent;
      const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
      // Polled: the kit's button eases its background when the look changes.
      await expect.poll(() => page.getByTestId('primary-action').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb);
      // No backdrop-filter anywhere in the HUD (Safari).
      const filtered = await page.getByTestId('hud').evaluate((root) => [...root.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e) as CSSStyleDeclaration & { webkitBackdropFilter?: string }; return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none'); }).length);
      expect(filtered).toBe(0);
    });
  }
});
