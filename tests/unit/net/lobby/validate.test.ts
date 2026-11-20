/** M8-P7: validators for every lobby message (matchmaking.md 2.4; contracts.md Part E). */
import { describe, expect, it } from 'vitest';
import { MAX_LOBBY_MESSAGE, validLobbyMessage, validTicket } from '../../../../src/net/lobby/validate';
import type { LobbyMessage, Ticket } from '../../../../src/net/lobby/messages';

const ticket: Ticket = {
  v: 1,
  tid: 't-abc',
  peerId: '0123456789abcdef',
  pubKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
  name: 'Ann',
  proto: 4,
  queues: ['1v1.constructed.ranked', '1v1.constructed.casual'],
  ratings: { '1v1.constructed': { r: 1500, g: 3 } },
  band: 3,
  score: 55,
  open: false,
  nat: 'unknown',
  rev: 1,
  sig: 'c2lnbmF0dXJl',
};
const MID = '0123456789abcdef';
const valid: LobbyMessage[] = [
  { v: 1, t: 'seek', ticket, waitedMs: 1200 },
  { v: 1, t: 'beat', state: 'seeking', waitedMs: 4000, n: 2, links: ['t-x', 't-y'] },
  { v: 1, t: 'unseek' },
  { v: 1, t: 'offer', mid: MID, queue: 'ffa4.constructed.casual', members: [{ tid: 'a', rev: 1 }, { tid: 'b', rev: 2 }, { tid: 'c', rev: 1, team: 1 }] },
  { v: 1, t: 'hold', mid: MID, nonce: 'AAAAAAAAAAAAAAAAAAAAAA', sig: 'c2ln' },
  { v: 1, t: 'pass', mid: MID, reason: 'window' },
  { v: 1, t: 'ready', mid: MID },
];

const oversize = (v: unknown): unknown => {
  if (typeof v === 'string') return v + 'x'.repeat(1100);
  if (typeof v === 'number') return 1e12;
  if (Array.isArray(v)) return [...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v, ...v];
  if (typeof v === 'boolean') return 'yes';
  return { ...(v as object), extra: 'x'.repeat(3000) };
};

describe('lobby validators', () => {
  it('accept each well-formed message', () => {
    for (const m of valid) expect(validLobbyMessage(JSON.parse(JSON.stringify(m)))).not.toBeNull();
    expect(validTicket(ticket)).not.toBeNull();
  });

  it.each(valid.map((m) => [m.t, m] as const))('reject %s with any field removed or oversized', (_t, m) => {
    for (const key of Object.keys(m)) {
      const removed: Record<string, unknown> = { ...m };
      delete removed[key];
      expect(validLobbyMessage(removed), `${m.t} without ${key}`).toBeNull();
      if (key === 'v' || key === 't') continue;
      const big = { ...m, [key]: oversize((m as unknown as Record<string, unknown>)[key]) };
      expect(validLobbyMessage(big), `${m.t} with oversized ${key}`).toBeNull();
    }
    expect(validLobbyMessage({ ...m, deckName: 'Gruul' })).toBeNull();
  });

  it('reject a ticket with any field removed or oversized, and anything over 2 kB', () => {
    for (const key of Object.keys(ticket)) {
      const removed: Record<string, unknown> = { ...ticket };
      delete removed[key];
      expect(validTicket(removed), `ticket without ${key}`).toBeNull();
      expect(validTicket({ ...ticket, [key]: oversize((ticket as unknown as Record<string, unknown>)[key]) }), `ticket with oversized ${key}`).toBeNull();
    }
    expect(validTicket({ ...ticket, queues: ['1v1.constructed.ranked', '1v1.constructed.ranked'] })).toBeNull();
    expect(validTicket({ ...ticket, ratings: { 'ffa4.constructed': { r: 1, g: 1 } } })).toBeNull();
    expect(validTicket({ ...ticket, name: 'a\u0000b' })).toBeNull();
    expect(validTicket({ ...ticket, band: 6 })).toBeNull();
    expect(validLobbyMessage({ v: 1, t: 'beat', state: 'seeking', waitedMs: 1, n: 1, links: Array.from({ length: 30 }, (_, i) => `link-${'x'.repeat(60)}-${i}`) })).toBeNull();
    expect(JSON.stringify({ v: 1, t: 'seek', ticket, waitedMs: 1 }).length).toBeLessThan(MAX_LOBBY_MESSAGE);
    expect(validLobbyMessage({ v: 2, t: 'unseek' })).toBeNull();
    expect(validLobbyMessage({ v: 1, t: 'chat', text: 'hi' })).toBeNull();
  });
});
