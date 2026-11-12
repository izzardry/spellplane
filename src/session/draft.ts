/**
 * The evening in the networked session (PLAN M2-P7; DESIGN "Pre-game: draft, sealed and deck building";
 * "Specification: card data, packs and draft formats", Evening stages and Draft formats). Implementer: M2-P7.
 *
 * - The draft driver of the current draft (draft/index.ts DRAFT_DRIVERS) runs over a `DraftHost` the session gives it
 *   (`DraftPort`): the own secret store and its persistence, stamped proposals, the pack-seed protocol, the pair
 *   channel for pack hand-overs and Winston piles, and every sequenced action with its confirmed state, delivered in
 *   order from a microtask so a driver never runs inside the engine's own dispatch. The driver lives as long as the
 *   draft does (also through build and match: a pack hand-over the pick timer took, or a Winston card shown after the
 *   last look, can still be on its way; DECISIONS [M2-P2], [M2-P3]) and is replaced when a new draft starts. Its
 *   `drive()` runs after every sequenced action, whenever a peer (re)connects, and on a slow clock (`DRIVE_MS`), the
 *   only clock of a driver that waits for a lost hand-over.
 * - `DraftControls` (the HUD's view of the draft and the builder): the driver's view and choices, the deck being built
 *   (`SecretStore.build`, created from the pool on first use and topped up with picks that arrive late), and Ready
 *   (the M1 `ready` path with the main deck as library and the rest of the pool as sideboard; the drafted pool itself
 *   stays in `SecretStore.pool`).
 * - `EveningControls`: lobby settings and the start (host), and the proposals that leave a match: a confirmation round
 *   labelled for the proposal (core/stage.ts STAGE_ROUND_LABELS).
 * - The automatic steps (the draft is done → build; everyone Ready → match; a proposal's round passed → its stage) are
 *   proposed by the acting host's browser only (core/stage.ts `actingHost`), once per confirmed seq, so the table
 *   moves on together and a refusal is not repeated in a loop.
 * - Private state from an earlier draft is dropped when the table is back in the lobby, or when a new draft finds it
 *   stale (a page that missed the lobby), so a new draft starts with an empty pool and no deck.
 */
import type { Action, ActionDraft } from '../core/actions';
import type { RevealedCard } from '../core/commit';
import { roundPassed } from '../core/reducer/confirm';
import type { Entropy } from '../core/secrets';
import { actingHost, lobbyOf, nextStage, notReady, stageProposalOf, STAGE_ROUND_LABELS } from '../core/stage';
import type { CardRef, DeckBuild, DraftFormat, LobbySettings, PackId, PoolCard, SecretStore, SeatId, Stage, TableState } from '../core/types';
import type { GeneratePack, SetDataSource } from '../data/types';
import { DRAFT_DRIVERS } from '../draft/index';
import { OPEN_POOL } from '../draft/open';
import { POOL_KEY } from '../draft/secret';
import type { DraftControls, DraftDriver, DraftHost, DraftPrivateView, PackSeed } from '../draft/types';
import { deckImportOf } from './deck-build';
import type { DeckImport, EveningControls } from './types';

/** How often a live draft driver is driven without any other event (ms): its only clock for asking again for a lost hand-over. */
export const DRIVE_MS = 1000;

/** Prefix of the pool card ids of a drafted pool: `p1` is the first pick (`SecretStore.pool[0]`). */
export const POOL_ID_PREFIX = 'p';

/** What the session hands the evening (NetTable implements it). */
export interface DraftPort {
  seat(): SeatId;
  /** Optimistic view. */
  state(): TableState;
  confirmedState(): TableState;
  secrets(): SecretStore;
  /** Replace the own secret store and save it. */
  setSecrets(next: SecretStore): void;
  /** Stamp, apply optimistically and propose; refused proposals are logged by the session. Not undoable. */
  propose(draft: ActionDraft): Action;
  /** Own proposals not sequenced yet. */
  pending(): readonly Action[];
  packSeed(): Promise<PackSeed>;
  sendPack(to: SeatId, packId: PackId, cards: readonly RevealedCard[]): void;
  onPack(listener: (packId: PackId, cards: RevealedCard[], from: SeatId) => void): () => void;
  sendCards(to: SeatId, about: string, cards: readonly RevealedCard[]): boolean;
  onCards(listener: (about: string, cards: RevealedCard[], from: SeatId) => void): () => void;
  /** Every sequenced action with the confirmed state after it, in order. */
  onSequenced(listener: (action: Action, state: TableState) => void): () => void;
  /** Any change of the view or the own secrets. */
  onChange(listener: () => void): () => void;
  /** A peer connected or left. */
  onPeers(listener: () => void): () => void;
  importDeck(deck: DeckImport): Promise<void>;
  warn(text: string): void;
  newId(prefix: string): string;
  readonly sets: SetDataSource | null;
  readonly generatePack: GeneratePack | null;
  readonly entropy: Entropy;
}

