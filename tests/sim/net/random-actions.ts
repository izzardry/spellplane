/**
 * Random actions for the simulated-network tests: what a player at a seat could plausibly do next on the table it
 * sees (its optimistic view), weighted towards contended public cards so that concurrent players collide —
 * moving, tapping and counting each other's cards, drawing and playing from their own hidden zones, tokens, lines,
 * the stack, life and turn. Most apply on the proposer's view; collisions with other players' sequenced actions
 * produce the conflicts, nacks and rollbacks the protocol must survive.
 */
import type { Action } from '../../../src/core/actions';
import type { Anchor, CardInstance, Pose, SeatId, TableState } from '../../../src/core/types';

type Rand = () => number;

const WEIGHTS: [string, number][] = [
  ['move', 22],
  ['tap', 10],
  ['rotate', 3],
  ['counter', 6],
  ['note', 3],
  ['draw', 6],
  ['revealHand', 4],
  ['playRevealed', 5],
  ['toZone', 3],
  ['createToken', 4],
  ['removeToken', 2],
  ['life', 5],
  ['playerCounter', 2],
  ['lineAdd', 3],
  ['lineRemove', 2],
  ['phaseSet', 2],
  ['turnPass', 1],
  ['stackPush', 2],
  ['stackResolve', 2],
  ['chat', 2],
  ['attach', 2],
  ['detach', 1],
  ['flip', 2],
];
const TOTAL = WEIGHTS.reduce((n, [, w]) => n + w, 0);

const pickOf = <T>(xs: readonly T[], rand: Rand): T | undefined => (xs.length ? xs[Math.floor(rand() * xs.length)] : undefined);

function kind(rand: Rand): string {
  let r = rand() * TOTAL;
  for (const [k, w] of WEIGHTS) {
    r -= w;
    if (r < 0) return k;
  }
  return 'move';
}

const pose = (rand: Rand): Pose => ({ x: Math.round(rand() * 800 - 400), y: Math.round(rand() * 600 - 300), rot: [0, 90, 180, 270][Math.floor(rand() * 4)]! });

