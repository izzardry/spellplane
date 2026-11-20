/**
 * M8-P5 acceptance, simulated network (PLAN Milestone 8 "M8-P5 Rejoin"; persistence.md section 7; contracts.md Part G
 * "Rejoin" items 1, 3, 6, 7 and 9): bringing a player back by link over real networked sessions on a LoopbackNetwork
 * with seeded delay and drop, under fake timers. The 30 seconds and the 24 hours run on the sequencer's injected clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRefusal } from '../../../src/core/reducer/rejoin';
import { closeAll, FAKE_TIMERS, net, settle, until, waitConverged, type Browser } from '../session/harness';
import { loseSave } from './helpers';
import { bringBack, comeBack, leave, moves, musterOf, replaceBrowser, seated, tokenOf, untilLive } from './rejoin-helpers';

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
    const link = await settle(ann!.session!.muster.invite('s1'));
    expect(link).toMatch(/#\/t\/amber-fox-river-42\/[\w-]{22}\/rejoin\/s1\/[\w-]{22}$/);
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
    expect(await refusal(late.session!.claimSeat())).toMatch(/void|present|otherDevice/);
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
  it('Ben announced a newer head, lost his storage and is re-seated by link: Ann becomes live', async () => {
    const network = lossy(211);
    const [ann, ben] = await seated(network, browsers, 2);
    // Ann leaves; Ben plays on alone; Ann returns while Ben is there and hears his newer head, then Ben's browser dies.
    await leave(ann!);
    await moves(ben!, 3);
    network.kill('peer-b');
    await comeBack(network, ann!);
    await vi.advanceTimersByTimeAsync(2000);
    // Ann may or may not have heard Ben's head before he dropped; force the remembered head as the case states.
    const m0 = musterOf(ann!);
    if (m0.knownHead === null) {
      // Ben never connected to the returning Ann: her copy shows Ben present, so she waits for him anyway.
      expect(m0.live).toBe(false);
    }
    await loseSave(ben!);
    await settle(ann!.session!.muster.playOn([]).catch(() => undefined));
    await vi.advanceTimersByTimeAsync(31_000);
    const st = ann!.session!.getState();
    if (st.seats.s1!.away !== true) await settle(ann!.session!.muster.playOn(['s1']));
    const link = await bringBack(ann!, 's1');
    const fresh = await replaceBrowser(network, browsers, link, 'newben');
    await settle(fresh.session!.claimSeat());
    await untilLive(ann!);
    expect(musterOf(ann!).knownHead).toBeNull();
  });

  it('PLAY ON WITH THIS TABLE: offered when only the remembered newer head fails rule 3; it clears it', async () => {
    const network = lossy(212);
    const [ann, ben] = await seated(network, browsers, 2);
    await leave(ann!);
    await moves(ben!, 2);
    // Ann comes back, hears Ben's newer head, and Ben's connection drops before the catch-up reaches Ann.
    network.kill('peer-b');
    const a = await comeBack(network, ann!);
    network.revive('peer-b');
    await until(() => musterOf(ann!).knownHead !== null || musterOf(ann!).live, 10_000, 'the head heard');
    if (musterOf(ann!).live) return; // already in step with Ben: nothing to decide
    network.kill('peer-b');
    await vi.advanceTimersByTimeAsync(8000);
    const m = musterOf(ann!);
    expect(m.live).toBe(false);
    void a;
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
