/**
 * Marks only where used (docs/design/m8/m7-adjustments.md, M7-P1, change 3: "library and graveyard slots always;
 * exile, command and the stack lane only while they hold a card or a dragged card is within 60 mm"; PLAN Milestone 8,
 * M7-P1: "empty exile unmarked, marked while a card is dragged within 60 mm or held").
 *
 * The render harness's real table scene in Plain (the default look); what is marked is read through the debug hook
 * (`render.zoneMarks()`), and a screenshot of each step is evidence under artifacts/shots/M7/looks/.
 */
import { expect, test, type Page } from '@playwright/test';
import { harnessLayout } from '../../../../src/scene/harness-fixture';
import { CARD_W } from '../../../../src/scene/math';
import { openRender, settle } from '../../render/helpers';
import { capture, evidence, onScreen, setTilt, toScreen } from './helpers';

const layout = harnessLayout();
const exile = layout.seats[0]!.zones.exile;

const marks = (page: Page) => page.evaluate(() => window.__spellplane!.render!.zoneMarks!());

/** The screen point of the table point `dx` mm from the exile slot's centre toward the table's middle (along -x). */
async function besideExile(page: Page, dx: number): Promise<{ x: number; y: number }> {
  const p = await toScreen(page, exile.x - dx, exile.y);
  expect(onScreen(page, p)).toBe(true);
  return p!;
}

test.describe('marks only where used', () => {
  test('an empty exile is unmarked; a card dragged within 60 mm marks it; dragged away it is unmarked again', async ({ page }, info) => {
    const errors = await openRender(page, { theme: 'plain', scenario: 'empty' });
    await setTilt(page, 1);
    expect(exile.rot % 180).toBe(0);

    await test.step('nothing marks exile, command or the stack lane on an empty table', async () => {
      expect(await marks(page)).toEqual([]);
      evidence(info, 'marks-empty', (await capture(page)).png);
    });

    // A card on s0's battlefield, 300 mm left of the exile slot (its centre), face up.
    const far = 300;
    await page.evaluate(([x, y]) => window.__renderHarness!.addCard('m1', 'fx-1', { x: x!, y: y!, rot: 0 }), [exile.x - far, exile.y] as const);
    await settle(page);
    expect(await marks(page)).toEqual([]);

    const start = await besideExile(page, far);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();

    await test.step('dragged to 40 mm from the slot’s edge: exile:s0 is marked, nothing else', async () => {
      // Card centre 40 mm beyond the slot's left edge (half a card width from its centre).
      const near = await besideExile(page, CARD_W / 2 + 40);
      await page.mouse.move(near.x, near.y, { steps: 12 });
      await expect.poll(() => marks(page), { timeout: 10_000 }).toEqual(['exile:s0']);
      evidence(info, 'marks-dragged-near', (await capture(page)).png);
    });

    await test.step('dragged back to 120 mm: unmarked while still held', async () => {
      const back = await besideExile(page, CARD_W / 2 + 120);
      await page.mouse.move(back.x, back.y, { steps: 8 });
      await expect.poll(() => marks(page), { timeout: 10_000 }).toEqual([]);
    });

    await test.step('released on the battlefield: still unmarked', async () => {
      await page.mouse.up();
      await settle(page);
      expect(await marks(page)).toEqual([]);
    });
    expect(errors).toEqual([]);
  });

  test('an exile that holds a card is marked without any drag (each seat’s own)', async ({ page }) => {
    const errors = await openRender(page, { theme: 'plain', scenario: 'demo' });
    await settle(page);
    // The demo table holds two cards in each exile and nothing in command or on the stack.
    expect(await marks(page)).toEqual(['exile:s0', 'exile:s1']);
    expect(errors).toEqual([]);
  });

  test('the stack lane is marked while the stack holds an item', async ({ page }) => {
    const errors = await openRender(page, { theme: 'plain', scenario: 'empty' });
    await settle(page);
    expect(await marks(page)).toEqual([]);
    await page.evaluate(() =>
      window.__spellplane!.dispatch!({ type: 'stackPush', by: 's0', cid: 'st1', item: 'i1', kind: 'ability', note: 'Draw a card.' } as never),
    );
    await expect.poll(() => marks(page), { timeout: 10_000 }).toEqual(['stack']);
    expect(errors).toEqual([]);
  });
});
