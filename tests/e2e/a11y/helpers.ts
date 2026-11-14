/**
 * Browser-test helpers of the accessibility pass (PLAN M5-P4): axe runs and the ways to reach the lobby, the table HUD
 * and the builder's list view on the test build. Card data comes from tests/fixtures (injected), faces are placeholders,
 * and pages talk over BroadcastChannel (`?transport=local`), so nothing touches the network.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { hook } from '../helpers/app';
import { freshProfile, freshRoom, open, setNickname } from '../lobby/helpers';
import { setsScript } from '../flow/helpers';
import { call, decklist, freshProfile as soloProfile, openSolo } from '../solo/helpers';

/** One axe finding, reduced to what a failing assertion should print. */
export interface AxeFinding {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: string[];
}

/**
 * The serious and critical axe violations on the page (PLAN M5-P4 acceptance: "axe reports no serious or critical
 * violations"): axe's default rule set (WCAG 2.0, 2.1 and 2.2 A and AA rules and best practices that axe enables by
 * default). The WebGL canvas is part of the page; axe has nothing to check inside it.
 */
export async function seriousViolations(page: Page, include?: string): Promise<AxeFinding[]> {
  let builder = new AxeBuilder({ page });
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 12).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join(' ').trim() ?? ''}`) }));
}

/** The solo table HUD with the 60-card fixture deck imported and shuffled and a hand of seven. */
export async function soloTable(page: Page, info: TestInfo): Promise<void> {
  await openSolo(page, soloProfile(info));
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 15_000 });
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  await expect(page.getByTestId('hand-card')).toHaveCount(7);
}

/** Wait until the table scene has drawn a frame (the debug hook's `cards()` answers). */
export async function sceneReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.cards === 'function'), { timeout: 15_000 }).toBe(true);
}

/** Two pages of one room in one context (BroadcastChannel), both seated in the lobby with nicknames. */
export async function twoInLobby(browser: Browser, info: TestInfo): Promise<{ context: BrowserContext; a: Page; b: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  const b = await context.newPage();
  const room = freshRoom();
  for (const [p, who, name] of [
    [a, 'a', 'Anna'],
    [b, 'b', 'Ben'],
  ] as const) {
    await p.addInitScript({ content: setsScript() });
    await open(p, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, who), transport: 'local' });
    await expect(p.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
    await setNickname(p, name);
  }
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await expect.poll(() => hook<string>(b, 'session.seat'), { timeout: 15_000 }).toBe('s1');
  return { context, a, b };
}

/** From the lobby, the host opens sealed pools for both; both land in the builder, shown in its list view. */
export async function sealedBuilder(a: Page, b: Page): Promise<void> {
  await a.getByTestId('lobby-mode').selectOption('sealed');
  await expect(a.getByTestId('start-draft')).toBeEnabled({ timeout: 15_000 });
  await a.getByTestId('start-draft').click();
  for (const p of [a, b]) {
    await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'build', { timeout: 30_000 });
    await expect(p.getByTestId('builder')).toBeVisible({ timeout: 30_000 });
  }
  if ((await a.getByTestId('builder').getAttribute('data-view')) !== 'list') await a.getByTestId('view-list').click();
  await expect(a.getByTestId('builder')).toHaveAttribute('data-view', 'list');
  await expect(a.getByTestId('builder-list-host')).toBeVisible();
}
