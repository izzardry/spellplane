/**
 * M8-P8: leaving a short computer game purges it whole (DESIGN "Landing and journey": "a solo game left after fewer
 * than ten moves is not kept"; computer.md 2.5: "deleting a computer game deletes the human's table, the bot's table
 * and the computer record together"). The order is the route's: leaveTable disposes the human's session, the route's
 * purge (`computerPurge`) disposes Sparring's handle and only then deletes, and the route's teardown disposes the
 * handle once more. No row of the room or of `bot~<room>` may come back afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openComputerGame, provideComputerDeps } from '../../../src/session/computer';
import { BOT_TABLE_PREFIX } from '../../../src/store/computer';
import { computerPurge, leaveTable } from '../../../src/ui/play/leave';
import { resetLifecycleForTests } from '../../../src/util/lifecycle';
import { FAKE_TIMERS, settle, simDeps } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  resetLifecycleForTests();
});
afterEach(() => {
  provideComputerDeps(null);
  vi.useRealTimers();
});

describe('leaving a short computer game', () => {
  it('leaves no table, secrets, log or computer record of either seat behind', async () => {
    const room = 'c-purge-71';
    const { deps, stores } = await simDeps(71);
    const g = await settle(openComputerGame(room, { deps }), 120_000, 'the game');
    await stores.games.create({ code: room, key: '', kind: 'solo', format: '1v1', decks: 'constructed', opponent: 'sparring', seat: 's0' });
    expect(await stores.computer.get(room)).not.toBeNull();
    const go = vi.fn();
    const toast = vi.fn();
    const out = await settle(leaveTable({ session: g.session, kind: 'computer', code: room, games: stores.games, go, toast, purgeComputer: computerPurge(g.handle, room, stores) }), 20_000, 'the leave');
    expect(out).toBe('purged');
    expect(go).toHaveBeenCalledWith('#/');
    expect(toast).not.toHaveBeenCalled();
    // The route's teardown disposes the handle again (a no-op), then every late save has had its time.
    g.handle.dispose();
    await vi.advanceTimersByTimeAsync(15_000);
    for (const id of [room, `${BOT_TABLE_PREFIX}${room}`]) {
      expect(await stores.tables.loadTable(id)).toBeNull();
      expect(await stores.tables.loadLog(id)).toEqual([]);
    }
    expect(await stores.computer.get(room)).toBeNull();
    expect(await stores.games.get(room)).toBeNull();
    stores.close();
  }, 60_000);
});
