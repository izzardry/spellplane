/**
 * PLAN Milestone 6, attach, carry and clips over the simulated network (CLAUDE.md: LoopbackNetwork with seeded delay,
 * drop and reordering; PLAN "Every protocol feature gets a simulated-network test"): two real NetEngines play
 * clips, tucks, carried group drags, a clipped card leaving the battlefield, an attack with attachments and Settle,
 * concurrent removals of one clip, and an undone removal. Every peer reaches the same state hash, and the table holds
 * what the design says on all of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { carryGroup } from '../../../src/core/clips';
import { tuckPose } from '../../../src/core/reducer';
import type { InstanceId, Pose, TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import { carryDropActions } from '../../../src/scene/carry';
import { toStoredPoses } from '../../../src/scene/gestures';
import { FAULTS } from '../net/scenarios';
import { agreed, baseTable, expectConverged, makeSim, until, type SimPeer } from '../net/sim';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

let n = 0;
const presentation = (z: string) => (z.startsWith('battlefield') ? ('free' as const) : z === 'stack' ? ('cascade-lane' as const) : ('squared' as const));

function propose(p: SimPeer, drafts: ActionDraft[]): Action[] {
  const out: Action[] = [];
  for (const d of drafts) {
    const a = { ...d, by: p.seat, cid: `${p.peerId}-${++n}` } as Action;
    expect(p.engine.propose(a), `${a.type} proposed`).toBe(true);
    out.push(a);
  }
  return out;
}

const confirmed = (p: SimPeer): TableState => p.engine.confirmedState();

/** Drop the carry group of `anchor` with its anchor at `pose` (a free drop), as the scene would. */
function dragDrafts(s: TableState, anchor: InstanceId, pose: Pose): ActionDraft[] {
  const g = carryGroup(s, anchor);
  const start = new Map(g.cards.map((id) => [id, s.cards[id]!.pose]));
  const zone = s.cards[anchor]!.zone;
  return toStoredPoses(s, carryDropActions(s, g, start, { rule: 5, kind: 'free', pose }, { zone, controller: s.cards[anchor]!.controller }, { newId: (p) => `${p}-${++n}`, presentation }));
}

