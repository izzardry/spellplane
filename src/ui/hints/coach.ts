/**
 * Gesture coach marks (PLAN M7-P5: "gesture coach marks that appear once at the moment an action becomes relevant
 * (first draw, first land, first attack) and never cover the play area"; docs/design/m7-hud-proposal.md, First-run
 * hints: "One coach mark at a time, anchored to the thing it explains … They disappear once you've done it"). Added by
 * M7-P5.
 *
 * A coach mark teaches a gesture, never a key. Each shows when its moment comes (the facts below), one at a time, and
 * is done for good, stored in `Settings.hintsSeen` like the first-run hints, once the player does what it teaches,
 * whether it was showing or not, or dismisses it. The life, next step and tilt marks belong to the HUD's plates, its
 * primary button and its tilt handle (M7-P2, M7-P3); this module never shows them, but keeps them seen once stored.
 */
import type { CardInstance, InstanceId, SeatId, TableState } from '../../core/types';
import type { CardData } from '../../data/types';
import type { CoachMarkId, HintId, SettingsStore } from '../../store/types';
import { COACH_MARK_IDS } from '../../store/types';
import { hintsSeenOf } from './hints';

/** The coach marks this module shows, in the order a newcomer meets them. */
export const TABLE_COACH_MARKS: readonly CoachMarkId[] = COACH_MARK_IDS.filter((id) => id !== 'coachLife' && id !== 'coachNextStep' && id !== 'coachTilt');

/** What the coach marks look at: the own table as this browser sees it, reduced to counts. */
export interface CoachFacts {
  /** A seat that plays (not a spectator, the match running). */
  playing: boolean;
  myTurn: boolean;
  library: number;
  hand: number;
  /** Own hand cards known to be lands. */
  handLands: number;
  /** Own battlefield cards, those that are lands, those tapped, and untapped creatures. */
  field: number;
  fieldLands: number;
  fieldTapped: number;
  fieldCreaturesReady: number;
  /** Own cards attacking now. */
  attacking: number;
  /** Cards selected now. */
  selected: number;
  /** A pile's actions are showing. */
  pileActions: boolean;
}

export const NO_FACTS: CoachFacts = { playing: false, myTurn: false, library: 0, hand: 0, handLands: 0, field: 0, fieldLands: 0, fieldTapped: 0, fieldCreaturesReady: 0, attacking: 0, selected: 0, pileActions: false };

/** Whether a card's type line says it is of `type` (front face; data from the card data source). */
function isType(data: CardData | null | undefined, type: string): boolean {
  const line = data?.type_line ?? data?.card_faces?.[0]?.type_line ?? '';
  return new RegExp(`\\b${type}\\b`, 'i').test(line);
}

/**
 * The facts for `seat` in `state`: `identity` gives the card data this browser may know (own hand from its secrets,
 * public cards from the state), never anything hidden from it.
 */
export function coachFacts(
  state: TableState,
  seat: SeatId | null,
  ctx: { identity(card: CardInstance): CardData | null; selected: readonly InstanceId[]; pileActions: boolean; spectator: boolean; myTurn: boolean },
): CoachFacts {
  if (seat === null || ctx.spectator || !state.seats[seat] || state.stage !== 'match') return { ...NO_FACTS };
  const zone = (kind: string) => state.zones[`${kind}:${seat}`]?.ids ?? [];
  const cardsOf = (kind: string) => zone(kind).map((id) => state.cards[id]).filter((c): c is CardInstance => !!c);
  const hand = cardsOf('hand');
  const field = cardsOf('battlefield').filter((c) => c.controller === seat);
  const data = (c: CardInstance) => ctx.identity(c);
  return {
    playing: true,
    myTurn: ctx.myTurn,
    library: zone('library').length,
    hand: hand.length,
    handLands: hand.filter((c) => isType(data(c), 'Land')).length,
    field: field.length,
    fieldLands: field.filter((c) => isType(data(c), 'Land')).length,
    fieldTapped: field.filter((c) => c.tapped).length,
    fieldCreaturesReady: field.filter((c) => !c.tapped && c.combat !== 'attack' && isType(data(c), 'Creature')).length,
    attacking: Object.values(state.cards).filter((c) => c.controller === seat && c.combat === 'attack').length,
    selected: ctx.selected.length,
    pileActions: ctx.pileActions,
  };
}

/** Whether a coach mark's moment has come. */
export function coachFits(id: CoachMarkId, f: CoachFacts): boolean {
  if (!f.playing) return false;
  switch (id) {
    case 'coachDraw':
      return f.library > 0 && f.hand === 0;
    case 'coachPlayLand':
      return f.myTurn && f.handLands > 0 && f.fieldLands === 0;
    case 'coachTap':
      return f.field > f.fieldTapped;
    case 'coachSelect':
      return f.field > 0 && f.selected === 0;
    case 'coachAttack':
      return f.myTurn && f.fieldCreaturesReady > 0;
    case 'coachPileActions':
      // Once the first cards are in play: the rarer pile actions come after the everyday gestures.
      return f.library > 0 && f.hand > 0 && f.field > 0 && !f.pileActions;
    default:
      return false;
  }
}

