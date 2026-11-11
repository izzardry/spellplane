import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Open the app with harness flags. `profile` gives each page its own IndexedDB namespace. */
export async function openApp(page: Page, opts: { profile?: string; transport?: 'local'; hash?: string; faces?: 'placeholder' | null } = {}) {
  const q = new URLSearchParams();
  if (opts.faces !== null) q.set('faces', opts.faces ?? 'placeholder');
  if (opts.profile) q.set('profile', opts.profile);
  if (opts.transport) q.set('transport', opts.transport);
  await page.goto(`./?${q.toString()}${opts.hash ? `#${opts.hash}` : ''}`);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
}

/** Call a function of window.__spellplane in the page and return its JSON result. */
export async function hook<T = unknown>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, a]) => {
      const api = window.__spellplane as Record<string, unknown> | undefined;
      const parts = (name as string).split('.');
      let target: unknown = api;
      let self: unknown = api;
      for (const p of parts) {
        self = target;
        target = (target as Record<string, unknown> | undefined)?.[p];
      }
      if (typeof target !== 'function') throw new Error(`__spellplane.${name as string} is not a function`);
      return JSON.parse(JSON.stringify((target as (...x: unknown[]) => unknown).apply(self, a as unknown[]) ?? null));
    },
    [fn, args] as const,
  ) as Promise<T>;
}

/**
 * Save a screenshot as gate evidence under artifacts/shots/<milestone>/<name>-<project>.png
 * (docs/PLAN.md: screenshots are evidence for review, not pixel baselines).
 */
export async function shot(page: Page, milestone: string, name: string, project: string) {
  const dir = path.join('artifacts', 'shots', milestone);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${project}.png`) });
}
