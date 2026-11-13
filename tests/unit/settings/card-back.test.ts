// The opt-in official card back (DESIGN "Card data and images", Card back: "Spellplane's own neutral back. The official
// back carries Wizards trademarks; it is an opt-in setting loaded from backs.scryfall.io"; "Decision log", Defaults: a
// neutral back with the official back as an opt-in; CLAUDE.md: never bundled; card images are never cropped, tinted or
// distorted). Tests never fetch it: the loader is injected.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_BACK_HOST, officialCardBackUrl } from '../../../src/data/back';
import { DEFAULT_SETTINGS } from '../../../src/store/types';
import { MemorySettings } from '../../../src/ui/fakes';
import { CardBackSetting, cardBackChoiceOf, fitWhole, imageBack, OFFICIAL_BACK_ID, type LoadedImage } from '../../../src/ui/settings/back';

const IMG: LoadedImage = { width: 488, height: 680, source: {} as CanvasImageSource };

function loader(result: LoadedImage | Error = IMG) {
  const urls: string[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  return {
    urls,
    hold() {
      hold = true;
    },
    release() {
      release?.();
    },
    load: async (url: string) => {
      urls.push(url);
      if (hold) await new Promise<void>((r) => (release = r));
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('default', () => {
  it('is the neutral Spellplane back, and nothing is loaded', async () => {
    expect(DEFAULT_SETTINGS.cardBack).toBe('spellplane');
    const l = loader();
    const back = new CardBackSetting({ settings: new MemorySettings(), load: l.load });
    await back.refresh();
    expect(back.state()).toEqual({ choice: 'spellplane', status: 'neutral', back: null, error: null });
    expect(l.urls).toEqual([]);
  });

  it('reads anything but "official" as the neutral back', () => {
    expect(cardBackChoiceOf('official')).toBe('official');
    for (const v of ['spellplane', 'Official', null, undefined, 3]) expect(cardBackChoiceOf(v)).toBe('spellplane');
  });
});

describe('opting in', () => {
  it('loads the official back from backs.scryfall.io only when chosen, keeps the choice, and hands a back to draw', async () => {
    const store = new MemorySettings();
    const l = loader();
    const back = new CardBackSetting({ settings: store, load: l.load });
    const states: string[] = [];
    back.subscribe((s) => states.push(s.status));
    await back.set('official');
    expect(l.urls).toEqual([officialCardBackUrl('normal')]);
    expect(new URL(l.urls[0]!).host).toBe(CARD_BACK_HOST);
    expect(states).toEqual(['loading', 'official']);
    expect(back.state()).toMatchObject({ choice: 'official', status: 'official', error: null, back: { id: OFFICIAL_BACK_ID, width: 488, height: 680 } });
    expect(await store.get('cardBack')).toBe('official');
  });

  it('a stored choice loads on the next page', async () => {
    const l = loader();
    const back = new CardBackSetting({ settings: new MemorySettings({ cardBack: 'official' }), load: l.load });
    await back.refresh();
    expect(back.state().status).toBe('official');
    expect(l.urls).toHaveLength(1);
  });

  it('switching back to the neutral back takes effect at once and is kept; switching again does not load twice', async () => {
    const store = new MemorySettings();
    const l = loader();
    const back = new CardBackSetting({ settings: store, load: l.load });
    await back.set('official');
    await back.set('spellplane');
    expect(back.state()).toEqual({ choice: 'spellplane', status: 'neutral', back: null, error: null });
    expect(await store.get('cardBack')).toBe('spellplane');
    await back.set('official');
    expect(back.state().status).toBe('official');
    expect(l.urls).toHaveLength(1);
  });

  it('a load that finishes after the viewer switched back does not show the official back', async () => {
    const l = loader();
    l.hold();
    const back = new CardBackSetting({ settings: new MemorySettings(), load: l.load });
    const first = back.set('official');
    await Promise.resolve();
    await back.set('spellplane');
    l.release();
    await first;
    expect(back.state()).toMatchObject({ choice: 'spellplane', status: 'neutral', back: null });
  });
});

describe('when the image cannot be loaded (failed image)', () => {
  it('keeps the neutral back, says why, and can try again', async () => {
    const store = new MemorySettings();
    let fail = true;
    const urls: string[] = [];
    const back = new CardBackSetting({
      settings: store,
      load: async (url) => {
        urls.push(url);
        if (fail) throw new Error('the image could not be loaded');
        return IMG;
      },
    });
    await back.set('official');
    expect(back.state()).toMatchObject({ choice: 'official', status: 'failed', back: null });
    expect(back.state().error).toMatch(/backs\.scryfall\.io/);
    expect(back.state().error).toMatch(/Spellplane back stays/);
    // The choice is kept: the next page tries again.
    expect(await store.get('cardBack')).toBe('official');
    fail = false;
    await back.retry();
    expect(back.state().status).toBe('official');
    expect(urls).toHaveLength(2);
  });
});

describe('drawing the official back', () => {
  it('fits the image whole with its aspect kept, centred', () => {
    expect(fitWhole(488, 680, 488, 680)).toEqual({ x: 0, y: 0, w: 488, h: 680 });
    expect(fitWhole(488, 680, 976, 1360)).toEqual({ x: 0, y: 0, w: 976, h: 1360 });
    // A wider target: full height, centred horizontally (nothing cropped, nothing stretched).
    const r = fitWhole(500, 700, 600, 700);
    expect(r).toEqual({ x: 50, y: 0, w: 500, h: 700 });
    expect(r.w / r.h).toBeCloseTo(500 / 700, 10);
    expect(fitWhole(0, 10, 10, 10)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('draws the image once, whole, with no tint or filter', () => {
    const calls: unknown[][] = [];
    const ctx = {
      set fillStyle(_v: string) {
        calls.push(['fillStyle']);
      },
      fillRect: (...a: number[]) => calls.push(['fillRect', ...a]),
      drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a.slice(1)]),
    } as unknown as CanvasRenderingContext2D;
    const t = imageBack(IMG);
    t.draw(ctx, 488, 680);
    expect(calls).toEqual([['drawImage', 0, 0, 488, 680]]);
    calls.length = 0;
    t.draw(ctx, 600, 680);
    expect(calls.at(-1)).toEqual(['drawImage', 56, 0, 488, 680]);
  });
});

describe('never bundled', () => {
  it('the official back is referenced only as a runtime URL, and no back image ships with the app', () => {
    const root = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.join(root, 'src'));
    if (fs.existsSync(path.join(root, 'public'))) walk(path.join(root, 'public'));
    const images = files.filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f) && /back/i.test(path.basename(f)));
    expect(images).toEqual([]);
    // Only data/back.ts builds the URL; nothing else names a back image on the host.
    const mentions = files.filter((f) => /\.(ts|svelte|js|html|css)$/.test(f) && !f.endsWith(path.join('src', 'data', 'back.ts')) && fs.readFileSync(f, 'utf8').includes(CARD_BACK_HOST + '/'));
    expect(mentions).toEqual([]);
  });
});
