/** Fixture decks and a two-to-four-seat MiniPeer table for the secrecy simulations and the leak test (no network). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base64url } from '../../src/core/hash';
import { createTable } from '../../src/core/reducer';
import type { Entropy } from '../../src/core/secrets';
import type { CardRef } from '../../src/core/types';
import { parseDecklist } from '../../src/data/decklist';
import type { CardData } from '../../src/data/types';
import { FixtureCardDataSource } from '../../src/debug/fixture-cards';
import { mtg } from '../../src/games/index';
import { LoopbackNetwork, type LoopbackOptions } from '../../src/net/loopback';
import { mulberry32 } from '../../src/util/prng';
import { MiniPeer, Player } from './minitable';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

let source: FixtureCardDataSource | null = null;
function cards(): FixtureCardDataSource {
  source ??= new FixtureCardDataSource(['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(readFileSync(join(FIXTURES, 'scryfall', f), 'utf8')) as CardData[]));
  return source;
}

/** The main deck of a fixture decklist (tests/fixtures/decklists) as card refs. */
export async function fixtureDeck(file: 'gw-m19-60.txt' | 'ur-m19-60.mtga.txt'): Promise<CardRef[]> {
  const parsed = parseDecklist(readFileSync(join(FIXTURES, 'decklists', file), 'utf8'));
  const resolved = await cards().resolveDeck(parsed.list);
  if (parsed.errors.length || resolved.errors.length) throw new Error(`fixture deck ${file} does not resolve`);
  return resolved.main;
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

/** A seeded stand-in for session/secrecy.ts's random ids and salts (tests only). */
export function testEntropy(seed: number): Entropy {
  const rand = mulberry32(seed);
  const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
  return { id: () => `c${Array.from(bytes(16), (b) => ID_ALPHABET[b & 31]).join('')}`, salt: () => base64url(bytes(16)) };
}

export interface NetTable {
  net: LoopbackNetwork;
  peers: MiniPeer[];
  players: Player[];
}

/** `names.length` seats on one LoopbackNetwork; seat s0's peer sequences. Every peer has joined when it resolves. */
export async function netTable(names: readonly string[], options: LoopbackOptions = {}): Promise<NetTable> {
  const net = new LoopbackNetwork(options);
  const start = createTable({ game: mtg, format: names.length === 2 ? '1v1' : names.length === 3 ? 'ffa3' : 'ffa4', seats: names.map((name, i) => ({ name, colour: i, peer: `p${i}` })) });
  const seats = Object.fromEntries(names.map((_, i) => [`s${i}`, `p${i}`]));
  const peers = names.map((_, i) => new MiniPeer(net, `p${i}`, `s${i}`, seats, 'p0', start));
  for (const p of peers) await p.join();
  const players = peers.map((p, i) => new Player(p, testEntropy(100 + i)));
  return { net, peers, players };
}
