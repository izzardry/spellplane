/**
 * The design audit (docs/design/m8/visual.md DS-4; PLAN Milestone 8, M8-P1): every visible button (link buttons
 * `a.ds-btn` included), input, segmented control and tab track is 28, 36, 44 or 56 px high (±0.5); the controls of one
 * `.ds-row` share one height; at most one `.ds-btn--primary` per layer (the stage, and each `[data-ds-layer]` of a
 * known name: sheet, popover, dialog, toast, coach; an unknown name is itself a finding and opens no layer); no
 * element computes a `backdrop-filter`; nothing over the scene host computes a `filter`; every text uses the look's
 * face or its reading face, and text outside any look is a finding. Other packages call `await designAudit(page)` in
 * their specs; it throws with every finding listed. Added by M8-P1.
 */
import { expect, type Page } from '@playwright/test';

export interface DesignAuditOptions {
  /** CSS selectors whose subtree the audit skips (legacy panels not yet swept). */
  skip?: string[];
  /** Check fonts (default true). */
  fonts?: boolean;
  /** Further `data-ds-layer` names that open a layer of their own (the kit page's look samples: 'sample'). */
  layers?: string[];
}

/** The layers of visual.md 2.10: each may hold one primary button of its own. */
export const DS_LAYERS = ['sheet', 'popover', 'dialog', 'toast', 'coach'] as const;

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
    ({ skip, fonts, layerNames }) => {
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
      const controls = [...document.querySelectorAll('button, [role="button"], a.ds-btn, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="range"]), select, .ds-seg, .ds-tabs, .ds-field')].filter(
        // A card in the hand fan is focusable (role="button") but is the card's own 63:88 size, not a control (M8-P8).
        (el) => !skipped(el) && visible(el) && !el.closest('.ds-seg button, .ds-field input, .ds-tabs button') && !el.matches('.ds-seg button, .ds-field input, .ds-mode, .ds-tabs button, [data-testid="hand-card"]'),
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
          const c = child.matches('button, [role="button"], a.ds-btn, input, select, .ds-seg, .ds-tabs, .ds-field, .ds-chip') ? child : child.querySelector(':scope > button, :scope > a.ds-btn, :scope > .ds-seg, :scope > .ds-tabs, :scope > .ds-field');
          if (!c || !visible(c) || c.matches('.ds-mode')) continue;
          heights.add(Math.round((c as HTMLElement).offsetHeight));
        }
        if (heights.size > 1) problems.push(`row with heights ${[...heights].join(', ')}: ${name(row)}`);
      }

      // 3. One primary per layer. Only a known layer name opens a layer; another name is reported and is no escape.
      const known = new Set(layerNames);
      for (const el of document.querySelectorAll('[data-ds-layer]')) {
        const n = (el as HTMLElement).dataset['dsLayer'] ?? '';
        if (!known.has(n) && !skipped(el)) problems.push(`unknown layer "${n}": ${name(el)}`);
      }
      const layerOf = (el: Element): Element | null => {
        for (let l = el.closest('[data-ds-layer]'); l; l = l.parentElement?.closest('[data-ds-layer]') ?? null) {
          if (known.has((l as HTMLElement).dataset['dsLayer'] ?? '')) return l;
        }
        return null;
      };
      const layers = new Map<Element | null, Element[]>();
      for (const el of document.querySelectorAll('.ds-btn--primary')) {
        if (skipped(el) || !visible(el)) continue;
        const layer = layerOf(el);
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

      // 5. Fonts are the look's: the faces of the nearest look (its --ds-font-* variables; a sample of another look
      //    inside the page carries its own).
      if (fonts) {
        const first = (v: string): string => v.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
        const KEYS = ['--ds-font-body', '--ds-font-heading', '--ds-font-numeral', '--ds-font-mono', '--ds-font-reading'];
        const seen = new Set<string>();
        let lookless = false;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!el || !n.textContent?.trim() || skipped(el) || !visible(el) || el.closest('script, style, title, .ds-sr-only')) continue;
          const cs = getComputedStyle(el);
          const allowed = new Set(KEYS.map((k) => cs.getPropertyValue(k)).filter((v) => v.trim()).map(first));
          if (!allowed.size) {
            if (!lookless) problems.push(`no look applied (no --ds-font-* in scope): ${name(el)}`);
            lookless = true;
            continue;
          }
          const f = first(cs.fontFamily);
          if (!allowed.has(f) && !seen.has(f)) {
            seen.add(f);
            problems.push(`font "${f}" is not the look's: ${name(el)}`);
          }
        }
      }
      return { controls: controls.length, problems };
    },
    { skip: opts.skip ?? [], fonts: opts.fonts ?? true, layerNames: [...DS_LAYERS, ...(opts.layers ?? [])] },
  );
}

/**
 * Wait until every running finite CSS animation and transition on the page has finished, at most `timeoutMs` of real
 * time (infinite pulses and paused animations are ignored; a fake clock does not hold it up past the bound).
 */
export async function settleAnimations(page: Page, timeoutMs = 2000): Promise<void> {
  // The bound runs in the test process (a real timer), so a page under page.clock cannot hold the audit up.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const settled = page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  try {
    await Promise.race([settled, bound]);
  } finally {
    clearTimeout(timer);
    // A page closed while the in-page wait is pending must not surface as an unhandled rejection.
    settled.catch(() => undefined);
  }
}

/** Assert the audit: throws with every finding. */
export async function designAudit(page: Page, opts: DesignAuditOptions = {}): Promise<DesignAuditResult> {
  const res = await designAuditFindings(page, opts);
  expect(res.problems, `design audit on ${page.url()}`).toEqual([]);
  return res;
}
