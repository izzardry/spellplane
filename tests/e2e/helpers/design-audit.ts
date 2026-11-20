/**
 * designAudit(page) (PLAN M8-P1 acceptance; contracts.md Part B sizes): every visible button, input and segmented
 * control is 28, 36, 44 or 56 px high (±0.5); at most one primary per layer; nothing computes a backdrop-filter or a
 * blur filter. Stub written by M8-P2 because M8-P1's helper was not on m8 yet; M8-P1's file replaces it.
 */
import { expect, type Page } from '@playwright/test';

export interface AuditProblem {
  what: string;
  where: string;
}

export async function designProblems(page: Page): Promise<AuditProblem[]> {
  return page.evaluate(() => {
    const problems: { what: string; where: string }[] = [];
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const ok = [28, 36, 44, 56];
    const controls = [...document.querySelectorAll('button:not([role="radio"]), a.ds-btn, input:not([type="hidden"]), [role="radiogroup"].ds-seg')];
    for (const el of controls) {
      if (!visible(el)) continue;
      // Inputs are measured by their field; a mode card is a container (72 px), not a control.
      const box = el.tagName === 'INPUT' ? (el.closest('.ds-field') ?? el) : el;
      if (box.classList.contains('ds-mode') || box.closest('.hrow__open') === box) continue;
      const h = box.getBoundingClientRect().height;
      if (!ok.some((k) => Math.abs(k - h) <= 0.5)) problems.push({ what: `height ${h}`, where: name(el) });
    }
    const primaries = [...document.querySelectorAll('.ds-btn--primary')].filter(visible);
    const layers = new Map<Element, number>();
    for (const p of primaries) {
      const layer = p.closest('[role="dialog"], .ds-sheet, [data-testid="first-run-sheet"]') ?? document.body;
      layers.set(layer, (layers.get(layer) ?? 0) + 1);
    }
    for (const [layer, n] of layers) if (n > 1) problems.push({ what: `${n} primaries`, where: name(layer) });
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) problems.push({ what: 'backdrop-filter', where: name(el) });
      if (cs.filter && cs.filter.includes('blur')) problems.push({ what: 'blur filter', where: name(el) });
    }
    return problems;
  });
}

/** Fail the test with the list of problems. */
export async function designAudit(page: Page): Promise<void> {
  expect(await designProblems(page)).toEqual([]);
}
