/**
 * The spectator's session (PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: "A spectator joins by the same
 * link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may reveal
 * their hand to a named spectator"). A TableSession over a NetEngine joined with role 'spectator':
 *
 * - No chair: `seat` is the spectator id `v:<peerId>` (core/teams.ts), which no key of `state.seats` matches. The
 *   session resolves once the room is joined (NetSessionOptions.role), not once it holds a chair.
 * - Public only: the shared state carries no hidden identity, and this browser holds no secret store of its own. Its
 *   `secrets()` is an empty store whose `received` holds only the cards a player revealed to this spectator by name,
 *   each checked against the owner's commitment (net/roles.ts `spectatorRevealsOver`) and dropped once the card goes
 *   where nobody sees it (core/secrets.ts `pruneReceived`). Nothing is written to IndexedDB: a spectator keeps no
 *   table record, log or secrets.
 * - Chat and ping: `dispatch` stamps every draft with the spectator id and proposes it; the sequencer accepts `chat`
 *   and `ping` only (net/roles.ts SPECTATOR_ACTIONS) and refuses everything else, which the engine rolls back with a
 *   system line here. A chat line carries the spectator's nickname in `name` (DECISIONS [M3-C]).
 * - No private effects: Ready, shuffles, draws, mulligans, looks, rolls, chairs and undo are refused with a reason.
 * - Presence: a spectator's cursor and drags are not shown to the table (they are the players' intent, DESIGN "Other
 *   players' cursors"); its typing indicator is.
 */
import type { Action, ActionDraft } from '../core/actions';
import { emptySecretStore, pruneReceived, receiveIdentity } from '../core/secrets';
import { spectatorIdOf, type SpectatorId } from '../core/teams';
import type { CardRef, InstanceId, LogEntry, Pose, RngPurpose, SeatColourIndex, SecretStore, TableState, ZoneId } from '../core/types';
import type { CardData } from '../data/types';
import { createNetEngine, NACK_DUPLICATE } from '../net/engine';
import { createNetIdentity } from '../net/identity';
import type { ChatChannel, SequencedAction } from '../net/messages';
import { spectatorRevealsOver } from '../net/roles';
import type { NetEngine, Presence, Unsubscribe } from '../net/types';
import { freshNetTable } from './net';
import { randomId } from './secrecy';
import type { DeckImport, LookedCard, NetSession, NetSessionOptions, NetStatusListener, SessionListener, SessionNetStatus } from './types';

/** The nickname a spectator's chat carries when the identity has none yet. */
export const DEFAULT_SPECTATOR_NAME = 'Spectator';
/** Why a spectator cannot do what only a seated player does (DESIGN "Players, seats and formats", Spectators). */
export const SPECTATOR_ONLY_WATCHES = 'Spectators watch: they can chat and ping, but cannot take a chair or touch cards. Open the table link without /watch to play.';

/** A presence that shows the table this spectator's typing only (no cursor, drag, speaking ring or caption). */
function watchingPresence(inner: Presence): Presence {
  return {
    cursor: () => undefined,
    drag: () => undefined,
    speaking: () => undefined,
    typing: (channel) => inner.typing(channel),
    captionInterim: () => undefined,
    peers: () => inner.peers(),
    subscribe: (listener) => inner.subscribe(listener),
  };
}

/** A networked table watched from a spectator's page (see the module comment). */
export class SpectatorTable implements NetSession {
  readonly role = 'spectator' as const;
  readonly roomId: string;
  readonly seat: SpectatorId;
  readonly presence: Presence;
  private sec: SecretStore;
  private entries: LogEntry[] = [];
  private readonly listeners = new Set<SessionListener>();
  private readonly netListeners = new Set<NetStatusListener>();
  private readonly unsubs: Unsubscribe[] = [];
  private readonly requested = new Set<string>();
  private readonly cidPrefix = randomId('');
  private cidCount = 0;
  private disposed = false;

