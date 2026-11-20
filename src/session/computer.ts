/**
 * A game against Sparring, the computer opponent (computer.md sections 3 and 10; contracts.md Part G "Computer
 * opponent"). Two networked sessions on one room over an in-page `LocalNetwork`: the human's (seat s0, host and
 * sequencer, `createdHere`) and Sparring's (seat s1, `neverAlone`, its own key pair kept as JWK in the computer record,
 * never a CryptoKey in IndexedDB, its own secret store and its own save under `bot~<roomId>`). Nothing joins a
 * signalling relay. The route receives the human session and a `ComputerHandle`, never the bot session.
 *
 * Setup (idempotent, so a resume runs it again harmlessly): the host sets constructed decks and a 3 s pass timer, both
 * import their deck if none is committed, the host starts the match, both deal their opening hand once, the host rolls
 * for the first player, then the runner starts.
 */
import { combatCue } from '../bot/cues';
import { createBotRunner, type BotRunner } from '../bot/runner';
import type { BotClock, BotSeatPort, Colour } from '../bot/types';
import { COLOURS } from '../bot/types';
import type { BotConfig, TableState } from '../core/types';
import { buildStarterDeck, sparringDeckName, type StarterPoolSource } from '../data/starter';
import type { CardDataSource } from '../data/types';
import { mtg } from '../games/index';
import type { GameDefinition } from '../games/types';
import { LocalNetwork } from '../net/local';
import { BOT_TABLE_PREFIX, deleteComputerRows, prefixedTableStore } from '../store/computer';
import { generateIdentity, toIdentityRecord } from '../store/identity';
import type { ComputerGameRecord, ComputerStore, DeckStore, ExportedIdentity, OpponentDeckChoice, TableStore } from '../store/types';
import { dealOpening, importIfNeeded, rollFirstPlayer } from './entry';
import { openNetSession, type NetSessionInternals, type NetTable } from './net';
import type { ComputerGame, ComputerHandle, ComputerStatus, DeckImport, SessionIdentity } from './types';

/** How the bot's key pair is made and opened (tests inject a fake: Web Crypto settles outside fake timers). */
export interface BotKeys {
  create(): Promise<ExportedIdentity>;
  open(e: ExportedIdentity): Promise<CryptoKeyPair>;
}

/** The real key pair: ECDSA P-256 exported as JWK; opened with a non-extractable private key. */
export const WEB_CRYPTO_BOT_KEYS: BotKeys = {
  async create() {
    const s = await generateIdentity();
    return { privateJwk: s.privateJwk!, publicJwk: s.publicJwk!, peerId: s.peerId, nickname: 'Sparring', seatColour: s.seatColour };
  },
  async open(e) {
    const r = await toIdentityRecord({ id: 'me', privateJwk: e.privateJwk, publicJwk: e.publicJwk, peerId: e.peerId, nickname: e.nickname, seatColour: e.seatColour });
    return r.keyPair;
  },
};

/** What a computer game needs from the page (main.ts, the route) or a test. */
export interface ComputerDeps {
  cardData: CardDataSource;
  identity: SessionIdentity;
  /** Persistence; null: the game runs unsaved (storage blocked, computer.md 10.4). */
  tables: TableStore | null;
  computer: ComputerStore | null;
  game?: GameDefinition;
  /** Where Sparring's starter deck comes from; null: Mirror. */
  starter?: StarterPoolSource | null;
  /** The bot's clock; default the page's timers. */
  clock?: BotClock;
  /** The in-page network (tests attach a tap); default a new one. */
  network?: LocalNetwork;
  internals?: { human?: NetSessionInternals; bot?: NetSessionInternals };
  botKeys?: BotKeys;
  now?: () => number;
  /** The deck library: a game for a deck id takes the human's deck from it. */
  decks?: DeckStore | null;
  /** A one-line notice for a toast (the Mirror fallback). */
  notice?: (text: string) => void;
  onError?: (e: unknown) => void;
}

/** What a new computer game needs (computer.md section 3). */
export interface ComputerGameOptions {
  roomId: string;
  /** The human's deck record id, or null for a starter deck. */
  deckId: string | null;
  /** Added by M8-P6: the human's deck and its name. */
  deck?: DeckImport;
  deckName?: string;
  /** Added by M8-P6: Sparring's colour; default a colour the human's deck does not mainly use, chosen by the seed. */
  colour?: Colour;
  /** Added by M8-P6: the bot's seed (64 hex characters); default random. */
  seed?: string;
  /** Added by M8-P6: the page's stores and services. */
  deps?: ComputerDeps;
}

