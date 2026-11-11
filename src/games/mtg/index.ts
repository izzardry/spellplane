/**
 * The Magic game definition (DESIGN "Table model", Game definition; "Specification: code interfaces").
 * Stub from M0-C; implementer: M0-P6 (zones and visibility, phases, starting life, neutral card back, layouts).
 * The keymap is real data (./keymap.ts).
 */
import type { GameDefinition } from '../types';
import { MTG_KEYMAP } from './keymap';

export { MTG_KEYMAP, chordToString } from './keymap';

const todo = (): never => {
  throw new Error('not implemented: M0-P6');
};

/** The Magic definition (DESIGN "Specification: code interfaces"). Stub: zones and phases are empty until M0-P6. */
export const mtg: GameDefinition = {
  id: 'mtg',
  zones: [],
  phases: [],
  startingLife: () => todo(),
  layout: () => todo(),
  cardBack: { id: 'mtg-back', width: 488, height: 680, draw: () => todo() },
  defaultDestination: () => todo(),
  keymap: MTG_KEYMAP,
};
