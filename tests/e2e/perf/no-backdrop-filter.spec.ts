/**
 * Nothing over the table blurs (docs/design/m8/m7-adjustments.md rulings: "No blur in CSS anywhere: no
 * `backdrop-filter` and no `filter: blur()` in the shell or over a table"; PLAN M7 A0: CSS blur over the WebGL canvas
 * is a measured cost in Safari; PLAN Milestone 8, M7-P1 Lifecycle). With a table mounted and the HUD's menu-like panels,
 * the log drawer, a dialog and a toast open in turn, no element whose box intersects the scene host computes a
 * `backdrop-filter` (or its WebKit prefix) other than none, or a `filter` with a blur. Each surface is scanned only once
 * it is on screen; a menu, a drawer, a dialog and a toast must each have been scanned (the toast is raised by importing
 * a decklist: the HUD's "Imported N cards"). The scan covers each element's ::before and ::after too.
 */
import { expect, test, type Page } from '@playwright/test';
import { openDeckImport } from '../helpers/hud';
import { decklist, freshProfile, openSolo } from '../solo/helpers';

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
      // The element and its generated boxes (a pseudo-element's box lies within its element's here).
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
        const filter = cs.filter || 'none';
        if ((backdrop !== 'none' && backdrop !== '') || /blur/i.test(filter))
          out.push({ tag: el.tagName.toLowerCase() + (pseudo ?? ''), testid: el.getAttribute('data-testid'), cls: String(el.className), backdrop, filter });
      }
    }
    return out;
  });
}

type Kind = 'menu' | 'drawer' | 'dialog' | 'toast';
type Loc = ReturnType<Page['getByTestId']>;
/** A way to open one surface: what to click (or null: already open), and the surface's own element. */
interface Opener {
  kind: Kind;
  name: string;
  open: (page: Page) => Promise<boolean>;
  panel: (page: Page) => Loc;
}

/** The open log drawer (closed, the Activity cluster keeps data-testid="log" with data-open="false"). */
const OPEN_LOG = '[data-testid="log"][data-open="true"]';

/** Click `loc` if it is on screen; whether it was. */
async function clickIfVisible(loc: Loc): Promise<boolean> {
  if (!(await loc.isVisible().catch(() => false))) return false;
  await loc.click();
  return true;
}

// Candidates per kind: the table HUD before and after its rebuild from the kit (M7-P2) name its controls differently.
// A candidate whose control is on screen must open its surface (asserted visible before the scan).
const OPENERS: Opener[] = [
  {
    kind: 'menu',
    name: 'table context menu',
    open: async (page) => {
      const box = (await page.getByTestId('scene-host').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      return true;
    },
    panel: (page) => page.getByRole('menu').first(),
  },
  { kind: 'menu', name: 'menu button', open: (page) => clickIfVisible(page.getByRole('button', { name: /^menu$/i }).first()), panel: (page) => page.getByRole('menu').first() },
  {
    kind: 'drawer',
    name: 'log drawer',
    // Closed, the Activity cluster carries data-testid="log" too (data-open="false"); only the open drawer counts.
    open: async (page) => (await page.locator(OPEN_LOG).isVisible().catch(() => false)) || clickIfVisible(page.getByTestId('open-log')),
    panel: (page) => page.locator(OPEN_LOG),
  },
  { kind: 'dialog', name: 'settings', open: (page) => clickIfVisible(page.getByTestId('open-settings')), panel: (page) => page.getByTestId('settings').or(page.getByRole('dialog')).first() },
  // The rebuilt HUD (M7-P2) opens its dialogs from the Menu.
  {
    kind: 'dialog',
    name: 'settings from the menu',
    open: async (page) => {
      if (!(await clickIfVisible(page.getByTestId('open-menu')))) return false;
      if (await clickIfVisible(page.getByTestId('menu-popover').getByTestId('open-settings'))) return true;
      // The Menu opened but has no settings item: close it, so no later step finds its items still showing.
      await page.keyboard.press('Escape');
      return false;
    },
    panel: (page) => page.getByTestId('settings').or(page.getByRole('dialog')).first(),
  },
  {
    kind: 'dialog',
    name: 'keys panel',
    open: async (page) => {
      if (await clickIfVisible(page.getByTestId('open-cheat-sheet'))) return true;
      // The rebuilt HUD (M7-P2) keeps the key sheet in the Menu.
      if (!(await clickIfVisible(page.getByTestId('open-menu')))) return false;
      if (await clickIfVisible(page.getByTestId('menu-popover').getByTestId('open-cheat-sheet'))) return true;
      await page.keyboard.press('Escape');
      return false;
    },
    panel: (page) => page.getByTestId('cheat-sheet'),
  },
  { kind: 'dialog', name: 'theme picker', open: (page) => clickIfVisible(page.getByTestId('open-theme-settings')), panel: (page) => page.getByTestId('theme-picker').or(page.locator('.theme-pop')).first() },
  {
    kind: 'toast',
    name: 'toast',
    open: async (page) => {
      // Importing a decklist raises the HUD's toast ("Imported 60 cards and a 3-card sideboard") over the table.
      await openDeckImport(page);
      await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
      await page.getByTestId('deck-check').click();
      await page.getByTestId('deck-import-go').click();
      await expect(page.getByTestId('deck-import')).toHaveCount(0);
      return true;
    },
    // The HUD's own toast or the kit's toast host, whichever shows it.
    panel: (page) => page.getByTestId('toast').or(page.getByTestId('toast-host')).first(),
  },
];

/** The kinds the acceptance names. */
const REQUIRED: Kind[] = ['menu', 'drawer', 'dialog', 'toast'];
/** The rebuilt HUD's (M7-P2) own routes: each must have opened its surface, so a stale selector cannot pass by another opener. */
const REQUIRED_OPENERS = ['menu button', 'log drawer', 'settings from the menu', 'keys panel'];

test('no element over the table computes a backdrop filter or a blur, whatever is open', async ({ page }, info) => {
  test.setTimeout(90_000);
  await openSolo(page, freshProfile(info));
  await expect(page.getByTestId('scene-host')).toBeVisible();
  const opened: string[] = [];
  const kinds = new Set<Kind>();
  await test.step('at rest', async () => {
    expect(await offenders(page)).toEqual([]);
  });
  for (const o of OPENERS)
    await test.step(o.name, async () => {
      if (!(await o.open(page))) return;
      // Scanned only once the surface itself is on screen: a click that opened nothing does not count.
      await expect(o.panel(page), `${o.name} is open`).toBeVisible();
      opened.push(o.name);
      kinds.add(o.kind);
      expect(await offenders(page), `${o.name} open`).toEqual([]);
      await page.keyboard.press('Escape');
    });
  info.annotations.push({ type: 'opened', description: opened.join(', ') });
  expect([...kinds].filter((k) => REQUIRED.includes(k)).sort()).toEqual([...REQUIRED].sort());
  expect(REQUIRED_OPENERS.filter((n) => !opened.includes(n)), 'HUD routes that opened nothing').toEqual([]);
});