/**
 * The room key of a computer game. The LocalNetwork never uses it, but a networked session ignores a save whose room key
 * is empty (that marks the solo table), so it must not be ''.
 */
export const COMPUTER_ROOM_KEY = 'computer';

/** Whether this build has a computer opponent. */
export const COMPUTER_AVAILABLE: boolean = true;

/** The text of the Mirror fallback toast (computer.md 10.4). */
export const MIRROR_NOTICE = "Couldn't load a sparring deck. Sparring mirrors your deck.";

function randomSeed(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** A colour the human's deck does not mainly use, chosen by the seed (computer.md 2.1 `auto`). */
export function autoColour(deck: DeckImport, cardData: CardDataSource, seed: string): Colour {
  const counts: Partial<Record<Colour, number>> = {};
  for (const r of deck.main) for (const c of cardData.peek(r.sid)?.colors ?? []) if ((COLOURS as readonly string[]).includes(c)) counts[c as Colour] = (counts[c as Colour] ?? 0) + 1;
  const main = COLOURS.reduce<Colour | null>((m, c) => ((counts[c] ?? 0) > (m ? (counts[m] ?? 0) : 0) ? c : m), null);
  const options = COLOURS.filter((c) => c !== main);
  return options[parseInt(seed.slice(0, 8) || '0', 16) % options.length]!;
}

const pageClock: BotClock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Resolve when `pred` holds for the session's state (checked on every change). */
function when(session: NetTable, pred: (s: TableState) => boolean, ms = 30_000, what = 'the table'): Promise<void> {
  if (pred(session.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const off = session.subscribe((s) => {
      if (!pred(s)) return;
      clearTimeout(t);
      off();
      resolve();
    });
    const t = setTimeout(() => {
      off();
      reject(new Error(`M8-P6: timed out waiting for ${what}`));
    }, ms);
  });
}

let pageDeps: (() => Promise<ComputerDeps>) | null = null;

/**
 * The page's services for computer games (main.ts registers them once): a call without `deps` (the route, main.ts's
 * `openComputer`) takes them from here. Null forgets them.
 */
export function provideComputerDeps(provider: (() => Promise<ComputerDeps>) | null): void {
  pageDeps = provider;
}

async function needDeps(deps: ComputerDeps | undefined): Promise<ComputerDeps> {
  if (deps) return deps;
  if (pageDeps) return pageDeps();
  throw new Error('M8-P6: a computer game needs the page stores and card data');
}

/** The colour of a newcomer's starter deck (journey.md section 6: `STARTER · GREEN`). */
export const STARTER_COLOUR: Colour = 'G';

/** The human's deck: the one given, the library deck of `deckId`, else a green starter deck (journey.md J26). */
async function humanDeckOf(opts: ComputerGameOptions, deps: ComputerDeps, seed: string): Promise<{ deck: DeckImport; name: string }> {
  if (opts.deck) return { deck: opts.deck, name: opts.deckName ?? 'Your deck' };
  if (opts.deckId && deps.decks) {
    const r = await deps.decks.get(opts.deckId);
    if (r) return { deck: { main: r.main.map((c) => ({ ...c })), side: r.side.map((c) => ({ ...c })) }, name: opts.deckName ?? r.name };
  }
  if (!deps.starter) throw new Error('M8-P6: no deck for this game and no starter pool');
  const d = await buildStarterDeck(deps.starter, { colour: STARTER_COLOUR, seed: `human|${seed}` });
  return { deck: { main: d.main, side: [] }, name: d.name };
}

interface Opened {
  human: NetTable;
  bot: NetTable;
  net: LocalNetwork;
}

async function openBoth(roomId: string, deps: ComputerDeps, botIdentity: SessionIdentity): Promise<Opened> {
  const game = deps.game ?? mtg;
  const net = deps.network ?? new LocalNetwork();
  const base = { game, cardData: deps.cardData, roomId, roomKey: COMPUTER_ROOM_KEY, format: '1v1' as const, ...(deps.now ? { now: deps.now } : {}) };
  let human: NetTable | null = null;
  try {
    human = await openNetSession(
      { ...base, transport: () => net.create(deps.identity.peerId), identity: deps.identity, ...(deps.tables ? { store: deps.tables } : {}) },
      { createdHere: true, settleMs: 0, loneWaitMs: 0, ...deps.internals?.human },
    );
    const bot = await openNetSession(
      { ...base, transport: () => net.create(botIdentity.peerId), identity: botIdentity, ...(deps.tables ? { store: prefixedTableStore(deps.tables, BOT_TABLE_PREFIX) } : {}) },
      { neverAlone: true, settleMs: 0, loneWaitMs: 0, ...deps.internals?.bot },
    );
    return { human, bot, net };
  } catch (e) {
    human?.dispose();
    if (!deps.network) net.dispose();
    throw e;
  }
}

/** The automatic setup (idempotent): decks, the match, opening hands, the first player. */
async function setUp(o: Opened, humanDeck: DeckImport | null, botDeck: DeckImport | null): Promise<void> {
  const { human, bot } = o;
  await when(human, (s) => Object.values(s.seats).filter((x) => x.peer !== undefined).length >= 2, 30_000, 'both seats');
  const st = human.getState();
  if (st.stage === 'lobby') {
    human.evening?.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    if (st.settings.passTimerMs !== 3000) human.dispatch({ type: 'settings', settings: { passTimerMs: 3000 } });
  }
  if (humanDeck) await importIfNeeded(human, humanDeck);
  if (botDeck) await importIfNeeded(bot, botDeck);
  const committed = (s: TableState): boolean => Object.hasOwn(s.commitments, human.seat) && Object.hasOwn(s.commitments, bot.seat);
  await when(human, committed, 30_000, 'both decks');
  await when(bot, committed, 30_000, 'both decks at Sparring');
  if (human.getState().stage === 'lobby') human.evening?.start();
  await when(human, (s) => s.stage === 'match', 30_000, 'the match');
  await when(bot, (s) => s.stage === 'match', 30_000, 'the match at Sparring');
  await dealOpening(human);
  await dealOpening(bot);
  const first = await rollFirstPlayer(human, { creator: true });
  // The setup is over only when both copies hold it: a game left at once then resumes without a half-done shuffle.
  const game = (s: TableState): number => s.games ?? 0;
  const dealt = (s: TableState): boolean => s.seats[human.seat]?.dealt === game(s) && s.seats[bot.seat]?.dealt === game(s);
  const quiet = (): boolean => human.engine.pending().length === 0 && bot.engine.pending().length === 0 && human.engine.seq() === bot.engine.seq();
  const started = (t: TableState): boolean => first === null || t.turn.active === (t.seats[first]?.team ?? first);
  await poll(() => dealt(human.getState()) && dealt(bot.getState()) && started(human.getState()) && started(bot.getState()) && quiet(), 30_000, 'the opening hands');
}

/** Resolve when `pred` holds, looking every 20 ms (the engines settle without a state change of their own). */
function poll(pred: () => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let waited = 0;
    const look = (): void => {
      if (pred()) return resolve();
      if (waited >= ms) return reject(new Error(`M8-P6: timed out waiting for ${what}`));
      waited += 20;
      setTimeout(look, 20);
    };
    look();
  });
}

