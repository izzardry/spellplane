/**
 * HUD behaviour on the `?harness=ui` page (PLAN M0-P4): hand fan geometry and drag into the scene, context menu with
 * keys, pile viewers, inspect, avatar life and counters, turn strip, log, deck import, token search, confirmation
 * prompt and the app shell's routes. Design references are in each test name's section.
 */
import { expect, test } from '@playwright/test';
import { openApp } from '../helpers/app';
import { drafts, hoverCard, hoverNothing, openHud, ui } from './harness';

test.describe('hand fan (DESIGN "Specification: geometry, layout and motion", Screen layer)', () => {
  test('cards are 22% of the viewport high, the hovered one 45%, upright and in the owner\'s order', async ({ page }) => {
    await openHud(page);
    const vp = page.viewportSize()!;
    const cards = page.getByTestId('hand-card');
    await expect(cards).toHaveCount(4);
    expect(await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card))).toEqual(['h1', 'h2', 'h3', 'h4']);
    const box = (await cards.nth(1).boundingBox())!;
    expect(box.height).toBeCloseTo(vp.height * 0.22, 0);
    expect(box.width / box.height).toBeCloseTo(63 / 88, 2);
    expect(box.y + box.height).toBeCloseTo(vp.height, 0);
    await cards.nth(1).hover();
    await expect.poll(async () => (await cards.nth(1).boundingBox())!.height).toBeCloseTo(vp.height * 0.45, 0);
    const raised = (await cards.nth(1).boundingBox())!;
    expect(raised.width / raised.height).toBeCloseTo(63 / 88, 2);
    expect(raised.y + raised.height).toBeCloseTo(vp.height, 0);
  });

  test('a large hand overlaps to fit 80% of the viewport width', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s, sec) => {
        for (let i = 0; i < 16; i++) {
          const id = `x${i}`;
          s.cards[id] = { id, owner: 's0', controller: 's0', zone: 'hand:s0', face: 'up', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} };
          s.zones['hand:s0']!.ids.push(id);
          sec.hand.push(id);
          sec.identities[id] = { card: { sid: 'sid-land' }, salt: 's' };
        }
        s.zones['hand:s0']!.ids.sort();
        (s.zones['hand:s0'] as { count: number }).count = s.zones['hand:s0']!.ids.length;
      }),
    );
    const vp = page.viewportSize()!;
    const cards = page.getByTestId('hand-card');
    await expect(cards).toHaveCount(20);
    await hoverNothing(page);
    // Cards slide into place (120 ms); measure once they have settled.
    const extent = () =>
      cards.evaluateAll((els) => {
        const rs = els.map((e) => e.getBoundingClientRect());
        return { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)) };
      });
    await expect.poll(async () => { const e = await extent(); return Math.round(e.right - e.left); }).toBe(Math.round(vp.width * 0.8));
    const { left, right } = await extent();
    expect(Math.abs((left + right) / 2 - vp.width / 2)).toBeLessThan(2);
  });

  test('dragging a hand card up hands the drag to the scene at the cursor', async ({ page }) => {
    await openHud(page);
    const card = page.locator('[data-testid="hand-card"][data-card="h2"]');
    const b = (await card.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 20);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y - 120, { steps: 6 });
    await page.mouse.up();
    const calls = await ui<{ method: string; args: unknown[] }[]>(page, 'scene');
    const drag = calls.find((c) => c.method === 'startDrag');
    expect(drag?.args[0]).toBe('h2');
    expect(drag!.args[2] as number).toBeLessThan(b.y);
  });

  test('another player\'s hand never shows in the fan', async ({ page }) => {
    await openHud(page);
    await expect(page.locator('[data-testid="hand-card"][data-card="opph1"]')).toHaveCount(0);
  });
});

