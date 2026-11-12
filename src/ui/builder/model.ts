/**
 * The builder container's model (DESIGN "Pre-game: draft, sealed and deck building", Deck building): Ready's deck,
 * the lock, the basic-land dispenser's printings and counts. Pure apart from `basicPrintings`, which reads card and
 * set data. Implementer: M2-P5.
 */
import type { CardRef, DeckBuild, SeatId, SetCode, TableState } from '../../core/types';
import type { CardData, CardDataSource, DeckEntry, SetDataSource } from '../../data/types';
import type { DeckImport } from '../../session/types';
import type { DeckRecord } from '../../store/types';
import { moveToPool } from './list/model';

/**
 * What Ready commits (DESIGN "Pre-game", Deck building: "Ready locks the deck and publishes its commitment"): the main
 * deck in deck order as the library, every other pool card as the sideboard (dispensed basics outside the deck are
 * back in the dispenser, so they are not part of the sideboard). Deck ids the pool lacks and repeats are skipped.
 */
export function deckImportOf(build: DeckBuild): DeckImport {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const ref = (r: CardRef): CardRef => (r.foil ? { sid: r.sid, foil: true } : { sid: r.sid });
  const seen = new Set<string>();
  const main: CardRef[] = [];
  for (const id of build.main) {
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    seen.add(id);
    main.push(ref(c.ref));
  }
  const side = build.cards.filter((c) => !seen.has(c.id) && !c.basic).map((c) => ref(c.ref));
  return { main, side };
}

/** The seat has committed its deck (Ready): the builder is locked until the next return to the builder. */
export function isLocked(state: TableState, seat: SeatId): boolean {
  return !!state.seats[seat]?.ready || !!state.commitments?.[seat];
}

/** Where the pool came from, for the deck library (M2-P6 `origin`): the draft's format and its set per pack. */
export function originOf(state: TableState): DeckRecord['origin'] | undefined {
  const d = state.draft;
  if (!d) return undefined;
  return { format: d.settings.format, sets: [...d.sets] };
}

/** The basic lands the dispenser hands out, in WUBRG order. */
export const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type BasicName = (typeof BASIC_NAMES)[number];

/** A basic land card (front type line "Basic … Land"). */
export function isBasicLandCard(card: CardData): boolean {
  const t = (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split(' // ')[0]!;
  return /\bBasic\b/.test(t) && /\bLand\b/.test(t);
}

/** Which of the five basics a card is, else null. */
export function basicNameOf(card: CardData | null): BasicName | null {
  if (!card || !isBasicLandCard(card)) return null;
  return BASIC_NAMES.find((n) => card.name === n) ?? null;
}

/** One printing the dispenser offers. */
export interface BasicPrinting {
  ref: CardRef;
  /** "M19 #261". */
  label: string;
}

export type BasicPrintings = Record<BasicName, BasicPrinting[]>;

export function emptyPrintings(): BasicPrintings {
  return { Plains: [], Island: [], Swamp: [], Mountain: [], Forest: [] };
}

function printingOf(card: CardData): BasicPrinting {
  return { ref: { sid: card.id }, label: `${card.set.toUpperCase()} #${card.collector_number}` };
}

const collector = (n: string): number => {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
};

/**
 * The printings the dispenser offers per basic (DESIGN "Pre-game", Deck building: "unlimited basics of any chosen
 * printing"): every printing of the pool's sets (from the set data, by collector number), then the printings found in
 * the pool itself, then one printing per name resolved through the card data source (with the pool's first set, else
 * Scryfall's default) so every basic has at least one printing. The first entry is the default choice.
 */
export async function basicPrintings(opts: { build: DeckBuild; sets: readonly SetCode[]; cardData: CardDataSource; setData?: SetDataSource | undefined }): Promise<BasicPrintings> {
  const out = emptyPrintings();
  const seen = new Set<string>();
  const add = (card: CardData | null | undefined) => {
    const name = basicNameOf(card ?? null);
    if (!card || !name || seen.has(card.id)) return;
    seen.add(card.id);
    out[name].push(printingOf(card));
  };
  // 1. The pool's sets.
  if (opts.setData) {
    const ids: { sid: string; set: number; number: number }[] = [];
    for (const [i, code] of [...new Set(opts.sets)].entries()) {
      let data = opts.setData.peek(code);
      if (!data) data = await opts.setData.get(code).catch(() => null);
      if (!data) continue;
      for (const c of Object.values(data.cards)) {
        if (!(BASIC_NAMES as readonly string[]).includes(c.name) || !(c.types ?? []).includes('Land')) continue;
        ids.push({ sid: c.scryfallId, set: i, number: collector(c.number) });
      }
    }
    ids.sort((a, b) => a.set - b.set || a.number - b.number);
    const unique = [...new Set(ids.map((x) => x.sid))];
    if (unique.length) {
      const found = await opts.cardData.getMany(unique).catch(() => ({}) as Record<string, CardData>);
      for (const sid of unique) add(found[sid] ?? opts.cardData.peek(sid));
    }
  }
  // 2. Printings in the pool.
  const poolSids = [...new Set(opts.build.cards.map((c) => c.ref.sid))];
  const missing = poolSids.filter((s) => !opts.cardData.peek(s));
  if (missing.length) await opts.cardData.getMany(missing).catch(() => ({}));
  for (const sid of poolSids) add(opts.cardData.peek(sid));
  // 3. One printing per name that still has none.
  const lacking = BASIC_NAMES.filter((n) => out[n].length === 0);
  if (lacking.length) {
    const set = opts.sets[0];
    const entries: DeckEntry[] = lacking.map((name, i) => ({ count: 1, name, section: 'main', line: i + 1, ...(set ? { set: set.toLowerCase() } : {}) }));
    const resolved = await opts.cardData.resolveDeck({ main: entries, side: [], commander: [], companion: [] }).catch(() => null);
    for (const card of Object.values(resolved?.cards ?? {})) add(card);
  }
  return out;
}

/** Dispensed basics of a name in the deck (the dispenser's count). */
export function dispensedCount(build: DeckBuild, name: BasicName, card: (ref: CardRef) => CardData | null): number {
  const inMain = new Set(build.main);
  return build.cards.filter((c) => inMain.has(c.id) && basicNameOf(card(c.ref)) === name).length;
}

/**
 * Hand one basic of a name back to the dispenser: the most recently added dispensed copy in the deck (drafted copies
 * stay: they go to the sideboard only by a move). Returns the build unchanged when there is none.
 */
export function returnBasic(build: DeckBuild, name: BasicName, card: (ref: CardRef) => CardData | null): DeckBuild {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const id = [...build.main].reverse().find((m) => {
    const c = byId.get(m);
    return !!c?.basic && basicNameOf(card(c.ref)) === name;
  });
  return id ? moveToPool(build, [id]) : build;
}
