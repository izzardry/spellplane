/**
 * PLAN M5-P2 in the browser: one two-player game ending in the audit panel (DESIGN "Multiplayer architecture", Hidden
 * information 6: at game end each browser publishes its nonces and order history, peers replay them; PLAN Milestone 5,
 * owner decisions: automatic at game end, a per-player verdict in the log and an audit panel). Two pages on
 * `?transport=local` with their own profiles: both Ready with a fixture deck in the lobby, the host starts, both
 * shuffle (with each other's nonces) and draw, Anna scries a card to the bottom and draws, Anna proposes "Next game"
 * from the evening bar and Ben confirms in the HUD's prompt. Nothing is published before that; afterwards both pages
 * show the audit panel with both players verified, the same verdicts in the debug hook, and the verdict lines in the
 * log. Engine behaviour is read from the debug hook, never from pixels; the screenshot is evidence.
 */
import { expect, test, type Page } from '@playwright/test';
import type { AuditBundle, AuditVerdict } from '../../../src/core/audit';
import type { LogEntry, SecretStore, TableState } from '../../../src/core/types';
import { hook, shot } from '../helpers/app';
import { setsScript } from '../flow/helpers';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname, twoPages } from '../lobby/helpers';

const state = (page: Page) => hook<TableState>(page, 'state');
const verdicts = (page: Page) => hook<AuditVerdict[]>(page, 'audit.verdicts');
const published = (page: Page) => hook<AuditBundle[]>(page, 'audit.published');
const log = (page: Page) => page.evaluate(() => window.__spellplane!.session!.log()) as Promise<LogEntry[]>;

async function ready(page: Page, file: string): Promise<void> {
  await page.evaluate((text) => window.__spellplane!.session!.importDecklist(text), decklist(file));
}

test('a two-player game ends in the audit panel: both players verified on both pages', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  // The recorded booster data, so the builder after the game never asks MTGJSON (tests never use the network).
  for (const p of [a, b]) await p.addInitScript({ content: setsScript() });
  await openTable(a, room, freshProfile(info, 'a'));
  await setNickname(a, 'Anna');
  await openTable(b, room, freshProfile(info, 'b'));
  await setNickname(b, 'Ben');
  await expect(chair(a, 's1')).toContainText('Ben');
  await expect(chair(b, 's0')).toContainText('Anna');

  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.', { timeout: 15_000 });
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 30_000 });

  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  // Anna scries one to the bottom (a private reorder) and draws.
  const [seen] = await a.evaluate(() => window.__spellplane!.session!.lookAt('library:s0', 1));
  await a.evaluate((id) => window.__spellplane!.dispatch!({ type: 'toZone', card: id, to: 'library:s0', position: 'bottom' } as never), seen!.id);
  await expect.poll(async () => (await hook<SecretStore>(a, 'secrets')).libraryOrder.at(-1), { timeout: 15_000 }).toBe(seen!.id);
  await a.evaluate(() => window.__spellplane!.session!.draw(1));
  await expect.poll(async () => (await state(b)).zones['hand:s0']?.ids.length, { timeout: 15_000 }).toBe(8);

  // Nothing is published mid-game, and no panel shows.
  expect(await published(a)).toEqual([]);
  expect(await verdicts(b)).toEqual([]);
  await expect(a.getByTestId('audit-panel')).toHaveCount(0);

  // "Next game": Anna proposes from the evening bar, Ben confirms in the HUD's prompt.
  await a.getByTestId('propose-nextGame').click();
  await expect(b.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
  await b.getByTestId('prompt-ok').click();
  for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'build', { timeout: 30_000 });

  // The audit runs by itself: each page published its own bundle, and both show both players verified.
  for (const p of [a, b]) {
    const panel = p.getByTestId('audit-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toHaveAttribute('data-game', '1');
    await expect(panel.locator('[data-testid="audit-row"][data-seat="s0"]')).toHaveAttribute('data-status', 'verified', { timeout: 30_000 });
    await expect(panel.locator('[data-testid="audit-row"][data-seat="s1"]')).toHaveAttribute('data-status', 'verified', { timeout: 30_000 });
    await expect(panel.locator('[data-testid="audit-row"][data-seat="s0"]')).toContainText('Anna');
    await expect(panel.locator('[data-testid="audit-row"][data-seat="s0"]')).toContainText('1 shuffle and 8 draws checked');
    await expect(panel.locator('[data-testid="audit-row"][data-seat="s1"]')).toContainText('1 shuffle and 7 draws checked');
  }
  const va = await verdicts(a);
  expect(va).toEqual([
    { seat: 's0', game: 1, status: 'verified', shuffles: 1, draws: 8 },
    { seat: 's1', game: 1, status: 'verified', shuffles: 1, draws: 7 },
  ]);
  expect(await verdicts(b)).toEqual(va);
  const [pa, pb] = [await published(a), await published(b)];
  expect(pa.map((x) => [x.seat, x.game.game, x.records.length])).toEqual([['s0', 1, 2]]);
  expect(pb.map((x) => [x.seat, x.game.game, x.records.length])).toEqual([['s1', 1, 1]]);
  for (const p of [a, b]) {
    const lines = (await log(p)).flatMap((e) => (e.kind === 'system' && e.text.startsWith('Audit of game 1') ? [e.text] : []));
    expect(lines.sort()).toEqual(['Audit of game 1: Anna — verified: 1 shuffle and 8 draws checked', 'Audit of game 1: Ben — verified: 1 shuffle and 7 draws checked']);
  }
  await shot(b, 'M5', 'audit-panel', info.project.name);

  // The panel closes and comes back from its button.
  await a.getByTestId('audit-close').click();
  await expect(a.getByTestId('audit-panel')).toHaveCount(0);
  await a.getByTestId('audit-toggle').click();
  await expect(a.getByTestId('audit-panel')).toBeVisible();
  await context.close();
});
