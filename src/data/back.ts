/**
 * The official card back, opt-in (DESIGN "Card data and images", Card back: "Spellplane's own neutral back. The
 * official back carries Wizards trademarks; it is an opt-in setting loaded from backs.scryfall.io"; CLAUDE.md: the
 * official back is never bundled). Setting: store/types.ts `Settings.cardBack`. Contracts: M5-C. Implementer: M5-P5
 * (the settings toggle, loading the image at runtime, handing it to the scene). Tests never fetch it: they route the
 * host to a fixture image or stay on the neutral back.
 */

/** Host that serves Scryfall's card back images (DESIGN "Card data and images"). Added by M5-C. */
export const CARD_BACK_HOST = 'backs.scryfall.io';

/**
 * Scryfall's `card_back_id` of the standard Magic back (DECISIONS [M5-C]: taken from Scryfall card objects; M5-P5
 * confirms it against a live card object at the playtest, since the fixtures trim the field). Added by M5-C.
 */
export const DEFAULT_CARD_BACK_ID = '0aeebaf5-8c7d-4636-9e82-8c27447861f7';

/** Image sizes backs.scryfall.io serves (Scryfall "Card Back Images"; 'normal' 488×680 matches the play tier). Added by M5-C. */
export type CardBackSize = 'small' | 'normal' | 'large';

/** URL of a card back image: `https://backs.scryfall.io/<size>/<id[0]>/<id[1]>/<id>.jpg` (Scryfall "Card Back Images"). Added by M5-C. */
export function officialCardBackUrl(size: CardBackSize = 'normal', backId: string = DEFAULT_CARD_BACK_ID): string {
  return `https://${CARD_BACK_HOST}/${size}/${backId[0]}/${backId[1]}/${backId}.jpg`;
}
