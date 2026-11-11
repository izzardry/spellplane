/** Texture keys for card faces (shared by the pure presentation code and the GPU texture cache). */
import type { CardRef } from '../core/types';

export const BACK_KEY = 'back';
export const BLANK_KEY = 'blank';

/** Key of a card face image: Scryfall id and face index (the foil flag does not change the image). */
export const faceKey = (ref: CardRef, faceIndex: 0 | 1): string => `${ref.sid}#${faceIndex}`;