test.describe('context menu (DESIGN "Input and interaction design": menus show the key beside each action)', () => {
  test('right-click on a card lists its actions with keys; choosing one acts on that card', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="scene-card"][data-card="bf1"]').click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="tap"]')).toContainText('T');
    await expect(menu.locator('[data-action="toLibraryBottom"] kbd')).toHaveText('Shift+L');
    await expect(menu.locator('[data-action="attack"] kbd')).toHaveText('A');
    await expect(menu.locator('[data-action="trigger"]')).toBeVisible();
    await expect(menu.locator('[data-action="transform"]')).toHaveCount(0); // not double-faced
    await menu.locator('[data-action="toExile"]').click();
    await expect(menu).toHaveCount(0);
    expect(await drafts(page)).toEqual([{ type: 'move', card: 'bf1', to: 'exile:s0' }]);
  });

  test('right-click on a hand card offers cast; on empty table the table actions', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="hand-card"][data-card="h1"]').click({ button: 'right' });
    await expect(page.getByTestId('context-menu').locator('[data-action="cast"] kbd')).toHaveText('C');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await page.mouse.click(700, 150, { button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu.locator('[data-action="untapAll"] kbd')).toHaveText('Ctrl+U');
    await menu.locator('[data-action="settle"]').click();
    expect(await drafts(page)).toEqual([{ type: 'settle' }]);
  });
});

test.describe('pile viewers (DESIGN "Table model", "Card manipulation" library actions)', () => {
  test('graveyard opens as an ordered fan whose cards take hover keys', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="scene-pile"][data-zone="graveyard:s0"]').dblclick();
    const viewer = page.getByTestId('pile-viewer');
    await expect(viewer).toHaveAttribute('data-kind', 'graveyard');
    await expect(viewer.getByTestId('pile-card')).toHaveCount(2);
    expect(await viewer.getByTestId('pile-card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card))).toEqual(['gy1', 'gy2']);
    await viewer.locator('[data-card="gy2"]').hover();
    await page.keyboard.press('KeyE');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'move', card: 'gy2', to: 'exile:s0' }]);
    await expect(viewer.getByTestId('pile-card')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
  });

  test('the library shows only its count until you look; look at top N is logged through the session', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await expect(viewer.getByTestId('pile-count')).toHaveText('3');
    await expect(viewer.getByTestId('pile-card')).toHaveCount(0);
    await viewer.getByRole('spinbutton').fill('2');
    await viewer.getByTestId('look-top').click();
    await expect(viewer.getByTestId('pile-card')).toHaveCount(2);
    expect(await ui(page, 'calls')).toEqual([{ method: 'lookAt', args: ['library:s0', 2] }]);
    // Scry: Shift+L on a looked-at card sends it to the bottom.
    await viewer.locator('[data-card="lib1"]').hover();
    await page.keyboard.press('Shift+KeyL');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'toZone', card: 'lib1', to: 'library:s0', position: 'bottom' }]);
  });

  test('searching the library shuffles it on close by default', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await viewer.getByTestId('search-library').click();
    await expect(viewer.getByTestId('pile-card')).toHaveCount(3);
    await expect(viewer.getByTestId('shuffle-on-close')).toBeChecked();
    await viewer.getByRole('button', { name: /close/i }).click();
    expect(await ui(page, 'calls')).toEqual([
      { method: 'lookAt', args: ['library:s0', 3] },
      { method: 'shuffle', args: ['library:s0'] },
    ]);
  });

  test('double-clicking your own library draws a card and opens no viewer (DESIGN "Input and interaction design", Mouse)', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="scene-pile"][data-zone="library:s0"]').dblclick();
    await expect.poll(() => ui(page, 'calls')).toEqual([{ method: 'draw', args: [1] }]);
    await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
    await expect(page.locator('[data-testid="hand-card"][data-card="lib1"]')).toHaveCount(1);
    // Another seat's library still opens as a count-only viewer.
    await page.locator('[data-testid="scene-pile"][data-zone="library:s1"]').dblclick();
    await expect(page.getByTestId('pile-viewer').getByTestId('pile-count')).toHaveText('1');
  });

  test('mill N moves the top N cards to the graveyard as one group; reveal top shows the top card to the others', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await viewer.getByTestId('library-n').fill('2');
    await viewer.getByTestId('mill').click();
    await expect.poll(() => drafts(page)).toEqual([
      { type: 'move', card: 'lib1', to: 'graveyard:s0', group: 'g1' },
      { type: 'move', card: 'lib2', to: 'graveyard:s0', group: 'g1' },
    ]);
    await expect(viewer.getByTestId('pile-count')).toHaveText('1');
    await viewer.getByTestId('reveal-top').click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'revealTo', instanceId: 'lib3', seats: ['s1'] });
    expect(await ui(page, 'calls')).toEqual([]); // no private look was logged
  });

  test('the table menu offers reveal top and mill N, which asks for the count inline', async ({ page }) => {
    await openHud(page);
    await page.mouse.click(700, 150, { button: 'right' });
    const menu = page.getByTestId('context-menu');
    await menu.locator('[data-action="mill"]').click();
    const input = page.getByTestId('draw-n-input');
    await expect(input).toBeFocused();
    await expect(page.getByTestId('draw-n')).toContainText('Mill how many?');
    await input.fill('1');
    await page.keyboard.press('Enter');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'move', card: 'lib1', to: 'graveyard:s0' }]);
    await page.mouse.click(700, 150, { button: 'right' });
    await page.getByTestId('context-menu').locator('[data-action="revealTop"]').click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'revealTo', instanceId: 'lib2', seats: ['s1'] });
  });

  test('another player\'s hand shows its count and a hidden note, not "Empty."', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="hand:s1"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await expect(viewer.getByTestId('pile-count')).toHaveText('1');
    await expect(viewer.getByTestId('hidden-note')).toHaveText('Hidden. Only the count is known.');
    await expect(viewer).not.toContainText('Empty.');
  });

  test('another player\'s library shows its count only, without look or search', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="library:s1"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await expect(viewer.getByTestId('pile-count')).toHaveText('1');
    await expect(viewer.getByTestId('look-top')).toHaveCount(0);
    await expect(viewer.getByTestId('search-library')).toHaveCount(0);
  });
});

