/**
 * Helpers for the M5-P5 browser tests: the settings harness page, a stubbed backs.scryfall.io (tests never use the
 * network; the official card back is served from a PNG made here), and opening the settings panel on the HUD harness.
 */
import { expect, type Page, type Route } from '@playwright/test';
import zlib from 'node:zlib';

/** Open the settings module test page (src/ui/settings/harness.ts) with fresh settings unless `keep`. */
export async function openSettingsHarness(page: Page, query: Record<string, string> = {}, keep = false): Promise<void> {
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'settings', ...query });
  if (!keep) q.set('fresh', '1');
  await page.goto(`./?${q.toString()}`);
  await expect(page.getByTestId('settings-harness')).toBeVisible();
}

/** A solid-colour RGB PNG of `w`×`h` (no external file, no network). */
export function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The colour of the stubbed official back. */
export const BACK_RGB: [number, number, number] = [40, 160, 90];

/**
 * Serve backs.scryfall.io from a PNG made here (or fail it), recording every request. Anything else on the internet is
 * aborted, so a test that reached for the network would fail.
 */
export async function stubBacks(page: Page, mode: { fail: boolean } = { fail: false }): Promise<string[]> {
  const urls: string[] = [];
  const png = solidPng(488, 680, BACK_RGB);
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route: Route) => {
    const url = route.request().url();
    if (new URL(url).host !== 'backs.scryfall.io') return route.abort();
    urls.push(url);
    if (mode.fail) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: png });
  });
  return urls;
}

/** Open the settings panel on the HUD (toolbar ⚙) at a section. */
export async function openHudSettings(page: Page, section: string): Promise<void> {
  if ((await page.getByTestId('settings').count()) === 0) await page.getByTestId('open-settings').click();
  await page.locator(`[data-testid="settings-tab"][data-section="${section}"]`).click();
  await expect(page.getByTestId('settings')).toHaveAttribute('data-section', section);
}
