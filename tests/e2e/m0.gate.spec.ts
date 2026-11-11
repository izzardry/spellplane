/**
 * Gate M0-G (docs/PLAN.md, Milestone 0): one player goldfishes the 60-card fixture deck on the solo table through the
 * real HUD and scene: paste the decklist into the import dialog; shuffle; draw seven; mulligan once; play a land;
 * tap it; cast a creature through the stack and resolve it to the battlefield; add two +1/+1 counters; create a
 * related token; attack and settle; move a card to the graveyard and exile; undo the last move; reload and find the
 * same state hash.
 *
 * Every step uses the design's UI path (keys on a hovered card, drags, dialogs, the pile viewer); engine behaviour is
 * asserted on the debug hook and state hashes, never on pixels. Screenshots (empty table, opening hand, mid-game
 * board, pile fan, inspect, cheat sheet) are review evidence under artifacts/shots/M0/.
 *
 * Card data comes from the recorded fixtures injected as window.__spellplaneFixtures (no network); faces are the
 * placeholder faces (?faces=placeholder).
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { CardInstance, SecretStore, TableState } from '../../src/core/types';
import { hook, shot } from './helpers/app';
import { call, decklist, freshProfile, openSolo, waitForSession } from './solo/helpers';

type ShownCard = { id: string; zone: string; tapped: boolean; screen: { x: number; y: number; width: number; height: number }; visible: boolean; moving: boolean; tier: string | null };

/** sid -> card name and type line, from the recorded fixtures (to pick a land, a creature, the Warleader). */
const FIXTURE_CARDS = new Map<string, { name: string; type_line: string }>(
  ['m19.json', 'tm19.json'].flatMap((f) =>
    (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as { id: string; name: string; type_line: string }[]).map((c) => [c.id, { name: c.name, type_line: c.type_line }] as const),
  ),
);

const ME = 's0';
const BF = `battlefield:${ME}`;

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const shown = (page: Page) => hook<ShownCard[]>(page, 'cards');
const sansSeq = (s: TableState) => ({ ...s, seq: 0 });

/** Name and type of an own card as this browser knows it (public identity or own secret). */
async function identify(page: Page, id: string): Promise<{ name: string; type_line: string }> {
  const [st, sec] = await Promise.all([state(page), secrets(page)]);
  const sid = st.cards[id]?.identity?.sid ?? sec.identities[id]?.card.sid;
  const c = sid ? FIXTURE_CARDS.get(sid) : undefined;
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}

/** Let the scene and the HUD process input (two animation frames). */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Wait until no card on the table animates and every visible card has a texture. */
async function sceneIdle(page: Page): Promise<void> {
  await expect
    .poll(async () => (await shown(page)).every((c) => !c.moving && (!c.visible || c.tier !== null)), { timeout: 15_000 })
    .toBe(true);
}

