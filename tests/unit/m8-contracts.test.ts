/**
 * M8-C contracts (docs/PLAN.md "M8-C contracts"; docs/design/m8/contracts.md): defaults, compatibility of older
 * records, the backup round trip with every new key, the database upgrade from version 1, the rejoin actions refused
 * with the state unchanged, the wire constants, the lobby constants and the five leak test files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/core/hash';
import { explain, reduce } from '../../src/core/reducer';
import type { Action } from '../../src/core/actions';
import { MESSAGE_CHANNEL, PROTOCOL_VERSION } from '../../src/net/messages';
import { LOBBY_PROTOCOL, LOBBY_REALM, lobbyRoomId, QUEUES, ratingKeyOf } from '../../src/net/lobby/types';
import { holdText } from '../../src/net/lobby/messages';
import { readBackup } from '../../src/store/backup';
import { DB_VERSION, openDb } from '../../src/store/db';
import { createGameStore } from '../../src/store/games';
import { createRatingStore } from '../../src/store/ratings';
import {
  BACKUP_FILE_FORMAT,
  BACKUP_FILE_VERSION,
  DEFAULT_HOME_PREFS,
  DEFAULT_SETTINGS,
  HINT_IDS,
  LIBRARY_FILE_VERSION,
  type BackupFile,
  type ComputerGameRecord,
  type DeckRecord,
  type GameSummary,
  type MatchRecord,
  type RatingRecord,
} from '../../src/store/types';
import { queueDeckInfo } from '../../src/data/deck/queue';
import { createMatchmaker } from '../../src/session/matchmaker';
import { createCheckpointer } from '../../src/session/checkpoint';
import { createComputerGame, resumeComputerGame } from '../../src/session/computer';
import { musterStatus } from '../../src/session/muster';
import { buildStarterDeck } from '../../src/data/starter';
import { act, fresh } from './core/helpers';
import { uniqueDbName } from './store/helpers';

const ROOT = path.resolve(__dirname, '../..');

describe('defaults (contracts.md Part E; journey.md J-C; decks.md section 7; computer.md C0; matchmaking.md 2.10)', () => {
  it('Home opens in solo with no deck, 1v1 unranked, any deck, a booster draft of 3 packs', () => {
    expect(DEFAULT_SETTINGS.home).toEqual(DEFAULT_HOME_PREFS);
    expect(DEFAULT_HOME_PREFS).toMatchObject({ mode: 'solo', deckId: null, quick: { format: '1v1', ranked: false }, private: { decks: 'any' }, draft: { boosters: { how: 'pass', packs: 3 } } });
    expect(DEFAULT_SETTINGS.deckCardSize).toBe('m');
    expect(DEFAULT_SETTINGS.computer).toEqual({ level: 'steady', pace: 'normal', deck: 'auto' });
    expect(DEFAULT_SETTINGS).toMatchObject({ lobbyNotify: false, alsoCasual: false, lastQueue: '1v1.constructed.casual', avoid: [] });
    for (const h of ['nameChip', 'storageAfterGame', 'coachSparring', 'lobbyPrivacy', 'rankedHonour'] as const) expect(HINT_IDS).toContain(h);
    expect(LIBRARY_FILE_VERSION).toBe(2);
  });

  it('a version 1 DeckRecord literal still type-checks and reads as a custom deck without a summary', () => {
    const v1: DeckRecord = { id: 'd1', name: 'Old', main: [{ sid: 'a' }], side: [], source: 'pasted', createdAt: 1, updatedAt: 1 };
    expect(v1.kind).toBeUndefined();
    expect(queueDeckInfo(v1)).toBeNull();
  });

  it('queueDeckInfo carries six facts and nothing else', () => {
    const info = queueDeckInfo({
      kind: 'sealed',
      size: 40,
      summary: { v: 1, at: 1, cards: 40, lands: 17, colours: ['G'], curve: [0, 2, 5, 6, 4, 3, 2, 1], avgMv: 3, unknown: 0, simple: true, maxCopies: 2, cover: { sid: 'x' }, fan: [{ sid: 'x' }], strength: { v: 1, score: 55, band: 'solid', parts: { quality: 0.5, curve: 0.5, interaction: 0.5, consistency: 0.5, mana: 0.5 }, basis: 'rank', complete: true } },
    });
    expect(info).toEqual({ kind: 'sealed', size: 40, cards: 40, strength: 55, band: 'solid', v: 1 });
  });
});

describe('the wire (contracts.md Part D)', () => {
  it('protocol 4 with a head message on ctl', () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(MESSAGE_CHANNEL.head).toBe('ctl');
  });
});

describe('the lobby (matchmaking.md 2.4; contracts.md Part E)', () => {
  it('the ten queues, the realm and the room name', () => {
    expect(QUEUES).toHaveLength(10);
    expect(new Set(QUEUES).size).toBe(10);
    expect(QUEUES.filter((q) => q.endsWith('.ranked'))).toEqual(['1v1.constructed.ranked', '1v1.limited.ranked']);
    expect(LOBBY_REALM).toBe('dev');
    expect(lobbyRoomId('live')).toBe(`lobby-${LOBBY_PROTOCOL}-live-all-0`);
    expect(ratingKeyOf('1v1.limited.ranked')).toBe('1v1.limited');
    expect(ratingKeyOf('ffa4.limited.casual')).toBeNull();
    expect(holdText('m', 't', 'p')).toBe('spellplane-v1|hold|m|t|p');
  });
});

describe('the rejoin actions refuse what does not apply and say why (contracts.md Part D; filled by M8-P5)', () => {
  it.each([
    ['seatInvite', act('seatInvite', { seat: 's1', h: 'x'.repeat(43), exp: 1 })],
    ['seatClaim', act('seatClaim', { seat: 's1', claim: 'c', peer: 'p', name: 'Ben' }, 's1')],
    ['playOn', act('playOn', { without: [] })],
  ])('%s leaves the state hash unchanged and says why', (_name, action) => {
    const s = { ...fresh(), stage: 'match' as const };
    const before = canonicalJson(s);
    expect(reduce(s, action as Action)).toBe(s);
    // M8-P5 filled rejoin.ts: these unseated and uninvited cases are refused with a reason (tests/unit/rejoin).
    expect(explain(s, action as Action)).toMatch(/\S/);
    expect(canonicalJson(s)).toBe(before);
  });
  it('a matched table refuses seat invites for good', () => {
    const s = { ...fresh(), stage: 'match' as const, settings: { ...fresh().settings, matched: true } };
    expect(explain(s, act('seatInvite', { seat: 's1', h: null }))).toMatch(/matched/);
  });
});

const summary = (code: string, t: number): GameSummary => ({
  code,
  key: 'k',
  kind: 'private',
  format: '1v1',
  decks: 'constructed',
  seat: 's0',
  players: [],
  stage: 'match',
  game: 1,
  turn: 3,
  active: 's1',
  seq: 10,
  hash: 'h',
  knownHead: null,
  handLost: false,
  recoveries: 0,
  takeovers: 0,
  createdAt: t,
  lastPlayedAt: t,
  savedAt: t,
  bytes: 0,
  actions: 4,
  thumb: { w: 100, h: 100, cards: [[1, 2, 0, 0]] },
  ended: 'result',
});
const rating: RatingRecord = { key: '1v1.constructed', rating: 1512, games: 3, wins: 2, losses: 1, draws: 0, peak: 1520, updatedAt: 5 };
const match: MatchRecord = { matchId: 'm1', roomId: 'amber-fox-93', roomKey: 'k', queue: '1v1.constructed.ranked', players: [], formedAt: 1, state: 'finished', deckId: 'd1', rated: { key: '1v1.constructed', before: 1500, after: 1512 } };
const computer: ComputerGameRecord = {
  roomId: 'c-amber-fox-93',
  createdAt: 1,
  updatedAt: 2,
  bot: { config: { level: 'steady', pace: 'normal', seed: '0'.repeat(64), name: 'Sparring' }, identity: { privateJwk: { kty: 'EC' }, publicJwk: { kty: 'EC' }, peerId: '0123456789abcdef', nickname: 'Sparring', seatColour: 1 }, seat: 's1', deck: { name: 'Green', choice: { kind: 'sparring', colour: 'G', set: 'M19' }, main: [] } },
  human: { deckId: null, deckName: 'Starter' },
};

describe('the backup file accepts every new key (PLAN M8-C Store row)', () => {
  it('round-trips games, ratings, matches, computer and the new settings', () => {
    const file: BackupFile = {
      format: BACKUP_FILE_FORMAT,
      version: BACKUP_FILE_VERSION,
      exportedAt: 1,
      decks: [],
      tables: [],
      settings: { home: { ...DEFAULT_HOME_PREFS, mode: 'draft' }, deckCardSize: 's', computer: { level: 'steady', pace: 'normal', deck: 'G' }, lobbyNotify: true, alsoCasual: true, lastQueue: '1v1.limited.ranked', avoid: [{ peerId: 'p', name: 'Mira', at: 1 }] },
      games: [summary('amber-fox-93', 1)],
      ratings: [rating],
      matches: [match],
      computer: [computer],
    };
    const read = readBackup(JSON.parse(JSON.stringify(file)));
    expect(read.errors).toEqual([]);
    expect(read.games).toEqual(file.games);
    expect(read.ratings).toEqual(file.ratings);
    expect(read.matches).toEqual(file.matches);
    expect(read.computer).toEqual(file.computer);
    expect(read.settings).toEqual(file.settings);
  });
});

describe('the database upgrades from version 1 to 2 (PLAN M8-C Store row)', () => {
  it('keeps every old record and adds the four new stores', async () => {
    const name = uniqueDbName('upgrade');
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('identity', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'name' });
        db.createObjectStore('tables', { keyPath: 'roomId' });
        db.createObjectStore('log', { keyPath: ['roomId', 'seq'] });
        db.createObjectStore('secrets', { keyPath: 'roomId' });
        db.createObjectStore('decks', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('fetchedAt', 'fetchedAt');
        db.createObjectStore('sets', { keyPath: 'code' });
      },
    });
    await v1.put('decks', { id: 'd1', name: 'Old', main: [], side: [], source: 'pasted', createdAt: 1, updatedAt: 1 });
    await v1.put('settings', { name: 'theme', value: 'dusk' });
    await v1.put('tables', { roomId: 'solo', roomKey: '', lastSeq: 0, snapshot: null, snapshotSeq: 0, seat: null, stage: 'lobby', updatedAt: 1 });
    v1.close();
    const db = await openDb(name);
    try {
      expect(db.version).toBe(DB_VERSION);
      for (const s of ['games', 'ratings', 'matches', 'computer']) expect([...db.objectStoreNames]).toContain(s);
      expect((await db.get('decks', 'd1'))?.name).toBe('Old');
      expect((await db.get('settings', 'theme'))?.value).toBe('dusk');
      expect(await db.get('tables', 'solo')).toBeDefined();
      const games = createGameStore(db, () => 7);
      await games.create({ code: 'amber-fox-93', key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
      await games.put(summary('cold-owl-12', 9));
      expect((await games.list()).map((g) => g.code)).toEqual(['cold-owl-12', 'amber-fox-93']);
      await games.remove('cold-owl-12', 10);
      expect((await games.list()).map((g) => g.code)).toEqual(['amber-fox-93']);
      expect(await createRatingStore(db).get('1v1.constructed')).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('stubs resolve harmlessly and name their package', () => {
  it('matchmaker off, checkpointer no-op, computer rejects, muster live, starter rejects', async () => {
    const mm = createMatchmaker({} as never);
    expect(mm.status()).toEqual({ phase: 'off' });
    const cp = createCheckpointer({} as never, null);
    await cp.now('leave');
    cp.stop();
    await expect(createComputerGame({ roomId: 'c-x', deckId: null })).rejects.toThrow(/M8-P6/);
    await expect(resumeComputerGame('c-x')).rejects.toThrow(/M8-P6/);
    expect(musterStatus(fresh(), 's0').live).toBe(true);
    await expect(buildStarterDeck({ pool: () => Promise.resolve([]) }, { colour: 'G', seed: '0' })).rejects.toThrow(/M8-P6/);
  });
});

describe('the five leak test files exist (contracts.md Part A)', () => {
  it.each(['tests/unit/decks/queue-leak.test.ts', 'tests/sim/flow/leak-lobby.test.ts', 'tests/sim/resume/leak-rejoin.test.ts', 'tests/sim/bot/leak.test.ts', 'tests/sim/lobby/leak.test.ts'])('%s', (file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });
});
