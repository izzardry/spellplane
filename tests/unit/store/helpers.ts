/** Shared fixtures for the store tests: a hand-built table, secret store and log entries (plain JSON). */
import type { Action } from '../../../src/core/actions';
import type { SecretStore, TableState } from '../../../src/core/types';
import type { LogRecord, TableRecord } from '../../../src/store/types';

let counter = 0;
/** A database name no other test uses (fake-indexeddb is shared within a test file). */
export function uniqueDbName(label: string): string {
  counter += 1;
  return `test-${label}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A small but representative solo table: a hidden library, a hand, public cards with counters, a pile, a line. */
export function sampleState(seq = 3): TableState {
  return {
    seq,
    game: 'mtg',
    format: '1v1',
    stage: 'match',
    seats: {
      s0: { id: 's0', index: 0, name: 'Ada', colour: 2, life: 17, counters: { poison: 1, 'cmd:s1': 4 }, ready: true, autoPass: false },
    },
    teams: {},
    cards: {
      c1: { id: 'c1', owner: 's0', controller: 's0', zone: 'library:s0', face: 'down', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} },
      c2: { id: 'c2', owner: 's0', controller: 's0', zone: 'library:s0', face: 'down', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} },
      c3: {
        id: 'c3',
        owner: 's0',
        controller: 's0',
        zone: 'battlefield:s0',
        identity: { sid: '0000579f-7b35-4ed3-b44c-db2a538066fe', foil: true },
        face: 'up',
        faceIndex: 1,
        tapped: true,
        pose: { x: -120.5, y: 88.25, rot: 90 },
        pile: { id: 'p1', index: 0, kind: 'cascade' },
        counters: { '+1/+1': 2 },
        note: 'Ünïcödé — note',
      },
      c4: { id: 'c4', owner: 's0', controller: 's0', zone: 'hand:s0', face: 'down', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} },
    },
    zones: {
      'library:s0': { id: 'library:s0', kind: 'library', owner: 's0', visibility: 'owner', count: 2, ids: ['c1', 'c2'] },
      'hand:s0': { id: 'hand:s0', kind: 'hand', owner: 's0', visibility: 'owner', count: 1, ids: ['c4'] },
      'battlefield:s0': { id: 'battlefield:s0', kind: 'battlefield', owner: 's0', visibility: 'public', ids: ['c3'] },
    },
    stack: [],
    lines: { l1: { id: 'l1', kind: 'mark', from: { kind: 'card', id: 'c3' }, to: { kind: 'seat', id: 's0' }, by: 's0' } },
    turn: { number: 4, active: 's0', phase: 'main1' },
    confirm: null,
    commitments: { s0: { seat: 's0', commits: ['aGFzaA', 'b3RoZXI'], instanceIds: ['c1', 'c2', 'c3', 'c4'], atSeq: 1 } },
    rng: {},
    shuffles: {},
    settings: { passTimerMs: null, teamHandsVisible: true },
  };
}

/** The owner's secret store matching sampleState. */
export function sampleSecrets(): SecretStore {
  return {
    seat: 's0',
    identities: {
      c1: { card: { sid: 'aaaa' }, salt: 'salt-1' },
      c2: { card: { sid: 'bbbb', foil: true }, salt: 'salt-2' },
      c3: { card: { sid: '0000579f-7b35-4ed3-b44c-db2a538066fe', foil: true }, salt: 'salt-3' },
      c4: { card: { sid: 'cccc' }, salt: 'salt-4' },
    },
    libraryOrder: ['c2', 'c1'],
    hand: ['c4'],
    audit: [{ kind: 'shuffle', sid: 'sh1', zone: 'library:s0', ownerNonce: 'n0', peerNonces: [], order: ['c2', 'c1', 'c4'] }],
    received: {},
  };
}

export function tap(seq: number, card = 'c3', tapped = true): Action {
  return { type: 'tap', by: 's0', cid: `cid-${seq}`, seq, card, tapped };
}

export function logEntry(roomId: string, seq: number): LogRecord {
  return { roomId, seq, action: tap(seq), at: 1_700_000_000_000 + seq };
}

export function tableRecord(roomId: string, lastSeq: number, snapshot: TableState | null = null, snapshotSeq = 0): TableRecord {
  return { roomId, roomKey: roomId === 'solo' ? '' : 'a2V5LWtleS1rZXkta2V5', lastSeq, snapshot, snapshotSeq, seat: 's0', stage: 'match', updatedAt: 1_700_000_000_000 + lastSeq };
}