test.describe('stale hover (DESIGN "Input and interaction design": a bare key acts on the card under the cursor)', () => {
  test('after casting a hand card, a key on a table card acts on the table card', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'h1');
    await page.keyboard.press('KeyC');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'stackPush', item: 'si1', kind: 'spell', card: 'h1', controller: 's0', round: 'r2' }]);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await drafts(page)).at(-1)).toEqual({ type: 'move', card: 'bf1', to: 'graveyard:s0' });
  });

  test('after closing the graveyard viewer with Esc, a key on a table card acts on the table card', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="scene-pile"][data-zone="graveyard:s0"]').dblclick();
    await page.getByTestId('pile-viewer').locator('[data-card="gy1"]').hover();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyE');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'move', card: 'bf1', to: 'exile:s0' }]);
  });
});

test.describe('inspect (DESIGN "Card manipulation", Inspect; Screen layer: 85% of viewport height)', () => {
  test('hold Space on a looked-at library card shows its face', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="zone-button"][data-zone="library:s0"]').click();
    const viewer = page.getByTestId('pile-viewer');
    await viewer.getByTestId('look-top').click();
    await viewer.locator('[data-card="lib1"]').hover();
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect-text')).toContainText('Verdant Field');
    await expect(page.getByTestId('inspect-text')).not.toContainText('hidden');
    await page.keyboard.up('Space');
  });

  test('while a prompt shows, Esc closes an open cheat sheet first and Hold stays a key away', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.confirm = { id: 'r9', askedBy: 's1', durationMs: 60000, startSeq: 0, responses: {} };
      }),
    );
    await hoverNothing(page);
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cheat-sheet')).toHaveCount(0);
    expect(await ui(page, 'actions')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect.poll(() => drafts(page)).toEqual([{ type: 'respond', round: 'r9', seat: 's0', response: 'hold' }]);
  });

  test('middle-click opens a large upright view with both faces and Oracle text', async ({ page }) => {
    await openHud(page);
    await page.locator('[data-testid="scene-card"][data-card="dfc"]').click({ button: 'middle' });
    const view = page.getByTestId('inspect');
    await expect(view).toBeVisible();
    const faces = view.getByTestId('inspect-face');
    await expect(faces).toHaveCount(2);
    const vp = page.viewportSize()!;
    const b = (await faces.first().boundingBox())!;
    expect(b.height).toBeCloseTo(vp.height * 0.85, 0);
    expect(b.width / b.height).toBeCloseTo(63 / 88, 2);
    await expect(view.getByTestId('inspect-text')).toContainText('Moon Sage');
    await expect(view.getByTestId('inspect-text')).toContainText('At the beginning of each upkeep');
    await expect(view.getByTestId('inspect-text')).toContainText('Sun Sage');
    await expect(view.getByRole('link', { name: /rulings/i })).toHaveAttribute('href', /scryfall\.com\/card\/tst\//);
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
  });

  test('a tapped card is shown upright; an opponent\'s face-down card shows as hidden', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf2');
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect-face')).toHaveCount(1);
    const t = await page.getByTestId('inspect-face').evaluate((e) => getComputedStyle(e).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(t);
    await page.keyboard.up('Space');
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.cards.opp1!.face = 'down';
        delete s.cards.opp1!.identity;
      }),
    );
    await hoverCard(page, 'opp1');
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect-text')).toContainText('hidden');
    await page.keyboard.up('Space');
  });
});

