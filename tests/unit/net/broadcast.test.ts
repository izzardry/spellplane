/**
 * The BroadcastChannel transport of the e2e harness (net/broadcast.ts), on Node's BroadcastChannel. M4 gate finding:
 * on `pagehide` it reported every peer gone to its own page, whose still running engine then marked the other seats
 * away (or took over as sequencer) and saved records no other page has; the reopened page's history diverged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastTransport } from '../../../src/net/broadcast';

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const opened: BroadcastTransport[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const t of opened.splice(0)) t.leave();
});

/** Two transports in one room; `page` is the one whose window can fire `pagehide`. */
async function pair(room: string): Promise<{ page: BroadcastTransport; other: BroadcastTransport; window: EventTarget; events: { page: string[]; other: string[] } }> {
  const window = new EventTarget();
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));
  const page = new BroadcastTransport('page');
  const events = { page: [] as string[], other: [] as string[] };
  page.onPeer((ev, p) => events.page.push(`${ev}:${p}`));
  await page.join(room, 'k');
  vi.unstubAllGlobals();
  const other = new BroadcastTransport('other');
  other.onPeer((ev, p) => events.other.push(`${ev}:${p}`));
  await other.join(room, 'k');
  opened.push(page, other);
  await until(() => page.peers().includes('other') && other.peers().includes('page'), 'the two transports to meet');
  return { page, other, window, events };
}

describe('BroadcastTransport', () => {
  it('a page that unloads says bye, but reports no peer gone to its own page', async () => {
    const { page, other, window, events } = await pair('room-unload');
    window.dispatchEvent(new Event('pagehide'));
    await until(() => events.other.includes('leave:page'), 'the other page to see it leave');
    expect(other.peers()).toEqual([]);
    expect(events.page).toEqual(['join:other']);
    expect(page.peers()).toEqual([]);
  });

  it('an explicit leave reports every peer gone (the engine closed itself first)', async () => {
    const { page, events } = await pair('room-leave');
    page.leave();
    expect(events.page).toEqual(['join:other', 'leave:other']);
    await until(() => events.other.includes('leave:page'), 'the other page to see it leave');
  });
});