  constructor(
    readonly engine: NetEngine,
    private readonly opts: NetSessionOptions,
  ) {
    this.roomId = opts.roomId;
    this.seat = spectatorIdOf(opts.identity.peerId);
    this.sec = emptySecretStore(this.seat);
    this.presence = watchingPresence(engine.presence);
    this.unsubs.push(
      engine.onState((view) => this.onView(view)),
      engine.onSequenced((a) => this.onSequenced(a)),
      engine.onRollback((a, reason) => {
        if (reason === NACK_DUPLICATE) return;
        this.system('warn', `${a.type} refused: ${reason}`);
        this.notify();
      }),
      engine.onSystem((level, text) => {
        this.system(level, text);
        this.notify();
      }),
      engine.onStatus(() => this.notifyNet()),
      engine.onPeers(() => this.notifyNet()),
      engine.onSequencerChange(() => this.notifyNet()),
      spectatorRevealsOver(engine, this.seat, ({ card, from, verified }) => {
        if (!verified) {
          this.system('warn', `Integrity warning: ${from} showed this browser card ${card.instanceId}, and it does not match ${from}'s deck commitment`);
        } else {
          this.sec = pruneReceived(receiveIdentity(this.sec, card, from), this.engine.state());
          this.prefetch([card.ref.sid]);
        }
        this.notify();
      }),
    );
    this.prefetchPublic(engine.state());
  }

  // --- Reading -----------------------------------------------------------------------------------------

  getState(): TableState {
    return this.engine.state();
  }

  secrets(): SecretStore {
    return this.sec;
  }

  cardData(ref: CardRef): CardData | null {
    return this.opts.cardData.peek(ref.sid);
  }

  log(): LogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  netStatus(): SessionNetStatus {
    return { mode: 'net', connection: this.engine.status(), peers: this.engine.peers(), sequencer: this.engine.sequencerId(), seq: this.engine.seq() };
  }

  subscribeNet(listener: NetStatusListener): () => void {
    this.netListeners.add(listener);
    return () => {
      this.netListeners.delete(listener);
    };
  }

  whenSaved(): Promise<void> {
    return Promise.resolve();
  }

  canUndo(): boolean {
    return false;
  }

  undo(): boolean {
    return false;
  }

  // --- Lifecycle ---------------------------------------------------------------------------------------

  leave(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    this.engine.leave();
    this.notifyNet();
    this.listeners.clear();
    this.netListeners.clear();
  }

  dispose(): void {
    this.leave();
  }

  // --- Acting: chat and ping go to the sequencer, which refuses every other action of a spectator --------------

  dispatch(draft: ActionDraft): Action {
    const { seq: _seq, ...rest } = draft as ActionDraft & { seq?: number };
    const base = { ...rest, by: this.seat, cid: `${this.cidPrefix}${++this.cidCount}` } as Action;
    const action: Action = base.type === 'chat' ? { ...base, name: this.nickname() } : base;
    if (this.disposed) return action;
    // The sequencer is the authority on what a spectator may do (net/roles.ts roleProblem): a card action is proposed
    // like any other, refused there and rolled back here with the sequencer's reason.
    if (!this.engine.propose(action)) this.system('warn', `${action.type} refused: it does not apply to the table as this page sees it`);
    this.notify();
    return action;
  }

  chat(text: string, channel: ChatChannel = 'table'): Action {
    // The team tab is the teammates' pair channel; a spectator writes on the table or spectator tab.
    return this.dispatch({ type: 'chat', text, channel: channel === 'team' ? 'spectator' : channel });
  }

  playFaceDown(card: InstanceId, to: ZoneId, pose?: Pose): Action {
    return this.dispatch({ type: 'move', card, to, ...(pose ? { pose } : {}) });
  }

  takeSeat(seat: string, colour: SeatColourIndex): Action {
    const action = { type: 'seatTake', seat, name: this.nickname(), colour, peer: this.opts.identity.peerId, by: seat, cid: `${this.cidPrefix}${++this.cidCount}` } as Action;
    this.refuse();
    return action;
  }

  roll(_purpose: RngPurpose, _n: number): Promise<number> {
    return this.refused();
  }

  importDeck(_deck: DeckImport): Promise<void> {
    return this.refused();
  }

