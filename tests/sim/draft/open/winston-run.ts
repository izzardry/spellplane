/**
 * Winston drafts on the simulated network (tests/sim/draft/open/net.ts), shared by the acceptance test
 * (winston.test.ts) and the leak scenario (leak.test.ts): a random player, what the other player may know from the
 * public log alone, and outages of the other player's browser at the moments the dealer must show it something.
 */
import { expect, vi } from 'vitest';
import { winstonActive, winstonDealt } from '../../../../src/core/open';
import { reduce } from '../../../../src/core/reducer';
import type { InstanceId, TableState } from '../../../../src/core/types';
import { heldIdentities } from '../../../../src/draft/open';
import { WINSTON_NEED } from '../../../../src/draft/winston';
import { mulberry32 } from '../../../../src/util/prng';
import { draftNet, runDraft, type DraftNet, type DraftSeat } from './net';

/** A player who looks at the pile shown and takes it or declines it at random (taking when declining is refused). */
export function randomWinston(seed: number): (s: DraftSeat) => void {
  const rand = mulberry32(seed);
  return (s) => {
    const v = s.driver.view();
    if (!v.waitingOn.includes(s.seat) || v.pile === undefined) return;
    expect(v.pile.length).toBeGreaterThan(0);
    const take = rand() < 0.35;
    if (s.driver.pileLook!(take)) return;
    expect(take).toBe(false);
    expect(s.driver.pileLook!(true)).toBe(true);
  };
}

/** What `seat` may know of the dealer's cards, from the public log: piles it looked at when it looked, and what it took. */
export function allowedFor(t: DraftNet, seat: string): Set<InstanceId> {
  const out = new Set<InstanceId>();
  let s: TableState = t.start;
  for (const a of t.seats[0]!.peer.log()) {
    s = reduce(s, a);
    const d = s.draft!;
    if (winstonDealt(d.winston) && winstonActive(d) === seat) for (const id of d.winston.pileIds[d.winston.pile]!) out.add(id);
    for (const id of d.taken?.[seat] ?? []) out.add(id);
  }
  return out;
}

/** What happened during a run with outages of s1. */
export interface Outages {
  /** s1 was lost right as the dealer's `pileLook` passed it the turn (the dealer's disclosure was in flight). */
  inFlight: boolean;
  /** s1 was offline when the turn passed to it (the dealer's `sendCards` reported no connected peer). */
  offline: boolean;
  /** `sendCards` calls of the dealer that found no connected peer. */
  undelivered: number;
  /** s1 reloaded after the turn passed to it and before its pile arrived (the disclosure died with the old page). */
  reloadedLacking: boolean;
}

export interface WinstonRun {
  t: DraftNet;
  outages: Outages;
}

const OUTAGE_MS = 1500;

/**
 * A Winston draft of `packs` under delay, reordering and dropped sequencing messages; each browser reloads once in
 * mid-draft. With `outages`, s1's peer is also killed and revived twice (LoopbackNetwork kill/revive): once right as
 * the dealer passes it the turn, so the pile it must be shown is lost on the way, and once while the dealer is active,
 * so the dealer passes the turn to a seat with no connected peer.
 */