test.describe('avatar (DESIGN "Turn flow and confirmation", Life and player counters)', () => {
  test('click, scroll and a typed value change life; counters add and remove', async ({ page }) => {
    await openHud(page);
    const me = page.locator('[data-testid="avatar"][data-seat="s0"]');
    await expect(me.getByTestId('life')).toHaveText('20');
    await me.getByTestId('life-plus').click();
    await me.getByTestId('life-minus').click();
    await me.getByTestId('life-minus').click();
    await me.getByTestId('life').hover();
    await page.mouse.wheel(0, 100);
    await expect(me.getByTestId('life')).toHaveText('18');
    await me.getByTestId('life').dblclick();
    const input = me.getByTestId('life-input');
    await expect(input).toBeFocused();
    await input.fill('14');
    await page.keyboard.press('Enter');
    await expect(me.getByTestId('life')).toHaveText('14');
    const d = await drafts(page);
    expect(d.map((a) => a.delta)).toEqual([1, -1, -1, -1, -4]);
    expect(d.every((a) => a.type === 'life' && a.seat === 's0')).toBe(true);
    await me.locator('[data-kind="poison"]').getByRole('button', { name: /add/i }).click();
    expect((await drafts(page)).at(-1)).toEqual({ type: 'playerCounter', seat: 's0', kind: 'poison', delta: 1 });
    await me.getByRole('button', { name: '+ counter' }).click();
    await me.getByTestId('counter-name').fill('energy');
    await page.keyboard.press('Enter');
    expect((await drafts(page)).at(-1)).toEqual({ type: 'playerCounter', seat: 's0', kind: 'energy', delta: 1 });
  });

  test('changes to an opponent\'s life go to their seat; life changes within two seconds merge into one log line', async ({ page }) => {
    await openHud(page);
    const ben = page.locator('[data-testid="avatar"][data-seat="s1"]');
    for (let i = 0; i < 3; i++) await ben.getByTestId('life-minus').click();
    expect((await drafts(page)).map((a) => [a.type, a.seat, a.delta])).toEqual([
      ['life', 's1', -1],
      ['life', 's1', -1],
      ['life', 's1', -1],
    ]);
    const lines = page.getByTestId('log-line');
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText('Ben: 20 → 17');
  });
});

test.describe('turn strip (DESIGN "Turn flow and confirmation", Turn and phase strip)', () => {
  test('shows turn number, active player and seven steps; Tab advances, clicking a step moves the marker', async ({ page }) => {
    await openHud(page);
    const strip = page.getByTestId('turn-strip');
    await expect(strip.getByTestId('turn-number')).toHaveText('Turn 1');
    await expect(strip.getByTestId('active-player')).toHaveText('Anna');
    await expect(strip.locator('[data-phase]')).toHaveCount(7);
    await expect(strip.locator('[aria-current="step"]')).toHaveText('Main 1');
    await hoverNothing(page);
    await page.keyboard.press('Tab');
    await expect(strip.locator('[aria-current="step"]')).toHaveText('Combat');
    await strip.locator('[data-phase="end"]').click();
    await expect(strip.locator('[aria-current="step"]')).toHaveText('End');
    await strip.getByTestId('next-turn').click();
    await expect(strip.getByTestId('turn-number')).toHaveText('Turn 2');
    await expect(strip.getByTestId('active-player')).toHaveText('Ben');
    expect(await drafts(page)).toEqual([
      { type: 'phaseSet', phase: 'combat' },
      { type: 'phaseSet', phase: 'end' },
      { type: 'turnPass', to: 's1' },
    ]);
  });

  test('passing the turn to yourself offers untap all and draw on one key, never done for you', async ({ page }) => {
    await openHud(page, { seats: ['Anna'] });
    await hoverNothing(page);
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('untap-offer')).toBeVisible();
    expect(await ui(page, 'calls')).toEqual([]);
    await page.keyboard.press('KeyU');
    await expect(page.getByTestId('untap-offer')).toHaveCount(0);
    expect(await ui(page, 'calls')).toEqual([{ method: 'draw', args: [1] }]);
    expect((await drafts(page)).slice(1)).toEqual([{ type: 'tap', card: 'bf2', tapped: false }]);
  });
});