  shuffle(_zone?: ZoneId): Promise<void> {
    return this.refused();
  }

  draw(_n?: number): Promise<void> {
    return this.refused();
  }

  mulligan(): Promise<void> {
    return this.refused();
  }

  lookAt(_zone: ZoneId, _n: number): Promise<LookedCard[]> {
    return this.refused();
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private nickname(): string {
    return this.opts.identity.nickname.trim().slice(0, 40) || DEFAULT_SPECTATOR_NAME;
  }

  private refuse(): void {
    this.system('warn', SPECTATOR_ONLY_WATCHES);
    this.notify();
  }

  private refused<T>(): Promise<T> {
    this.refuse();
    return Promise.reject(new Error(SPECTATOR_ONLY_WATCHES));
  }

  private onView(view: TableState): void {
    if (this.disposed) return;
    // A revealed card that went where nobody sees it (a library), was re-issued or became public is forgotten.
    this.sec = pruneReceived(this.sec, view);
    this.prefetchPublic(view);
    this.notify();
    this.notifyNet();
  }

  private onSequenced(action: SequencedAction): void {
    if (this.disposed) return;
    // A rewound history replaces the entries from its first replaced seq on (as session/net.ts does).
    const last = this.entries.findLastIndex((e) => e.kind === 'action');
    if (last >= 0 && this.entries[last]!.seq >= action.seq) this.entries = this.entries.filter((e) => e.kind !== 'action' || e.seq < action.seq);
    this.entries.push({ kind: 'action', seq: action.seq, at: this.now(), action });
  }

  private prefetchPublic(view: TableState): void {
    const sids: string[] = [];
    for (const c of Object.values(view.cards)) if (c.identity) sids.push(c.identity.sid);
    this.prefetch(sids);
  }

  private prefetch(sids: readonly string[]): void {
    const fresh = [...new Set(sids)].filter((s) => !this.requested.has(s));
    if (!fresh.length) return;
    for (const s of fresh) this.requested.add(s);
    this.opts.cardData.getMany(fresh).then(
      () => this.notify(),
      (e: unknown) => {
        for (const s of fresh) this.requested.delete(s);
        this.system('warn', `Card data is unavailable: ${e instanceof Error ? e.message : String(e)}`);
        this.notify();
      },
    );
  }

  private system(level: 'info' | 'warn', text: string): void {
    this.entries.push({ kind: 'system', seq: this.engine.seq(), at: this.now(), level, text });
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private notify(): void {
    if (this.disposed) return;
    const state = this.engine.state();
    for (const l of [...this.listeners]) {
      try {
        l(state);
      } catch (e) {
        console.error('session listener failed', e);
      }
    }
  }

  private notifyNet(): void {
    const status = this.netStatus();
    for (const l of [...this.netListeners]) {
      try {
        l(status);
      } catch (e) {
        console.error('net status listener failed', e);
      }
    }
  }
}

/**
 * Join the table of `opts.roomId` as a spectator and resolve once joined (DESIGN "Players, seats and formats",
 * Spectators; session/types.ts NetSessionOptions.role). The replica starts from the seq-0 table and catches up from
 * the players; nothing is read from or written to the local store. Aborting `signal` before that leaves the room.
 */
export async function openSpectatorSession(opts: NetSessionOptions, signal?: AbortSignal): Promise<SpectatorTable> {
  const identity = await createNetIdentity(opts.identity.keyPair, opts.identity.peerId, opts.identity.nickname);
  if (signal?.aborted) throw new Error('Joining the table was cancelled');
  const engine = createNetEngine({
    transport: opts.transport(),
    roomId: opts.roomId,
    roomKey: opts.roomKey,
    identity,
    game: opts.game,
    start: { snapshot: { seq: 0, state: freshNetTable(opts.game, opts.format ?? '1v1') }, tail: [] },
    role: 'spectator',
    ...(opts.now ? { now: opts.now } : {}),
  });
  const session = new SpectatorTable(engine, opts);
  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(new Error('Joining the table was cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      engine.join().then(
        () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        (e: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  } catch (e) {
    session.leave();
    throw e;
  }
  return session;
}