/** The bot session as the runner's port. */
function portOf(bot: NetTable): BotSeatPort {
  return {
    seat: bot.seat,
    getState: () => bot.getState(),
    subscribe: (l) => bot.subscribe(l),
    secrets: () => bot.secrets(),
    cardData: (r) => bot.cardData(r),
    log: () => bot.log(),
    dispatch: (a) => bot.dispatch(a),
    draw: (n) => bot.draw(n),
    mulligan: () => bot.mulligan(),
    chat: (t) => bot.chat(t),
    settled: () => bot.engine.pending().length === 0,
  };
}

/** The handle the route receives (computer.md section 3). */
function handleOf(o: Opened, config: BotConfig, runner: BotRunner, record: ComputerGameRecord | null, deps: ComputerDeps): ComputerHandle {
  let disposed = false;
  const now = deps.now ?? (() => Date.now());
  const offResult = o.human.subscribe((s) => {
    if (!record || s.result === undefined || record.result) return;
    record.result = { winner: s.result.winners.includes(o.human.seat) ? 'human' : 'bot', turn: s.turn.number, at: now() };
    record.updatedAt = now();
    void deps.computer?.put(record).catch(() => undefined);
  });
  const handle: ComputerHandle = {
    seat: o.bot.seat,
    config,
    status: (): ComputerStatus => runner.status(),
    subscribe: (l) => runner.subscribe(l),
    pause: () => runner.pause(),
    resume: () => runner.resume(),
    setPace: (p) => runner.setPace(p),
    takeBack: () => undefined,
    skipTurn: () => undefined,
    concede() {
      if (o.bot.getState().result !== undefined) return;
      runner.pause();
      o.bot.chat('I concede. Good game.');
      o.bot.dispatch({ type: 'concede' });
    },
    combat: () => combatCue(o.human.getState(), o.human.log(), o.human.seat, o.bot.seat),
    dispose() {
      if (disposed) return;
      disposed = true;
      offResult();
      runner.dispose();
      if (record) {
        record.updatedAt = now();
        void deps.computer?.put(record).catch(() => undefined);
      }
      // Both saves finish in the background; a resume of this room waits for them (up to 10 s, should storage hang),
      // so it never reads a save that is behind the table and never deals or rolls a second time.
      const saved = Promise.all([o.human.whenSaved(), o.bot.whenSaved()]).then(
        () => undefined,
        () => undefined,
      );
      let cap: ReturnType<typeof setTimeout> | undefined;
      const done = Promise.race([saved, new Promise<void>((r) => (cap = setTimeout(r, LEAVE_SAVE_MS)))]).finally(() => {
        clearTimeout(cap);
        if (closing.get(o.human.roomId) === done) closing.delete(o.human.roomId);
      });
      closing.set(o.human.roomId, done);
      void o.bot.leave().catch(() => undefined);
      o.bot.dispose();
      o.human.dispose();
      o.net.dispose();
    },
  };
  // Sparring's runner and session stay out of the handle (computer.md section 3: the route never receives the bot
  // session): only `runnerOf` and `botSessionOf` reach them, for tests and the debug hook.
  internals.set(handle, { runner, bot: o.bot });
  return handle;
}

