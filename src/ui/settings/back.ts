/**
 * The card back setting (DESIGN "Card data and images", Card back: "Spellplane's own neutral back. The official back
 * carries Wizards trademarks; it is an opt-in setting loaded from backs.scryfall.io"; "Decision log", Defaults: "a
 * neutral Spellplane card back with the official back as an opt-in"; CLAUDE.md: the official back is never bundled).
 *
 * The choice (`Settings.cardBack`, 'spellplane' by default) lives in this browser's settings and never on the wire:
 * each viewer sees other players' hidden cards with the back they chose. The official image is requested only after the
 * viewer picks it, from data/back.ts `officialCardBackUrl`, with `crossOrigin = 'anonymous'` so the scene may use it as
 * a texture. Until it has loaded, and when it cannot be loaded, the neutral back stays and the reason is shown.
 *
 * The image is drawn whole: scaled to fit the card with its aspect kept (never cropped, tinted or distorted), the
 * margin, if the card's aspect differs, filled with a neutral dark tone.
 */
import { officialCardBackUrl } from '../../data/back';
import type { CardBackChoice, SettingsStore } from '../../store/types';
import type { Canvas2D, TextureSource } from '../../util/texture';

/** A decoded image: what a TextureSource needs to draw it. */
export interface LoadedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
}

/** Loads an image by URL (the browser's Image by default; tests inject one). */
export type ImageLoader = (url: string) => Promise<LoadedImage>;

/** Where the back stands: the neutral back, the official one loading, shown, or failed (the neutral back stays). */
export type CardBackStatus = 'neutral' | 'loading' | 'official' | 'failed';

export interface CardBackState {
  choice: CardBackChoice;
  status: CardBackStatus;
  /** The back to draw instead of the theme's or game's, or null for the default. */
  back: TextureSource | null;
  /** Why the official back is not shown, or null. */
  error: string | null;
}

/** Texture id of the official back (the scene caches face arrays by back). */
export const OFFICIAL_BACK_ID = 'official-back';

export function cardBackChoiceOf(v: unknown): CardBackChoice {
  return v === 'official' ? 'official' : 'spellplane';
}

/** The browser's image loader: CORS-enabled, so a canvas or WebGL texture may read it. */
export const browserImageLoader: ImageLoader = (url) =>
  new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('images cannot be loaded here'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve({ width: img.naturalWidth, height: img.naturalHeight, source: img });
      else reject(new Error('the image is empty'));
    };
    img.onerror = () => reject(new Error('the image could not be loaded'));
    img.src = url;
  });

/** Where an image of `iw`×`ih` goes inside `w`×`h` when fitted whole with its aspect kept, centred. */
export function fitWhole(iw: number, ih: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (iw <= 0 || ih <= 0 || w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

/** A TextureSource that draws a loaded image whole (never cropped, tinted or distorted). */
export function imageBack(img: LoadedImage, id: string = OFFICIAL_BACK_ID): TextureSource {
  return {
    id,
    width: img.width,
    height: img.height,
    draw(ctx: Canvas2D, w: number, h: number) {
      const r = fitWhole(img.width, img.height, w, h);
      if (r.w < w || r.h < h) {
        ctx.fillStyle = '#16120e';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img.source, r.x, r.y, r.w, r.h);
    },
  };
}

export interface CardBackOptions {
  settings?: SettingsStore | null | undefined;
  load?: ImageLoader;
  /** The official back's URL; data/back.ts officialCardBackUrl('normal') by default. */
  url?: string;
}

/**
 * The viewer's card back: reads the stored choice, loads the official image when it is chosen, and tells subscribers
 * which back to draw. One instance per page (the HUD hands it to its settings panel), so the image loads once.
 */
export class CardBackSetting {
  private st: CardBackState = { choice: 'spellplane', status: 'neutral', back: null, error: null };
  private readonly listeners = new Set<(s: CardBackState) => void>();
  private readonly settings: SettingsStore | null;
  private readonly load: ImageLoader;
  readonly url: string;
  /** The loaded official back, kept for the page so switching back and forth does not load it again. */
  private loaded: TextureSource | null = null;
  private ticket = 0;
  private edits = 0;
  private disposed = false;

  constructor(opts: CardBackOptions = {}) {
    this.settings = opts.settings ?? null;
    this.load = opts.load ?? browserImageLoader;
    this.url = opts.url ?? officialCardBackUrl('normal');
  }

  state(): CardBackState {
    return { ...this.st };
  }

  subscribe(fn: (s: CardBackState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Read the stored choice (on mount); a choice made on this page meanwhile wins. */
  async refresh(): Promise<void> {
    if (!this.settings) return;
    const at = this.edits;
    let stored: unknown;
    try {
      stored = await this.settings.get('cardBack');
    } catch {
      return;
    }
    if (this.disposed || at !== this.edits) return;
    await this.apply(cardBackChoiceOf(stored));
  }

  /** The viewer picks a back: shown at once (the official one once loaded) and kept in the settings. */
  async set(choice: CardBackChoice): Promise<void> {
    this.edits++;
    const c = cardBackChoiceOf(choice);
    const shown = this.apply(c);
    await this.settings?.set('cardBack', c).catch(() => undefined);
    await shown;
  }

  /** Try the official image again after a failure. */
  async retry(): Promise<void> {
    if (this.st.choice !== 'official') return;
    await this.apply('official');
  }

  dispose(): void {
    this.disposed = true;
    this.ticket++;
    this.listeners.clear();
  }

  private async apply(choice: CardBackChoice): Promise<void> {
    const ticket = ++this.ticket;
    if (choice === 'spellplane') {
      this.update({ choice, status: 'neutral', back: null, error: null });
      return;
    }
    if (this.loaded) {
      this.update({ choice, status: 'official', back: this.loaded, error: null });
      return;
    }
    this.update({ choice, status: 'loading', back: null, error: null });
    try {
      const img = await this.load(this.url);
      const back = imageBack(img);
      this.loaded = back;
      if (ticket !== this.ticket || this.disposed) return;
      this.update({ choice, status: 'official', back, error: null });
    } catch (e) {
      if (ticket !== this.ticket || this.disposed) return;
      const why = e instanceof Error ? e.message : String(e);
      this.update({ choice, status: 'failed', back: null, error: `The official card back could not be loaded from backs.scryfall.io (${why}). The Spellplane back stays until it loads.` });
    }
  }

  private update(next: CardBackState): void {
    const prev = this.st;
    this.st = next;
    if (prev.choice === next.choice && prev.status === next.status && prev.back === next.back && prev.error === next.error) return;
    for (const fn of [...this.listeners]) fn(this.state());
  }
}
