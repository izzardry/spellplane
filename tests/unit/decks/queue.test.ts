/** Queue entry (decks.md section 7, D21; PLAN M8-P3 unit acceptance): incomplete, copies, ok. */
import { describe, expect, it } from 'vitest';
import { averageInfo, queueEligibility } from '../../../src/data/deck/queue';
import { summarise } from '../../../src/data/deck/summary';
import type { DeckRecord } from '../../../src/store/types';
import { customDeck, decklist, lookup, ref, times } from './fixture-decks';

const withSummary = (d: DeckRecord): DeckRecord => ({ ...d, summary: summarise(d, lookup) });

describe('queueEligibility', () => {
  it('answers ok for the GW fixture deck with its six facts', async () => {
    const { main } = await decklist('gw-m19-60.txt');
    const r = queueEligibility(withSummary(customDeck(main)));
    expect(r).toEqual({ ok: true, info: { kind: 'custom', size: 60, cards: 60, strength: 40, band: 'casual', v: 1 } });
  });

  it('answers incomplete below the size', async () => {
    const { main } = await decklist('gw-m19-60.txt');
    expect(queueEligibility(withSummary(customDeck(main.slice(0, 50))))).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('answers copies above four copies of a card that is not a basic land', async () => {
    const { main } = await decklist('gw-m19-60.txt');
    const five = [...main.slice(0, 55), ...times(5, ref('Shock'))];
    expect(queueEligibility(withSummary(customDeck(five)))).toEqual({ ok: false, reason: 'copies' });
  });

  it('answers opening for boosters not yet shown, and noStrength without card data', () => {
    const opening = customDeck(times(40, ref('Shock')), { kind: 'sealed', size: 40, seal: { via: 'packs', sets: ['M19', 'M19'], pool: [], sealedAt: 1, revealed: 1 } });
    expect(queueEligibility(opening)).toEqual({ ok: false, reason: 'opening' });
    const unknown = customDeck(times(60, { sid: 'nope' }));
    expect(queueEligibility({ ...unknown, summary: summarise(unknown, () => null) })).toEqual({ ok: false, reason: 'noStrength' });
    expect(averageInfo(unknown, 1)).toEqual({ kind: 'custom', size: 60, cards: 60, strength: 50, band: 'solid', v: 1 });
  });
});