/** A random action by `seat` against `state` (its view), or null when the pick has nothing to act on. */
export function randomAction(state: TableState, seat: SeatId, rand: Rand, cid: string): Action | null {
  const base = { by: seat, cid };
  const seats = Object.keys(state.seats).sort();
  const cards = Object.values(state.cards).sort((a, b) => (a.id < b.id ? -1 : 1));
  const onField = cards.filter((c) => c.zone.startsWith('battlefield:'));
  const isPublic = (c: CardInstance): boolean => state.zones[c.zone]?.visibility === 'public' && c.zone !== 'stack';
  const pub = cards.filter(isPublic);
  const ownHand = state.zones[`hand:${seat}`]?.ids ?? [];
  const ownLib = state.zones[`library:${seat}`]?.ids ?? [];
  const k = kind(rand);
  switch (k) {
    case 'move': {
      const c = pickOf(pub, rand);
      if (!c) return null;
      const r = rand();
      const to = r < 0.75 ? `battlefield:${pickOf(seats, rand)!}` : r < 0.9 ? `graveyard:${c.owner}` : `exile:${c.owner}`;
      return { ...base, type: 'move', card: c.id, to, pose: pose(rand) };
    }
    case 'tap': {
      const c = pickOf(onField, rand);
      return c ? { ...base, type: 'tap', card: c.id, tapped: !c.tapped } : null;
    }
    case 'rotate': {
      const c = pickOf(onField, rand);
      return c ? { ...base, type: 'rotate', card: c.id, delta: 180 } : null;
    }
    case 'counter': {
      const c = pickOf(onField, rand);
      return c ? { ...base, type: 'counter', card: c.id, kind: rand() < 0.7 ? '+1/+1' : 'loyalty', delta: rand() < 0.7 ? 1 : -1 } : null;
    }
    case 'note': {
      const c = pickOf(onField, rand);
      return c ? { ...base, type: 'note', card: c.id, text: rand() < 0.8 ? `note ${cid}` : '' } : null;
    }
    case 'draw': {
      const id = ownLib[0];
      return id ? { ...base, type: 'draw', instanceId: id } : null;
    }
    case 'revealHand': {
      const id = pickOf(ownHand.filter((h) => !state.cards[h]?.identity), rand);
      return id ? { ...base, type: 'reveal', instanceId: id, ref: { sid: `sid-${id}` }, salt: `salt-${id}` } : null;
    }
    case 'playRevealed': {
      const id = pickOf(ownHand.filter((h) => state.cards[h]?.identity), rand);
      return id ? { ...base, type: 'move', card: id, to: `battlefield:${seat}`, pose: pose(rand) } : null;
    }
    case 'toZone': {
      const c = pickOf(pub.filter((x) => x.owner === seat && !x.isToken), rand);
      return c ? { ...base, type: 'toZone', card: c.id, to: rand() < 0.5 ? `hand:${seat}` : `library:${seat}`, position: rand() < 0.5 ? 'top' : 'bottom' } : null;
    }
    case 'createToken':
      return { ...base, type: 'createToken', card: `tok-${cid}`, zone: `battlefield:${seat}`, pose: pose(rand), ref: { sid: 'token-cat' } };
    case 'removeToken': {
      const c = pickOf(cards.filter((x) => x.isToken), rand);
      return c ? { ...base, type: 'remove', card: c.id } : null;
    }
    case 'life':
      return { ...base, type: 'life', seat: pickOf(seats, rand)!, delta: rand() < 0.6 ? -1 : 2 };
    case 'playerCounter':
      return { ...base, type: 'playerCounter', seat: pickOf(seats, rand)!, kind: 'poison', delta: 1 };
    case 'lineAdd': {
      const a = pickOf(onField, rand);
      const b = pickOf(onField, rand);
      if (!a || !b) return null;
      const to: Anchor = rand() < 0.3 ? { kind: 'seat', id: pickOf(seats, rand)! } : { kind: 'card', id: b.id };
      return { ...base, type: 'lineAdd', line: `line-${cid}`, kind: rand() < 0.5 ? 'target' : 'mark', from: { kind: 'card', id: a.id }, to };
    }
    case 'lineRemove': {
      const l = pickOf(Object.keys(state.lines).sort(), rand);
      return l ? { ...base, type: 'lineRemove', line: l } : null;
    }
    case 'phaseSet':
      return { ...base, type: 'phaseSet', phase: pickOf(['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'], rand)! };
    case 'turnPass':
      return { ...base, type: 'turnPass', to: pickOf(seats, rand)! };
    case 'stackPush': {
      const c = pickOf(onField, rand);
      return c ? { ...base, type: 'stackPush', item: `item-${cid}`, kind: 'ability', source: c.id, note: 'draw a card' } : null;
    }
    case 'stackResolve': {
      const top = state.stack[state.stack.length - 1];
      return top ? { ...base, type: 'stackResolve', item: top.id } : null;
    }
    case 'chat':
      return { ...base, type: 'chat', text: `gg ${cid}`, channel: 'table' };
    case 'attach': {
      const a = pickOf(onField, rand);
      const b = pickOf(onField, rand);
      return a && b && a.id !== b.id ? { ...base, type: 'attach', card: a.id, to: b.id } : null;
    }
    case 'detach': {
      const c = pickOf(onField.filter((x) => x.attachedTo), rand);
      return c ? { ...base, type: 'detach', card: c.id } : null;
    }
    case 'flip': {
      const c = pickOf(onField.filter((x) => x.identity), rand);
      return c ? { ...base, type: 'flip', card: c.id, face: c.face === 'up' ? 'down' : 'up' } : null;
    }
  }
  return null;
}