describe('attach, carry and clips on two peers (delay, 5% drop, reordering, peer loss)', () => {
  it.each([3, 11, 29])('converge on one hash with the clips and attachments the design gives (seed %i)', async (seed) => {
    const sim = makeSim({ engines: 2, seats: 2, start: baseTable(2), seed, ...FAULTS });
    await until(() => agreed(sim.peers), 20_000, 'connection');
    const [anna, ben] = sim.peers as [SimPeer, SimPeer];

    // Anna clips her a00 and a01 to Ben's b00 (any battlefield cards, either player may).
    propose(anna, [{ type: 'clipAdd', clip: 'k1', cards: ['b00', 'a00', 'a01'], anchor: { card: 'a00', x: 20, y: 0 } }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(confirmed(p).clips?.k1).toEqual({ id: 'k1', cards: ['a00', 'a01', 'b00'], anchor: { card: 'a00', x: 20, y: 0 }, by: 's0' });

    // Ben drags b00: the whole clipped group moves rigidly, as one group.
    const before = confirmed(ben);
    const drag = propose(ben, dragDrafts(before, 'b00', { x: 0, y: -40, rot: 0 }));
    expect(new Set(drag.map((a) => a.group)).size).toBe(1);
    await expectConverged(sim.peers);
    const after = confirmed(anna);
    const dx = after.cards.b00!.pose.x - before.cards.b00!.pose.x;
    const dy = after.cards.b00!.pose.y - before.cards.b00!.pose.y;
    for (const id of ['a00', 'a01']) {
      expect(after.cards[id]!.pose.x - before.cards[id]!.pose.x).toBeCloseTo(dx, 6);
      expect(after.cards[id]!.pose.y - before.cards[id]!.pose.y).toBeCloseTo(dy, 6);
    }

    // Anna tucks a02 behind a00 while Ben sends a01 to his... Anna's graveyard (anyone may move public cards).
    const host = confirmed(anna).cards.a00!.pose;
    propose(anna, [{ type: 'attach', card: 'a02', to: 'a00' }]);
    await vi.advanceTimersByTimeAsync(37);
    propose(ben, [{ type: 'move', card: 'a01', to: 'graveyard:s0' }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) {
      const s = confirmed(p);
      expect(s.cards.a02).toMatchObject({ attachedTo: 'a00', pose: tuckPose(host, 1) });
      expect(s.clips?.k1?.cards).toEqual(['a00', 'b00']);
    }

    // Anna attacks with a00: its Aura travels with it; Settle brings both back.
    const tucked = confirmed(anna).cards.a02!.pose;
    propose(anna, [{ type: 'moveTemp', card: 'a00', pose: { ...host, y: host.y - 110 }, combat: 'attack', tap: true }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(confirmed(p).cards.a02!.pose).toEqual({ ...tucked, y: tucked.y - 110 });
    propose(ben, [{ type: 'settle' }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(confirmed(p).cards.a02!.pose).toEqual(tucked);

    // Both take the clip off at once: one removal wins, the other is refused; no clip is left anywhere.
    const beforeRemove = confirmed(ben);
    const [removal] = propose(ben, [{ type: 'clipRemove', clip: 'k1' }]);
    await vi.advanceTimersByTimeAsync(20);
    propose(anna, [{ type: 'clipRemove', clip: 'k1' }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(confirmed(p).clips).toBeUndefined();

    // If Ben's removal was the one sequenced, his undo brings the clip back with Anna as its creator.
    if (ben.acked.has(removal!.cid)) {
      const inv = inverse(beforeRemove, removal!);
      expect(inv).not.toBeNull();
      propose(ben, [{ type: 'undo', of: removal!.cid, inverse: JSON.parse(JSON.stringify(inv)) }]);
      await expectConverged(sim.peers);
      for (const p of sim.peers) expect(confirmed(p).clips?.k1).toMatchObject({ cards: ['a00', 'b00'], by: 's0' });
    }

    // Peer loss between clip actions (PLAN standing rule: delay, drop, reordering and peer loss): the sequencing page
    // clips while the other page is cut off, takes a clip off and puts another on before it is back; it catches up.
    const stay = sim.peers.find((p) => p.engine.isSequencer())!;
    const lost = sim.peers.find((p) => p !== stay)!;
    propose(stay, [{ type: 'clipAdd', clip: 'k2', cards: ['a00', 'a02'], anchor: { card: 'a00', x: 0, y: 30 } }]);
    await expectConverged(sim.peers);
    sim.net.kill(lost.transport.selfId);
    await vi.advanceTimersByTimeAsync(150);
    propose(stay, [{ type: 'clipRemove', clip: 'k2' }]);
    await vi.advanceTimersByTimeAsync(40);
    propose(stay, [{ type: 'clipAdd', clip: 'k3', cards: ['a02', 'b00'], anchor: { card: 'b00', x: 0, y: -30 } }]);
    await vi.advanceTimersByTimeAsync(300);
    sim.net.revive(lost.transport.selfId);
    await until(() => agreed(sim.peers), 30_000, 'the reconnection');
    await expectConverged(sim.peers);
    for (const p of sim.peers) {
      expect(confirmed(p).clips?.k2).toBeUndefined();
      expect(confirmed(p).clips?.k3).toMatchObject({ cards: ['a02', 'b00'], by: stay.seat });
    }
    // Back, the other page takes k3 off; both agree again.
    propose(lost, [{ type: 'clipRemove', clip: 'k3' }]);
    await expectConverged(sim.peers);
    for (const p of sim.peers) expect(confirmed(p).clips?.k3).toBeUndefined();
  }, 120_000);
});
