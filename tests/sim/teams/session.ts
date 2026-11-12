/**
 * Four real networked sessions (session/net.ts over the M1-P1 engine, tests/sim/session/harness.ts) at a Two-Headed
 * Giant table on a LoopbackNetwork under fake timers: Anna (s0) and Ben (s1) are team t0, Cleo (s2) and Dan (s3) team
 * t1 (core/teams.ts TABLE_FORMAT_TEAMS). Test files must mock net/identity themselves (vi.mock is hoisted per file).
 */
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { InstanceId, SeatId } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import type { LoopbackNetwork } from '../../../src/net/loopback';
import type { NetSessionOptions } from '../../../src/session/types';
import { browser, open, settle, waitConverged, type Browser, type NetTable } from '../session/harness';
import type { DeckImport } from '../../../src/session/types';

export interface Table {
  browsers: Browser[];
  sessions: NetTable[];
}

export const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];

/** Four browsers seated at a '2hg' table in join order (s0..s3). */
export async function seatedTeams(network: LoopbackNetwork, all: Browser[], opts: Partial<NetSessionOptions> = {}): Promise<Table> {
  const browsers: Browser[] = [];
  for (let i = 0; i < 4; i++) {
    const b = await browser(NAMES[i]!.toLowerCase(), `peer-${i}`, NAMES[i]!, i);
    all.push(b);
    browsers.push(b);
    await open(network, b, {}, { format: '2hg', ...opts });
  }
  const sessions = browsers.map((b) => b.session!);
  await waitConverged(sessions, 'all four seated');
  sessions.forEach((s, i) => expect(s.seat).toBe(`s${i}`));
  const st = sessions[0]!.engine.confirmedState();
  expect(Object.fromEntries(Object.values(st.seats).map((s) => [s.id, s.team]))).toEqual({ s0: 't0', s1: 't0', s2: 't1', s3: 't1' });
  return { browsers, sessions };
}

/**
 * Four 40-card decks of distinct Core Set 2019 printings, one per seat, no printing in two decks: a Scryfall id in a
 * player's hand is then evidence of that player's card wherever it shows up (the leak scan stays exact).
 */
export function disjointDecks(): DeckImport[] {
  const all = (JSON.parse(readFileSync(new URL('../../fixtures/scryfall/m19.json', import.meta.url), 'utf8')) as CardData[])
    .filter((c) => !/Token/.test(c.type_line ?? ''))
    .map((c) => c.id)
    .sort();
  return [0, 1, 2, 3].map((i) => ({ main: all.slice(i * 40, i * 40 + 40).map((sid) => ({ sid })), side: [] }));
}

/** Everyone Readies its own deck (disjointDecks), shuffles and draws seven. */
export async function openingHands(t: Table): Promise<void> {
  const decks = disjointDecks();
  for (const [i, s] of t.sessions.entries()) await settle(s.importDeck(decks[i]!), 30_000, `${s.seat} ready`);
  await settle(Promise.all(t.sessions.map((s) => s.shuffle())), 60_000, 'the shuffles');
  for (const s of t.sessions) await settle(s.draw(7), 30_000, `${s.seat} draws`);
  await waitConverged(t.sessions, 'opening hands');
}

/** A seat's hand as its owner holds it: ids in the owner's arrangement with their Scryfall ids. */
export function ownHand(s: NetTable): { id: InstanceId; sid: string }[] {
  const st = s.engine.confirmedState();
  const inZone = new Set(st.zones[`hand:${s.seat}`]!.ids);
  const arranged = s.secrets().hand.filter((id) => inZone.has(id));
  const rest = [...inZone].filter((id) => !arranged.includes(id));
  return [...arranged, ...rest].map((id) => ({ id, sid: s.secrets().identities[id]!.card.sid }));
}

/** The teammate's hand as `viewer` shows it (TeamControls.hand). */
export function shownHand(viewer: NetTable, of: SeatId): { id: InstanceId; sid: string; verified: boolean }[] {
  return (viewer.team?.hand(of) ?? []).map((c) => ({ id: c.id, sid: c.ref.sid, verified: c.verified }));
}
