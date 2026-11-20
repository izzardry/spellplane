/**
 * PLAN Milestone 8, M8-P1 (Ztyle kit), on the kit page `?harness=kit` in the four looks: the bundled face, press and
 * focus, the segmented control's keys, coarse-pointer hit areas, the undo toast's timing (page.clock, never slept),
 * the booster art, whole card faces (63:88, not clipped, full opacity in a tile that may not be picked), the seal band
 * below the cover card, and the design audit. Screenshots go to artifacts/shots/M8/kit-<look>.png.
 */
import { devices, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { designAudit, designAuditFindings, settleAnimations } from '../helpers/design-audit';

const LOOKS = ['plain', 'kitchen', 'graphite', 'codex'] as const;

async function openKit(page: Page, look: string): Promise<void> {
  await page.goto(`./?faces=placeholder&harness=kit&look=${look}`);
  await expect(page.getByTestId('kit-page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__kitHarness?.fontsReady() ?? false)).toBe(true);
  await settleAnimations(page);
}

for (const look of LOOKS) {
  test.describe(`kit in ${look}`, () => {
    test('the bundled face loads with the network blocked', async ({ page }) => {
      // Everything that is not this page's own origin is refused.
      const local = (u: string): boolean => !/^https?:/.test(u) || ['localhost', '127.0.0.1'].includes(new URL(u).hostname);
      await page.route('**/*', (route) => (local(route.request().url()) ? route.continue() : route.abort()));
      const external: string[] = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url());
      });
      await openKit(page, look);
      expect(await page.evaluate(() => document.fonts.check('14px "Fira Code"'))).toBe(true);
      expect(await page.evaluate(async () => (await document.fonts.load('500 14px "Fira Code"')).length)).toBeGreaterThan(0);
      expect(external).toEqual([]);
    });

    test('a pressed button sinks: its transform and shadow differ from rest; a toggle that is on stays sunk', async ({ page }) => {
      await openKit(page, look);
      const btn = page.getByTestId('btn-secondary');
      await page.mouse.move(0, 0);
      const style = () => btn.evaluate((el) => ({ t: getComputedStyle(el).transform, s: getComputedStyle(el).boxShadow }));
      await expect.poll(async () => (await style()).t).toBe('none');
      const rest = await style();
      const box = (await btn.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect.poll(async () => (await style()).s).not.toBe(rest.s);
      // The transform animates (150 ms); it ends sunk: translateY(1px) scale(.98).
      await expect.poll(async () => (await style()).t).toMatch(/^matrix\(0\.98, 0, 0, 0\.98, 0, 1\)$/);
      await page.mouse.up();
      const pressed = await page.getByTestId('btn-pressed').evaluate((el) => ({ t: getComputedStyle(el).transform, s: getComputedStyle(el).boxShadow, p: el.getAttribute('aria-pressed') }));
      expect(pressed.p).toBe('true');
      expect(pressed.s).not.toBe(rest.s);
      expect(pressed.t).not.toBe('none');
      // Only transform is animated (visual.md 2.11): a shadow switches in one step.
      const props = await btn.evaluate((el) => getComputedStyle(el).transitionProperty);
      expect(props.split(',').map((p) => p.trim())).toEqual(['transform']);
    });

    test('arrow keys move a segmented control and skip a disabled option', async ({ page }) => {
      await openKit(page, look);
      const seg = page.getByTestId('seg-format');
      const checked = () => seg.locator('[aria-checked="true"]').getAttribute('data-value');
      expect(await checked()).toBe('ffa4');
      await seg.locator('[data-value="ffa4"]').focus();
      await page.keyboard.press('ArrowLeft');
      expect(await checked()).toBe('ffa3');
      await page.keyboard.press('ArrowRight');
      expect(await checked()).toBe('ffa4');
      await page.keyboard.press('ArrowRight');
      expect(await checked()).toBe('v1');
      await expect(seg.locator('[data-value="v1"]')).toBeFocused();
      await page.keyboard.press('End');
      expect(await checked()).toBe('ffa4');
      // One tab stop; the thumb sits under the selected segment.
      expect(await seg.locator('[tabindex="0"]').count()).toBe(1);
      const [thumb, opt] = await Promise.all([seg.locator('.ds-seg__thumb').boundingBox(), seg.locator('[data-value="ffa4"]').boundingBox()]);
      await expect.poll(async () => Math.abs(((await seg.locator('.ds-seg__thumb').boundingBox())?.x ?? 0) - (opt?.x ?? 0))).toBeLessThan(1);
      expect(thumb).not.toBeNull();
      expect(await page.evaluate(() => window.__kitHarness!.events())).toEqual(['segment:ffa3', 'segment:ffa4', 'segment:v1', 'segment:ffa4']);
    });

    test('mode cards are a radio group: arrow keys select the next card', async ({ page }) => {
      await openKit(page, look);
      const group = page.getByTestId('modes');
      await expect(group).toHaveAttribute('role', 'radiogroup');
      await group.locator('[data-value="quick"]').focus();
      await page.keyboard.press('ArrowRight');
      await expect(group.locator('[aria-checked="true"]')).toHaveAttribute('data-value', 'private');
      await expect(group.locator('[data-value="private"]')).toBeFocused();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await expect(group.locator('[aria-checked="true"]')).toHaveAttribute('data-value', 'draft');
    });

    test('every control shows a visible focus ring', async ({ page }) => {
      await openKit(page, look);
      await page.keyboard.press('Tab');
      const report = await page.evaluate(() => {
        const out: string[] = [];
        const controls = [...document.querySelectorAll<HTMLElement>('[data-testid="kit-page"] button:not(:disabled), [data-testid="kit-page"] a[href], [data-testid="kit-page"] input')].filter((el) => el.offsetParent !== null);
        for (const el of controls) {
          el.focus();
          if (document.activeElement !== el) continue;
          const ring = el.matches('input') ? (el.closest('.ds-field') as HTMLElement) : el;
          const cs = getComputedStyle(ring);
          const ok = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
          if (!ok) out.push(`${el.tagName} ${el.className} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 20)}" outline ${cs.outlineStyle} ${cs.outlineWidth}`);
        }
        return { checked: controls.length, out };
      });
      expect(report.checked).toBeGreaterThan(30);
      expect(report.out).toEqual([]);
    });

    test('the undo toast lives 5 s; a second one restarts the timer and offers UNDO ALL', async ({ page }) => {
      await page.clock.install();
      await openKit(page, look);
      const host = page.getByTestId('toast-host');
      await test.step('one toast, five seconds', async () => {
        await page.evaluate(() => window.__kitHarness!.undo('Deck A removed'));
        await expect(host.locator('.ds-toast')).toHaveCount(1);
        await expect(host.getByRole('button', { name: 'Undo all' })).toHaveCount(0);
        await page.clock.runFor(4_900);
        await expect(host.locator('.ds-toast')).toHaveCount(1);
        await page.clock.runFor(200);
        await expect(host.locator('.ds-toast')).toHaveCount(0);
        expect(await page.evaluate(() => window.__kitHarness!.events())).toEqual(['commit:Deck A removed']);
      });
      await test.step('two toasts share the timer and UNDO ALL undoes both, newest first', async () => {
        await page.evaluate(() => window.__kitHarness!.undo('B'));
        await page.clock.runFor(4_000);
        await page.evaluate(() => window.__kitHarness!.undo('C'));
        await expect(host.locator('.ds-toast')).toHaveCount(2);
        await page.clock.runFor(4_000);
        await expect(host.locator('.ds-toast')).toHaveCount(2);
        await host.getByRole('button', { name: 'Undo all' }).click();
        await expect(host.locator('.ds-toast')).toHaveCount(0);
        expect((await page.evaluate(() => window.__kitHarness!.events())).slice(1)).toEqual(['undo:C', 'undo:B']);
      });
      await test.step('a request stays until answered; one status slot', async () => {
        await page.evaluate(() => window.__kitHarness!.request('Ben asks to undo'));
        await page.evaluate(() => window.__kitHarness!.status('Ben is away'));
        await page.evaluate(() => window.__kitHarness!.status('Ben is back'));
        await page.clock.runFor(60_000);
        await expect(host.locator('.ds-toast--request')).toHaveCount(1);
        await expect(host.locator('.ds-toast--status')).toHaveText(/Ben is back/);
        await host.getByRole('button', { name: 'Allow' }).click();
        await expect(host.locator('.ds-toast--request')).toHaveCount(0);
        expect((await page.evaluate(() => window.__kitHarness!.events())).at(-1)).toBe('allow:Ben asks to undo');
      });
    });

    test('menu, dialog and coach mark: Escape closes and focus returns; the scrim is flat', async ({ page }) => {
      await openKit(page, look);
      const opener = page.getByTestId('open-menu');
      await opener.click();
      const menu = page.getByTestId('kit-menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.getByTestId('open-dialog').click();
      const dialog = page.getByTestId('kit-dialog');
      await expect(dialog).toBeVisible();
      const scrim = await page.locator('.ds-scrim').evaluate((el) => ({ f: getComputedStyle(el).filter, b: getComputedStyle(el).getPropertyValue('backdrop-filter') || 'none' }));
      expect(scrim).toEqual({ f: 'none', b: 'none' });
      await designAudit(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page.getByTestId('open-coach').click();
      await expect(page.getByTestId('coach')).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(page.getByTestId('coach')).toHaveCount(0);
      expect((await page.evaluate(() => window.__kitHarness!.events())).at(-1)).toBe('coach:dismiss');
    });

    test('boosters are our own drawing: stable art per set code, no image and no external reference', async ({ page }) => {
      await openKit(page, look);
      const art = await page.evaluate(() => [window.__kitHarness!.packArt('COR', 0), window.__kitHarness!.packArt('COR', 0), window.__kitHarness!.packArt('ALP', 0)]);
      expect(art[0]).toEqual(art[1]);
      expect(art[0]).not.toEqual(art[2]);
      const svgs = page.locator('svg.ds-booster');
      expect(await svgs.count()).toBeGreaterThanOrEqual(7);
      for (const html of await svgs.evaluateAll((els) => els.map((e) => e.outerHTML))) {
        expect(html).not.toMatch(/<image|<use|<foreignObject/i);
        expect(html).not.toMatch(/(?:href|src)="(?!#)/i);
        expect(html).not.toMatch(/url\((?!["']?#)/i);
        expect(html).not.toMatch(/\sfilter=/i);
      }
      const cor = await page.getByTestId('booster-COR').getAttribute('data-hash');
      const alp = await page.getByTestId('booster-ALP').getAttribute('data-hash');
      expect(cor).not.toBe(alp);
      await expect(page.getByTestId('booster-COR')).toContainText('COR');
    });

    test('card faces are whole: 63:88, not clipped, and at full opacity in a tile that may not be picked', async ({ page }) => {
      await openKit(page, look);
      const faces = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll<HTMLImageElement>('.ds-tile img, .ds-fan img')];
        return imgs.map((img) => {
          const r = img.getBoundingClientRect();
          let clipped: string | false = false;
          let dim = false;
          for (let a: Element | null = img; a; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (a !== img && /(hidden|clip|scroll|auto)/.test(cs.overflow)) {
              const ar = a.getBoundingClientRect();
              if (r.left < ar.left - 0.5 || r.top < ar.top - 0.5 || r.right > ar.right + 0.5 || r.bottom > ar.bottom + 0.5) clipped = `${a.tagName}.${a.className} ${cs.overflow} ${JSON.stringify([r.left, r.top, r.right, r.bottom, ar.left, ar.top, ar.right, ar.bottom].map(Math.round))}`;
            }
            if (parseFloat(cs.opacity) < 1 || (cs.filter && cs.filter !== 'none') || (cs.mixBlendMode && cs.mixBlendMode !== 'normal')) dim = true;
          }
          return { id: img.closest('[data-testid]')?.getAttribute('data-testid'), ratio: img.offsetWidth / img.offsetHeight, fit: getComputedStyle(img).objectFit, clipped, dim };
        });
      });
      expect(faces.length).toBeGreaterThanOrEqual(7);
      for (const f of faces) {
        expect(Math.abs(f.ratio / (63 / 88) - 1), `${f.id} ratio`).toBeLessThan(0.01);
        expect(f.fit).toBe('contain');
        expect(f.clipped, `${f.id} clipped`).toBe(false);
        expect(f.dim, `${f.id} dimmed`).toBe(false);
      }
      // The locked tile dims its text and well and names the reason.
      const locked = page.getByTestId('tile-locked');
      await expect(locked.locator('.ds-tile__reason')).toContainText('Booster decks only');
      expect(await locked.locator('.ds-tile__info').evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
      expect(await locked.locator('.ds-tile__stage').evaluate((el) => parseFloat(getComputedStyle(el, '::before').opacity))).toBeLessThan(1);
      expect(faces.find((f) => f.id === 'locked-face')).toBeTruthy();
    });

    test('the seal band sits below the cover card and never crosses it', async ({ page }) => {
      await openKit(page, look);
      const [seal, face] = await Promise.all([page.getByTestId('seal').boundingBox(), page.getByTestId('sealed-face').boundingBox()]);
      expect(seal && face).toBeTruthy();
      const overlap = !(seal!.x + seal!.width <= face!.x || face!.x + face!.width <= seal!.x || seal!.y + seal!.height <= face!.y || face!.y + face!.height <= seal!.y);
      expect(overlap).toBe(false);
      expect(seal!.y).toBeGreaterThanOrEqual(face!.y + face!.height);
    });

    test('the countdown steps when its parent steps it, and the curve chart has a table of its numbers', async ({ page }) => {
      await openKit(page, look);
      const c = page.getByTestId('countdown');
      await expect(c).toHaveAttribute('data-seconds', '17');
      await page.getByTestId('tick').click();
      await expect(c).toHaveAttribute('data-seconds', '16');
      const rows = await page.getByTestId('curve').locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent?.trim())));
      expect(rows[1]).toEqual(['1', '4', '2', '5']);
      expect(rows[7]).toEqual(['7+', '0', '0', '0']);
      // Creature bars are ink, other bars halftone, one target outline per column with a target.
      const parts = await page.getByTestId('curve').evaluate((el) => ({ cr: el.querySelectorAll('[data-part="creatures"]').length, sp: el.querySelectorAll('[data-part="others"]').length, tg: el.querySelectorAll('[data-part="target"]').length }));
      expect(parts).toEqual({ cr: 5, sp: 5, tg: 6 });
    });

    test('the design audit passes; screenshot', async ({ page }, info) => {
      await openKit(page, look);
      const res = await designAudit(page);
      expect(res.controls).toBeGreaterThan(30);
      const dir = path.join('artifacts', 'shots', 'M8');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, info.project.name === 'chromium' ? `kit-${look}.png` : `kit-${look}-${info.project.name}.png`), fullPage: true });
    });
  });
}