/** The runner and session behind each handle; module-private (see `runnerOf`, `botSessionOf`). */
const internals = new WeakMap<ComputerHandle, { runner: BotRunner; bot: NetTable }>();

/** Create a computer game (computer.md section 3). */
export async function createComputerGame(opts: ComputerGameOptions): Promise<ComputerGame> {
  const deps = await needDeps(opts.deps);
  const seed = opts.seed ?? randomSeed();
  const human = await humanDeckOf(opts, deps, seed);
  const humanDeck = human.deck;
  await deps.cardData.getMany([...new Set(humanDeck.main.map((r) => r.sid))]);
  const colour = opts.colour ?? autoColour(humanDeck, deps.cardData, seed);
  let botMain: DeckImport;
  let choice: OpponentDeckChoice;
  let botName: string;
  try {
    if (!deps.starter) throw new Error('no starter pool');
    const d = await buildStarterDeck(deps.starter, { colour, seed, name: sparringDeckName(colour) });
    await deps.cardData.getMany([...new Set(d.main.map((r) => r.sid))]);
    botMain = { main: d.main, side: [] };
    choice = { kind: 'sparring', colour, set: d.set };
    botName = d.name;
  } catch {
    botMain = { main: humanDeck.main.map((r) => ({ ...r })), side: [] };
    choice = { kind: 'mirror' };
    botName = 'Mirror';
    deps.notice?.(MIRROR_NOTICE);
  }
  const keys = deps.botKeys ?? WEB_CRYPTO_BOT_KEYS;
  const exported = { ...(await keys.create()), nickname: 'Sparring', seatColour: (deps.identity.seatColour + 4) % 8 };
  const config: BotConfig = { level: 'steady', pace: 'normal', seed, name: 'Sparring' };
  const now = deps.now ?? (() => Date.now());
  const record: ComputerGameRecord = {
    roomId: opts.roomId,
    createdAt: now(),
    updatedAt: now(),
    bot: { config, identity: exported, seat: 's1', deck: { name: botName, choice, main: botMain.main } },
    human: { deckId: opts.deckId, deckName: human.name },
  };
  await deps.computer?.put(record).catch(() => undefined);
  try {
    return await start(opts.roomId, deps, record, humanDeck);
  } catch (e) {
    // A first setup that failed leaves no half-made game behind: the next open of the room starts a new one.
    await deleteComputerRows(deps, opts.roomId).catch(() => undefined);
    throw e;
  }
}

