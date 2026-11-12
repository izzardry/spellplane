/**
 * Shared fixtures for the list view and deck library tests: M19 card data from tests/fixtures/scryfall/m19.json and a
 * build as the builder table hands it over (DeckBuild with table positions, a dispensed basic, a foil, a deck order
 * that is not pool order).
 */
import type { CardRef, DeckBuild } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import { loadFixtureSet } from '../data/fakeScryfall';

export const M19: CardData[] = loadFixtureSet('m19.json');

/** The first M19 card of that exact name. */
export function m19(name: string): CardData {
  const c = M19.find((x) => x.name === name);
  if (!c) throw new Error(`no M19 fixture card named ${name}`);
  return c;
}

export const sid = (name: string): string => m19(name).id;

/** Card lookup over the M19 fixtures (what the page's CardDataSource.peek gives the list view). */
export function lookup(ref: CardRef): CardData | null {
  return M19.find((c) => c.id === ref.sid) ?? null;
}

/**
 * A drafted pool as the builder table leaves it: deck cards in the order they were dragged into the deck area, every
 * card with a table position, two Forests from the dispenser, one foil Shock, and the rest of the pool beside.
 */
export function tableBuild(): DeckBuild {
  const cards: DeckBuild['cards'] = [
    { id: 'p1', ref: { sid: sid('Llanowar Elves') } },
    { id: 'p2', ref: { sid: sid('Shock'), foil: true } },
    { id: 'p3', ref: { sid: sid('Divination') } },
    { id: 'p4', ref: { sid: sid('Draconic Disciple') } },
    { id: 'p5', ref: { sid: sid('Llanowar Elves') } },
    { id: 'p6', ref: { sid: sid('Sarkhan, Fireblood') } },
    { id: 'p7', ref: { sid: sid('Cancel') } },
    { id: 'p8', ref: { sid: sid('Meteor Golem') } },
    { id: 'p9', ref: { sid: sid('Detection Tower') } },
    { id: 'p10', ref: { sid: sid('Nicol Bolas, the Ravager // Nicol Bolas, the Arisen') } },
    { id: 'p11', ref: { sid: sid('Shock') } },
    { id: 'p12', ref: { sid: M19.find((c) => c.name === 'Forest')!.id } },
    { id: 'b1', ref: { sid: M19.find((c) => c.name === 'Forest')!.id }, basic: true },
    { id: 'b2', ref: { sid: M19.find((c) => c.name === 'Forest')!.id }, basic: true },
  ];
  const poses: NonNullable<DeckBuild['poses']> = {};
  cards.forEach((c, i) => (poses[c.id] = { x: -300 + 70 * i, y: i % 2 ? 120 : -120, rot: 0 }));
  return { cards, main: ['p6', 'p1', 'b1', 'p4', 'p2', 'p5', 'b2', 'p12'], poses };
}
