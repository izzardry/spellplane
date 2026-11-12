/**
 * Ready, the lock and the dispenser's printings (DESIGN "Pre-game: draft, sealed and deck building", Deck building:
 * "Ready locks the deck and publishes its commitment (see Multiplayer architecture)"; "a basic-land dispenser hands out
 * unlimited basics of any chosen printing"). Ready goes through TableSession.importDeck, the M1 commitment path.
 */
import { describe, expect, it } from 'vitest';
import type { DeckBuild, TableState } from '../../../src/core/types';
import type { CardData, SetDataSource } from '../../../src/data/types';
import { mtg } from '../../../src/games/index';
import { createSoloSession } from '../../../src/session/solo';
import { basicPrintings, deckImportOf, dispensedCount, isLocked, originOf, returnBasic } from '../../../src/ui/builder/model';
import { harnessSets } from '../../../src/ui/builder/harness';
import { FakeCardData } from '../../../src/ui/fakes';
import { buildOf, lookup, M19, sid } from './helpers';

describe('Ready commits the deck (DESIGN: Ready locks the deck and publishes its commitment)', () => {
  it('the library is the main deck in deck order, the sideboard the rest of the pool without dispensed basics', () => {
    const b = buildOf(['Shock*', 'Divination', 'Llanowar Elves', '+Forest', '+Forest', 'Forest'], ['p3', 'b4', 'p1', 'gone', 'p3']);
    expect(deckImportOf(b)).toEqual({
      main: [{ sid: sid('Llanowar Elves') }, { sid: sid('Forest') }, { sid: sid('Shock'), foil: true }],
      side: [{ sid: sid('Divination') }, { sid: sid('Forest') }],
    });
  });

  it('through the session it publishes a commitment for every deck card and locks the builder', async () => {
    const data = new FakeCardData(M19);
    const session = await createSoloSession({ game: mtg, cardData: data });
    const b = buildOf(['Shock', 'Llanowar Elves', 'Divination', '+Forest'], ['p1', 'p2', 'b4']);
    expect(isLocked(session.getState(), session.seat)).toBe(false);
    await session.importDeck(deckImportOf(b));
    const st = session.getState();
    expect(st.commitments[session.seat]?.commits).toHaveLength(3);
    expect(isLocked(st, session.seat)).toBe(true);
    // Identities stay in this browser: the shared state names none of the deck's cards.
    const shared = JSON.stringify(st);
    for (const name of ['Shock', 'Llanowar Elves', 'Forest']) expect(shared).not.toContain(sid(name));
    expect(Object.values(session.secrets().identities).map((i) => i.card.sid).sort()).toEqual([sid('Shock'), sid('Llanowar Elves'), sid('Forest')].sort());
    expect(session.secrets().pool).toEqual([{ sid: sid('Divination') }]);
    session.dispose();
  });

  it('names where a drafted pool came from', () => {
    const state = { draft: { settings: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19', 'M19', 'M20'] } } as unknown as TableState;
    expect(originOf(state)).toEqual({ format: 'pass', sets: ['M19', 'M19', 'M20'] });
    expect(originOf({} as TableState)).toBeUndefined();
  });
});

describe('the dispenser\'s printings', () => {
  const data = () => new FakeCardData(M19);

  it('offers every printing of the pool\'s sets by collector number, the first as default', async () => {
    const p = await basicPrintings({ build: buildOf(['Shock']), sets: ['M19'], cardData: data(), setData: harnessSets(M19) });
    expect(p.Plains.map((x) => x.label)).toEqual(['M19 #261', 'M19 #262', 'M19 #263', 'M19 #264']);
    expect(p.Forest.map((x) => x.label)).toEqual(['M19 #277', 'M19 #278', 'M19 #279', 'M19 #280']);
    expect(p.Island[0]!.ref).toEqual({ sid: M19.find((c) => c.name === 'Island')!.id });
  });

  it('without set data, offers the printings in the pool, then one resolved printing for every other basic', async () => {
    const forest = M19.filter((c) => c.name === 'Forest')[2]!;
    const b: DeckBuild = { cards: [{ id: 'p1', ref: { sid: forest.id } }, { id: 'p2', ref: { sid: sid('Shock') } }], main: [] };
    const p = await basicPrintings({ build: b, sets: [], cardData: data() });
    expect(p.Forest.map((x) => x.label)).toEqual([`M19 #${forest.collector_number}`]);
    for (const n of ['Plains', 'Island', 'Swamp', 'Mountain'] as const) expect(p[n]).toHaveLength(1);
  });

  it('a set without data (or failing) does not block the rest', async () => {
    const broken: SetDataSource = { listSets: () => Promise.resolve([]), get: () => Promise.reject(new Error('offline')), peek: () => null };
    const p = await basicPrintings({ build: buildOf(['Island']), sets: ['XYZ'], cardData: data(), setData: broken });
    expect(p.Island.length).toBeGreaterThanOrEqual(1);
    expect(p.Plains).toHaveLength(1);
  });

  it('counts basics of a name in the deck and hands back the latest dispensed copy, never a drafted one', () => {
    const b = buildOf(['Forest', '+Forest', '+Forest', 'Island'], ['p1', 'b2', 'b3']);
    expect(dispensedCount(b, 'Forest', lookup)).toBe(3);
    const one = returnBasic(b, 'Forest', lookup);
    expect(one.cards.map((c) => c.id)).toEqual(['p1', 'b2', 'p4']);
    expect(one.main).toEqual(['p1', 'b2']);
    const two = returnBasic(one, 'Forest', lookup);
    const three = returnBasic(two, 'Forest', lookup);
    // The drafted Forest stays in the deck: only a move takes it out.
    expect(three).toBe(two);
    expect(three.main).toEqual(['p1']);
    expect(returnBasic(b, 'Island', lookup)).toBe(b);
  });
});

describe('cards whose data is loading', () => {
  it('Ready commits them by Scryfall id all the same', () => {
    const b: DeckBuild = { cards: [{ id: 'x', ref: { sid: 'unknown-sid' } }], main: ['x'] };
    expect(deckImportOf(b)).toEqual({ main: [{ sid: 'unknown-sid' }], side: [] });
    const none = (): CardData | null => null;
    expect(dispensedCount(b, 'Forest', none)).toBe(0);
  });
});
