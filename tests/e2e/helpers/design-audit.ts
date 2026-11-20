/**
 * The design audit (docs/design/m8/visual.md DS-4; PLAN Milestone 8, M8-P1): every visible button, input and segmented
 * control is 28, 36, 44 or 56 px high (±0.5); the controls of one `.ds-row` share one height; at most one
 * `.ds-btn--primary` per layer (the stage, and each `[data-ds-layer]`: sheet, popover, dialog, toast, coach); no
 * element computes a `backdrop-filter`; nothing over the scene host computes a `filter`; every text uses the look's
 * face or its reading face. Other packages call `await designAudit(page)` in their specs; it throws with every
 * finding listed. Added by M8-P1.
 */
import { expect, type Page } from '@playwright/test';

export interface DesignAuditOptions {
  /** CSS selectors whose subtree the audit skips (legacy panels not yet swept). */
  skip?: string[];
  /** Check fonts (default true). */
  fonts?: boolean;
}

export interface DesignAuditResult {
  /** Number of controls measured. */
  controls: number;
  problems: string[];
}

/** Run the audit in the page and return its findings (no assertion). */
export async function designAuditFindings(page: Page, opts: DesignAuditOptions = {}): Promise<DesignAuditResult> {
  // Let entry animations (a sheet rising, a popover fading in) end first: mid-animation a layer is still transparent.
  await settleAnimations(page);
  return page.evaluate(
    ({ skip, fonts }) => {
      const HEIGHTS = [28, 36, 44, 56];
      const problems: string[] = [];
      const skipped = (el: Element): boolean => skip.some((s) => el.closest(s) !== null);
      const visible = (el: Element): boolean => {
        const h = el as HTMLElement;
        if (typeof h.checkVisibility === 'function' && !h.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const name = (el: Element): string => {
        const h = el as HTMLElement;
        const id = h.dataset['testid'] ? `[data-testid=${h.dataset['testid']}]` : '';
        const text = (h.getAttribute('aria-label') ?? h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
        return `<${el.tagName.toLowerCase()}${id} class="${(h.className && typeof h.className === 'string' ? h.className : '').slice(0, 60)}"> "${text}"`;
      };
      const okHeight = (h: number): boolean => HEIGHTS.some((x) => Math.abs(x - h) <= 0.5);

      // 1. Control heights. Segments are measured by their track; a mode card is a container (visual.md 2.5).
      const controls = [...document.querySelectorAll('button, [role="button"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="range"]), select, .ds-seg, .ds-field')].filter(
        (el) => !skipped(el) && visible(el) && !el.closest('.ds-seg button, .ds-field input, .ds-tabs button') && !el.matches('.ds-seg button, .ds-field input, .ds-mode, .ds-tabs button'),
      );
      for (const el of controls) {
        const h = el.getBoundingClientRect().height;
        // A transformed control (a pressed button scales to .98) is measured by its layout height.
        const layout = (el as HTMLElement).offsetHeight || h;
        if (!okHeight(layout)) problems.push(`height ${layout.toFixed(1)} px: ${name(el)}`);
      }

      // 2. One row, one height.
      for (const row of document.querySelectorAll('.ds-row')) {
        if (skipped(row) || !visible(row)) continue;
        const heights = new Set<number>();
        for (const child of row.children) {
          const c = child.matches('button, [role="button"], input, select, .ds-seg, .ds-field, .ds-chip') ? child : child.querySelector(':scope > button, :scope > .ds-seg, :scope > .ds-field');
          if (!c || !visible(c) || c.matches('.ds-mode')) continue;
          heights.add(Math.round((c as HTMLElement).offsetHeight));
        }
        if (heights.size > 1) problems.push(`row with heights ${[...heights].join(', ')}: ${name(row)}`);
      }

      // 3. One primary per layer.
      const layers = new Map<Element | null, Element[]>();
      for (const el of document.querySelectorAll('.ds-btn--primary')) {
        if (skipped(el) || !visible(el)) continue;
        const layer = el.closest('[data-ds-layer]');
        layers.set(layer, [...(layers.get(layer) ?? []), el]);
      }
      for (const [layer, els] of layers) if (els.length > 1) problems.push(`${els.length} primary buttons in the ${layer ? (layer as HTMLElement).dataset['dsLayer'] : 'stage'} layer: ${els.map(name).join(' · ')}`);

      // 4. No backdrop-filter anywhere; no filter over the scene host.
      const all = [...document.querySelectorAll('*')];
      for (const el of all) {
        const cs = getComputedStyle(el);
        const bf = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter');
        if (bf && bf !== 'none') problems.push(`backdrop-filter ${bf}: ${name(el)}`);
      }
      const host = document.querySelector('[data-testid="scene-host"]');
      if (host) {
        const hr = host.getBoundingClientRect();
        for (const el of all) {
          if (el === host || el.contains(host) || !visible(el)) continue;
          const f = getComputedStyle(el).filter;
          if (!f || f === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.right > hr.left && r.left < hr.right && r.bottom > hr.top && r.top < hr.bottom) problems.push(`filter ${f} over the scene host: ${name(el)}`);
        }
      }

      // 5. Fonts are the look's.
      if (fonts) {
        const root = getComputedStyle(document.documentElement);
        const first = (v: string): string => v.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
        const allowed = new Set(['--ds-font-body', '--ds-font-heading', '--ds-font-numeral', '--ds-font-mono', '--ds-font-reading'].map((k) => root.getPropertyValue(k)).filter((v) => v.trim()).map(first));
        if (allowed.size) {
          const seen = new Set<string>();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !n.textContent?.trim() || skipped(el) || !visible(el) || el.closest('script, style, title, .ds-sr-only')) continue;
            const f = first(getComputedStyle(el).fontFamily);
            if (!allowed.has(f) && !seen.has(f)) {
              seen.add(f);
              problems.push(`font "${f}" is not the look's: ${name(el)}`);
            }
          }
        }
      }
      return { controls: controls.length, problems };
    },
    { skip: opts.skip ?? [], fonts: opts.fonts ?? true },
  );
}

/** Wait until every finite CSS animation and transition on the page has finished (infinite pulses are ignored). */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** Assert the audit: throws with every finding. */
export async function designAudit(page: Page, opts: DesignAuditOptions = {}): Promise<DesignAuditResult> {
  const res = await designAuditFindings(page, opts);
  expect(res.problems, `design audit on ${page.url()}`).toEqual([]);
  return res;
}
