/**
 * Caption bubbles in the scene (DESIGN "Chat and voice", Dictation and captions: Placement; "Specification: geometry,
 * layout and motion", Screen layer: at most 280 px wide and three lines). Anchored to a card or stack item, else beside
 * the speaker's avatar (TableLayout seat `zones.avatar`), upright for every viewer. Contracts: M3-C (stub);
 * implementer: M3-P4, which calls it from the table scene's `update` (ViewState.captions).
 */
import type { Anchor, TableState } from '../core/types';
import type { TableLayout } from '../games/types';
import type { SceneCaption, TablePoint } from './types';

/**
 * The table point a caption hangs from: the anchored card's or stack item's position, else the speaker's avatar; null
 * when neither exists (DESIGN "Chat and voice", Placement). Implementer: M3-P4.
 */
export function captionPoint(_state: TableState, _layout: TableLayout, _caption: Pick<SceneCaption, 'anchor' | 'seat'>): { point: TablePoint; anchoredTo: Anchor | null } | null {
  throw new Error('not implemented: M3-P4');
}
