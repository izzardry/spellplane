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
  /**
   * Whether pile riders come along (default true). False for temporary moves (Alt+drag, attack, block): a card displaced
   * temporarily leaves its pile singly, as before M6, so Settle never has to rebuild a pile; attachments and clipped
   * cards still travel with it (PLAN Milestone 6, owner decisions, Combat and Settle). Added by M6-P1.
   */
  piles?: boolean;
}

const own = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);

/** Whether a card is on a battlefield (a public zone of kind 'battlefield'). */
function onBattlefield(state: TableState, c: CardInstance): boolean {
  const z = own(state.zones, c.zone);
  return !!z && z.visibility === 'public' && z.kind === 'battlefield';
}

const byIdOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The cards a drag of `anchor` carries (PLAN Milestone 6, owner decisions, Carry rule and Paperclips): the anchor; with
 * it, when it is part of the selection, every selected battlefield card; and, recursively from every card taken, the
 * cards cascaded on top of it (later in its cascade; from the bottom card, the whole pile; in a squared pile the cards
 * above it), every card attached to it, and every card clipped to it. Only battlefield cards ride along; a card
 * elsewhere (hand, stack, a pile zone) moves alone. Pure and deterministic. Implementer: M6-P1.
 */
export function carryGroup(state: TableState, anchor: InstanceId, opts: CarryOptions = {}): DragGroup {
  const card = own(state.cards, anchor);
  if (!card) return { anchor, cards: [], reason: {}, leavesPile: null, leavesHost: null };
  if (!onBattlefield(state, card)) return { anchor, cards: [anchor], reason: {}, leavesPile: null, leavesHost: null };
  const all = Object.keys(state.cards).sort(byIdOrder).map((id) => state.cards[id]!);
  const piles = new Map<PileId, CardInstance[]>();
  const hosted = new Map<InstanceId, InstanceId[]>();
  for (const c of all) {
    if (!onBattlefield(state, c)) continue;
    if (c.pile) piles.set(c.pile.id, [...(piles.get(c.pile.id) ?? []), c]);
    if (c.attachedTo !== undefined) hosted.set(c.attachedTo, [...(hosted.get(c.attachedTo) ?? []), c.id]);
  }
  for (const ms of piles.values()) ms.sort((a, b) => a.pile!.index - b.pile!.index || byIdOrder(a.id, b.id));
  const clips = Object.keys(state.clips ?? {})
    .sort(byIdOrder)
    .map((id) => state.clips![id]!);

  const taken = new Set<InstanceId>([anchor]);
  const reason: Record<InstanceId, CarryReason> = {};
  const queue: InstanceId[] = [anchor];
  const add = (id: InstanceId, why: CarryReason): void => {
    if (taken.has(id)) return;
    const c = own(state.cards, id);
    if (!c || !onBattlefield(state, c)) return;
    taken.add(id);
    reason[id] = why;
    queue.push(id);
  };
  if (opts.selection?.includes(anchor)) for (const id of [...opts.selection].sort(byIdOrder)) add(id, 'selection');
  for (let i = 0; i < queue.length; i++) {
    const c = state.cards[queue[i]!]!;
    if (opts.piles !== false && c.pile) {
      for (const m of piles.get(c.pile.id) ?? []) if (m.pile!.index > c.pile.index) add(m.id, c.pile.kind === 'cascade' ? 'cascade' : 'squared');
    }
    for (const a of hosted.get(c.id) ?? []) add(a, 'attached');
    for (const clip of clips) if (clip.cards.includes(c.id)) for (const o of clip.cards) add(o, 'clip');
  }

  const zoneRank = new Map<InstanceId, [string, number]>();
  for (const id of taken) {
    const c = state.cards[id]!;
    zoneRank.set(id, [c.zone, own(state.zones, c.zone)?.ids.indexOf(id) ?? -1]);
  }
  const rest = [...taken]
    .filter((id) => id !== anchor)
    .sort((a, b) => {
      const ra = zoneRank.get(a)!;
      const rb = zoneRank.get(b)!;
      return byIdOrder(ra[0], rb[0]) || ra[1] - rb[1] || byIdOrder(a, b);
    });
  const base = card.pile ? (piles.get(card.pile.id) ?? [])[0] : undefined;
  return {
    anchor,
    cards: [anchor, ...rest],
    reason,
    leavesPile: card.pile && base && !taken.has(base.id) ? card.pile.id : null,
    leavesHost: card.attachedTo !== undefined && !taken.has(card.attachedTo) ? card.attachedTo : null,
  };
}
