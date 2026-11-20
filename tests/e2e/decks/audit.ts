/**
 * A design audit for the Deck mode pages (PLAN M8-P1's `designAudit`, which lives on M8-P1's branch; this is the same
 * set of rules for M8-P3's own pages until the shared helper is merged): every visible button, input and segment is
 * 28, 36, 44 or 56 px high (±0.5); at most one filled (primary) button per layer (the page, each dialog or sheet); no
 * `backdrop-filter` and no `blur(` anywhere on the page. Returns the problems found (empty when it passes).
 */
import type { Page } from '@playwright/test';

export async function deckAudit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const heights = [28, 36, 44, 56];
    const visible = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let x: Element | null = e; x; x = x.parentElement) {
        const s = getComputedStyle(x);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const controls = [...document.querySelectorAll('button, [role="button"], select, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), [role="radio"]')].filter(visible);
    for (const c of controls) {
      if (c.closest('.ds-seg') && c.getAttribute('role') === 'radio') continue; // a segment sits in its track; the track is measured
      const box = c.closest('.ds-field') ?? c; // a field's input sits in its well; the well is the control
      const h = box.getBoundingClientRect().height;
      if (!heights.some((x) => Math.abs(h - x) <= 0.5)) problems.push(`${c.tagName.toLowerCase()} "${(c.textContent ?? c.getAttribute('aria-label') ?? '').trim().slice(0, 30)}" is ${h.toFixed(1)} px high`);
    }
    for (const t of [...document.querySelectorAll('.ds-seg')].filter(visible)) {
      const h = t.getBoundingClientRect().height;
      if (!heights.some((x) => Math.abs(h - x) <= 0.5)) problems.push(`segmented "${t.getAttribute('aria-label') ?? ''}" is ${h.toFixed(1)} px high`);
    }
    const layers = new Map<Element, number>();
    for (const b of [...document.querySelectorAll('.ds-btn--primary')].filter(visible)) {
      const layer = b.closest('[data-ds-layer], [role="dialog"], .ds-scrim, [role="menu"], .ds-toast') ?? document.body;
      layers.set(layer, (layers.get(layer) ?? 0) + 1);
    }
    for (const [layer, n] of layers) if (n > 1) problems.push(`${n} primary buttons in one layer (${layer.tagName.toLowerCase()})`);
    for (const e of document.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      const bf = s.getPropertyValue('backdrop-filter') || s.getPropertyValue('-webkit-backdrop-filter');
      if (bf && bf !== 'none') problems.push(`backdrop-filter on ${e.tagName.toLowerCase()}`);
      if (/blur\(/.test(s.filter)) problems.push(`blur on ${e.tagName.toLowerCase()}`);
    }
    return problems;
  });
}