test.describe('turn change and the stack chip (DESIGN "Turn flow and confirmation"; "The effect stack", Resolving)', () => {
  test('when another player passes the turn to you, you are offered untap-and-draw', async ({ page }) => {
    await openHud(page);
    await expect(page.getByTestId('untap-offer')).toHaveCount(0);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.turn = { number: 2, active: 's1', phase: 'untap' };
      }),
    );
    await expect(page.getByTestId('untap-offer')).toHaveCount(0);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.turn = { number: 3, active: 's0', phase: 'untap' };
      }),
    );
    await expect(page.getByTestId('untap-offer')).toBeVisible();
  });

  test('the stack chip offers the destinations with the default first; picking one resolves there', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.stack = [{ id: 'si9', kind: 'spell', controller: 's0', card: 'bf1' }];
      }),
    );
    const to = page.getByTestId('resolve-to');
    await expect(to.getByRole('button')).toHaveText(['Battlefield', 'Graveyard', 'Exile', 'Hand']);
    await expect(to.getByRole('button', { name: /default/ })).toHaveText('Battlefield');
    await to.getByRole('button', { name: 'Resolve to Exile' }).click();
    expect(await drafts(page)).toEqual([{ type: 'stackResolve', item: 'si9', to: 'exile:s0' }]);
  });
});

test.describe('log (DESIGN "Turn flow and confirmation", Action log)', () => {
  test('one line per action with actor and card name; hovering the name previews the card and highlights it', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyG');
    const lines = page.getByTestId('log-line');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('Anna taps Test Bear');
    await expect(lines.nth(1)).toContainText('Anna moves Test Bear to their graveyard');
    await expect(page.locator('[data-testid="log"] [aria-live="polite"]')).toHaveCount(1);
    await lines.nth(0).getByTestId('log-card').hover();
    await expect(page.getByTestId('card-preview')).toBeVisible();
    await expect.poll(async () => (await ui<{ hovered: string | null }>(page, 'view'))?.hovered).toBe('bf1');
  });

  test('chat lines interleave with actions', async ({ page }) => {
    await openHud(page);
    await hoverNothing(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('good game');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('log-line').last()).toContainText('Anna: good game');
  });
});

test.describe('focus and keys (DESIGN "Input and interaction design")', () => {
  test('after a mouse click on a HUD button, Enter still focuses the chat; a keyboard-focused button takes its own Enter', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-deck-import').click();
    await page.getByTestId('deck-import').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('deck-import')).toHaveCount(0);
    await hoverNothing(page);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('chat-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByTestId('open-cheat-sheet').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    await expect(page.getByTestId('chat-input')).not.toBeFocused();
  });
});

test.describe('deck import (DESIGN "Pre-game", Constructed decks)', () => {
  test('paste a list, see unresolved lines with near matches, fix one and import into the session', async ({ page }) => {
    await openHud(page);
    await page.getByTestId('open-deck-import').click();
    await page.getByTestId('deck-text').fill('4 Test Bear\n2 Spark Jolts\n20 Verdant Field\nnot a card line\n\nSideboard\n1 Moon Sage');
    await page.getByTestId('deck-check').click();
    const errors = page.getByTestId('deck-error');
    await expect(errors).toHaveCount(2);
    await expect(errors.nth(0)).toHaveAttribute('data-line', '2');
    await expect(errors.nth(1)).toHaveAttribute('data-line', '4');
    await expect(page.getByTestId('deck-summary')).toContainText('24 cards in the deck, 1 in the sideboard');
    await errors.nth(0).getByTestId('near-match').filter({ hasText: 'Spark Jolt' }).click();
    await expect(page.getByTestId('deck-summary')).toContainText('26 cards in the deck');
    await expect(page.getByTestId('deck-text')).toHaveValue(/^2 Spark Jolt$/m);
    await page.getByTestId('deck-import-go').click();
    await expect(page.getByTestId('deck-import')).toHaveCount(0);
    const calls = await ui<{ method: string; args: [{ main: { sid: string }[]; side: { sid: string }[] }] }[]>(page, 'calls');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('importDeck');
    expect(calls[0]!.args[0].main).toHaveLength(26);
    expect(calls[0]!.args[0].main.filter((r) => r.sid === 'sid-bolt')).toHaveLength(2);
    expect(calls[0]!.args[0].side).toEqual([{ sid: 'sid-dfc' }]);
    await expect(page.locator('[data-testid="zone-button"][data-zone="library:s0"] b')).toHaveText('29');
  });

  test('typing in the decklist never fires keys', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf1');
    await page.getByTestId('open-deck-import').click();
    await page.getByTestId('deck-text').focus();
    await page.keyboard.type('4 Test Bear tgedsa?');
    expect(await ui(page, 'actions')).toEqual([]);
    expect(await ui(page, 'calls')).toEqual([]);
  });
});