/** Whether the player just did what a coach mark teaches (from the facts before and after a change). */
export function coachDone(id: CoachMarkId, before: CoachFacts, after: CoachFacts): boolean {
  if (!before.playing || !after.playing) return false;
  switch (id) {
    case 'coachDraw':
      return after.hand > before.hand && after.library < before.library;
    case 'coachPlayLand':
      return after.fieldLands > before.fieldLands;
    case 'coachTap':
      return after.fieldTapped > before.fieldTapped;
    case 'coachSelect':
      return after.selected > 0 && before.selected === 0;
    case 'coachAttack':
      return after.attacking > before.attacking;
    case 'coachPileActions':
      return after.pileActions && !before.pileActions;
    default:
      return false;
  }
}

/** The coach mark to show: the first of TABLE_COACH_MARKS not seen whose moment has come, else null. */
export function nextCoach(seen: readonly string[], f: CoachFacts): CoachMarkId | null {
  return TABLE_COACH_MARKS.find((id) => !seen.includes(id) && coachFits(id, f)) ?? null;
}

/**
 * A coach mark's text: the gesture, by mouse or by finger, never a key (PLAN M7-P5: "no hint text teaches keys").
 * `anchor` names what it points at, so the HUD can place it near that thing.
 */
export function coachText(id: CoachMarkId, touch: boolean): { text: string; anchor: 'library' | 'hand' | 'field' | 'creature' } {
  const click = touch ? 'Tap' : 'Click';
  switch (id) {
    case 'coachDraw':
      return { text: `${click} your library to draw, or drag its top card into your hand.`, anchor: 'library' };
    case 'coachPlayLand':
      return { text: 'Drag a land from your hand onto the table to play it.', anchor: 'hand' };
    case 'coachTap':
      return { text: `${touch ? 'Double-tap' : 'Double-click'} a card to tap or untap it.`, anchor: 'field' };
    case 'coachSelect':
      return { text: `${click} a card for its actions: tap, flip, counters and more.`, anchor: 'field' };
    case 'coachAttack':
      return { text: 'Drag a creature toward your opponent to attack.', anchor: 'creature' };
    case 'coachPileActions':
      return { text: `${touch ? 'Tap' : 'Point at'} a pile for its actions: shuffle, search and more.`, anchor: 'library' };
    default:
      return { text: '', anchor: 'field' };
  }
}

/**
 * Which coach mark shows and which are done: reads `Settings.hintsSeen` once (none shows before, so a returning player
 * sees no flash), follows the facts, and stores a mark as done when its action happens or it is dismissed. Without a
 * settings store the marks last for the page.
 */
export class CoachController {
  private seen: HintId[] = [];
  private ready = false;
  private facts: CoachFacts = { ...NO_FACTS };
  private shown: CoachMarkId | null = null;
  private readonly listeners = new Set<(id: CoachMarkId | null) => void>();

  constructor(private readonly settings: SettingsStore | null | undefined) {}

  /** The coach mark showing now, or null. */
  current(): CoachMarkId | null {
    return this.shown;
  }

  /** The coach marks done or dismissed. */
  done(): CoachMarkId[] {
    return COACH_MARK_IDS.filter((id) => this.seen.includes(id));
  }

  subscribe(fn: (id: CoachMarkId | null) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async load(): Promise<void> {
    let stored: unknown;
    try {
      stored = (await this.settings?.get('hintsSeen')) ?? [];
    } catch {
      stored = [];
    }
    this.seen = [...new Set([...hintsSeenOf(stored), ...this.seen])];
    this.ready = true;
    this.refresh();
  }

  /** The table changed: marks whose action happened are done; the next one whose moment came shows. */
  update(next: CoachFacts): void {
    const before = this.facts;
    this.facts = next;
    const did = TABLE_COACH_MARKS.filter((id) => !this.seen.includes(id) && coachDone(id, before, next));
    if (did.length) this.markSeen(did);
    this.refresh();
  }

  /** The player dismissed the mark showing (or any mark): it never shows again in this profile. */
  dismiss(id: CoachMarkId): void {
    this.markSeen([id]);
    this.refresh();
  }

  private markSeen(ids: readonly CoachMarkId[]): void {
    const fresh = ids.filter((id) => !this.seen.includes(id));
    if (fresh.length === 0) return;
    this.seen = [...this.seen, ...fresh];
    void this.store();
  }

  private async store(): Promise<void> {
    if (!this.settings) return;
    try {
      // Merge with what is stored: the first-run hints (ui/hints/hints.ts) write the same list.
      const stored = hintsSeenOf(await this.settings.get('hintsSeen'));
      await this.settings.set('hintsSeen', [...new Set([...stored, ...this.seen])]);
    } catch {
      // Not stored: done for this page.
    }
  }

  private refresh(): void {
    const next = this.ready ? nextCoach(this.seen, this.facts) : null;
    if (next === this.shown) return;
    this.shown = next;
    for (const fn of [...this.listeners]) fn(next);
  }
}