/** The view while no driver runs. */
function idleView(state: TableState, secrets: SecretStore): DraftPrivateView {
  return { format: state.draft?.settings.format ?? null, pack: null, picks: 0, marked: [], queued: 0, pool: [...(secrets.pool ?? [])], timer: null, waitingOn: [] };
}

function plainRef(r: CardRef): CardRef {
  return r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
}

/** The deck being built from a drafted pool, before any choice: every card in the sideboard (DESIGN "Pre-game", Deck building). */
export function buildFromPool(pool: readonly CardRef[]): DeckBuild {
  return { cards: pool.map((ref, i) => ({ id: `${POOL_ID_PREFIX}${i + 1}`, ref: plainRef(ref) })), main: [] };
}

/** A constructed deck as a build (main deck in the deck, sideboard beside it), so a rematch can sideboard too. */
export function buildFromDeck(deck: DeckImport): DeckBuild {
  const cards: PoolCard[] = [...deck.main.map((ref, i) => ({ id: `d${i + 1}`, ref: plainRef(ref) })), ...deck.side.map((ref, i) => ({ id: `s${i + 1}`, ref: plainRef(ref) }))];
  return { cards, main: deck.main.map((_, i) => `d${i + 1}`) };
}

const POOL_ID = new RegExp(`^${POOL_ID_PREFIX}([1-9][0-9]*)$`);

/**
 * `build` with the picks that reached the pool after it was made (pool cards past its highest pool card id) added to
 * the sideboard; the same object when there are none. A build without any pool card id (a deck the player opened from
 * the library instead) gets nothing added.
 */
export function withLatePicks(build: DeckBuild, pool: readonly CardRef[]): DeckBuild {
  let highest = 0;
  for (const c of build.cards) {
    const m = POOL_ID.exec(c.id);
    if (m !== null) highest = Math.max(highest, Number(m[1]));
  }
  if (highest === 0 || highest >= pool.length) return build;
  const add: PoolCard[] = pool.slice(highest).map((ref, i) => ({ id: `${POOL_ID_PREFIX}${highest + i + 1}`, ref: plainRef(ref) }));
  return { ...build, cards: [...build.cards, ...add] };
}

/** The own picks with ids that the draft secrets hold (hidden-pack and open formats). */
function heldPicks(s: SecretStore): number {
  const held = s.draft?.held ?? {};
  return (held[POOL_KEY]?.length ?? 0) + (held[OPEN_POOL]?.length ?? 0);
}

/**
 * Whether the own draft secrets belong to an earlier draft than `state`'s (a page that missed the lobby between two
 * drafts): a generated pack whose seed round the table no longer has (a new draft drops them), or more picks than the
 * table counts for this seat.
 */
export function staleDraftSecrets(state: TableState, s: SecretStore, seat: SeatId): boolean {
  const d = state.draft;
  if (d === undefined || s.draft === undefined) return false;
  if (s.draft.generated.some((g) => !Object.hasOwn(state.shuffles, g.sid))) return true;
  return heldPicks(s) > (Object.hasOwn(d.pools, seat) ? d.pools[seat]! : 0);
}

/** The secret store without anything of a draft (pool, draft secrets, deck being built). */
function withoutDraft(s: SecretStore): SecretStore {
  const { draft: _draft, build: _build, pool: _pool, ...rest } = s;
  return rest;
}

/** One browser's evening: the draft driver, DraftControls, EveningControls and the automatic stage steps. */
export class Evening {
  private driver: DraftDriver | null = null;
  private driverKey = '';
  private readonly unsubs: (() => void)[] = [];
  private readonly sequencedListeners = new Set<(action: Action, state: TableState) => void>();
  private readonly viewListeners = new Set<(view: DraftPrivateView) => void>();
  private queue: { action: Action; state: TableState }[] = [];
  private flushing = false;
  private driveQueued = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The confirmed seq at which this browser last proposed an automatic stage step. */
  private steppedAt = -1;
  private disposed = false;
  readonly draft: DraftControls | undefined;
  readonly evening: EveningControls;