export async function winstonDraft(seed: number, packs: number, options: { outages?: boolean; reloadLacking?: boolean; sets?: string[] } = {}): Promise<WinstonRun> {
  const t = await draftNet(2, { format: 'winston', packs }, { seed, delay: { min: 0, max: 100 }, drop: 0.05, faultyChannels: ['act', 'ctl'] }, options.sets);
  const [a, b] = t.seats as [DraftSeat, DraftSeat];
  const outages: Outages = { inFlight: false, offline: false, undelivered: 0, reloadedLacking: false };
  const send = a.host.sendCards!.bind(a.host);
  a.host.sendCards = (to, about, cards) => {
    const delivered = send(to, about, cards);
    if (!delivered) outages.undelivered += 1;
    return delivered;
  };
  if (options.outages === true) {
    let previous: string | null = null;
    let dead = false;
    a.peer.onSequenced(() => {
      const d = a.peer.state.draft!;
      const active = winstonActive(d);
      const took = d.taken?.s0?.length ?? 0;
      if (!dead && !outages.inFlight && previous === 's0' && active === 's1' && took >= 2) {
        // The dealer's driver has just sent s1 its pile (its listener runs first); s1 drops before it arrives.
        outages.inFlight = true;
        dead = true;
        t.net.kill(b.peer.peerId);
        setTimeout(() => {
          t.net.revive(b.peer.peerId);
          dead = false;
        }, OUTAGE_MS);
      } else if (!dead && outages.inFlight && !outages.offline && previous === 's1' && active === 's0' && took >= 8) {
        // s1 leaves while the dealer looks; the dealer then passes the turn to a seat with no connected peer.
        outages.offline = true;
        dead = true;
        t.net.kill(b.peer.peerId);
        setTimeout(() => {
          t.net.revive(b.peer.peerId);
          dead = false;
        }, OUTAGE_MS * 2);
      }
      if (active !== null) previous = active;
    });
  }
  if (options.reloadLacking === true) {
    // s1 reloads after the sequenced action that passed it the turn arrived and before its pile did: the dealer's
    // disclosure went out (sendCards reported a connected peer) but never arrived, and the old page's request goes
    // down with it. No further action follows, since only s1 can act now, so the reloaded driver must ask by itself.
    let lost = false;
    const deliver = a.host.sendCards!;
    a.host.sendCards = (to, about, cards) => {
      const took = a.peer.state.draft?.taken?.s1?.length ?? 0;
      const last = a.peer.log().at(-1);
      // The disclosure the dealer sends as its own pileLook is sequenced and passes the turn to s1.
      const passing = last !== undefined && last.cid === about && last.type === 'pileLook' && last.by === 's0';
      if (!lost && passing && cards.length > 0 && took >= 2 && winstonActive(a.peer.state.draft!) === 's1') {
        lost = true;
        return true;
      }
      return deliver(to, about, cards);
    };
    b.peer.onSequenced(() => {
      const d = b.peer.state.draft!;
      // Caught up with the sequencer: no sequenced action is still on its way to s1.
      if (!lost || outages.reloadedLacking || b.peer.state.seq !== a.peer.state.seq) return;
      if (winstonActive(d) !== 's1' || !winstonDealt(d.winston)) return;
      const known = heldIdentities(b.secrets());
      if (d.winston.pileIds[d.winston.pile]!.every((id) => known.has(id))) return;
      // The page goes: whatever the old driver just asked for, and the dealer's answer, are lost with it.
      outages.reloadedLacking = true;
      t.net.kill(b.peer.peerId);
      setTimeout(() => b.reload(), 0);
      setTimeout(() => t.net.revive(b.peer.peerId), 300);
    });
  }
  const bot = randomWinston(seed * 7);
  const reloads = new Set<string>();
  await runDraft(t, (s) => {
    // Each browser reloads once in mid-draft (the dealer while holding the stack, the other between looks).
    const taken = s.peer.state.draft?.taken?.[s.seat]?.length ?? 0;
    if (!reloads.has(s.seat) && taken >= 6) {
      reloads.add(s.seat);
      s.reload();
    }
    bot(s);
  });
  expect(reloads.size).toBe(2);
  // Let the last disclosures land.
  await vi.advanceTimersByTimeAsync(500);
  return { t, outages };
}

/** `draftCards` requests (`winston:need`) the dealer received from s1. */
export function requestsTo(seat: DraftSeat): number {
  return seat.peer.received.filter((m) => {
    const msg = m.msg as { t?: string; about?: string };
    return msg.t === 'draftCards' && msg.about === WINSTON_NEED;
  }).length;
}
