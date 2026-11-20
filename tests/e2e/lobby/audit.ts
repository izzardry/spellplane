/**
 * The design audit for the lobby specs (M8-P4; PLAN Milestone 8, "Design language": the four heights, one primary per
 * layer, no blur), until M8-P1's shared `designAudit` lands: every visible button, link button, select and text field
 * is 28, 36, 44 or 56 px high (±0.5; a text field is measured by its kit well `.ds-field`); at most one filled primary
 * button per layer (a dialog or a kit sheet is a layer of its own); no element computes a backdrop-filter or a filter.
 */
import type { Page } from '@playwright/test';

export interface AuditFinding {
  rule: 'height' | 'primaries' | 'filter';
  what: string;
}

export async function lobbyAudit(page: Page, root = 'body'): Promise<AuditFinding[]> {
  return page.evaluate((rootSel) => {
    const out: { rule: 'height' | 'primaries' | 'filter'; what: string }[] = [];
    const scope = document.querySelector(rootSel) ?? document.body;
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el: Element): string => `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 24) ?? ''}]`;
    const ok = [28, 36, 44, 56];
    for (const el of Array.from(scope.querySelectorAll('button, a.ds-btn, select, input:not([type=radio]):not([type=checkbox])'))) {
      if (!visible(el)) continue;
      const box = el.closest('.ds-field') ?? el;
      const h = box.getBoundingClientRect().height;
      if (!ok.some((k) => Math.abs(h - k) <= 0.5)) out.push({ rule: 'height', what: `${name(el)} ${h}` });
    }
    const layers = new Map<Element, number>();
    for (const el of Array.from(scope.querySelectorAll('.ds-btn--primary'))) {
      if (!visible(el)) continue;
      const layer = el.closest('[role=dialog], .ds-sheet') ?? scope;
      layers.set(layer, (layers.get(layer) ?? 0) + 1);
    }
    for (const [layer, n] of layers) if (n > 1) out.push({ rule: 'primaries', what: `${name(layer)} has ${n}` });
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if ((bf && bf !== 'none') || (cs.filter && cs.filter !== 'none')) out.push({ rule: 'filter', what: name(el) });
    }
    return out;
  }, root);
}
