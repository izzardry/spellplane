/**
 * M8-P2: SOLO · ALONE deals the selected deck into its practice table (journey.md 4.1 "the selected deck is imported,
 * shuffled, seven cards are dealt and the table opens"; contracts.md Part D `importIfNeeded`, `dealOpening`), and the
 * kept setup of a new private or draft table is applied once by the table route.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { mtg } from '../../../src/games/index';
import { createSoloSession } from '../../../src/session/index';
import type { TableSession } from '../../../src/session/types';
import { createGameStore } from '../../../src/store/games';
import { DEFAULT_HOME_PREFS, type DeckRecord } from '../../../src/store/types';
import { applyPendingSetup, launchSolo, savePendingSetup, type LaunchDeps } from '../../../src/ui/play/launch';
import { cardSource, closeStores, deckA, stores } from '../session/helpers';
import { sampleState } from '../store/helpers';

afterEach(() => closeStores());

describe('SOLO · ALONE with the page opener', () => {
  it('turns on the automatic setup, imports the deck and deals seven cards once; the route reopens it from the store', async () => {
    const s = await stores();
    const games = createGameStore(s.db);
    const opened: TableSession[] = [];
    const open = async (roomId: string): Promise<TableSession> => {
      const session = await createSoloSession({ game: mtg, cardData: cardSource, roomId, store: s.tables });
      opened.push(session);
      return session;
    };
    const a = await deckA();
    const deck: DeckRecord = { id: 'gw', name: 'GW Fixture', main: a.main, side: a.side, source: 'pasted', kind: 'custom', createdAt: 1, updatedAt: 1 };
    const went: string[] = [];
    const deps: LaunchDeps = {
      games,
      decks: null,
      settings: null,
      go: (h) => void went.push(h),
      toast: () => undefined,
      now: () => 5000,
      newRoom: () => ({ roomId: 'x', roomKey: 'y' }),
      newPracticeId: () => 'p-practice01',
      openPractice: open,
    };
    expect(await launchSolo(deps, { ...DEFAULT_HOME_PREFS, solo: { opponent: 'alone' } }, deck, 'alone')).toBe('#/p/p-practice01');
    expect(went).toEqual(['#/p/p-practice01']);
    // The launcher closed its session before the route opens the table.
    expect(opened).toHaveLength(1);

    const again = await open('p-practice01');
    const st = again.getState();
    expect(st.settings.autoSetup).toBe(true);
    expect(st.zones[`hand:${again.seat}`]!.ids).toHaveLength(7);
    expect(st.zones[`library:${again.seat}`]!.ids).toHaveLength(53);
    expect(st.seats[again.seat]!.dealt).toBe(st.games ?? 0);
    expect(await games.get('p-practice01')).toMatchObject({ kind: 'solo', opponent: 'dummy', deck: { id: 'gw', name: 'GW Fixture' } });
    again.dispose();
  });
});

describe('applyPendingSetup', () => {
  function fake(stage: 'lobby' | 'match') {
    const st = sampleState();
    st.stage = stage;
    st.format = '1v1';
    st.settings = { ...st.settings, autoSetup: false };
    const sent: Action[] = [];
    return { sent, session: { roomId: 'amber-fox-river-12', getState: () => st, dispatch: (a: Action) => (sent.push(a), a) } as unknown as TableSession };
  }
  const memory = () => {
    const m = new Map<string, string>();
    return { setItem: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
  };

  it('applies autoSetup, the format with its starting life and the lobby settings, once', () => {
    const store = memory();
    savePendingSetup('amber-fox-river-12', { format: 'ffa4', autoSetup: true, lobby: { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false } }, store);
    const { session, sent } = fake('lobby');
    expect(applyPendingSetup(session, store)).toBe(true);
    expect(sent.map((a) => a.type)).toEqual(['settings', 'formatSet', 'lobbySet']);
    expect(sent[0]).toMatchObject({ settings: { autoSetup: true } });
    expect(sent[1]).toMatchObject({ format: 'ffa4', life: 20 });
    expect(sent[2]).toMatchObject({ lobby: { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'] } });
    expect(applyPendingSetup(session, store)).toBe(false);
    expect(sent).toHaveLength(3);
  });

  it('does nothing for a room without a kept setup or past its lobby', () => {
    const store = memory();
    const { session, sent } = fake('match');
    expect(applyPendingSetup(session, store)).toBe(false);
    savePendingSetup('amber-fox-river-12', { format: '1v1', autoSetup: true, lobby: { draft: null, sets: ['M19'], pickTimer: false } }, store);
    expect(applyPendingSetup(session, store)).toBe(false);
    expect(sent).toEqual([]);
  });
});
