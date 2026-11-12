/**
 * Networked sessions on a LoopbackNetwork under Vitest fake timers (PLAN M1-P8; CLAUDE.md test harnesses). Every
 * session is the real one (session/net.ts over the M1-P1 engine and the M1-P2 pair channel) with its own fake
 * IndexedDB; only the identity's Web Crypto is replaced (tests/sim/net/fake-identity.ts: ECDSA settles outside the
 * fake clock). Test files must `vi.mock('../../../src/net/identity', …)` themselves (vi.mock is hoisted per file).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { sha256Sync } from '../../../src/core/sha256';
import type { InstanceId, SeatId, TableState } from '../../../src/core/types';
import { parseDecklist } from '../../../src/data/decklist';
import type { CardData } from '../../../src/data/types';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import { mtg } from '../../../src/games/index';
import { LoopbackNetwork, type LoopbackOptions } from '../../../src/net/loopback';
import { memoryNonces, type NonceStore } from '../../../src/session/nonces';
import { openNetSession, type NetSessionInternals, type NetTable } from '../../../src/session/net';
import type { DeckImport, NetSessionOptions } from '../../../src/session/types';
import { STORE_NAMES } from '../../../src/store/db';
import { openStores, type LocalStores } from '../../../src/store/stores';
import type { Disclosure } from '../../leak/leak';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

export const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as ('setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'Date')[] };

let source: FixtureCardDataSource | null = null;
export function cards(): FixtureCardDataSource {
  source ??= new FixtureCardDataSource(['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(readFileSync(join(FIXTURES, 'scryfall', f), 'utf8')) as CardData[]));
  return source;
}

/** A fixture decklist resolved against the fixtures. */
export async function fixtureDeck(file: 'gw-m19-60.txt' | 'ur-m19-60.mtga.txt'): Promise<DeckImport> {
  const parsed = parseDecklist(readFileSync(join(FIXTURES, 'decklists', file), 'utf8'));
  const resolved = await cards().resolveDeck(parsed.list);
  if (parsed.errors.length || resolved.errors.length) throw new Error(`fixture deck ${file} does not resolve`);
  return { main: resolved.main, side: resolved.side };
}

/** Card name by Scryfall id (fixtures). */
export function nameOf(sid: string): string {
  return cards().peek(sid)?.name ?? '?';
}

export function typeOf(sid: string): string {
  return cards().peek(sid)?.type_line ?? '';
}

