/**
 * Helpers of the M2-P7 evening simulations: real networked sessions (session/net.ts with the evening of
 * session/draft.ts) on a LoopbackNetwork under fake timers (tests/sim/session/harness.ts), with the recorded MTGJSON
 * booster data of tests/fixtures/mtgjson/ and M2-P1's real pack generator.
 */
import { expect, vi } from 'vitest';
import type { DeckBuild, LobbySettings, SeatId, Stage } from '../../../src/core/types';
import { generatePack } from '../../../src/data/packs';
import type { SetData, SetDataSource } from '../../../src/data/types';
import type { LoopbackNetwork } from '../../../src/net/loopback';
import type { NetSessionOptions } from '../../../src/session/types';
import { fixtureSet } from '../draft/open/net';
import { browser, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';

/** The recorded set data, as the app's set source serves it. */
export function fixtureSets(): SetDataSource {
  const data = new Map<string, SetData>();
  const get = (code: string): SetData => {
    if (!data.has(code)) data.set(code, fixtureSet(code));
    return data.get(code)!;
  };
  return { listSets: () => Promise.resolve([]), get: (code) => Promise.resolve(get(code.toUpperCase())), peek: (code) => get(code.toUpperCase()) };
}

const SETS = fixtureSets();

/** What main.ts adds for drafts: set data and pack generation. */
export const EVENING_OPTS: Partial<NetSessionOptions> = { sets: SETS, generatePack };

export interface Evening {
  A: Browser;
  B: Browser;
}

/** Anna (s0, the host) and Ben (s1) seated at one table with set data. */
export async function seatedPair(network: LoopbackNetwork, browsers: Browser[]): Promise<Evening> {
  const A = await browser('anna', 'peer-a', 'Anna', 2);
  const B = await browser('ben', 'peer-b', 'Ben', 5);
  browsers.push(A, B);
  await open(network, A, {}, EVENING_OPTS);
  await open(network, B, {}, EVENING_OPTS);
  await waitConverged(both({ A, B }), 'both seated');
  expect(A.session!.seat).toBe('s0');
  expect(B.session!.seat).toBe('s1');
  return { A, B };
}

export function both(e: Evening): NetTable[] {
  return [e.A.session!, e.B.session!];
}

/** A reload of `b`'s page: everything is saved, the page is gone, and the link is opened again with the same storage. */
export async function reload(network: LoopbackNetwork, b: Browser): Promise<NetTable> {
  const s = b.session!;
  await settle(s.whenSaved());
  s.leave();
  b.session = null;
  return open(network, b, {}, EVENING_OPTS);
}

/** Wait until every session's confirmed table is in `stage`. */
export async function stageIs(e: Evening, stage: Stage, maxMs = 60_000): Promise<void> {
  await until(() => both(e).every((s) => s.engine.confirmedState().stage === stage), maxMs, `the ${stage} stage`);
}

/** The host sets the lobby and starts. */
export async function startDraft(e: Evening, lobby: LobbySettings): Promise<void> {
  const a = e.A.session!;
  a.evening!.setLobby(lobby);
  await waitConverged(both(e), 'the lobby settings');
  a.evening!.start();
  await stageIs(e, 'draft');
}

/** Pick the first card of the front pack (or confirm what is marked) wherever a pack is in front of a seat. */
export function pickWherePossible(sessions: readonly NetTable[]): void {
  for (const s of sessions) {
    const v = s.draft!.view();
    if (v.pack === null || v.picks === 0) continue;
    if (s.engine.pending().some((a) => a.type === 'pick')) continue;
    const chosen = v.marked.length === v.picks ? [...v.marked] : v.pack.cards.slice(0, v.picks).map((c) => c.id);
    s.draft!.mark(chosen);
    s.draft!.pick(chosen);
  }
}

/** Run the draft to its end (picking first cards), calling `during` after every step until it returns true once. */
export async function draftToEnd(e: Evening, during?: () => Promise<boolean>, maxMs = 600_000): Promise<void> {
  let duringDone = during === undefined;
  for (let t = 0; t <= maxMs; t += 20) {
    if (both(e).every((s) => s.engine.confirmedState().stage !== 'draft')) return;
    pickWherePossible(both(e));
    if (!duringDone) duringDone = await during!();
    await vi.advanceTimersByTimeAsync(20);
  }
  throw new Error('the draft did not finish');
}

/** A 40-card-ish deck from the own pool: the first `n` pool cards in the deck, the rest in the sideboard. */
export function deckOfFirst(build: DeckBuild, n: number): DeckBuild {
  return { ...build, main: build.cards.slice(0, n).map((c) => c.id) };
}

/** The own pool card count the table counts for `seat`. */
export function poolCount(s: NetTable, seat: SeatId): number {
  return s.engine.confirmedState().draft?.pools[seat] ?? 0;
}

/**
 * Act wherever this seat is the one the open formats wait for: take the first card of a face-up Rochester pack, take
 * (or, every other time, decline) the Winston pile looked at, take the first open row or column of the grid.
 */
export function openFormatBot(sessions: readonly NetTable[], rand: () => number): void {
  for (const s of sessions) {
    if (s.engine.pending().length > 0) continue;
    const st = s.getState();
    const d = st.draft;
    if (st.stage !== 'draft' || d === undefined || d.done) continue;
    const v = s.draft!.view();
    if (!v.waitingOn.includes(s.seat)) continue;
    if (v.pack !== null && v.pack.public && v.pack.cards.length > 0) {
      const c = v.pack.cards[Math.floor(rand() * v.pack.cards.length)]!.id;
      s.draft!.mark([c]);
      s.draft!.pick([c]);
    } else if (v.pile !== undefined) {
      s.draft!.pileLook(rand() < 0.5 || d.winston!.stack === 0);
    } else if (d.grid !== undefined) {
      for (const line of ['row', 'col'] as const) for (const i of [0, 1, 2] as const) if (s.draft!.gridTake(line, i)) return;
    }
  }
}
