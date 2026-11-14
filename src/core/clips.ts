/**
 * Paperclips and the solitaire carry rule (DESIGN "Card manipulation", Placement and piles: "Piles carry like
 * solitaire"; Clip; PLAN Milestone 6, owner decisions: Attach by overlap (Carry rule), Paperclips). Contracts: M6-C.
 * Implementer: M6-P1 (`carryGroup`, the clip reducer in core/reducer/clips.ts, the scene's drag in scene/table-scene.ts
 * and scene/clips.ts). Pure: shared by the scene's drag, the combat shortcuts (attachments travel with their host) and
 * the keyboard routes.
 */
import type { CardInstance, Clip, InstanceId, PileId, TableState } from './types';

/** Every clip `card` is in, in clip-id order (DESIGN "Card manipulation", Clip). Added by M6-C. */
export function clipsOf(state: TableState, card: InstanceId): Clip[] {
  const clips = state.clips ?? {};
  return Object.keys(clips)
    .sort()
    .map((id) => clips[id]!)
    .filter((c) => c.cards.includes(card));
}

/**
 * The connected group of clipped cards around `card`: `card` itself plus every card that shares a clip with it,
 * transitively ("Clips may chain"), sorted; `[card]` when it is in no clip (PLAN Milestone 6, owner decisions,
 * Paperclips, Rules). Added by M6-C.
 */
export function clipGroup(state: TableState, card: InstanceId): InstanceId[] {
  const clips = Object.values(state.clips ?? {});
  const seen = new Set<InstanceId>([card]);
  const todo: InstanceId[] = [card];
  while (todo.length) {
    const id = todo.pop()!;
    for (const c of clips) {
      if (!c.cards.includes(id)) continue;
      for (const other of c.cards) {
        if (seen.has(other)) continue;
        seen.add(other);
        todo.push(other);
      }
    }
  }
  return [...seen].sort();
}

/** Why a card rides along with a drag (PLAN Milestone 6, owner decisions, Carry rule). Added by M6-C. */
export type CarryReason =
  /** Cascaded on top of the grabbed card (later in its cascade pile; solitaire). */
  | 'cascade'
  /** In the grabbed card's squared pile (the bottom card takes the whole pile). */
  | 'squared'
  /** Attached to a carried card, recursively. */
  | 'attached'
  /** Clipped to a carried card, through any chain of clips. */
  | 'clip'
  /** Part of the multi-selection being dragged. */
  | 'selection';

/**
 * What one drag (or one keyboard move) moves (PLAN Milestone 6, owner decisions, Carry rule: "Dragging a card carries
 * every card riding on it: the cards cascaded on top of it … and every card attached to it, recursively"; Paperclips:
 * "the dragged set is the connected group of clipped cards plus everything riding on them"). The scene moves `cards`
 * rigidly with the anchor and dispatches one action per card with a shared `group` (one undo step). Added by M6-C.
 */
export interface DragGroup {
  /** The grabbed card. */
  anchor: InstanceId;
  /** Every card that moves, anchor first, then bottom to top in draw order; each once. */
  cards: InstanceId[];
  /** Why each card other than the anchor moves. */
  reason: Record<InstanceId, CarryReason>;
  /** The pile the anchor leaves (it was dragged out of the middle or top of a pile on its own), or null. */
  leavesPile: PileId | null;
  /** The host the anchor leaves (a card dragged off its host detaches; logged), or null. */
  leavesHost: InstanceId | null;
}

/** Options of `carryGroup`. Added by M6-C. */
export interface CarryOptions {
  /** The current multi-selection; when the anchor is in it, every selected battlefield card moves too, each with its riders. */
  selection?: readonly InstanceId[];
}

/**
 * The cards a drag of `anchor` carries (PLAN Milestone 6, owner decisions, Carry rule and Paperclips). Implementer:
 * M6-P1. Stub (M6-C): the anchor alone (no card when it does not exist); the scene keeps its M5 pile grab until M6-P1
 * replaces both.
 */
export function carryGroup(state: TableState, anchor: InstanceId, _opts: CarryOptions = {}): DragGroup {
  const card: CardInstance | undefined = Object.hasOwn(state.cards, anchor) ? state.cards[anchor] : undefined;
  return { anchor, cards: card ? [anchor] : [], reason: {}, leavesPile: null, leavesHost: null };
}
