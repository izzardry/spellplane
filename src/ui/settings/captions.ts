/**
 * Captions as the scene draws them (DESIGN "Chat and voice", Placement: a speech bubble in the speaker's seat colour;
 * voice/types.ts Caption → scene/types.ts SceneCaption). M3-P4.
 */
import type { TableState } from '../../core/types';
import type { SceneCaption } from '../../scene/types';
import type { Caption } from '../../voice/types';

/** The scene's captions for the controller's: the speaker's seat (null for a spectator) and its seat colour. */
export function sceneCaptions(list: readonly Caption[], st: TableState): SceneCaption[] {
  return list.map((c) => {
    const seat = Object.hasOwn(st.seats, c.speaker) ? c.speaker : null;
    return { id: c.id, text: c.text, final: c.final, anchor: c.anchor, seat, colour: seat ? (st.seats[seat]?.colour ?? null) : null, opacity: 1 };
  });
}
