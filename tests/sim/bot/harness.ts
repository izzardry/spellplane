/**
 * M8-P6: computer games in simulation. The real createComputerGame (two networked sessions over a LocalNetwork) under
 * Vitest fake timers, fixture card data, fake key pairs (Web Crypto settles outside the fake clock), seeded entropy,
 * and a scripted human that plays lands and creatures, attacks with everything and presses the cues.
 * Test files must `vi.mock('../../../src/net/identity', …)` themselves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { sha256Sync } from '../../../src/core/sha256';
import type { InstanceId, TableState } from '../../../src/core/types';
import { combatCue, actionsOf, turnWindow } from '../../../src/bot/cues';
import { firstTurnOfGame } from '../../../src/bot/view';
import { CUE_LABELS } from '../../../src/bot/types';
import { buildStarterFromPool } from '../../../src/data/starter';
import type { CardData } from '../../../src/data/types';
import { fixtureStarterPool } from '../../../src/debug/fixture-starter';
import { FixtureCardDataSource } from '../../../src/debug/fixture-cards';
import { LocalNetwork, timeoutScheduler, type LocalDelivery } from '../../../src/net/local';
import { botSessionOf, createComputerGame, resumeComputerGame, type BotKeys, type ComputerDeps } from '../../../src/session/computer';
import type { NetTable } from '../../../src/session/net';
import { memoryNonces } from '../../../src/session/nonces';
import type { ComputerGame, DeckImport } from '../../../src/session/types';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { testEntropy } from '../../leak/fixtures';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
export const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as ('setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'Date')[] };

let all: CardData[] | null = null;
export function fixtureCards(): CardData[] {
  all ??= ['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(readFileSync(join(FIXTURES, 'scryfall', f), 'utf8')) as CardData[]);
  return all;
}
export function starterPoolFixture(): CardData[] {
  return JSON.parse(readFileSync(join(FIXTURES, 'starter', 'starter-pool.m19.json'), 'utf8')) as CardData[];
}
let src: FixtureCardDataSource | null = null;
export function cards(): FixtureCardDataSource {
  src ??= new FixtureCardDataSource(fixtureCards());
  return src;
}

export const fakeBotKeys: BotKeys = {
  create: () => Promise.resolve({ privateJwk: {}, publicJwk: {}, peerId: 'peer-sparring', nickname: 'Sparring', seatColour: 3 }),
  open: () => Promise.resolve({} as CryptoKeyPair),
};

/** Advance fake timers until `done()` holds. */
export async function until(done: () => boolean, maxMs = 60_000, what = 'condition', step = 50): Promise<void> {
  for (let t = 0; t <= maxMs; t += step) {
    if (done()) return;
    await vi.advanceTimersByTimeAsync(step);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function settle<T>(p: Promise<T>, maxMs = 60_000, what = 'promise'): Promise<T> {
  let out: { ok: true; v: T } | { ok: false; e: unknown } | null = null;
  p.then(
    (v) => (out = { ok: true, v }),
    (e: unknown) => (out = { ok: false, e }),
  );
  await until(() => out !== null, maxMs, what, 10);
  const r = out as unknown as { ok: true; v: T } | { ok: false; e: unknown };
  if (!r.ok) throw r.e;
  return r.v;
}

export const hashOf = (s: TableState): string => sha256Sync(canonicalJson(s));

/** The human's deck: a green starter from the fixture pool. */
export function humanDeck(colour: 'G' | 'R' | 'W' = 'G', seed = 'human'): DeckImport {
  return { main: buildStarterFromPool(starterPoolFixture(), { colour, seed }).main, side: [] };
}

let dbs = 0;
export interface Sim {
  stores: LocalStores;
  deps: ComputerDeps;
  net: LocalNetwork;
  deliveries: LocalDelivery[];
  game: ComputerGame;
  human: NetTable;
  bot: NetTable;
}

/** Deps for a profile; `record` collects the LocalNetwork deliveries. */
export async function simDeps(seed: number, opts: { stores?: LocalStores; tap?: boolean; starter?: boolean } = {}): Promise<{ deps: ComputerDeps; stores: LocalStores; net: LocalNetwork; deliveries: LocalDelivery[] }> {
  const stores = opts.stores ?? (await openStores(`bot-sim-${seed}-${++dbs}`));
  const deliveries: LocalDelivery[] = [];
  const net = new LocalNetwork({ scheduler: timeoutScheduler(), ...(opts.tap === true ? { tap: (d: LocalDelivery) => void deliveries.push(d) } : {}) });
  const deps: ComputerDeps = {
    cardData: cards(),
    identity: { keyPair: {} as CryptoKeyPair, peerId: 'peer-human', nickname: 'Ann', seatColour: 0 },
    tables: stores.tables,
    computer: stores.computer,
    starter: opts.starter === false ? null : fixtureStarterPool(fixtureCards()),
    botKeys: fakeBotKeys,
    network: net,
    internals: { human: { nonces: memoryNonces(), entropy: testEntropy(seed * 2 + 1) }, bot: { nonces: memoryNonces(), entropy: testEntropy(seed * 2 + 2) } },
    onError: (e) => {
      throw e;
    },
  };
  return { deps, stores, net, deliveries };
}

/** A new computer game under fake timers. */
export async function newGame(seed: number, opts: { tap?: boolean; starter?: boolean; deck?: DeckImport; clock?: ComputerDeps['clock'] } = {}): Promise<Sim> {
  const d = await simDeps(seed, opts);
  if (opts.clock) d.deps.clock = opts.clock;
  const game = await settle(createComputerGame({ roomId: `c-sim-${seed}`, deckId: null, deck: opts.deck ?? humanDeck(), colour: 'R', seed: `seed-${seed}`, deps: d.deps }), 120_000, 'the computer game');
  const bot = botOf(d.net, game);
  return { ...d, game, human: game.session as NetTable, bot };
}

/** Reopen a saved game from the same profile. */
export async function resumeGame(seed: number, stores: LocalStores, opts: { tap?: boolean; clock?: ComputerDeps['clock'] } = {}): Promise<Sim> {
  const d = await simDeps(seed + 1000, { stores, ...(opts.tap !== undefined ? { tap: opts.tap } : {}) });
  if (opts.clock) d.deps.clock = opts.clock;
  const game = await settle(resumeComputerGame(`c-sim-${seed}`, d.deps), 120_000, 'the resumed game');
  return { ...d, game, human: game.session as NetTable, bot: botOf(d.net, game) };
}

/** The bot session (tests reach it through the runner's port only by state; here through the handle's internals). */
function botOf(_net: LocalNetwork, game: ComputerGame): NetTable {
  return botSessionOf(game.handle)!;
}

const kindOf = (sid: string | undefined): string => (sid ? (cards().peek(sid)?.type_line ?? '') : '');

/**
 * The scripted human: one gesture per call, by the table. It untaps, draws, plays a land, casts the creatures it can
 * pay for (and resolves them once Sparring passed), attacks with every untapped creature that did not arrive this turn,
 * presses Attack and Damage, settles, and passes. On Sparring's turn it answers rounds and presses "Blocks done"
 * without blocking.
 */
export function scriptedHuman(h: NetTable, botSeat: string): () => boolean {
  const me = h.seat;
  let n = 0;
  const id = (p: string): string => `${me}.h${p}${h.getState().seq}.${++n}`;
  return () => {
    if (h.engine.pending().length > 0) return false;
    const st = h.getState();
    if (st.result !== undefined || st.stage !== 'match') return false;
    const d = (a: ActionDraft): Action => h.dispatch(a);
    const conf = st.confirm;
    if (conf && conf.askedBy !== me && conf.responses[me] === undefined) {
      d({ type: 'respond', round: conf.id, seat: me, response: 'ok' });
      return true;
    }
    // Wait while Sparring has not answered the own round (a cue or a spell).
    if (conf && conf.askedBy === me && conf.responses[botSeat] === undefined) return false;
    const window = turnWindow(actionsOf(h.log()));
    const mineDone = (t: Action['type']): boolean => window.some((a) => a.by === me && a.type === t);
    const cue = combatCue(st, h.log(), me, botSeat);
    if (st.turn.active !== me) {
      if (cue?.kind === 'blocksDone') {
        d({ type: 'ask', round: id('r'), label: CUE_LABELS.blocksDone });
        return true;
      }
      return false;
    }
    const bf = (st.zones[`battlefield:${me}`]?.ids ?? []).map((x) => st.cards[x]!).filter((c) => c.owner === me);
    const sec = h.secrets();
    const handIds = sec.hand.filter((x) => st.cards[x]?.zone === `hand:${me}`);
    const sidOf = (x: InstanceId): string | undefined => st.cards[x]?.identity?.sid ?? sec.identities[x]?.card.sid;
    if (!mineDone('phaseSet')) {
      const g = id('g');
      for (const c of bf) if (c.tapped) d({ type: 'tap', card: c.id, tapped: false, group: g });
      d({ type: 'phaseSet', phase: 'main1', group: g });
      return true;
    }
    if (!mineDone('draw') && !firstTurnOfGame(st, actionsOf(h.log()))) {
      void h.draw(1);
      return true;
    }
    if (cue?.kind === 'attack' || cue?.kind === 'damage') {
      d({ type: 'ask', round: id('r'), label: CUE_LABELS[cue.kind] });
      return true;
    }
    const top = st.stack[st.stack.length - 1];
    if (top) {
      if (top.controller !== me) return false;
      if (conf && conf.about === top.id && conf.responses[botSeat] === undefined) return false;
      d({ type: 'stackResolve', item: top.id, to: `battlefield:${me}` });
      return true;
    }
    const played = window.filter((a) => a.by === me && (a.type === 'move' || a.type === 'stackPush')).map((a) => (a.type === 'move' ? a.card : (a as { card?: string }).card));
    if (!window.some((a) => a.by === me && a.type === 'move' && /Land/.test(kindOf(sidOf(a.card))))) {
      const land = handIds.find((x) => /Land/.test(kindOf(sidOf(x))));
      if (land) {
        d({ type: 'move', card: land, to: `battlefield:${me}`, pose: { x: -400 + 70 * bf.length, y: -480, rot: 0 } });
        return true;
      }
    }
    const lands = bf.filter((c) => !c.tapped && /Land/.test(kindOf(c.identity?.sid)));
    const castable = handIds.find((x) => /Creature/.test(kindOf(sidOf(x))) && (cards().peek(sidOf(x)!)?.cmc ?? 99) <= lands.length);
    if (castable && !window.some((a) => a.by === me && a.type === 'moveTemp')) {
      const g = id('g');
      const cmc = cards().peek(sidOf(castable)!)!.cmc;
      for (const l of lands.slice(0, cmc)) d({ type: 'tap', card: l.id, tapped: true, group: g });
      d({ type: 'stackPush', item: id('si'), kind: 'spell', card: castable, controller: me, round: id('r') });
      return true;
    }
    if (!mineDone('moveTemp') && !window.some((a) => a.by === me && a.type === 'ask')) {
      const attackers = bf.filter((c) => !c.tapped && /Creature/.test(kindOf(c.identity?.sid)) && !played.includes(c.id));
      if (attackers.length > 0) {
        const g = id('g');
        for (const c of attackers) d({ type: 'moveTemp', card: c.id, pose: { x: c.pose.x, y: c.pose.y + 110, rot: c.pose.rot }, combat: 'attack', tap: true, group: g });
        return true;
      }
    }
    const displaced = bf.filter((c) => c.home !== undefined).map((c) => c.id);
    if (displaced.length > 0) {
      d({ type: 'settle', cards: displaced });
      return true;
    }
    const g = id('g');
    d({ type: 'turnPass', to: botSeat, group: g });
    d({ type: 'phaseSet', phase: 'untap', group: g });
    return true;
  };
}

/** Play until `done` or the turn cap: the scripted human acts every 300 ms of table time; Sparring runs on its pace. */
export async function play(sim: Sim, done: (s: TableState) => boolean, maxTurns = 40, maxMs = 3_600_000): Promise<void> {
  const act = scriptedHuman(sim.human, sim.game.handle.seat);
  for (let t = 0; t < maxMs; t += 300) {
    const s = sim.human.getState();
    if (done(s) || s.turn.number > maxTurns) return;
    act();
    await vi.advanceTimersByTimeAsync(300);
  }
}
