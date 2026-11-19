/**
 * Magic's named table objects (DESIGN "Card manipulation", Other table objects: "a generic counter object for emblems,
 * monarch, initiative or day/night"; GAPS 3). Real data, owned by M6-C; the HUD offers them and a free name (M6-P3).
 * Names only: no card data, images or Wizards marks.
 */
import type { TableObjectPreset } from '../types';

/** Counter objects offered by name, in menu order (DESIGN "Card manipulation", Other table objects). Added by M6-C. */
export const MTG_TABLE_OBJECTS: readonly TableObjectPreset[] = [
  { kind: 'counter', label: 'Emblem', zone: 'command' },
  { kind: 'counter', label: 'Monarch', zone: 'battlefield' },
  { kind: 'counter', label: 'Initiative', zone: 'battlefield' },
  { kind: 'counter', label: 'Day / Night', zone: 'battlefield' },
  { kind: 'counter', label: "City's blessing", zone: 'battlefield' },
];
