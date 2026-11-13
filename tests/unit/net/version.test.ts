/**
 * PLAN M5-P6 protocol version check (PLAN Milestone 5, owner decisions, Version mismatch: "A room records its protocol
 * version. A peer on a different protocol version gets a clear message naming both versions and what to do (reload
 * after the game, or wait for the table to update), never a silent failure"; DESIGN "Specification: network protocol
 * and secrecy": peers with a different `v` are refused with a visible version-mismatch notice).
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../../src/net/messages';
import { roomProtocol, roomVersionNotice, versionAdvice, versionNotice, type VersionMismatch } from '../../../src/net/version';
import { TablePersistence } from '../../../src/session/persist';
import type { TableRecord, TableStore } from '../../../src/store/types';
import { createTable } from '../../../src/core/reducer';
import { TEST_GAME } from '../core/helpers';

const m = (mine: number, theirs: number, nickname = 'Ben'): VersionMismatch => ({ mine, theirs, peerId: 'p-ben', nickname });

describe('versionAdvice: the older page reloads after the game, the newer page waits for the table', () => {
  it('tells an older page to reload after the game', () => {
    expect(versionAdvice(m(1, 2))).toBe('reloadAfterGame');
    expect(versionAdvice(m(2, 7))).toBe('reloadAfterGame');
  });
  it('tells a newer page to wait for the table to update', () => {
    expect(versionAdvice(m(2, 1))).toBe('waitForTable');
    expect(versionAdvice(m(5, 4))).toBe('waitForTable');
  });
  it('counts a version it cannot read as older (the other side has to change)', () => {
    expect(versionAdvice(m(2, -1))).toBe('waitForTable');
    expect(versionAdvice(m(2, Number.NaN))).toBe('waitForTable');
  });
});

describe('versionNotice names both versions and what to do', () => {
  it('on the older page: both versions, the other player, and reload after the game', () => {
    const text = versionNotice(m(1, 2));
    expect(text).toContain('version 1');
    expect(text).toContain('version 2');
    expect(text).toContain('Ben');
    expect(text).toMatch(/reload .*after the game/i);
    expect(text).not.toMatch(/wait for the table/i);
  });
  it('on the newer page: both versions, and wait for the table to update', () => {
    const text = versionNotice(m(2, 1));
    expect(text).toContain('version 1');
    expect(text).toContain('version 2');
    expect(text).toMatch(/wait for the table to update/i);
    expect(text).toMatch(/Ben reloads .*after the game/);
  });
  it('without a name or a readable version still says what is known', () => {
    const text = versionNotice(m(2, -1, ''));
    expect(text).toContain('Another player');
    expect(text).toContain('an unknown version');
    expect(text).toContain('version 2');
    expect(text).toMatch(/wait for the table to update/i);
  });
  it('says plainly that the two cannot play together until then', () => {
    expect(versionNotice(m(2, 3))).toMatch(/cannot play at one table/);
  });
});

describe('a room records its protocol version', () => {
  it('reads a record written before M5 as protocol 1', () => {
    expect(roomProtocol({})).toBe(1);
    expect(roomProtocol({ protocol: PROTOCOL_VERSION })).toBe(PROTOCOL_VERSION);
  });

  it('every save of the table record carries this page’s protocol version', async () => {
    const written: TableRecord[] = [];
    const store = {
      saveAction: (_room: string, _e: unknown, rec: TableRecord) => {
        written.push(rec);
        return Promise.resolve();
      },
      saveSnapshot: (rec: TableRecord) => {
        written.push(rec);
        return Promise.resolve();
      },
      saveSecrets: () => Promise.resolve(),
    } as unknown as TableStore;
    const state = createTable({ game: TEST_GAME, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] });
    const p = new TablePersistence({ store, roomId: 'r', roomKey: 'k', seat: () => 's0', onError: () => undefined, now: () => 1, snapshot: state, snapshotSeq: 0, lastSeq: 0 });
    p.saveBase(state, null);
    const action = { type: 'life', by: 's0', cid: 'c1', seat: 's0', delta: -1, seq: 1 } as const;
    p.saveAction(action, { ...state, seq: 1 }, null);
    await p.whenSaved();
    expect(written.length).toBe(2);
    for (const r of written) expect(r.protocol).toBe(PROTOCOL_VERSION);
  });

  it('a room a newer Spellplane last played gets a notice naming both versions; an older or equal one continues silently', () => {
    expect(roomVersionNotice({}, 2)).toBeNull();
    expect(roomVersionNotice({ protocol: 1 }, 2)).toBeNull();
    expect(roomVersionNotice({ protocol: 2 }, 2)).toBeNull();
    const text = roomVersionNotice({ protocol: 3 }, 2)!;
    expect(text).toContain('version 3');
    expect(text).toContain('version 2');
    expect(text).toMatch(/reload/i);
  });
});