test.describe('coarse pointer', () => {
  const { defaultBrowserType: _ignored, ...ipad } = devices['iPad (gen 7)'];
  test.use({ ...ipad });

  test('xs and sm controls keep their look and get a 44 px hit area', async ({ page }) => {
    await openKit(page, 'plain');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const probe = await page.evaluate(() => {
      const out: { what: string; h: number; above: boolean; below: boolean }[] = [];
      for (const sel of ['[data-testid="row-xs"] .ds-btn--xs', '[data-testid="row-xs"] .ds-btn--icon', '[data-testid="row-sm"] .ds-btn--sm']) {
        const el = document.querySelector<HTMLElement>(sel)!;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const reach = (44 - r.height) / 2 - 1;
        const x = r.left + r.width / 2;
        const hit = (y: number) => {
          const t = document.elementFromPoint(x, y);
          return t === el || el.contains(t);
        };
        out.push({ what: sel, h: r.height, above: hit(r.top - reach), below: hit(r.bottom + reach) });
      }
      return out;
    });
    for (const p of probe) {
      expect([28, 36], p.what).toContain(Math.round(p.h));
      expect(p.above && p.below, p.what).toBe(true);
    }
  });
});

test('the audit finds a mixed row, a second primary and a blur', async ({ page }) => {
  await openKit(page, 'plain');
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="row-md"]')!;
    const extra = document.querySelector('[data-testid="row-xs"] .ds-btn')!.cloneNode(true);
    row.appendChild(extra);
    const p = document.querySelector('[data-testid="btn-primary"]')!.cloneNode(true) as HTMLElement;
    p.removeAttribute('data-testid');
    document.querySelector('[data-testid="row-md-2"]')!.appendChild(p);
    const odd = document.createElement('button');
    odd.className = 'ds-btn';
    odd.style.height = '40px';
    odd.textContent = 'Odd';
    document.querySelector('[data-testid="kit-page"]')!.appendChild(odd);
    (document.querySelector('.ds-sheet') as HTMLElement).style.setProperty('backdrop-filter', 'blur(4px)');
    (document.querySelector('.ds-sheet') as HTMLElement).style.setProperty('-webkit-backdrop-filter', 'blur(4px)');
  });
  const res = await designAuditFindings(page);
  const text = res.problems.join('\n');
  expect(text).toMatch(/row with heights/);
  expect(text).toMatch(/2 primary buttons in the sheet layer/);
  expect(text).toMatch(/height 40\.0 px/);
  expect(text).toMatch(/backdrop-filter/);
});

test('the look picker lists Plain, Kitchen Table, Graphite and Codex, Plain first and chosen', async ({ page }) => {
  await page.goto('./?faces=placeholder&harness=settings&fresh=1');
  await expect(page.getByTestId('settings-harness')).toBeVisible();
  const picker = page.getByTestId('theme-picker');
  await expect(picker).toBeVisible();
  const options = picker.locator('[data-testid="theme-option"]');
  const ids = await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-theme')));
  // A fresh profile is on Plain, so the picker offers exactly the four looks (an M4 theme set otherwise is shown too).
  expect(ids).toEqual(['plain', 'kitchen', 'graphite', 'codex']);
  await expect(options.nth(0).locator('input')).toBeChecked();
  await expect(options.nth(0)).toContainText('Plain');
  await expect(options.nth(1)).toContainText('Kitchen Table');
  await expect(options.nth(2)).toContainText('Graphite');
  await expect(options.nth(3)).toContainText('Codex');
});
