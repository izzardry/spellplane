/**
 * A design audit of M8-P5's screens (PLAN Milestone 8 "designAudit"; visual.md V4; contracts.md Part G "Visual"),
 * kept here until the kit's shared helper (tests/e2e/helpers/design-audit.ts, M8-P1) is on the branch: every visible
 * button, input and segment is 28, 36, 44 or 56 px high (±0.5); at most one filled (primary) button per layer; no CSS
 * blur and no backdrop filter anywhere on the page.
 */
import { expect, type Page } from '@playwright/test';

const HEIGHTS = [28, 36, 44, 56];

export interface AuditFinding {
  what: string;
  detail: string;
}

/** The audit's findings under `scope` (a CSS selector; the whole page by default). */
export async function auditFindings(page: Page, scope = 'body', layer = '[role="dialog"], [data-layer], body'): Promise<AuditFinding[]> {
  return page.evaluate(
    ({ scope, layer, heights }) => {
      const out: { what: string; detail: string }[] = [];
      const root = document.querySelector(scope);
      if (!root) return [{ what: 'scope', detail: `${scope} not found` }];
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
      for (const el of root.querySelectorAll('button, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="radio"], select')) {
        if (!visible(el)) continue;
        const h = el.getBoundingClientRect().height;
        if (!heights.some((x) => Math.abs(x - h) <= 0.5)) out.push({ what: 'height', detail: `${name(el)} is ${h.toFixed(1)} px` });
      }
      const layers = new Map<Element, number>();
      for (const el of root.querySelectorAll('.ds-btn--primary')) {
        if (!visible(el)) continue;
        const l = el.closest(layer) ?? document.body;
        layers.set(l, (layers.get(l) ?? 0) + 1);
      }
      for (const [l, n] of layers) if (n > 1) out.push({ what: 'primary', detail: `${n} filled buttons in ${name(l)}` });
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const backdrop = (cs as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter;
        if (/blur\(/.test(cs.filter) || (backdrop !== undefined && backdrop !== '' && backdrop !== 'none')) out.push({ what: 'blur', detail: name(el) });
      }
      return out;
    },
    { scope, layer, heights: HEIGHTS },
  );
}

/** Assert the audit is clean under `scope`. */
export async function designAudit(page: Page, scope?: string): Promise<void> {
  expect(await auditFindings(page, scope)).toEqual([]);
}
