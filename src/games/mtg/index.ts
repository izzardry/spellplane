/**
 * The Magic game definition (DESIGN "Table model", Game definition; "Specification: code interfaces"):
 * zones and their visibility, the seven phases, starting life, the neutral card back, the default resolve
 * destination, the canonical keymap and the table layouts.
 */
import type { Format } from '../../core/types';
import type { GameDefinition } from '../types';
import { MTG_CARD_BACK } from './cardBack';
import { mtgDefaultDestination } from './destination';
import { MTG_KEYMAP } from './keymap';
import { mtgLayout } from './layout';
import { MTG_PHASES, MTG_ZONES } from './zones';

export { MTG_KEYMAP, chordToString } from './keymap';
export { MTG_CARD_BACK, drawCardBack } from './cardBack';
export { MTG_LAYOUT, PROVISIONAL_FORMATS, isProvisionalLayout, mtgLayout, soloLayout } from './layout';
export { MTG_PHASES, MTG_ZONES } from './zones';
export { mtgDefaultDestination } from './destination';

/** Starting life: 20 each, or 30 per team in Two-Headed Giant (DESIGN "Players, seats and formats"). */
export function mtgStartingLife(format: Format): number {
  return format === '2hg' ? 30 : 20;
}

/** The Magic definition (DESIGN "Specification: code interfaces"). */
export const mtg: GameDefinition = {
  id: 'mtg',
  zones: MTG_ZONES,
  phases: MTG_PHASES,
  startingLife: mtgStartingLife,
  layout: mtgLayout,
  cardBack: MTG_CARD_BACK,
  defaultDestination: mtgDefaultDestination,
  keymap: MTG_KEYMAP,
};
