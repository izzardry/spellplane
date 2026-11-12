/**
 * The Two-Headed Giant draft and sealed scenarios of the shared leak test (CLAUDE.md: any code touching hidden
 * information adds its scenario to the shared leak test; DESIGN "Pre-game: draft, sealed and deck building", Hidden
 * information column: Two-Headed Giant draft "Team sees its own packs and pool", sealed "Team pool only").
 *
 * What a seat may know is derived from the public log alone (tests/leak/team.ts `teamKnowledge`): the remaining
 * cards of every pack at each of its team's turns at it, and in sealed its team's packs. Every other card of the other
 * seats' packs (salt, Scryfall id unless it knows a card of that printing, opaque id next to its Scryfall id) and every
 * other seat's pack-seed owner nonce, its teammate's included, must be absent from every message the seat received, its
 * shared state and log, its secret store and its view (tests/leak/draft.ts). The scenarios run under delay, drop and
 * reordering with a reload, so the re-sends and the answers to requests are scanned too; a negative control shows the
 * scan would see a leak.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packLeakScan } from '../../leak/draft';
import { teamKnowledge } from '../../leak/team';
import { close, generatedBy, runTeamDraft, teamBot, type TeamNet, type TeamSeat, teamNet } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const FAULTY = { seed: 29, delay: { min: 0, max: 50 }, drop: 0.05 };

function scanSeat(t: TeamNet, b: TeamSeat, extra: unknown[] = []): ReturnType<typeof packLeakScan> {
  const knowledge = teamKnowledge(t.start, t.seats[0]!.peer.log());
  const allowed = new Set([...knowledge.get(b.team)!, ...generatedBy(b).map((c) => c.instanceId)]);
  const others = t.seats.filter((x) => x !== b);
  const everything = new Map(t.seats.flatMap(generatedBy).map((c) => [c.instanceId, c]));
  return packLeakScan({
    observed: [b.peer.received, b.peer.state, b.peer.log(), b.secrets(), b.driver.view(), ...extra],
    others: others.flatMap(generatedBy),
    nonces: others.flatMap((x) => (x.secrets().draft?.generated ?? []).map((g) => g.ownerNonce)),
    allowed,
    known: [...allowed].flatMap((id) => (everything.has(id) ? [everything.get(id)!] : [])),
  });
}

function expectNoLeak(t: TeamNet): void {
  for (const b of t.seats) {
    const report = scanSeat(t, b);
    expect(report.forbidden, `${b.seat} must not know some cards`).toBeGreaterThan(0);
    expect(report.tokens, `${b.seat} tokens`).toEqual([]);
    expect(report.pairs, `${b.seat} pairs`).toEqual([]);
    // Every draftCards b received is cards its team may know at that point of the draft or later.
    const knowledge = teamKnowledge(t.start, t.seats[0]!.peer.log()).get(b.team)!;
    for (const m of b.peer.received) {
      const msg = m.msg as { t?: string; cards?: { instanceId: string }[] };
      if (m.channel !== 'prv' || msg.t !== 'draftCards') continue;
      for (const c of msg.cards ?? []) expect(knowledge.has(c.instanceId), `${b.seat} received ${c.instanceId}`).toBe(true);
    }
  }
}

describe('Two-Headed Giant leak scenarios', () => {
  it('a Two-Headed Giant draft shows each team only the packs it held, at its turns, and the cards it took', async () => {
    const t = await teamNet({ format: 'teamDraft', packs: 2, picks: 2 }, FAULTY, ['M19']);
    let reloaded = false;
    await runTeamDraft(t, teamBot(23), 900_000, (ms) => {
      if (!reloaded && ms > 300 && t.seats[2]!.driver.view().pack !== null) {
        reloaded = true;
        t.seats[2]!.reload();
      }
    });
    expect(reloaded).toBe(true);
    expectNoLeak(t);
    close(t);
  }, 120_000);

  it('Two-Headed Giant sealed shows each team only its own pool', async () => {
    const t = await teamNet({ format: 'teamSealed', packs: 4 }, FAULTY, ['M19']);
    await runTeamDraft(t, () => undefined, 900_000);
    expectNoLeak(t);
    // Negative control: a scan of what one team holds against the other team's pool finds it.
    const [anna, , cleo] = t.seats as [TeamSeat, TeamSeat, TeamSeat];
    const leaked = scanSeat(t, anna, [cleo.secrets()]);
    expect(leaked.tokens.length).toBeGreaterThan(0);
    close(t);
  }, 120_000);
});