/** How long a resume waits at most for the last saves of the sessions that left the room. */
const LEAVE_SAVE_MS = 10_000;
/** Rooms whose sessions were just disposed, until their last saves are written. */
const closing = new Map<string, Promise<void>>();

/** Open both sessions, run the (idempotent) setup and start the runner. */
async function start(roomId: string, deps: ComputerDeps, record: ComputerGameRecord, humanDeck: DeckImport | null): Promise<ComputerGame> {
  const keys = deps.botKeys ?? WEB_CRYPTO_BOT_KEYS;
  const e = record.bot.identity;
  await closing.get(roomId);
  const botIdentity: SessionIdentity = { keyPair: await keys.open(e), peerId: e.peerId, nickname: 'Sparring', seatColour: e.seatColour };
  const o = await openBoth(roomId, deps, botIdentity);
  try {
    // A resume whose first setup was cut off before the human's deck was committed brings that deck again (the
    // library deck of the record, else the starter deck, which the stored seed makes the same one).
    const deck = humanDeck ?? (Object.hasOwn(o.human.getState().commitments, o.human.seat) ? null : (await humanDeckOf({ roomId, deckId: record.human.deckId, deckName: record.human.deckName }, deps, record.bot.config.seed)).deck);
    if (deck) await deps.cardData.getMany([...new Set(deck.main.map((r) => r.sid))]);
    await setUp(o, deck, { main: record.bot.deck.main, side: [] });
  } catch (err) {
    const saved = Promise.race([Promise.all([o.human.whenSaved(), o.bot.whenSaved()]).catch(() => undefined), new Promise<void>((r) => setTimeout(r, LEAVE_SAVE_MS))]);
    o.bot.dispose();
    o.human.dispose();
    o.net.dispose();
    await saved;
    throw err;
  }
  const runner = createBotRunner({ port: portOf(o.bot), config: record.bot.config, clock: deps.clock ?? pageClock, ctx: { seatIndex: o.bot.getState().seats[o.bot.seat]?.index ?? 1, seatRot: 180 }, ...(deps.onError ? { onError: deps.onError } : {}) });
  return { session: o.human, handle: handleOf(o, record.bot.config, runner, deps.computer ? record : null, deps) };
}

/** Resume a saved computer game (computer.md 10.3): both sessions on a new LocalNetwork, then the runner at once. */
export async function resumeComputerGame(roomId: string, deps?: ComputerDeps): Promise<ComputerGame> {
  const d = await needDeps(deps);
  const record = await d.computer?.get(roomId);
  if (!record) throw new Error('M8-P6: Sparring is gone (no computer record for this game)');
  return start(roomId, d, record, null);
}

/**
 * Delete a computer game whole (computer.md 2.5: "deleting a computer game deletes the human's table, the bot's table
 * and the computer record together"): History's Remove and the short-game purge call it for a room that has a computer
 * record (`ComputerStore.get`). It waits for the last saves of a game just left, so none of them writes a row back.
 * Without `stores` it takes the page's (provideComputerDeps).
 */
export async function deleteComputerGame(roomId: string, stores?: { tables: TableStore | null; computer: ComputerStore | null }): Promise<void> {
  const s = stores ?? (await needDeps(undefined));
  await closing.get(roomId);
  await deleteComputerRows(s, roomId);
}

/** The bot behind a handle (tests and the debug hook only: the runner's view holds Sparring's hand). */
export function runnerOf(handle: ComputerHandle): BotRunner | null {
  return internals.get(handle)?.runner ?? null;
}

/** Sparring's session behind a handle (tests and the debug hook only: it holds Sparring's secrets). */
export function botSessionOf(handle: ComputerHandle): NetTable | null {
  return internals.get(handle)?.bot ?? null;
}

/**
 * What `#/c/<room>` opens (computer.md 10.3; journey.md 4.1 SOLO row): the saved game of that room, resumed at once,
 * else a new game for the human's deck (`deckId`, else a starter deck).
 */
export async function openComputerGame(roomId: string, opts: { deckId?: string | null; deps?: ComputerDeps } = {}): Promise<ComputerGame> {
  const deps = await needDeps(opts.deps);
  const saved = await deps.computer?.get(roomId).catch(() => null);
  if (saved) return resumeComputerGame(roomId, deps);
  return createComputerGame({ roomId, deckId: opts.deckId ?? null, deps });
}
