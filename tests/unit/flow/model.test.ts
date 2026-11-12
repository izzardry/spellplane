/**
 * The evening bar's words and offers (ui/flow/model.ts) and the session's builder helpers (session/draft.ts), against
 * DESIGN "Specification: card data, packs and draft formats", Evening stages, and "Pre-game", Deck building.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { createDraftState } from '../../../src/core/drafting';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { STAGE_ROUND_LABELS } from '../../../src/core/stage';
import type { CardRef, DeckBuild, LobbySettings, SecretStore, SeatId, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import { deckImportOf } from '../../../src/session/deck-build';
import { buildFromDeck, buildFromPool, staleDraftSecrets, withLatePicks } from '../../../src/session/draft';
import { buildFromDeckRecord, deckRecordFromBuild } from '../../../src/store/decks';
import { draftStart, openProposal, proposals, stageStatus } from '../../../src/ui/flow/model';

let cid = 0;
function ok(s: TableState, by: SeatId, a: ActionDraft): TableState {
  const action = { ...a, by, cid: `m${++cid}`, seq: s.seq + 1 } as Action;
  expect(explain(s, action)).toBeNull();
  return reduce(s, action);
}

function table(names: string[]): TableState {
  const formats = { 2: '1v1', 3: 'ffa3', 4: 'ffa4' } as const;
  return createTable({ game: mtg, format: formats[names.length as 2 | 3 | 4], seats: names.map((name, i) => ({ name, colour: i, peer: `p${i}` })) });
}

const lobby = (l: Partial<LobbySettings>): LobbySettings => ({ draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false, ...l });

function inBuild(): TableState {
  let s = ok(ok(table(['Anna', 'Ben']), 's0', { type: 'lobbySet', lobby: lobby({}) }), 's0', { type: 'stageSet', stage: 'draft' });
  s = { ...s, draft: { ...s.draft!, done: true } };
  return ok(s, 's0', { type: 'stageSet', stage: 'build' });
}

const ready = (s: TableState, seat: SeatId): TableState => ok(s, seat, { type: 'ready', commits: ['h'], instanceIds: [`${seat}-x`], zone: `library:${seat}` });

describe('the lobby’s draft start', () => {
  it('only the host may press it, once the seated count suits the mode', () => {
    let s = ok(table(['Anna', 'Ben', 'Cleo']), 's0', { type: 'lobbySet', lobby: lobby({ draft: { format: 'winston', packs: 6 } }) });
    expect(draftStart(s, 's0')).toEqual({ label: 'Start the Winston draft', problem: 'This mode is for 2 players, and 3 are seated.' });
    s = ok(s, 's0', { type: 'lobbySet', lobby: lobby({ draft: { format: 'sealed', packs: 6 } }) });
    expect(draftStart(s, 's0')).toEqual({ label: 'Open the sealed pools', problem: null });
    expect(draftStart(s, 's1')).toEqual({ label: 'Open the sealed pools', problem: 'Waiting for Anna to start.' });
    expect(draftStart(s, null)!.problem).toBe('Waiting for Anna to start.');
  });

  it('is absent for constructed decks and outside the lobby', () => {
    expect(draftStart(ok(table(['Anna', 'Ben']), 's0', { type: 'lobbySet', lobby: lobby({ draft: null }) }), 's0')).toBeNull();
    expect(draftStart(inBuild(), 's0')).toBeNull();
  });
});

describe('the evening bar', () => {
  it('build: who is not Ready yet', () => {
    let s = inBuild();
    expect(stageStatus(s, 's0')).toBe('Build your deck and press Ready (also waiting for Ben).');
    s = ready(s, 's0');
    expect(stageStatus(s, 's0')).toBe('Waiting for Ben to press Ready.');
    expect(stageStatus(s, 's1')).toBe('Build your deck and press Ready.');
    expect(stageStatus(ready(s, 's1'), 's1')).toBe('Everyone is Ready: the game starts.');
  });

  it('offers next game and new draft in a match, a new draft in the builder, nothing while a proposal is open', () => {
    const b = inBuild();
    expect(proposals(b, 's0')).toEqual(['newDraft']);
    const m = ok(ready(ready(b, 's0'), 's1'), 's0', { type: 'stageSet', stage: 'match' });
    expect(proposals(m, 's1')).toEqual(['nextGame', 'newDraft']);
    expect(proposals(m, null)).toEqual([]);
    const asked = ok(m, 's1', { type: 'ask', round: 'r1', label: STAGE_ROUND_LABELS.nextGame });
    expect(proposals(asked, 's0')).toEqual([]);
    expect(openProposal(asked)).toEqual({ event: 'nextGame', round: 'r1', by: 's1', byName: 'Ben', waiting: ['s0'], held: false, passed: false });
    expect(stageStatus(asked, 's1')).toBe('You proposed the next game; waiting for Anna.');
    expect(stageStatus(asked, 's0')).toBe('Ben proposed the next game; waiting for you.');
    const held = ok(asked, 's0', { type: 'respond', round: 'r1', seat: 's0', response: 'hold' });
    expect(openProposal(held)!.held).toBe(true);
    expect(stageStatus(held, 's1')).toBe('You proposed the next game; someone is holding.');
    const passed = ok(asked, 's0', { type: 'respond', round: 'r1', seat: 's0', response: 'ok' });
    expect(stageStatus(passed, 's0')).toBe('Everyone agreed to the next game.');
    // A round about something else is not a proposal.
    expect(openProposal(ok(m, 's0', { type: 'ask', round: 'r2', label: 'attacks?' }))).toBeNull();
  });
});

describe('the deck being built', () => {
  const pool: CardRef[] = [{ sid: 'a' }, { sid: 'b', foil: true }, { sid: 'a' }];

  it('starts from the pool with everything in the sideboard, ids by pick order', () => {
    expect(buildFromPool(pool)).toEqual({ cards: [{ id: 'p1', ref: { sid: 'a' } }, { id: 'p2', ref: { sid: 'b', foil: true } }, { id: 'p3', ref: { sid: 'a' } }], main: [] });
  });

  it('takes picks that reach the pool late into the sideboard, and nothing twice', () => {
    const b: DeckBuild = { ...buildFromPool(pool.slice(0, 2)), main: ['p2'], poses: { p2: { x: 1, y: 2, rot: 0 } } };
    const later = withLatePicks(b, pool);
    expect(later.cards.map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
    expect(later.main).toEqual(['p2']);
    expect(later.poses).toEqual(b.poses);
    expect(withLatePicks(later, pool)).toBe(later);
  });

  it('adds nothing to a deck the player opened from the library instead of the pool', () => {
    const opened: DeckBuild = { cards: [{ id: 'list-add-1', ref: { sid: 'q' } }], main: ['list-add-1'] };
    expect(withLatePicks(opened, pool)).toBe(opened);
    // Nor does it bring back a pool card the build no longer has (only picks past its last one count as late).
    const dropped: DeckBuild = { cards: [{ id: 'p2', ref: { sid: 'b', foil: true } }], main: [] };
    expect(withLatePicks(dropped, pool).cards.map((c) => c.id)).toEqual(['p2', 'p3']);
  });

  it('adds nothing to a drafted deck from an earlier draft reopened from the library, though its ids are p1…pN too', () => {
    // An earlier evening: a 30-card pool saved to the library as a drafted deck (its pool build keeps ids p1…p30).
    const old = buildFromPool(Array.from({ length: 30 }, (_, i) => ({ sid: `old-${i + 1}` })));
    const record = deckRecordFromBuild({ ...old, main: old.cards.slice(0, 23).map((c) => c.id) }, { id: 'x', name: 'old deck', now: 1, origin: { format: 'pass', sets: ['m19'] } });
    const opened = buildFromDeckRecord(record);
    expect(opened.cards.map((c) => c.id)).toContain('p30');
    // Tonight: a 45-card pool; the player opens the old deck in the builder instead.
    const tonight: CardRef[] = Array.from({ length: 45 }, (_, i) => ({ sid: `new-${i + 1}` }));
    expect(withLatePicks(opened, tonight)).toBe(opened);
    // Nor when the old deck's first cards happen to be tonight's first picks: one other card is enough.
    const overlapping: CardRef[] = [...old.cards.slice(0, 29).map((c) => c.ref), { sid: 'new-30' }, ...tonight.slice(30)];
    expect(withLatePicks(opened, overlapping)).toBe(opened);
    // A foil and a plain printing of the same card are different picks.
    const foiled: CardRef[] = [...old.cards.map((c, i) => (i === 4 ? { ...c.ref, foil: true } : c.ref)), ...tonight.slice(30)];
    expect(withLatePicks(opened, foiled)).toBe(opened);
    // The same deck is topped up when tonight's pool really is its pool (saved tonight and reopened).
    const same: CardRef[] = [...old.cards.map((c) => c.ref), ...tonight.slice(30)];
    expect(withLatePicks(opened, same).cards.map((c) => c.id)).toEqual(Array.from({ length: 45 }, (_, i) => `p${i + 1}`));
  });

  it('keeps a constructed deck as a build, so a rematch sideboards it like a drafted one', () => {
    const deck = { main: [{ sid: 'x' }, { sid: 'y' }], side: [{ sid: 'z' }] };
    const b = buildFromDeck(deck);
    expect(deckImportOf(b)).toEqual(deck);
  });
});

describe('private state of an earlier draft', () => {
  const sec = (over: Partial<SecretStore>): SecretStore => ({ seat: 's0', identities: {}, libraryOrder: [], hand: [], audit: [], received: {}, ...over });

  it('is stale when its pack seeds are gone or it holds more picks than the table counts', () => {
    const t = table(['Anna', 'Ben']);
    const st: TableState = { ...t, stage: 'draft', draft: createDraftState(t, lobby({}), 1)! };
    const card = { instanceId: 'c1', ref: { sid: 'a' }, salt: 's' };
    expect(staleDraftSecrets(st, sec({}), 's0')).toBe(false);
    expect(staleDraftSecrets(st, sec({ draft: { held: {}, generated: [], marked: [] } }), 's0')).toBe(false);
    const old = sec({ draft: { held: {}, generated: [{ packId: 'pk-x', sid: 'gone', ownerNonce: 'n', peerNonces: [], set: 'M19', cards: [card] }], marked: [] } });
    expect(staleDraftSecrets(st, old, 's0')).toBe(true);
    const withRound: TableState = { ...st, shuffles: { gone: { id: 'gone', zone: 'pack:s0', owner: 's0', purpose: 'pack', h: 'h', startSeq: 2, nonces: {}, orderHash: 'o' } } };
    expect(staleDraftSecrets(withRound, old, 's0')).toBe(false);
    expect(staleDraftSecrets(st, sec({ draft: { held: { 'pool:hidden': [card] }, generated: [], marked: [] } }), 's0')).toBe(true);
    const counted: TableState = { ...st, draft: { ...st.draft!, pools: { s0: 1, s1: 0 } } };
    expect(staleDraftSecrets(counted, sec({ draft: { held: { 'pool:hidden': [card] }, generated: [], marked: [] } }), 's0')).toBe(false);
  });
});
