/**
 * PLAN M5-P6 protocol version check in the browser (PLAN Milestone 5, owner decisions, Version mismatch: "A peer on a
 * different protocol version gets a clear message naming both versions and what to do (reload after the game, or wait
 * for the table to update), never a silent failure"). The simulated-network tests (tests/sim/net/version.test.ts) come
 * first; here a page of another version is a script on the local transport (BroadcastChannel, `?transport=local`) that
 * speaks as an M0-M4 page does: a hello with its own `v`, and a version bye to any hello of another version.
 */
import { expect, test, type Page } from '@playwright/test';
import { freshProfile, freshRoom, open, openTable } from '../lobby/helpers';

/** Start a page of protocol `v` in `page` (any page of the app's origin): it lives as long as that page does. */
async function otherVersion(page: Page, roomId: string, v: number, nickname: string): Promise<void> {
  await page.evaluate(
    ([room, version, name]) => {
      const bc = new BroadcastChannel(`spellplane-room-${room as string}`);
      const me = `old-${Math.random().toString(36).slice(2, 8)}`;
      const hello = (to?: string): void =>
        bc.postMessage({ k: 'msg', from: me, ...(to ? { to } : {}), channel: 'ctl', msg: { v: version, t: 'hello', peerId: `peer-${me}`, pubKey: 'pk', nickname: name, seat: null, role: 'player', lastSeq: 0, nonce: 'n' } });
      bc.onmessage = (e: MessageEvent<{ k: string; from: string; to?: string; msg?: { t?: string; v?: number } }>) => {
        const f = e.data;
        if (f.from === me || (f.to && f.to !== me)) return;
        if (f.k === 'hello') {
          bc.postMessage({ k: 'here', from: me, to: f.from });
          hello(f.from);
        }
        if (f.k === 'msg' && f.msg?.t === 'hello' && f.msg.v !== version) bc.postMessage({ k: 'msg', from: me, to: f.from, channel: 'ctl', msg: { v: version, t: 'bye', reason: 'version', version } });
      };
      bc.postMessage({ k: 'hello', from: me });
      hello();
      setInterval(() => bc.postMessage({ k: 'beat', from: me }), 1000);
    },
    [roomId, v, nickname] as const,
  );
}

test.describe('protocol version mismatch (M5-P6)', () => {
  test('a table that meets an older page shows both versions and says to wait for the table to update', async ({ page }, info) => {
    const room = freshRoom();
    await openTable(page, room, freshProfile(info, 'anna'));
    await otherVersion(page, room.roomId, 1, 'Old Ben');
    const notice = page.getByTestId('version-mismatch');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveAttribute('data-mine', '2');
    await expect(notice).toHaveAttribute('data-theirs', '1');
    await expect(notice).toHaveAttribute('data-advice', 'waitForTable');
    await expect(notice).toContainText('Old Ben runs Spellplane protocol version 1');
    await expect(notice).toContainText('this page runs protocol version 2');
    await expect(notice).toContainText('wait for the table to update');
    // The lobby says why nobody joined, never a silent wait.
    await expect(page.getByTestId('connectivity-problem')).toContainText('different version of Spellplane');
    // Hidden for this mismatch on request.
    await page.getByTestId('version-mismatch-hide').click();
    await expect(notice).toBeHidden();
  });

  test('a page that meets a newer one is told to reload after the game', async ({ page }, info) => {
    const room = freshRoom();
    await openTable(page, room, freshProfile(info, 'anna'));
    await otherVersion(page, room.roomId, 3, 'Ben');
    const notice = page.getByTestId('version-mismatch');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveAttribute('data-advice', 'reloadAfterGame');
    await expect(notice).toContainText('version 3');
    await expect(notice).toContainText('version 2');
    await expect(notice).toContainText('reload it after the game');
  });

  test('opening the link while only a page of another version is in the room says why it cannot join', async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const host = await context.newPage();
    const joiner = await context.newPage();
    const room = freshRoom();
    // The other version's page lives in a page of the app's origin (the start page).
    await open(host, '/', { profile: freshProfile(info, 'host') });
    await otherVersion(host, room.roomId, 1, 'Anna');
    await open(joiner, `/t/${room.roomId}/${room.roomKey}`, { profile: freshProfile(info, 'ben'), transport: 'local' });
    const error = joiner.getByTestId('room-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText('Anna runs Spellplane protocol version 1');
    await expect(error).toContainText('protocol version 2');
    await expect(error).toContainText('wait for the table to update');
    await expect(joiner.getByTestId('lobby')).toHaveCount(0);
    await context.close();
  });
});
