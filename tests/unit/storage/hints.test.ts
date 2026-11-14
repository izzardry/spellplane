/**
 * PLAN Milestone 5, owner decisions, Installable on iPad: "shows a one-time hint on iPad and iPhone explaining why"
 * (Safari's 7-day storage wipe), and PLAN M5-P3's storage-persistence prompt (ui/storage/hints.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_SCREEN_HINT, isAppleMobile, showHomeScreenHint, showPersistHint, withSeen, type HintEnv } from '../../../src/ui/storage/hints';
import { WEB_APP_MANIFEST, APPLE_TOUCH_ICON } from '../../../src/util/pwa';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

const env = (userAgent: string, over: Partial<HintEnv> = {}): HintEnv => ({ userAgent, platform: /Mac/.test(userAgent) ? 'MacIntel' : 'Linux', maxTouchPoints: 0, standalone: false, ...over });

describe('the Home Screen hint', () => {
  it('shows on iPhone and iPad, including iPadOS Safari that presents itself as a Mac', () => {
    expect(isAppleMobile(env(IPHONE, { platform: 'iPhone', maxTouchPoints: 5 }))).toBe(true);
    expect(isAppleMobile(env(IPAD_OLD, { platform: 'iPad', maxTouchPoints: 5 }))).toBe(true);
    expect(isAppleMobile(env(MAC, { maxTouchPoints: 5 }))).toBe(true);
    expect(isAppleMobile(env(MAC))).toBe(false);
    expect(isAppleMobile(env(ANDROID, { maxTouchPoints: 5 }))).toBe(false);
  });

  it('shows once, and never when Spellplane already runs from the Home Screen', () => {
    const ipad = env(MAC, { maxTouchPoints: 5 });
    expect(showHomeScreenHint(ipad, [])).toBe(true);
    expect(showHomeScreenHint(ipad, ['welcome'])).toBe(true);
    expect(showHomeScreenHint(ipad, ['installHomeScreen'])).toBe(false);
    expect(showHomeScreenHint({ ...ipad, standalone: true }, [])).toBe(false);
    expect(showHomeScreenHint(env(MAC), [])).toBe(false);
  });

  it('explains why: Safari’s 7-day wipe, and how to add it', () => {
    expect(HOME_SCREEN_HINT.body).toMatch(/7 days/);
    expect(HOME_SCREEN_HINT.body).toMatch(/Add to Home Screen/);
  });
});

describe('the storage-persistence prompt', () => {
  it('shows while the browser could keep the data for good but does not, until answered once', () => {
    expect(showPersistHint({ supported: true, persisted: false }, [])).toBe(true);
    expect(showPersistHint({ supported: true, persisted: true }, [])).toBe(false);
    expect(showPersistHint({ supported: false, persisted: false }, [])).toBe(false);
    expect(showPersistHint({ supported: true, persisted: false }, ['persistStorage'])).toBe(false);
  });

  it('records an answer once', () => {
    expect(withSeen([], 'persistStorage')).toEqual(['persistStorage']);
    expect(withSeen(['persistStorage'], 'persistStorage')).toEqual(['persistStorage']);
    expect(withSeen(['welcome'], 'installHomeScreen')).toEqual(['welcome', 'installHomeScreen']);
  });
});

describe('the web app manifest', () => {
  it('names Spellplane’s own icons, a maskable one and the 180 px Home Screen icon, under the app’s base', () => {
    expect(WEB_APP_MANIFEST.start_url).toBe('./');
    expect(WEB_APP_MANIFEST.icons.some((i) => 'purpose' in i && i.purpose === 'maskable')).toBe(true);
    expect(APPLE_TOUCH_ICON).toBe('icons/apple-touch-icon.png');
    expect(WEB_APP_MANIFEST.icons.every((i) => !i.src.startsWith('/'))).toBe(true);
  });

  it('ships every icon it names as a PNG of the stated size', () => {
    const size = (src: string): string => {
      const png = readFileSync(new URL(`../../../public/${src}`, import.meta.url));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
    };
    for (const icon of WEB_APP_MANIFEST.icons) expect(size(icon.src)).toBe(icon.sizes);
    expect(size(APPLE_TOUCH_ICON)).toBe('180x180');
  });
});