  constructor(private readonly port: DraftPort) {
    this.evening = {
      setLobby: (lobby) => this.port.propose({ type: 'lobbySet', lobby: structuredClone(lobby) as LobbySettings }),
      start: () => {
        const st = this.port.state();
        return this.port.propose({ type: 'stageSet', stage: nextStage('lobby', 'start', lobbyOf(st)) ?? 'match' });
      },
      propose: (event) => this.propose(event),
    };
    this.draft = port.sets !== null && port.generatePack !== null ? this.controls() : undefined;
    this.unsubs.push(
      port.onSequenced((action, state) => this.sequenced(action, state)),
      port.onPeers(() => this.queueDrive()),
      port.onChange(() => this.changed()),
    );
    this.sync(port.confirmedState());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    this.stopDriver();
    this.sequencedListeners.clear();
    this.viewListeners.clear();
  }

  /** The current draft view (null outside a draft). */
  view(): DraftPrivateView | null {
    const st = this.port.state();
    if (st.draft === undefined) return null;
    return this.driver?.view() ?? idleView(st, this.port.secrets());
  }

  // --- The driver -------------------------------------------------------------------------------------------

  private host(): DraftHost {
    const port = this.port;
    const host: DraftHost = {
      get seat() {
        return port.seat();
      },
      state: () => port.state(),
      confirmedState: () => port.confirmedState(),
      secrets: () => port.secrets(),
      setSecrets: (next) => port.setSecrets(next),
      dispatch: (a) => port.propose(a),
      packSeed: () => port.packSeed(),
      sendPack: (to, packId, cards) => port.sendPack(to, packId, cards),
      onPack: (l) => port.onPack(l),
      sendCards: (to, about, cards) => port.sendCards(to, about, cards),
      onCards: (l) => port.onCards(l),
      onSequenced: (l) => {
        this.sequencedListeners.add(l);
        return () => this.sequencedListeners.delete(l);
      },
      sets: port.sets!,
      generatePack: port.generatePack!,
      entropy: port.entropy,
    };
    return host;
  }

  private stopDriver(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const d = this.driver;
    this.driver = null;
    this.driverKey = '';
    d?.dispose();
  }

  /** Follow the confirmed state: the driver of its draft, private state of earlier drafts dropped. */
  private sync(st: TableState): void {
    if (this.disposed) return;
    const me = this.port.seat();
    const sec = this.port.secrets();
    // Back in the lobby: the pool, draft secrets and deck of the evening's last draft go (the deck library keeps
    // what the player saved there).
    if (st.stage === 'lobby' && sec.draft !== undefined) this.port.setSecrets(withoutDraft(sec));
    const d = st.draft;
    const key = d === undefined || this.port.sets === null || this.port.generatePack === null ? '' : `${d.startSeq}:${d.settings.format}`;
    if (key === this.driverKey) return;
    this.stopDriver();
    if (key === '' || d === undefined) return;
    // A new draft starts from nothing: no draft secrets yet (a constructed deck's build and sideboard go too), or ones
    // of an earlier draft this page never saw end.
    const current = this.port.secrets();
    if ((current.draft === undefined && (current.build !== undefined || current.pool !== undefined)) || staleDraftSecrets(st, current, me)) this.port.setSecrets(withoutDraft(current));
    const format: DraftFormat = d.settings.format;
    try {
      this.driver = DRAFT_DRIVERS[format](this.host());
    } catch (e) {
      this.port.warn(`The ${format} draft cannot run here: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.driverKey = key;
    this.timer = setInterval(() => this.queueDrive(), DRIVE_MS);
    this.queueDrive();
  }

  private queueDrive(): void {
    if (this.driveQueued || this.disposed) return;
    this.driveQueued = true;
    queueMicrotask(() => {
      this.driveQueued = false;
      if (this.disposed) return;
      try {
        this.driver?.drive();
      } catch (e) {
        this.port.warn(`The draft could not go on: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.step();
    });
  }

