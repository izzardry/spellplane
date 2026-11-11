/**
 * FaceSource (DESIGN "Card data and images"; PLAN B0.5 placeholder faces): Scryfall image URLs per face and tier,
 * or, with `?faces=placeholder`, placeholder faces drawn from the card data so tests never load images.
 */
import type { CardRef } from '../core/types';
import { flags } from '../util/flags';
import { imageUrl, placeholderFace } from './cards';
import type { CardDataSource, FaceImage, FaceSource, ImageTier } from './types';

export type FaceMode = 'scryfall' | 'placeholder';

export class CardFaceSource implements FaceSource {
  constructor(
    private readonly cards: CardDataSource,
    readonly mode: FaceMode = flags().faces,
  ) {}

  /**
   * "Unknown card" only when Scryfall definitely has no such card; a failed lookup (network error, 429 give-up)
   * rejects, so the caller can ask again later instead of keeping a placeholder.
   */
  async faceFor(ref: CardRef, faceIndex: 0 | 1, tier: ImageTier): Promise<FaceImage> {
    const card = this.cards.peek(ref.sid) ?? (await this.cards.get(ref.sid));
    if (!card) return { kind: 'placeholder', face: { name: 'Unknown card' } };
    if (this.mode === 'scryfall') {
      const url = imageUrl(card, faceIndex, tier);
      if (url) return { kind: 'url', url };
    }
    return { kind: 'placeholder', face: placeholderFace(card, faceIndex) };
  }
}

/** The page's face source: Scryfall URLs, or placeholder faces when the page was opened with `?faces=placeholder`. */
export function createFaceSource(cards: CardDataSource, mode: FaceMode = flags().faces): FaceSource {
  return new CardFaceSource(cards, mode);
}