/** Advance fake timers until `done()` holds; fails after `maxMs` of table time. */
export async function until(done: () => boolean, maxMs = 30_000, what = 'condition'): Promise<void> {
  for (let t = 0; t <= maxMs; t += 10) {
    if (done()) return;
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Advance fake timers until the promise settles; returns its value or throws its error. */
export async function settle<T>(p: Promise<T>, maxMs = 30_000, what = 'promise'): Promise<T> {
  let out: { ok: true; v: T } | { ok: false; e: unknown } | null = null;
  p.then(
    (v) => (out = { ok: true, v }),
    (e: unknown) => (out = { ok: false, e }),
  );
  await until(() => out !== null, maxMs, what);
  const r = out as unknown as { ok: true; v: T } | { ok: false; e: unknown };
  if (!r.ok) throw r.e;
  return r.v;
}

export const hashOf = (s: TableState): string => sha256Sync(canonicalJson(s));

let dbCounter = 0;

/** One browser: its profile's stores, its nonce store and (once open) its session. */
export interface Browser {
  name: string;
  peerId: string;
  stores: LocalStores;
  nonces: NonceStore;
  /** A live nickname cell, as main.ts hands it (the lobby renames through the IdentityStore). */
  identity: NetSessionOptions['identity'];
  session: NetTable | null;
}

export function browser(name: string, peerId: string, nickname = name, seatColour = 0): Promise<Browser> {
  return openStores(`net-${name}-${++dbCounter}-${Math.random().toString(36).slice(2, 8)}`).then((stores) => ({
    name,
    peerId,
    stores,
    nonces: memoryNonces(),
    identity: { keyPair: {} as CryptoKeyPair, peerId, nickname, seatColour },
    session: null,
  }));
}

export const ROOM = 'amber-fox-river-42';
export const KEY = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Open `b`'s session on `net` (a fresh transport each time, as a reload would) and wait until it holds a chair. */
export async function open(net: LoopbackNetwork, b: Browser, internals: NetSessionInternals = {}, opts: Partial<NetSessionOptions> = {}): Promise<NetTable> {
  const p = openNetSession(
    {
      game: mtg,
      cardData: cards(),
      roomId: ROOM,
      roomKey: KEY,
      transport: () => net.create(b.peerId),
      identity: b.identity,
      store: b.stores.tables,
      ...opts,
    },
    { nonces: b.nonces, ...internals },
  );
  b.session = await settle(p, 60_000, `${b.name} to take a chair`);
  return b.session;
}

export function net(options: LoopbackOptions = {}): LoopbackNetwork {
  return new LoopbackNetwork({ seed: 7, delay: { min: 5, max: 60 }, ...options });
}

/** Both sessions confirmed the same seq with nothing pending, and agree on the state hash. */
export function converged(sessions: readonly NetTable[]): boolean {
  if (sessions.some((s) => s.engine.pending().length > 0)) return false;
  const seqs = new Set(sessions.map((s) => s.engine.seq()));
  if (seqs.size !== 1) return false;
  return new Set(sessions.map((s) => hashOf(s.engine.confirmedState()))).size === 1;
}

export async function waitConverged(sessions: readonly NetTable[], what = 'the sessions to converge'): Promise<string> {
  await until(() => converged(sessions), 30_000, what);
  return hashOf(sessions[0]!.engine.confirmedState());
}

/** Every record of a profile's IndexedDB. */
export async function dump(stores: LocalStores): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const name of STORE_NAMES) out.push(...(await stores.db.getAll(name)));
  return out;
}

/** What browser `b` could have seen: every message it received (engine log and loopback deliveries), its state, log, secrets and IndexedDB. */
export async function observedBy(network: LoopbackNetwork, b: Browser): Promise<unknown[]> {
  const s = b.session!;
  const delivered = network.delivered.filter((d) => d.to === b.peerId).map((d) => d.msg);
  const received = s.engine.messages().filter((r) => r.dir === 'in');
  return [...delivered, ...received, s.getState(), s.engine.confirmedState(), s.log(), s.secrets(), ...(await dump(b.stores))];
}

/**
 * What the owner deliberately showed `to`, taken from the owner's side: its sequenced public reveals and flips with
 * an identity, and its targeted reveals naming `to` (identity and salt from the owner's store at that moment). A
 * disclosed card that later went back into a hidden zone lapses (tests/leak/leak.ts Disclosure).
 */
export function trackDisclosures(owner: NetTable, to: SeatId): Disclosure[] {
  const out: Disclosure[] = [];
  let prior: TableState = owner.engine.confirmedState();
  owner.engine.onSequenced((a: Action) => {
    const next = owner.engine.confirmedState();
    const me = owner.seat;
    const add = (id: InstanceId, sid: string, salt: string): void => void out.push({ instanceId: id, sid, salt });
    if (a.by === me && a.type === 'reveal') add(a.instanceId, a.ref.sid, a.salt);
    if (a.by === me && a.type === 'flip' && a.ref && a.salt) add(a.card, a.ref.sid, a.salt);
    if (a.by === me && a.type === 'revealTo' && a.seats.includes(to)) {
      const s = owner.secrets().identities[a.instanceId];
      if (s) add(a.instanceId, s.card.sid, s.salt);
    }
    for (const d of out) {
      const before = prior.cards[d.instanceId];
      const now = next.cards[d.instanceId];
      if (before && now && prior.zones[before.zone]?.visibility === 'public' && next.zones[now.zone]?.visibility !== 'public') d.lapsed = true;
    }
    prior = next;
  });
  return out;
}

/** Close every session and store of these browsers. */
export function closeAll(browsers: readonly Browser[]): void {
  for (const b of browsers) {
    b.session?.leave();
    b.stores.close();
  }
}

export type { NetTable };
