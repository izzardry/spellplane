/**
 * Nothing over the table blurs (docs/design/m8/m7-adjustments.md rulings: "No blur in CSS anywhere: no
 * `backdrop-filter` and no `filter: blur()` in the shell or over a table"; PLAN M7 A0: CSS blur over the WebGL canvas
 * is a measured cost in Safari; PLAN Milestone 8, M7-P1 Lifecycle). With a table mounted and the HUD's menu-like panels,
 * the log drawer, a dialog and a toast open in turn, no element whose box intersects the scene host computes a
 * `backdrop-filter` (or its WebKit prefix) other than none, or a `filter` with a blur.
 */
import { expect, test, type Page } from '@playwright/test';
import { freshProfile, openSolo } from '../solo/helpers';

interface Offender {
  tag: string;
  testid: string | null;
  cls: string;
  backdrop: string;
  filter: string;
}

/** Every element over the scene host that computes a backdrop filter or a blur. */
function offenders(page: Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="scene-host"]');
    if (!host) throw new Error('no scene host');
    const h = host.getBoundingClientRect();
    const out: Offender[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= h.left || r.left >= h.right || r.bottom <= h.top || r.top >= h.bottom) continue;
      const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      const filter = cs.filter || 'none';
      if ((backdrop !== 'none' && backdrop !== '') || /blur/i.test(filter))
        out.push({ tag: el.tagName.toLowerCase(), testid: el.getAttribute('data-testid'), cls: String(el.className), backdrop, filter });
    }
    return out;
  });
}

test('no element over the table computes a backdrop filter or a blur, whatever is open', async ({ page }, info) => {
  test.setTimeout(90_000);
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('scene-host')).toBeVisible();
  const opened: string[] = [];
  await test.step('at rest', async () => {
    expect(await offenders(page)).toEqual([]);
  });
  // Each opener runs only if its control is on screen (the HUD is being rebuilt from the kit; M7-P2): every panel that
  // opens is scanned, and at least three of them must have opened.
  const openers: [string, () => Promise<boolean>][] = [
    ['menu', async () => clickIfVisible(page, page.getByRole('button', { name: /^menu$/i }).first())],
    ['keys panel', async () => clickIfVisible(page, page.getByTestId('open-cheat-sheet'))],
    ['log drawer', async () => clickIfVisible(page, page.getByRole('button', { name: /^(log|activity)/i }).first())],
    ['settings dialog', async () => clickIfVisible(page, page.getByTestId('open-settings'))],
    ['theme dialog', async () => clickIfVisible(page, page.getByTestId('open-theme-settings'))],
    [
      'toast',
      async () => {
        // The view toggle names the new view in a toast where the HUD has one; the scene host must stay clear either way.
        const ok = await clickIfVisible(page, page.getByTestId('perspective'));
        return ok && (await page.getByTestId('toast').or(page.getByRole('status')).first().isVisible().catch(() => false));
      },
    ],
  ];
  for (const [name, open] of openers)
    await test.step(name, async () => {
      if (!(await open())) return;
      opened.push(name);
      expect(await offenders(page), `${name} open`).toEqual([]);
      await page.keyboard.press('Escape');
    });
  info.annotations.push({ type: 'opened', description: opened.join(', ') });
  expect(opened.length).toBeGreaterThanOrEqual(3);
});

async function clickIfVisible(page: Page, loc: ReturnType<Page['getByTestId']>): Promise<boolean> {
  if (!(await loc.isVisible().catch(() => false))) return false;
  await loc.click();
  return true;
}
