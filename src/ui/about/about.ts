/**
 * The About panel's text (DESIGN "Card data and images", Legal position: "Spellplane stays free, account-less,
 * rules-free and image-free in its own bundle, and shows the policy's disclaimer in its About panel"; Card data and
 * images: Scryfall for card objects, images and tokens, MTGJSON for booster composition, MIT licensed; "Decision log",
 * Domain and licence: public repository, MIT). PLAN M5-P5: "About panel with the Wizards Fan Content Policy notice and
 * Scryfall and MTGJSON credits".
 */

/** The Wizards Fan Content Policy disclaimer, in the wording the policy asks fan content to carry. */
export const FAN_CONTENT_NOTICE =
  'Spellplane is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.';

export const FAN_CONTENT_POLICY_URL = 'https://company.wizards.com/en/legal/fancontentpolicy';

/** One credited source. */
export interface Credit {
  id: 'scryfall' | 'mtgjson';
  name: string;
  url: string;
  text: string;
}

export const CREDITS: readonly Credit[] = [
  {
    id: 'scryfall',
    name: 'Scryfall',
    url: 'https://scryfall.com',
    text: 'Card data, card images, tokens and the optional official card back come from the Scryfall API, fetched by your browser and cached in it. Card images are shown whole, with their artist and copyright lines. Spellplane is not produced by or affiliated with Scryfall.',
  },
  {
    id: 'mtgjson',
    name: 'MTGJSON',
    url: 'https://mtgjson.com',
    text: 'Booster contents for realistic packs (sheets, weights and foils) come from MTGJSON, released under the MIT licence.',
  },
];

/** What Spellplane is and is not (DESIGN "Vision, goals and non-goals"; Legal position). */
export const ABOUT_TEXT = [
  'Spellplane is a free, peer-to-peer card table for playing Magic: The Gathering with friends. It has no accounts, no server and no rules engine: the players are the rules engine.',
  'It ships no card data, card images or Wizards logos. Its own card back is a neutral design; the official back is an opt-in setting loaded from Scryfall.',
  'Magic: The Gathering and its card names, art and symbols are trademarks and copyright of Wizards of the Coast LLC.',
];

export const SOURCE_URL = 'https://github.com/izzardry/spellplane';
export const LICENCE = 'MIT';