  private sequenced(action: Action, state: TableState): void {
    this.queue.push({ action, state });
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => this.flush());
  }

  /** Deliver the sequenced actions in order, outside the engine's own dispatch. */
  private flush(): void {
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const { action, state } = this.queue.shift()!;
        this.sync(state);
        for (const l of [...this.sequencedListeners]) {
          try {
            l(action, state);
          } catch (e) {
            this.port.warn(`The draft could not follow action ${action.seq ?? '?'}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    } finally {
      this.flushing = false;
    }
    this.queueDrive();
  }

  private changed(): void {
    if (this.viewListeners.size === 0) return;
    const v = this.view() ?? idleView(this.port.state(), this.port.secrets());
    for (const l of [...this.viewListeners]) {
      try {
        l(v);
      } catch (e) {
        console.error('draft view listener failed', e);
      }
    }
  }

  // --- The automatic stage steps ------------------------------------------------------------------------------

  /** Propose the step the confirmed table owes (acting host only, once per confirmed seq). */
  private step(): void {
    const st = this.port.confirmedState();
    const me = this.port.seat();
    if (actingHost(st) !== me || this.steppedAt === st.seq) return;
    if (this.port.pending().some((a) => a.type === 'stageSet')) return;
    let to: Stage | null = null;
    let round: string | undefined;
    if (st.stage === 'draft' && st.draft?.done === true) to = 'build';
    else if (st.stage === 'build' && notReady(st).length === 0) to = 'match';
    if (to === null && (st.stage === 'match' || st.stage === 'build') && st.confirm !== null && roundPassed(st)) {
      const proposal = stageProposalOf(st.confirm.label);
      const target = proposal === null ? null : nextStage(st.stage, proposal);
      if (target !== null && (proposal !== 'nextGame' || st.stage === 'match')) {
        to = target;
        round = st.confirm.id;
      }
    }
    if (to === null) return;
    this.steppedAt = st.seq;
    this.port.propose({ type: 'stageSet', stage: to, ...(round !== undefined ? { round } : {}) });
  }

  /**
   * Ask the others to confirm leaving the match (next game: back to the builder; new draft: back to the lobby);
   * resolves true once the stage changed, false when someone held, another round replaced it, or it was refused.
   */
  private propose(event: 'nextGame' | 'newDraft'): Promise<boolean> {
    const st = this.port.state();
    const target = nextStage(st.stage, event);
    if (target === null || (event === 'nextGame' && st.stage !== 'match') || (event === 'newDraft' && st.stage !== 'match' && st.stage !== 'build')) return Promise.resolve(false);
    const round = this.port.newId('r');
    const ask = this.port.propose({ type: 'ask', round, label: STAGE_ROUND_LABELS[event] });
    const from = st.stage;
    return new Promise<boolean>((resolve) => {
      let asked = false;
      let settled = false;
      const done = (v: boolean): void => {
        if (settled) return;
        settled = true;
        queueMicrotask(off);
        resolve(v);
      };
      const check = (s: TableState): void => {
        if (s.stage === target && asked) return done(true);
        if (s.stage !== from) return done(false);
        if (s.confirm?.id === round) {
          asked = true;
          if (Object.values(s.confirm.responses).includes('hold')) done(false);
          return;
        }
        if (asked || !this.port.pending().some((a) => a.cid === ask.cid)) done(false);
      };
      const offSequenced = this.port.onSequenced((_a, s) => check(s));
      // A refused ask is never sequenced: the next change of the view tells.
      const offChange = this.port.onChange(() => {
        if (!asked && !this.port.pending().some((a) => a.cid === ask.cid) && this.port.confirmedState().confirm?.id !== round) done(false);
      });
      const off = (): void => {
        offSequenced();
        offChange();
      };
      if (this.disposed) done(false);
    });
  }

  // --- DraftControls ------------------------------------------------------------------------------------------

  private controls(): DraftControls {
    return {
      view: () => this.view() ?? idleView(this.port.state(), this.port.secrets()),
      subscribe: (listener) => {
        this.viewListeners.add(listener);
        return () => this.viewListeners.delete(listener);
      },
      mark: (cards) => this.driver?.mark(cards),
      pick: (cards) => this.driver?.pick(cards) ?? false,
      pileLook: (take) => this.driver?.pileLook?.(take) ?? false,
      gridTake: (line, index) => this.driver?.gridTake?.(line, index) ?? false,
      build: () => this.build(),
      setBuild: (build) => {
        this.port.setSecrets({ ...this.port.secrets(), build: structuredClone(build) });
        this.changed();
      },
      ready: () => this.ready(),
    };
  }

  /** The deck being built: the stored one (with late picks), else one made from the drafted pool; null without a pool. */
  private build(): DeckBuild | null {
    const s = this.port.secrets();
    const st = this.port.state();
    const pool = st.draft !== undefined ? (s.pool ?? []) : [];
    if (s.build !== undefined) {
      const next = withLatePicks(s.build, pool);
      if (next !== s.build) this.port.setSecrets({ ...s, build: next });
      return structuredClone(next);
    }
    if (st.draft === undefined || pool.length === 0) return null;
    const made = buildFromPool(pool);
    this.port.setSecrets({ ...s, build: made });
    return structuredClone(made);
  }

  /** Ready in the builder: commit the main deck; the drafted pool stays the pool (importDeck would make it the sideboard). */
  private async ready(): Promise<void> {
    const build = this.build();
    if (build === null) throw new Error('There is no pool to build a deck from');
    const pool = this.port.secrets().pool;
    const done = this.port.importDeck(deckImportOf(build));
    const s = this.port.secrets();
    if (pool !== undefined && this.port.state().draft !== undefined) this.port.setSecrets({ ...s, pool, build });
    await done;
  }
}
