/**
 * M8-P5 acceptance, simulated network (PLAN Milestone 8 "M8-P5 Rejoin"; persistence.md section 7; contracts.md Part G
 * "Rejoin" items 1, 3, 6, 7 and 9): bringing a player back by link over real networked sessions on a LoopbackNetwork
 * with seeded delay and drop, under fake timers. The 30 seconds and the 24 hours run on the sequencer's injected clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRefusal } from '../../../src/core/reducer/rejoin';
import { closeAll, FAKE_TIMERS, net, open, settle, until, waitConverged, type Browser } from '../session/harness';
import { loseSave } from './helpers';
import { bringBack, comeBack, leave, moves, musterOf, newerHeadHeard, replaceBrowser, seated, tokenOf, untilLive } from './rejoin-helpers';
import { closeWatchers, watch, type Watcher } from '../roles/harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const lossy = (seed: number) => net({ seed, delay: { min: 5, max: 100 }, drop: 0.03 });
const refusal = async (p: Promise<unknown>): Promise<string> => {
  try {
    await settle(p, 30_000, 'the refusal');
  } catch (e) {
    return claimRefusal(e instanceof Error ? e.message : String(e));
  }
  throw new Error('expected a refusal');
};

describe('the sequencer checks of a re-invite (persistence.md section 7)', () => {
  it('refuses an invite before the seat was seen away for 30 seconds', async () => {
    const network = lossy(201);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 2000, 'Ben away');
    await expect(settle(ann!.session!.muster.invite('s1'))).rejects.toThrow(/less than 30 seconds/);
    await vi.advanceTimersByTimeAsync(31_000);
    // The page runs with test flags in its address: they belong to this browser and stay out of the shared link.
    vi.stubGlobal('location', { href: 'https://tables.example/app/?profile=ann&transport=local#/t/amber-fox-river-42/x', hash: '#/t/amber-fox-river-42/x' });
    let link: string;
    try {
      link = await settle(ann!.session!.muster.invite('s1'));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(link).toMatch(/^https:\/\/tables\.example\/app\/#\/t\/amber-fox-river-42\/[\w-]{22}\/rejoin\/s1\/[\w-]{22}$/);
  });

  it('a blank browser claims the seat; the address, used twice, is refused; the 24 hours run on the sequencer clock', async () => {
    const network = lossy(202);
    const [ann, ben] = await seated(network, browsers, 2);
    await moves(ann!, 2);
    await loseSave(ben!);
    const link = await bringBack(ann!, 's1');
    const fresh = await replaceBrowser(network, browsers, link, 'blank');
    // It waits on the claim page: no seat yet, the public table in step, never a table of its own.
    expect(fresh.session!.engine.seat()).toBeNull();
    expect(fresh.session!.claimInfo()).toEqual({ seat: 's1', name: 'Ben' });
    expect(fresh.session!.getState().seq).toBe(ann!.session!.getState().seq);
    await settle(fresh.session!.claimSeat());
    await waitConverged([ann!.session!, fresh.session!]);
    const seat = ann!.session!.getState().seats.s1!;
    expect(seat.peer).toBe('peer-blank');
    expect(seat.takeovers).toBe(1);
    expect(seat.away).toBeUndefined();
    expect(fresh.session!.seat).toBe('s1');
    await untilLive(fresh);
    // A second blank browser with the same link: already used.
    const second = await replaceBrowser(network, browsers, link, 'again');
    second.session!.engine.setClock?.(() => Date.now());
    expect(await refusal(second.session!.claimSeat())).toMatch(/used|present/);
  });

  it('a blank browser reloaded after its address lost the token still holds the claim; a spent link forgets it', async () => {
    const network = lossy(206);
    const [ann, ben] = await seated(network, browsers, 2);
    await loseSave(ben!);
    const link = await bringBack(ann!, 's1');
    const { token } = tokenOf(link);
    const fresh = await replaceBrowser(network, browsers, link, 'blank');
    expect(fresh.nonces.get('claim', 's1')).toBe(token);
    // The page reloads; Gathering scrubbed the token from the address, so the route passes no claim.
    fresh.session!.dispose();
    fresh.session = null;
    const again = await open(network, fresh, { settleMs: 200 });
    expect(again.engine.seat()).toBeNull();
    expect(again.claimInfo()).toEqual({ seat: 's1', name: 'Ben' });
    await settle(again.claimSeat());
    await waitConverged([ann!.session!, again], 'the claim');
    expect(ann!.session!.getState().seats.s1!.peer).toBe('peer-blank');
    expect(fresh.nonces.get('claim', 's1')).toBeNull();
    // A second blank browser with the spent link is refused, and does not keep the token.
    const late = await replaceBrowser(network, browsers, link, 'late');
    expect(late.nonces.get('claim', 's1')).toBe(token);
    late.session!.engine.setClock?.(() => Date.now());
    expect(await refusal(late.session!.claimSeat())).toBe('used');
    expect(late.nonces.get('claim', 's1')).toBeNull();
  });

  it('refuses a claim after 24 hours on the sequencer clock, and while the old browser is connected', async () => {
    const network = lossy(203);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    const link = await bringBack(ann!, 's1');
    // The old browser is back (connected): its own return voids the link; a fresh one is refused meanwhile too.
    const late = await replaceBrowser(network, browsers, link, 'late');
    ann!.session!.setClock(() => Date.now() + 25 * 60 * 60 * 1000);
    expect(await refusal(late.session!.claimSeat())).toBe('expired');
    ann!.session!.setClock(() => Date.now());
    const back = await comeBack(network, ben!);
    await waitConverged([ann!.session!, back]);
    expect(ann!.session!.getState().seats.s1!.invite).toBeUndefined();
    expect(await refusal(late.session!.claimSeat())).toMatch(/^(void|present)$/);
  });

  it('the old browser coming back from its save after its seat was taken over is told so, not handed the old seat', async () => {
    const network = lossy(205);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    const link = await bringBack(ann!, 's1');
    const fresh = await replaceBrowser(network, browsers, link, 'newben');
    await settle(fresh.session!.claimSeat());
    await waitConverged([ann!.session!, fresh.session!], 'the claim');
    await leave(fresh);
    await until(() => ann!.session!.getState().seats.s1!.away === true, 2000, 'the new browser away');
    // Ben's own save still maps s1 to his key pair; the room's copy gave it to the new browser.
    await expect(comeBack(network, ben!)).rejects.toThrow(/Your seat was taken over from another browser \(link made by Ann\)/);
    expect(ann!.session!.getState().seats.s1!.peer).toBe('peer-newben');
  });

  it('a browser that still has its save ignores the token and resumes without a claim', async () => {
    const network = lossy(204);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    const link = await bringBack(ann!, 's1');
    const back = await comeBack(network, ben!);
    void tokenOf(link);
    await waitConverged([ann!.session!, back]);
    expect(back.seat).toBe('s1');
    expect(back.claimInfo()).toBeNull();
    expect(ann!.session!.getState().seats.s1!.takeovers).toBeUndefined();
  });
});

describe('the muster rows of contracts.md Part G item 9', () => {
  /** Row 6 of the case table, then Cy back: Ann waits only because of Ben's newer copy (knownHead). */
  async function onlyKnownHeadMissing(seed: number) {
    const network = net({ seed, delay: { min: 40, max: 120 } });
    const r = await newerHeadHeard(network, browsers);
    const c = await comeBack(network, r.cy);
    await waitConverged([r.ann.session!, c], 'Ann and Cy');
    await vi.advanceTimersByTimeAsync(3000);
    const m = musterOf(r.ann);
    expect(m).toMatchObject({ live: false, playOnHere: true, waitingFor: [r.benSeat] });
    expect(m.knownHead).toMatchObject({ peer: 'peer-b', seat: r.benSeat });
    return { network, ...r };
  }

  it('Ben announced a newer head, lost his storage and is re-seated by link: the claim clears knownHead, Ann is live by rule 3', async () => {
    const { network, ann, ben, benSeat } = await onlyKnownHeadMissing(211);
    await loseSave(ben);
    const link = await bringBack(ann, benSeat);
    expect(musterOf(ann).live).toBe(false);
    const fresh = await replaceBrowser(network, browsers, link, 'newben');
    await settle(fresh.session!.claimSeat());
    await waitConverged([ann.session!, fresh.session!], 'the claim');
    await untilLive(ann);
    expect(musterOf(ann).knownHead).toBeNull();
    expect(ann.session!.liveRule()).toBe(3);
    // Nobody pressed PLAY ON: the claim alone made Ann live.
    expect(ann.session!.log().some((e) => e.kind === 'action' && e.action.type === 'playOn')).toBe(false);
  });

  it('PLAY ON WITH THIS TABLE: offered when only the remembered newer head fails rule 3; it clears it and makes Ann live by rule 4', async () => {
    const { ann } = await onlyKnownHeadMissing(212);
    await settle(ann.session!.muster.playOn([]));
    await untilLive(ann);
    expect(musterOf(ann).knownHead).toBeNull();
    expect(ann.session!.liveRule()).toBe(4);
  });
});