/** Wait until the camera has stopped moving (two equal samples a few frames apart). */
async function cameraIdle(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        await frames(page);
        const now = JSON.stringify(await hook(page, 'camera'));
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Zoom to a card with Z on hover (DESIGN "Camera and navigation"), take a screenshot, and fit the table again (0). */
async function zoomedEvidence(page: Page, id: string, name: string, project: string): Promise<void> {
  await hoverTable(page, id);
  await page.keyboard.press('KeyZ');
  await cameraIdle(page);
  await page.mouse.move(8, 450);
  await evidence(page, name, project);
  await page.keyboard.press('Digit0');
  await cameraIdle(page);
}

/** Wait until the hand fan shows `ids`, in that order. */
async function handShows(page: Page, ids: string[]): Promise<void> {
  await expect.poll(() => page.getByTestId('hand-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual(ids);
}

/** Point the mouse at a card on the table (centre of its screen rectangle) so bare keys act on it. */
async function hoverTable(page: Page, id: string): Promise<void> {
  await sceneIdle(page);
  const c = (await shown(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  expect(c.visible).toBe(true);
  await page.mouse.move(c.screen.x + c.screen.width / 2, c.screen.y + c.screen.height / 2, { steps: 4 });
  await frames(page);
}

/** Point the mouse at a card in the hand fan (low on the card, where no neighbour overlaps it). */
async function hoverHand(page: Page, id: string): Promise<void> {
  const el = page.locator(`[data-testid="hand-card"][data-card="${id}"]`);
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12, { steps: 4 });
  await expect(el).toHaveClass(/hovered/);
}

async function evidence(page: Page, name: string, project: string): Promise<void> {
  await sceneIdle(page);
  await frames(page);
  await shot(page, 'M0', name, project);
}

test.describe('M0 gate @gate', () => {
  test('goldfish the fixture deck through the HUD and scene, then reload to the same state hash', async ({ page }, info) => {
    test.setTimeout(240_000);
    const project = info.project.name;
    const errors: string[] = [];
    const outside: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (!/^(data|blob):/.test(r.url()) && !new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(r.url());
    });

    // --- Empty table -------------------------------------------------------------------------------------------
    const profile = freshProfile(info);
    await openSolo(page, profile);
    await expect(page.getByTestId('hud')).toBeVisible();
    expect(Object.keys((await state(page)).cards)).toHaveLength(0);
    await evidence(page, 'empty-table', project);

    // --- Paste the decklist into the import dialog -----------------------------------------------------------------
    await page.getByTestId('open-deck-import').click();
    await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
    await page.getByTestId('deck-check').click();
    await expect(page.getByTestId('deck-summary')).toContainText('60 cards in the deck, 3 in the sideboard');
    await expect(page.getByTestId('deck-error')).toHaveCount(0);
    await page.getByTestId('deck-import-go').click();
    await expect(page.getByTestId('deck-import')).toHaveCount(0);
    let st = await state(page);
    expect(st.zones[`library:${ME}`]!.ids).toHaveLength(60);
    expect(Object.values(st.cards).every((c) => c.zone === `library:${ME}` && c.identity === undefined)).toBe(true);
    const unshuffled = (await secrets(page)).libraryOrder;
    expect(unshuffled).toHaveLength(60);

    // --- Shuffle (S) ------------------------------------------------------------------------------------------------
    await page.mouse.move(720, 300);
    await page.keyboard.press('KeyS');
    await expect.poll(async () => (await secrets(page)).libraryOrder).not.toEqual(unshuffled);
    expect([...(await secrets(page)).libraryOrder].sort()).toEqual([...unshuffled].sort());

    // --- Draw seven (Shift+D, type 7, Enter) ---------------------------------------------------------------------
    await page.keyboard.press('Shift+KeyD');
    await expect(page.getByTestId('draw-n-input')).toBeFocused();
    await page.getByTestId('draw-n-input').fill('7');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await secrets(page)).hand).toHaveLength(7);
    const firstSeven = (await secrets(page)).hand;
    await handShows(page, firstSeven);

    // --- Mulligan once (Ctrl+M: shuffle the hand in, draw seven), then bottom one card by hand (Shift+L) ---------
    await page.mouse.move(720, 300);
    await page.keyboard.press('Control+KeyM');
    await expect.poll(async () => (await secrets(page)).hand).not.toEqual(firstSeven);
    let hand = (await secrets(page)).hand;
    expect(hand).toHaveLength(7);
    expect((await state(page)).zones[`library:${ME}`]!.ids).toHaveLength(53);
    await handShows(page, hand);
    await page.mouse.move(720, 300);
    await evidence(page, 'opening-hand', project);

    const bottomed = hand[hand.length - 1]!;
    await hoverHand(page, bottomed);
    await page.keyboard.press('Shift+KeyL');
    await expect.poll(async () => (await secrets(page)).libraryOrder.at(-1)).toBe(bottomed);
    hand = (await secrets(page)).hand;
    expect(hand).toHaveLength(6);
    expect(hand).not.toContain(bottomed);

    // --- Fetch a Leonin Warleader (library viewer, Search, hover, H), so the cast creature has a related token ------
    await page.mouse.move(720, 300);
    await page.locator(`[data-testid="avatar"][data-seat="${ME}"] [data-testid="zone-button"][data-zone="library:${ME}"]`).click();
    await expect(page.getByTestId('pile-viewer')).toBeVisible();
    await page.getByTestId('search-library').click();
    await expect(page.getByTestId('pile-card')).toHaveCount(54);
    const sec = await secrets(page);
    const warleader = sec.libraryOrder.find((id) => FIXTURE_CARDS.get(sec.identities[id]!.card.sid)?.name === 'Leonin Warleader')!;
    expect(warleader).toBeTruthy();
    const pileCard = page.locator(`[data-testid="pile-card"][data-card="${warleader}"]`);
    // A hovered fan card is raised over its neighbours: start from empty table so no other card is raised, then
    // point at the target's left strip, which no unraised neighbour covers.
    await page.mouse.move(720, 120);
    await expect(page.locator('[data-testid="pile-card"].hovered')).toHaveCount(0);
    await pileCard.hover({ position: { x: 4, y: 30 }, timeout: 15_000 });
    await expect(pileCard).toHaveClass(/hovered/);
    await page.keyboard.press('KeyH');
    await expect.poll(async () => (await secrets(page)).hand).toContain(warleader);
    const orderBeforeClose = (await secrets(page)).libraryOrder;
    await page.getByRole('button', { name: /^Close .*Library/ }).click();
    await expect(page.getByTestId('pile-viewer')).toHaveCount(0);
    // Closing a search shuffles by default (DESIGN "Card manipulation", Library actions).
    await expect.poll(async () => (await secrets(page)).libraryOrder).not.toEqual(orderBeforeClose);

    // --- Mill three (library viewer, Mill N), so the graveyard has a pile to fan ----------------------------------
    await page.locator(`[data-testid="avatar"][data-seat="${ME}"] [data-testid="zone-button"][data-zone="library:${ME}"]`).click();
    await page.getByTestId('library-n').fill('3');
    await page.getByTestId('mill').click();
    await expect.poll(async () => (await state(page)).zones[`graveyard:${ME}`]?.ids.length).toBe(3);
    await page.getByRole('button', { name: /^Close .*Library/ }).click();

    // A land in hand: draw (D) until one comes, as a goldfishing player would.
    const isLand = async (id: string) => (await identify(page, id)).type_line.includes('Land');
    for (let i = 0; i < 20; i++) {
      hand = (await secrets(page)).hand;
      const lands = await Promise.all(hand.map(isLand));
      if (lands.some(Boolean)) break;
      await page.mouse.move(720, 300);
      await page.keyboard.press('KeyD');
      await expect.poll(async () => (await secrets(page)).hand.length).toBe(hand.length + 1);
    }
    hand = (await secrets(page)).hand;
    await handShows(page, hand);
    const land = (await Promise.all(hand.map(async (id) => ((await isLand(id)) ? id : null)))).find((x) => x)!;
    expect(land).toBeTruthy();

    // --- Play a land: drag it from the hand fan onto the own battlefield ---------------------------------------------
    const vp = page.viewportSize()!;
    const landEl = page.locator(`[data-testid="hand-card"][data-card="${land}"]`);
    await hoverHand(page, land);
    const lb = (await landEl.boundingBox())!;
    const grab = { x: lb.x + lb.width / 2, y: lb.y + lb.height - 12 };
    await page.mouse.down();
    await page.mouse.move(grab.x, vp.height * 0.7, { steps: 6 });
    await page.mouse.move(vp.width * 0.4, vp.height * 0.6, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(BF);
    st = await state(page);
    expect(st.cards[land]).toMatchObject({ face: 'up', tapped: false });
    expect(st.cards[land]!.identity).toEqual((await secrets(page)).identities[land]!.card);
    expect((await secrets(page)).hand).not.toContain(land);

    // --- Tap it (T on the hovered land) -------------------------------------------------------------------------------
    await hoverTable(page, land);
    await page.keyboard.press('KeyT');
    await expect.poll(async () => (await state(page)).cards[land]?.tapped).toBe(true);
    await sceneIdle(page);
    expect((await shown(page)).find((c) => c.id === land)!.tapped).toBe(true);

    // --- Cast a creature (C on the hovered hand card) and resolve it (R) to the battlefield ---------------------------
    await hoverHand(page, warleader);
    await page.keyboard.press('KeyC');
    await expect.poll(async () => (await state(page)).stack.map((i) => i.card)).toEqual([warleader]);
    st = await state(page);
    expect(st.cards[warleader]!.zone).toBe('stack');
    expect(st.cards[warleader]!.identity?.sid).toBe((await secrets(page)).identities[warleader]!.card.sid);
    await expect(page.getByTestId('stack-chip')).toBeVisible();
    await page.mouse.move(720, 300);
    await frames(page);
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await state(page)).cards[warleader]?.zone).toBe(BF);
    expect((await state(page)).stack).toEqual([]);

    // --- Two +1/+1 counters (+ twice on the hovered creature) -----------------------------------------------------
    await hoverTable(page, warleader);
    await page.keyboard.press('Shift+Equal');
    await page.keyboard.press('Shift+Equal');
    await expect.poll(async () => (await state(page)).cards[warleader]?.counters).toEqual({ '+1/+1': 2 });

    // --- Create the related token (Ctrl+T on the hovered Warleader: its Cat is listed first) -----------------------
    await hoverTable(page, warleader);
    await page.keyboard.press('Control+KeyT');
    await expect(page.getByTestId('token-search')).toBeVisible();
    const related = page.locator('[data-testid="token-result"][data-related="true"]');
    await expect(related).toHaveCount(1);
    await expect(related).toContainText('Cat');
    const before = new Set(Object.keys((await state(page)).cards));
    await related.click();
    await expect(page.getByTestId('token-search')).toHaveCount(0);
    await expect.poll(async () => Object.keys((await state(page)).cards).filter((id) => !before.has(id))).toHaveLength(1);
    st = await state(page);
    const cat = Object.keys(st.cards).find((id) => !before.has(id))!;
    expect(st.cards[cat]).toMatchObject({ zone: BF, face: 'up', tapped: false, identity: { sid: 'b31f1580-5bba-4cef-b0c8-f2837a597b7d' } });

    // --- Attack (A on the hovered creature) and settle (B) -------------------------------------------------------------
    const homePose = (await state(page)).cards[warleader]!.pose;
    await hoverTable(page, warleader);
    await page.keyboard.press('KeyA');
    await expect.poll(async () => (await state(page)).cards[warleader]?.combat).toBe('attack');
    st = await state(page);
    expect(st.cards[warleader]).toMatchObject({ tapped: true, home: homePose });
    expect(st.cards[warleader]!.pose).not.toEqual(homePose);
    await page.mouse.move(720, 120);
    await evidence(page, 'attack', project);
    await zoomedEvidence(page, warleader, 'attack-zoomed', project);
    await page.keyboard.press('KeyB');
    await expect.poll(async () => (await state(page)).cards[warleader]?.home).toBeUndefined();
    st = await state(page);
    expect(st.cards[warleader]).toMatchObject({ pose: homePose, tapped: true });
    expect(st.cards[warleader]!.combat).toBeUndefined();
    await page.mouse.move(720, 120);
    await evidence(page, 'mid-game-board', project);
    await zoomedEvidence(page, warleader, 'mid-game-board-zoomed', project);

    // --- Move a card to the graveyard (G), then on to exile (E); undo the last move (Ctrl+Z) -------------------------
    await hoverTable(page, land);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`graveyard:${ME}`);
    st = await state(page);
    expect(st.zones[`graveyard:${ME}`]!.ids.at(-1)).toBe(land);
    expect(st.cards[land]!.tapped).toBe(false);
    const inGraveyard = await state(page);
    // The graveyard's top card is the land; hover the pile and exile it.
    await hoverTable(page, land);
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`exile:${ME}`);
    await page.keyboard.press('Control+KeyZ');
    await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`graveyard:${ME}`);
    expect(sansSeq(await state(page))).toEqual(sansSeq(inGraveyard));

    // --- Pile fan: the graveyard opens as an ordered fan (avatar zone button) ---------------------------------------
    await page.locator(`[data-testid="avatar"][data-seat="${ME}"] [data-testid="zone-button"][data-zone="graveyard:${ME}"]`).click();
    await expect(page.getByTestId('pile-viewer')).toHaveAttribute('data-kind', 'graveyard');
    await expect(page.getByTestId('pile-card')).toHaveCount(4);
    expect(await page.getByTestId('pile-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))).toEqual((await state(page)).zones[`graveyard:${ME}`]!.ids);
    await page.mouse.move(720, 120);
    await evidence(page, 'pile-fan', project);
    await page.getByRole('button', { name: /^Close .*Graveyard/ }).click();
    await expect(page.getByTestId('pile-viewer')).toHaveCount(0);

    // --- Inspect (hold Space over the creature) ---------------------------------------------------------------------
    await hoverTable(page, warleader);
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect')).toBeVisible();
    await expect(page.getByTestId('inspect-text')).toContainText('Leonin Warleader');
    await shot(page, 'M0', 'inspect', project);
    await page.keyboard.up('Space');
    await expect(page.getByTestId('inspect')).toHaveCount(0);

    // --- Cheat sheet (?) -----------------------------------------------------------------------------------------------
    await page.mouse.move(720, 120);
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('cheat-sheet')).toBeVisible();
    await expect(page.getByTestId('cheat-row').first()).toBeVisible();
    await shot(page, 'M0', 'cheat-sheet', project);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cheat-sheet')).toHaveCount(0);

    // --- Reload: the same state hash ------------------------------------------------------------------------------------
    await call(page, 'saved');
    const hash = await call<string>(page, 'hash');
    const finalState = await state(page);
    const finalSecrets = await secrets(page);
    const onTable = (s: TableState) => Object.values(s.cards).filter((c: CardInstance) => c.zone === BF).map((c) => c.id).sort();
    expect(onTable(finalState)).toEqual([cat, warleader].sort());
    await page.reload();
    await waitForSession(page);
    expect(await call<string>(page, 'hash')).toBe(hash);
    expect(await state(page)).toEqual(finalState);
    expect(await secrets(page)).toEqual(finalSecrets);
    await handShows(page, finalSecrets.hand);

    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
  });
});
