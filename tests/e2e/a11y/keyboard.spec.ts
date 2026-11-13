/**
 * Keyboard card focus, the accessible mirror, the log as a live region and seat glyphs, on the HUD module test page
 * (`?harness=ui`: the real HUD over a fake session and a DOM stand-in for the scene). DESIGN "Input and interaction
 * design", Accessibility: "every card action is reachable from the keyboard by cycling focus through cards in a zone";
 * "The log is a live region, so screen readers announce actions"; "Seat colours are paired with a shape or pattern";
 * "Keys never fire while a text field has focus". PLAN M5-P4; DECISIONS [M5-C]: arrows move focus, the focused card
 * counts as hovered for the keymap, 'assertive' only for prompts addressed to this player.
 */
import { expect, test, type Page } from '@playwright/test';
import type { CardFocus } from '../../../src/ui/a11y/index';
import type { ViewState } from '../../../src/scene/types';
import { hook } from '../helpers/app';
import { drafts, hoverCard, hoverNothing, openHud, ui } from '../ui/harness';

const focus = (page: Page) => hook<CardFocus | null>(page, 'a11y.focus');
const announcements = (page: Page) => hook<string[]>(page, 'a11y.announcements');
const view = (page: Page) => ui<ViewState | null>(page, 'view');
const active = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);

test.describe('keyboard card focus (PLAN M5-P4)', () => {
  test('arrows cycle the hand and move between zones; the card keys act on the focused card; focus passes on when the card leaves', async ({ page }) => {
    await openHud(page);
    await hoverNothing(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h1' });
    // The mirror takes DOM focus (a screen reader follows it) and is described by the focused card.
    expect(await active(page)).toBe('a11y-mirror');
    await expect(page.getByTestId('a11y-mirror')).toHaveAttribute('data-focus-text', 'Spark Jolt. Your hand, 1 of 4');
    await expect(page.getByTestId('a11y-focus-chip')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h2' });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h4' });
    await page.keyboard.press('PageUp');
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h1' });

    // Down: the own battlefield, read left to right in the far row first.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focus(page)).toEqual({ zone: 'battlefield:s0', card: 'bf1' });
    await expect.poll(async () => (await view(page))?.focused).toBe('bf1');
    expect((await view(page))?.hovered ?? null).toBeNull();
    await page.keyboard.press('KeyT');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'bf1', tapped: true }]);

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focus(page)).toEqual({ zone: 'battlefield:s0', card: 'bf2' });
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await ui<{ cards: Record<string, { zone: string }> }>(page, 'state')).cards.bf2?.zone).toBe('graveyard:s0');
    // The card left: focus passes to the card that took its place.
    await expect.poll(() => focus(page)).toEqual({ zone: 'battlefield:s0', card: 'dfc' });

    // Escape leaves the focus; the scene stops drawing the ring.
    await page.keyboard.press('Escape');
    await expect.poll(() => focus(page)).toBeNull();
    await expect.poll(async () => (await view(page))?.focused ?? null).toBeNull();
  });

  test('never focuses a hidden card: the library is a zone without a card, the opponent\'s hand is skipped', async ({ page }) => {
    await openHud(page);
    await hoverNothing(page);
    const seen: (CardFocus | null)[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowDown');
      seen.push(await focus(page));
    }
    const zones = seen.map((f) => f?.zone);
    expect(zones).toContain('library:s0');
    expect(zones).toContain('battlefield:s1');
    expect(zones).not.toContain('hand:s1');
    expect(seen.find((f) => f?.zone === 'library:s0')?.card).toBeNull();
    expect(seen.find((f) => f?.zone === 'library:s1')?.card ?? null).toBeNull();
    expect(seen.map((f) => f?.card)).not.toContain('opph1');
    const lib = (await announcements(page)).find((t) => t.startsWith('Your library'));
    expect(lib).toBe('Your library, 3 cards, face down');
  });

  test('the keyboard focus wins over a resting pointer; moving the pointer onto another card hands the keys back', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h4' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    await expect.poll(() => focus(page)).toEqual({ zone: 'battlefield:s0', card: 'land1' });
    await page.keyboard.press('KeyT');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'tap', card: 'land1', tapped: true }]);
    await hoverCard(page, 'dfc');
    await expect.poll(() => focus(page)).toBeNull();
    await page.keyboard.press('KeyT');
    await expect.poll(async () => (await drafts(page)).at(-1)).toEqual({ type: 'tap', card: 'dfc', tapped: true });
  });

  test('arrows in a text field stay in the field; Tab onto the table puts focus on the first card', async ({ page }) => {
    await openHud(page);
    await hoverNothing(page);
    await page.getByTestId('chat-input').focus();
    await page.keyboard.type('hi');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    expect(await focus(page)).toBeNull();
    await page.getByTestId('a11y-mirror').focus();
    await expect.poll(() => focus(page)).toEqual({ zone: 'hand:s0', card: 'h1' });
  });
});

test.describe('the log as a live region (PLAN M5-P4)', () => {
  test('a new log line is announced once, politely; a filter change announces nothing; the log list itself is not live', async ({ page }) => {
    await openHud(page);
    await expect(page.getByTestId('live-polite')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('live-assertive')).toHaveAttribute('aria-live', 'assertive');
    expect(await page.getByTestId('log-lines').getAttribute('aria-live')).toBeNull();
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('live-polite')).toContainText('Anna taps Test Bear');
    const said = await announcements(page);
    expect(said.filter((t) => t.includes('Anna taps Test Bear'))).toHaveLength(1);
    await page.getByTestId('log-filter-chat').click();
    await page.getByTestId('log-filter-all').click();
    await page.waitForTimeout(600);
    expect(await announcements(page)).toEqual(said);
  });

  test('a prompt addressed to this player is announced assertively, with its keys', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.confirm = { id: 'r9', askedBy: 's1', durationMs: 60000, startSeq: 0, responses: {} };
      }),
    );
    await expect(page.getByTestId('confirm-prompt')).toBeVisible();
    await expect(page.getByTestId('live-assertive')).toContainText(/Ben asks for responses\. Enter: OK\. \w+: hold\./);
    // The asker's seat glyph stands beside the asker's seat-coloured name.
    await expect(page.getByTestId('confirm-prompt').getByTestId('seat-glyph')).toHaveAttribute('data-glyph', 'square');
  });
});

test.describe('seat glyphs beside seat colours (PLAN M5-P4)', () => {
  test('log lines and the turn strip pair the seat colour with the seat\'s glyph', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    const line = page.getByTestId('log-line').last();
    await expect(line.getByTestId('seat-glyph')).toHaveAttribute('data-glyph', 'circle');
    await expect(page.getByTestId('active-player').getByTestId('seat-glyph')).toHaveAttribute('data-glyph', 'circle');
    // Decorative for screen readers: the name next to it says who it is.
    await expect(line.getByTestId('seat-glyph')).toHaveAttribute('aria-hidden', 'true');
  });
});