describe('a claim while the old browser is connected (persistence.md section 7)', () => {
  it("is refused by the sequencer with its own reason: the seat's key pair watches from its old browser", async () => {
    const network = lossy(213);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ben!);
    const link = await bringBack(ann!, 's1');
    // Ben's old browser opens the table to watch: connected, but sitting at no chair, so the seat stays away and the
    // invite open; the reducer accepts the claim, only the sequencer's connection check refuses it.
    let oldBen: Watcher | null = null;
    try {
      oldBen = await watch(network, 'oldben', 'peer-b', 'Ben');
      await until(() => ann!.session!.engine.peers().some((p) => p.peerId === 'peer-b' && p.status === 'connected'), 10_000, 'the old browser connected');
      expect(ann!.session!.getState().seats.s1!.away).toBe(true);
      expect(ann!.session!.getState().seats.s1!.invite).toBeDefined();
      const late = await replaceBrowser(network, browsers, link, 'late');
      expect(await refusal(late.session!.claimSeat())).toBe('otherDevice');
      expect(ann!.session!.getState().seats.s1!.peer).toBe('peer-b');
    } finally {
      if (oldBen) closeWatchers([oldBen]);
    }
  });
});

describe('team hands after a claim (contracts.md Part G item 1)', () => {
  it('after a claim the teammate withholds its hand until its player says SHOW', async () => {
    const network = lossy(221);
    const [ann, ben, cy, dana] = await seated(network, browsers, 4, '2hg');
    // Dana (s3) loses her browser; her teammate Cy (s2) brings her back.
    await loseSave(dana!);
    await expect(settle(ann!.session!.muster.invite('s3').catch((e: unknown) => Promise.reject(e)))).rejects.toThrow(/teammate|30 seconds/);
    const link = await bringBack(cy!, 's3');
    // An opponent's invite is refused even now.
    await expect(settle(ann!.session!.muster.invite('s3'))).rejects.toThrow(/teammate/);
    const fresh = await replaceBrowser(network, browsers, link, 'newdana');
    await settle(fresh.session!.claimSeat());
    await waitConverged([cy!.session!, fresh.session!]);
    const team = cy!.session!.team!;
    expect(team.withheld!()).toEqual([{ seat: 's3', name: 'Dana', by: 'Cy' }]);
    await vi.advanceTimersByTimeAsync(3000);
    const handMsgs = (): number =>
      network.delivered.filter((d) => d.to === 'peer-newdana' && (d.msg as { t?: string }).t === 'teamHand').length;
    expect(handMsgs()).toBe(0);
    team.showHand!('s3');
    await until(() => handMsgs() > 0, 5000, 'the hand after SHOW');
    expect(team.withheld!()).toEqual([]);
    void ben;
  });
});
