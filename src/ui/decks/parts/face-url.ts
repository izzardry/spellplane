/**
 * Image URLs for card faces in Deck mode (decks.md D28: whole, sharp, uniformly scaled). A Scryfall face is its URL; a
 * placeholder face (`?faces=placeholder`) is drawn once at half size and kept as a small JPEG data URL, so grids show
 * `<img>` elements in both cases and no canvas stays alive per tile. The cache is bounded. Implementer: M8-P3.
 */
import type { CardRef } from '../../../core/types';
import type { FaceSource, ImageTier } from '../../../data/types';
import { drawPlaceholderFace } from '../../../scene/placeholder';

const MAX = 400;
const cache = new Map<string, string>();

function remember(key: string, url: string): string {
  cache.set(key, url);
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return url;
}

/** The URL of a card's front face, or null when it cannot be shown (the caller shows the neutral back). */
export async function faceUrl(faces: FaceSource, ref: CardRef, tier: ImageTier = 'normal'): Promise<string | null> {
  const key = `${ref.sid}:${tier}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await faces.faceFor(ref, 0, tier);
  if (img.kind === 'url') return remember(key, img.url);
  const full = drawPlaceholderFace(img.face) as HTMLCanvasElement;
  const small = document.createElement('canvas');
  small.width = Math.round(full.width / 2);
  small.height = Math.round(full.height / 2);
  const ctx = small.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(full, 0, 0, small.width, small.height);
  const url = small.toDataURL('image/jpeg', 0.85);
  full.width = full.height = 0;
  small.width = small.height = 0;
  return remember(key, url);
}

/** An image that failed to load (offline, 404): not kept, so the next tile that shows the card asks again. */
export function forgetFaceUrl(url: string): void {
  for (const [k, v] of cache) if (v === url) cache.delete(k);
}
