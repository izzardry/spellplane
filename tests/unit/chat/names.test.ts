/**
 * PLAN M1-P6: `[[card name]]` previews resolve through the card data source (DESIGN "Chat and voice", Text chat; card
 * data from the recorded fixtures, never the network).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData, CardDataSource, DeckList } from '../../../src/data/types';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import { CardNameResolver } from '../../../src/ui/chat/names';

const FIXTURES = fileURLToPath(new URL('../../fixtures/scryfall', import.meta.url));
const cards = ['m19.json', 'm20.json', 'tm19.json'].flatMap((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as CardData[]);
const byName = (name: string, set: string) => cards.find((c) => c.name === name && c.set === set)!;

describe('CardNameResolver', () => {
  it('finds a card by its exact name, ignoring case and extra spaces, through resolveDeck', async () => {
    const r = new CardNameResolver(new FixtureCardDataSource(cards));
    const shock = byName('Shock', 'm19');
    expect(await r.resolve('Shock')).toEqual({ status: 'found', ref: { sid: shock.id }, card: shock });
    expect(await r.resolve('  sHoCk ')).toMatchObject({ status: 'found', ref: { sid: shock.id } });
    expect(await r.resolve('ajani,  adversary of tyrants')).toMatchObject({ status: 'found', card: { name: 'Ajani, Adversary of Tyrants' } });
  });

  it('a front-face name finds a double-faced card', async () => {
    const r = new CardNameResolver(new FixtureCardDataSource(cards));
    expect(await r.resolve('Nicol Bolas, the Ravager')).toMatchObject({ status: 'found', card: { name: 'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen' } });
  });

  it('a set hint picks that printing; a hint that matches nothing still finds the card by name', async () => {
    const r = new CardNameResolver(new FixtureCardDataSource(cards));
    expect(await r.resolve('Epicure of Blood', 'm20')).toMatchObject({ status: 'found', ref: { sid: byName('Epicure of Blood', 'm20').id } });
    expect(await r.resolve('Epicure of Blood', 'm19')).toMatchObject({ status: 'found', ref: { sid: byName('Epicure of Blood', 'm19').id } });
    expect(await r.resolve('Shock', 'zzz')).toMatchObject({ status: 'found', ref: { sid: byName('Shock', 'm19').id } });
  });

  it('an unknown name is missing, with near matches when the source has them; tokens are not cards', async () => {
    const r = new CardNameResolver(new FixtureCardDataSource(cards));
    const miss = await r.resolve('Leonin Warleeder');
    expect(miss.status).toBe('missing');
    if (miss.status === 'missing') expect(miss.nearMatches).toContain('Leonin Warleader');
    expect((await r.resolve('Grizzly Bears')).status).toBe('missing');
  });

  it('asks the source once per name (case-insensitive), also while a lookup is in flight; peek answers once known', async () => {
    const source = new FixtureCardDataSource(cards);
    const spy = vi.spyOn(source, 'resolveDeck');
    const r = new CardNameResolver(source);
    expect(r.peek('Shock')).toBeNull();
    const [a, b] = await Promise.all([r.resolve('Shock'), r.resolve('shock')]);
    expect(a).toEqual(b);
    await r.resolve('SHOCK');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.peek('shock')).toEqual(a);
    await r.resolve('Nope Card');
    await r.resolve('nope card');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('never rejects; a failed lookup is missing and is asked again on the next hover', async () => {
    let fail = true;
    const shock = byName('Shock', 'm19');
    const source = {
      resolveDeck: vi.fn(async (list: DeckList) => {
        if (fail) throw new Error('offline');
        return { main: list.main.map(() => ({ sid: shock.id })), side: [], cards: { [shock.id]: shock }, errors: [] };
      }),
    } as unknown as CardDataSource;
    const r = new CardNameResolver(source);
    expect(await r.resolve('Shock')).toEqual({ status: 'missing', nearMatches: [] });
    expect(r.peek('Shock')).toBeNull();
    fail = false;
    expect(await r.resolve('Shock')).toMatchObject({ status: 'found', ref: { sid: shock.id } });
    expect(source.resolveDeck).toHaveBeenCalledTimes(2);
  });
});
