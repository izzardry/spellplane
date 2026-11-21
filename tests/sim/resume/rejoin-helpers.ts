/**
 * Helpers of the M8-P5 rejoin simulations (persistence.md sections 5 to 7): real networked sessions on a
 * LoopbackNetwork under fake timers. A table is opened, every browser seated, and the host moves it to the match
 * stage, where the muster rule applies (in the lobby every browser is live).
 */
import { expect, vi } from 'vitest';
import type { MusterStatus } from '../../../src/session/types';
import type { LoopbackNetwork } from '../../../src/net/loopback';
import { browser, hashOf, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { claimOfLink, leave as leaveTable, replaceBrowser as replaceWith, returnFromSave } from '../../leak/minitable';

export const NAMES = ['Ann', 'Ben', 'Cy', 'Dana'] as const;

/** `n` browsers seated at a table in the match stage; their sessions converged. */
export async function seated(network: LoopbackNetwork, browsers: Browser[], n = 2, format?: '1v1' | 'ffa3' | 'ffa4' | '2hg'): Promise<Browser[]> {
  const out: Browser[] = [];
  for (let i = 0; i < n; i++) {
    const b = await browser(NAMES[i]!.toLowerCase(), `peer-${String.fromCharCode(97 + i)}`, NAMES[i]!, i);
    browsers.push(b);
    out.push(b);
    // The first browser created the room (main.ts marks it so): a joiner that sat alone gives its chair up to it.
    await open(network, b, { settleMs: 200, ...(i === 0 ? { createdHere: true } : {}) });
    // The host sets the format before the others join (a joiner starts from the default table and syncs the log).
    if (i === 0 && format !== undefined && format !== '1v1') {
      const host = b.session!;
      host.dispatch({ type: 'formatSet', format, life: format === '2hg' ? 30 : 20 });
      await until(() => host.engine.pending().length === 0 && host.getState().format === format, 5000, 'the format');
    }
  }
  await waitConverged(out.map((b) => b.session!), 'everyone seated');
  const host = out[0]!.session!;
  if (format === '2hg') host.dispatch({ type: 'settings', settings: { teamHandsVisible: true } });
  host.dispatch({ type: 'stageSet', stage: 'match' });
  await waitConverged(out.map((b) => b.session!), 'the match stage');
  expect(host.getState().stage).toBe('match');
  return out;
}

/** The muster verdict of a browser's session. */
export function musterOf(b: Browser): MusterStatus {
  return b.session!.muster.muster();
}

/** `n` moves (life changes count as a player's move: core/log.ts isPlayAction) by `b`, each sequenced. */
export async function moves(b: Browser, n: number): Promise<void> {
  const s = b.session!;
  for (let i = 0; i < n; i++) s.dispatch({ type: 'life', seat: s.seat, delta: -1 });
  await until(() => s.engine.pending().length === 0, 30_000, `${b.name}'s moves`);
}

/** Leave the table on purpose (bye leave); the save is flushed first. */
export async function leave(b: Browser): Promise<void> {
  await settle(leaveTable(b));
}

/** Open the table again from the browser's save (History, the link, a reload). */
export async function comeBack(network: LoopbackNetwork, b: Browser): Promise<NetTable> {
  return returnFromSave(() => open(network, b, { settleMs: 200 }));
}

/** Wait until the browser is live by the muster rule. */
export async function untilLive(b: Browser, maxMs = 5000): Promise<void> {
  await until(() => b.session!.muster.muster().live, maxMs, `${b.name} to be live`);
}

export const confirmedHash = (b: Browser): string => hashOf(b.session!.engine.confirmedState());

/** The token of a re-invite link (persistence.md section 7). */
export function tokenOf(link: string): { seat: string; token: string } {
  return claimOfLink(link);
}

/** A blank browser (new key pair, empty profile) opens a re-invite link and waits on the claim page. */
export async function replaceBrowser(network: LoopbackNetwork, browsers: Browser[], link: string, name = 'fresh'): Promise<Browser> {
  const b = await browser(name, `peer-${name}`, name);
  browsers.push(b);
  await replaceWith(link, (claim) => open(network, b, { settleMs: 200, claim }));
  return b;
}

/** `b` makes a link for `seat` once the seat has been away for 30 seconds on the sequencer's clock. */
export async function bringBack(b: Browser, seat: string): Promise<string> {
  await until(() => b.session!.getState().seats[seat]!.away === true, 15_000, `${seat} away`);
  await vi.advanceTimersByTimeAsync(31_000);
  return settle(b.session!.muster.invite(seat), 30_000, 'the invite');
}

/** The tab is closed (or the machine sleeps): no `bye`, the transport just goes. */
export function crash(network: LoopbackNetwork, b: Browser): void {
  network.kill(b.peerId);
  b.session!.dispose();
  b.session = null;
}

/**
 * Case-table row 6 of persistence.md section 5 (three players): Ben leaves, then Ann's and Cy's tabs close, so Ann's
 * copy marks Ben away. Ben returns alone, plays on (PLAY ON WITHOUT ANN AND CY) and makes moves, and his tab closes.
 * Ann returns and waits for Cy; Ben's browser comes back and Ann's engine hears his newer copy (hello), and Ben drops
 * before Ann's copy caught up. Returns once Ann remembers Ben's copy as `knownHead` and Ben is gone again.
 */
export async function newerHeadHeard(network: LoopbackNetwork, browsers: Browser[]): Promise<{ ann: Browser; ben: Browser; cy: Browser; benSeat: string; cySeat: string }> {
  const [ann, ben, cy] = (await seated(network, browsers, 3, 'ffa3')) as [Browser, Browser, Browser];
  const benSeat = ben.session!.seat;
  const cySeat = cy.session!.seat;
  await moves(ann, 1);
  await waitConverged([ann.session!, ben.session!, cy.session!], 'the first move');
  await leave(ben);
  await until(() => ann.session!.getState().seats[benSeat]!.away === true, 2000, 'Ben away');
  await waitConverged([ann.session!, cy.session!], 'Ben away everywhere');
  for (const b of [ann, cy]) await settle(b.session!.whenSaved());
  crash(network, ann);
  crash(network, cy);
  // Ben alone: his copy shows Ann and Cy present; the table decides to play on without them.
  const b = await comeBack(network, ben);
  await until(() => !b.muster.muster().live && b.muster.muster().waitingFor.length === 2, 5000, 'Ben waits');
  await settle(b.muster.playOn(['s0', cySeat]));
  await until(() => b.muster.muster().live, 5000, 'Ben live');
  await moves(ben, 3);
  await settle(b.whenSaved());
  const benSeq = b.engine.seq();
  crash(network, ben);
  // Ann alone: Ben away in her copy, Cy present: she waits for Cy.
  const a = await comeBack(network, ann);
  await vi.advanceTimersByTimeAsync(2000);
  expect(a.muster.muster()).toMatchObject({ live: false, waitingFor: [cySeat], knownHead: null });
  // Ben's browser comes back: Ann's engine verifies him and hears his newer copy before any catch-up; Ben drops.
  network.revive(ben.peerId);
  const back = returnFromSave(() => open(network, ben, { settleMs: 200 }));
  await until(() => a.muster.muster().knownHead !== null, 5000, "Ben's newer copy heard");
  expect(a.engine.seq()).toBeLessThan(benSeq);
  network.kill(ben.peerId);
  await settle(back.catch(() => undefined), 30_000, "Ben's page");
  if (ben.session) {
    ben.session.dispose();
    ben.session = null;
  }
  return { ann, ben, cy, benSeat, cySeat };
}
