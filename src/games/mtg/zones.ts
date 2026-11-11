/**
 * Magic zones and phases (DESIGN "Table model", zone table; "Turn flow and confirmation", Turn and phase strip).
 * Zone ids derived from these kinds follow core/ids.ts: 'library:s0', 'stack'.
 */
import type { PhaseSpec, ZoneSpec } from '../types';

/** Every zone of the Table model with its scope, visibility, ordering and presentation. */
export const MTG_ZONES: ZoneSpec[] = [
  // Nobody sees faces, order hidden; owner's browser only, others get a count. Squared pile with a count badge.
  { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
  // Owner sees faces (and a Two-Headed Giant teammate when enabled, decided by table settings, not here).
  // Screen-anchored fan for the owner; a row of backs at the seat for others.
  { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
  // Shared, free placement with snapping; zone order is draw order only.
  { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
  // Shared; squared pile with the top card visible, opens as an ordered fan.
  { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
  // Shared, except face-down cards whose identity stays with the exiling player; pile beside the graveyard.
  { id: 'exile', scope: 'seat', visibility: 'public', ordered: false, presentation: 'squared', label: 'Exile' },
  // One per table, central cascade lane, newest on top.
  { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
  // Small area beside the avatar.
  { id: 'command', scope: 'seat', visibility: 'public', ordered: false, presentation: 'area', label: 'Command' },
  // Owner only; hidden during play, the builder table between games.
  { id: 'sideboard', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'hidden', label: 'Sideboard / pool' },
  // The pack a player currently holds; handed over on pass. Rochester's public pack is the draft package's concern (M2).
  { id: 'pack', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Draft pack' },
];

/** The seven steps of the turn strip. */
export const MTG_PHASES: PhaseSpec[] = [
  { id: 'untap', label: 'Untap' },
  { id: 'upkeep', label: 'Upkeep' },
  { id: 'draw', label: 'Draw' },
  { id: 'main1', label: 'Main 1' },
  { id: 'combat', label: 'Combat' },
  { id: 'main2', label: 'Main 2' },
  { id: 'end', label: 'End' },
];