test.describe('token search (DESIGN "Card manipulation", Create token)', () => {
  test('Ctrl+T on a card lists its related tokens first; choosing one creates it beside the card', async ({ page }) => {
    await openHud(page);
    await hoverCard(page, 'bf2');
    await page.keyboard.press('Control+KeyT');
    const panel = page.getByTestId('token-search');
    await expect(panel.locator('[data-related="true"]')).toHaveText([/Sprout/]);
    await page.keyboard.type('o');
    await expect(panel.getByTestId('token-result').first()).toHaveText(/Sprout/);
    await expect(panel.getByTestId('token-result')).toHaveCount(2); // Sprout (related), Soldier
    await panel.getByTestId('token-result').first().click();
    await expect(panel).toHaveCount(0);
    expect(await drafts(page)).toEqual([{ type: 'createToken', card: 'c1', zone: 'battlefield:s0', pose: { x: -131, y: -260, rot: 0 }, ref: { sid: 'sid-tok-sprout' }, controller: 's0' }]);
  });
});

test.describe('confirmation prompt (DESIGN "Turn flow and confirmation", Confirmation rounds)', () => {
  test('another player\'s round shows OK and Hold with keys; Hold marks you as responding', async ({ page }) => {
    await openHud(page);
    await page.evaluate(() =>
      window.__uiHarness!.update((s) => {
        s.confirm = { id: 'r9', askedBy: 's1', label: 'attacks?', durationMs: 60000, startSeq: 0, responses: {} };
      }),
    );
    const prompt = page.getByTestId('confirm-prompt');
    await expect(prompt).toContainText('Ben');
    await expect(prompt).toContainText('attacks?');
    await expect(prompt.getByTestId('prompt-ok')).toContainText('Enter');
    await expect(prompt.getByTestId('prompt-hold')).toContainText('Esc');
    await hoverNothing(page);
    await page.keyboard.press('KeyH');
    await expect(prompt.getByTestId('release')).toBeVisible();
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('responding')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveCount(0);
    expect(await drafts(page)).toEqual([
      { type: 'respond', round: 'r9', seat: 's0', response: 'hold' },
      { type: 'respond', round: 'r9', seat: 's0', response: 'release' },
    ]);
  });
});

test.describe('app shell routes (PLAN M0-P4: #/ solo table, room for #/t/<room>/<key>, #/diag, #/lobby)', () => {
  for (const [hash, id] of [
    ['/lobby', 'route-lobby'],
    ['/diag', 'route-diag'],
    ['/t/abc/key123', 'route-room'],
    ['/nowhere', 'route-notFound'],
  ] as const) {
    test(`#${hash} shows its page`, async ({ page, browserName }) => {
      // M1-P5: the start page reads the key-pair identity, which Playwright WebKit on macOS cannot store (tests/e2e/lobby/helpers.ts).
      test.skip(hash === '/lobby' && browserName === 'webkit' && process.platform === 'darwin', 'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB');
      await page.goto(`./?faces=placeholder#${hash}`);
      await expect(page.getByTestId(id)).toBeVisible();
      await page.getByRole('link', { name: /solo table/i }).click();
      await expect(page.getByTestId(id)).toHaveCount(0);
      await expect(page.getByTestId('hud')).toBeVisible();
    });
  }

  test('#/ keeps the solo table', async ({ page }) => {
    await openApp(page, { hash: '/' });
    await expect(page.getByTestId('hud')).toBeVisible();
  });
});
