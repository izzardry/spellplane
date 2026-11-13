/**
 * Client side of the pass draft and the Pick-Two preset (DESIGN "Specification: card data, packs and draft formats", Pass draft; "Specification: network protocol and secrecy", Draft packs: secret pack generation, commitments, pick, private hand-over, alternating direction, pick timer, queue counts).
 * Contracts: M2-C (stub); implementer: M2-P2.
 *
 * - Opening: when a round starts, the browser generates its pack of that round from a fresh pack seed (the
 *   secret-shuffle seed protocol with purpose 'pack', `DraftHost.packSeed`) with M2-P1's generator, keeps the cards
 *   and the audit record in its SecretStore (draft/secret.ts) and proposes the face-down `packOpen` (sorted ids and
 *   commitments only).
 * - Picking: `pick` names no card (core/reducer/pass.ts). Before proposing it the browser marks the chosen cards, and
 *   the cards a pick took are decided only once the pick is sequenced: the marked cards of that pack, filled up with
 *   its first cards in pack order. A pick the sequencer's pick timer took (`draftTimeout`) resolves the same way
 *   (DESIGN pick timer: "the marked card, or else the first card, is taken"), so a pick that races a timeout takes
 *   the same cards either way.
 * - Passing: once a pick from a held pack is resolved, the browser proposes `packPass` to the next drafter in the
 *   round's direction; once that is sequenced it sends the remaining cards on the pair channel to that drafter only
 *   (`DraftHost.sendPack`) and keeps a copy for a re-send. A drafter that holds a pack (confirmed) without its cards
 *   asks the drafter that passed it, with a pack request (`sendPack` with no cards), after `REQUEST_MS` and then every
 *   `REQUEST_MS` until they arrive; the copy is answered only to the holder of the pack's current visit.
 * - All of this follows from the pack's visits (core/reducer/pass.ts `packVisit`), not from the actions this browser
 *   happened to apply, so a snapshot, a reload or an outage never hands a pack to the wrong pool. A pick the timer took
 *   while the holder was away still reaches its pool: the copy of a pack's last visit is kept until the match starts
 *   (every deck is Ready then) or a new draft, since no acknowledgement says it arrived, and the holder asks for it in
 *   any later stage of the same draft. While the draft runs every handed-on copy is kept: it brings a pack back when the
 *   room's history turns out not to hold its pass (a split the room repaired by adopting another history, M5-P6; see
 *   `reconcile`).
 * - Everything private (held packs, the pool with ids, handed-on copies, marks) is in the own SecretStore, so a
 *   reload in the middle of a pick shows the same pack with the same marks.
 */
import type { RevealedCard } from '../core/commit';
import { passTarget, pickTimerMs, setForPack } from '../core/drafting';
import { packCountAt, packVisit, packVisitor } from '../core/reducer/pass';
import type { DraftPack, DraftState, InstanceId, PackId, PassDraftSettings, SeatId, TableState } from '../core/types';
import { draftSecretsOf } from './open';
import { addToPool, isPackKey, openHiddenPack, plainCard, poolCards, SENT_PREFIX, unopenedGenerated, updateSecrets } from './secret';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** How often a drafter asks again for a pack it holds without its cards (ms). */
export const REQUEST_MS = 2000;

/**
 * The pass draft of `state`, or null: in the draft stage only, unless `anyStage` (the hand-over of the last cards of a
 * pack whose pick the timer took can still be on its way after the draft ended).
 */
function passDraftOf(state: TableState, anyStage = false): DraftState | null {
  const d = state.draft;
  if (!d || d.settings.format !== 'pass') return null;
  if (!anyStage && state.stage !== 'draft') return null;
  return d;
}

function packOf(d: DraftState, id: PackId): DraftPack | null {
  return Object.hasOwn(d.packs, id) ? d.packs[id]! : null;
}

function picksOf(d: DraftState): number {
  return Math.max(1, (d.settings as PassDraftSettings).picks);
}

/** The cards one pick takes from a pack with `left` cards (core/reducer/pass.ts pickCount). */
function picksFor(d: DraftState, left: number): number {
  return Math.min(picksOf(d), left);
}

/** Whether `seat` holds `pack` after picking from it (it owes the pass). */
function picked(d: DraftState, seat: SeatId, pack: DraftPack): boolean {
  return pack.holder === seat && !(d.queues[seat] ?? []).includes(pack.id);
}

/** The seats the table is waiting for: a pack to pick from, a pass owed, or their pack of the round still to open. */
function waitingOn(d: DraftState): SeatId[] {
  if (d.done) return [];
  return d.drafters.filter((s) => {
    if ((d.queues[s] ?? []).length > 0) return true;
    const packs = Object.values(d.packs);
    if (packs.some((p) => p.count > 0 && picked(d, s, p))) return true;
    return !packs.some((p) => p.opener === s && p.number === d.round);
  });
}

/**
 * Which visit of `me` (core/reducer/pass.ts PackVisit) `count` held cards of `pack` belong to: the cards at its start
 * (not resolved yet) or after its pick (resolved, to be passed). Counts fall by the picks per pass with every visit,
 * so the count names the visit. Null when it names none (the pack moved on without this browser).
 */
function heldVisit(d: DraftState, pack: DraftPack, me: SeatId, count: number): { j: number; resolved: boolean } | null {
  const cur = packVisit(d, pack);
  if (cur === null) return null;
  const picks = picksOf(d);
  for (let j = cur.k; j >= 0; j--) {
    if (packVisitor(d, pack, j) !== me) continue;
    if (packCountAt(pack, picks, j) === count) return { j, resolved: false };
    if (count > 0 && packCountAt(pack, picks, j + 1) === count) return { j, resolved: true };
  }
  return null;
}

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P2. */
export const createPassDriver: CreateDraftDriver = (host) => {
  const me = host.seat;
  let disposed = false;
  let opening = false;
  /**
   * The remembered unopened packs this driver offered (draft/secret.ts unopenedGenerated): each once, so a refused one is
   * not offered again. A pack whose `packOpen` is in a stretch of history the room abandoned is offered again (M5-P6):
   * opening a new one instead would make its seed round the latest and the pack the engine proposes again unopenable,
   * with its pick already in the pool.
   */
  const offered = new Set<PackId>();
  /** When each missing pack was first missed or last asked for (local clock). */
  const asked = new Map<PackId, number>();
  let retry: ReturnType<typeof setTimeout> | null = null;

  /**
   * The confirmed state: picks are resolved and passes sent from sequenced actions only. The host's own copy when it
   * offers one (so this driver never lags behind the pair channel, which checks hand-overs against it), else the
   * state of the last sequenced action.
   */
  let lastSequenced: TableState = host.confirmedState?.() ?? host.state();
  const conf = (): TableState => host.confirmedState?.() ?? lastSequenced;

  const held = (): Record<string, RevealedCard[]> => draftSecretsOf(host.secrets()).held;

  const dropHeld = (key: string): void => {
    updateSecrets(host, (ds) => {
      const next = { ...ds.held };
      delete next[key];
      return { draft: { ...ds, held: next } };
    });
  };

  /**
   * Bring the own secrets in step with the confirmed state, from the visits alone (so a snapshot or a reload that
   * skipped actions changes nothing): take back a handed-on pack whose pass the room's history does not hold (below),
   * resolve every own visit whose pick is taken (the marked cards, then the first ones), and hand on every pack whose
   * pass is sequenced (keeping a copy for a re-send until the draft is over).
   *
   * Abandoned history (M5-P6; M2 gate follow-up): a sequenced action can still be replaced when the room adopts
   * another history after a split (net/engine.ts `adopt`), and the engine proposes this browser's own actions of the
   * abandoned part again. A pass this driver already acted on may so be gone from the confirmed state: the pack is
   * back with this drafter, or not even here yet. Its handed-on copy is then the pack as it was after the own pick
   * (resolved into the pool already, so the pick proposed again takes nothing twice), and goes back to the held packs;
   * the pass proposed again hands it on afresh. Copies are kept while the draft runs for that reason.
   */
  const reconcile = (): void => {
    const state = conf();
    const d = passDraftOf(state, true);
    if (d === null || state.stage === 'match') {
      // Every pool is final once the decks are Ready (or the draft is gone): no hand-over is owed any more.
      for (const key of Object.keys(held())) if (key.startsWith(SENT_PREFIX)) dropHeld(key);
      return;
    }
    const picks = picksOf(d);
    for (const [key, cards] of Object.entries(held())) {
      if (!key.startsWith(SENT_PREFIX)) continue;
      const packId = key.slice(SENT_PREFIX.length);
      const pack = packOf(d, packId);
      // Not in the room's history (yet): its `packOpen` may be part of an abandoned stretch the engine proposes again,
      // so the copy is kept while the draft runs (a finished draft drops it below).
      if (pack === null) continue;
      const from = sentVisit(d, pack, cards.length);
      const cur = packVisit(d, pack);
      // The pass is not in the room's history (any more): the pack is back with this drafter, or before it.
      if (from !== null && (cur === null || cur.k <= from) && !Object.hasOwn(held(), packId)) {
        updateSecrets(host, (ds) => {
          const next = { ...ds.held, [packId]: cards };
          delete next[key];
          return { draft: { ...ds, held: next } };
        });
      }
    }
    for (const [key, cards] of Object.entries(held())) {
      if (!isPackKey(key)) continue;
      const pack = packOf(d, key);
      if (pack === null) continue;
      const cur = packVisit(d, pack);
      const mine = heldVisit(d, pack, me, cards.length);
      if (cur === null || mine === null) continue;
      if (!mine.resolved) {
        if (mine.j < cur.k || cur.picked) resolvePick(pack, cards, packCountAt(pack, picks, mine.j) - packCountAt(pack, picks, mine.j + 1));
        continue;
      }
      if (cur.k <= mine.j) continue;
      // The pass is sequenced: keep the copy for a re-send, then hand the cards to the next visit's holder.
      updateSecrets(host, (ds) => {
        const next = { ...ds.held, [SENT_PREFIX + key]: cards };
        delete next[key];
        return { draft: { ...ds, held: next } };
      });
      if (cur.k === mine.j + 1) send(cur.holder, key, cards);
    }
    // Once the draft is done no pass can be taken back any more: only the copy of a pack's last visit is still kept (its
    // receiver may not have it yet).
    if (d.done) {
      for (const key of Object.keys(held())) {
        if (!key.startsWith(SENT_PREFIX)) continue;
        const pack = packOf(d, key.slice(SENT_PREFIX.length));
        if (pack !== null && sentFor(d, pack, held()[key]!.length)) continue;
        dropHeld(key);
      }
    }
  };

  /** The own visit a handed-on copy of `count` cards of `pack` was passed on from, or null when it names none. */
  const sentVisit = (d: DraftState, pack: DraftPack, count: number): number | null => {
    const picks = picksOf(d);
    const last = Math.ceil(pack.commitment.instanceIds.length / picks);
    for (let j = last; j >= 0; j--) if (packVisitor(d, pack, j) === me && packCountAt(pack, picks, j + 1) === count && count > 0) return j;
    return null;
  };

  /** Whether a handed-on copy of `count` cards is the pack as its current visit's holder got it from this browser. */
  const sentFor = (d: DraftState, pack: DraftPack, count: number): boolean => {
    const cur = packVisit(d, pack);
    return cur !== null && cur.k >= 1 && cur.holder !== me && packVisitor(d, pack, cur.k - 1) === me && packCountAt(pack, picksOf(d), cur.k) === count;
  };

  /**
   * Whether this browser holds the current visit of `pack` without its cards: not received yet, or received after its
   * pick was taken and not resolved into the pool (the own pool counts fewer of the pack's cards than its visits took).
   */
  const missing = (d: DraftState, pack: DraftPack): boolean => {
    const cur = packVisit(d, pack);
    // The own fresh pack is in the store from its generation; nobody else has it.
    if (cur === null || cur.holder !== me || cur.k < 1 || !isPackKey(pack.id)) return false;
    if (Object.hasOwn(held(), pack.id)) return false;
    if (!cur.picked) return true;
    const picks = picksOf(d);
    let took = 0;
    for (let j = 0; j <= cur.k; j++) if (packVisitor(d, pack, j) === me) took += packCountAt(pack, picks, j) - packCountAt(pack, picks, j + 1);
    const ids = new Set(pack.commitment.instanceIds);
    return poolCards(host.secrets()).filter((c) => ids.has(c.instanceId)).length < took;
  };

  /** Decide which `k` cards the pick from `pack` took (marked first, then in pack order) and move them to the pool. */
  const resolvePick = (pack: DraftPack, cards: readonly RevealedCard[], k: number): void => {
    const ids = new Set(cards.map((c) => c.instanceId));
    const marked = draftSecretsOf(host.secrets()).marked.filter((id) => ids.has(id));
    const take = new Set(marked.slice(0, k));
    for (const c of cards) {
      if (take.size >= k) break;
      take.add(c.instanceId);
    }
    const order = [...take];
    const taken = order.map((id) => cards.find((c) => c.instanceId === id)!);
    const left = cards.filter((c) => !take.has(c.instanceId));
    updateSecrets(host, (ds, s) => {
      const pooled = addToPool(ds, s, taken);
      const next = { ...pooled.draft.held };
      if (left.length > 0) next[pack.id] = left.map(plainCard);
      else delete next[pack.id];
      return { draft: { ...pooled.draft, held: next, marked: ds.marked.filter((id) => !ids.has(id)) }, pool: pooled.pool };
    });
  };

  const send = (to: SeatId, packId: PackId, cards: readonly RevealedCard[]): void => {
    // Picked identities stay with the picker (DESIGN Draft packs): a card of the own pool is never handed on, whatever
    // the held copy says (the receiver's commitment and count checks cannot tell a picked card from a left one).
    const pooled = new Set(poolCards(host.secrets()).map((c) => c.instanceId));
    if (cards.some((c) => pooled.has(c.instanceId))) return;
    try {
      host.sendPack(to, packId, cards);
    } catch {
      // The confirmed state does not allow the hand-over (yet): the receiver asks again.
    }
  };

  const off = host.onSequenced((_a, state) => {
    if (state.draft?.settings.format !== 'pass') return;
    lastSequenced = state;
    reconcile();
  });

  const offPack = host.onPack((packId, cards, from) => {
    if (disposed || !isPackKey(packId)) return;
    reconcile();
    const d = passDraftOf(conf(), true);
    const pack = d === null ? null : packOf(d, packId);
    if (d === null || pack === null) return;
    if (cards.length === 0) {
      // A request (net/private.ts checked that `from` holds the visit after this browser's): send the copy again.
      const copy = held()[SENT_PREFIX + packId];
      if (copy !== undefined && sentFor(d, pack, copy.length) && packVisit(d, pack)?.holder === from) send(from, packId, copy);
      return;
    }
    if (!missing(d, pack)) return;
    updateSecrets(host, (ds) => ({ draft: { ...ds, held: { ...ds.held, [packId]: cards.map(plainCard) } } }));
    asked.delete(packId);
    reconcile();
    driver.drive();
  });

  const open = async (round: number, set: string): Promise<void> => {
    opening = true;
    const remembered = unopenedGenerated(host, host.confirmedState?.() ?? host.state(), set);
    const reuse = remembered === null || !offered.has(remembered.packId);
    if (remembered !== null) offered.add(remembered.packId);
    try {
      const still = (): boolean => {
        const d = passDraftOf(host.state());
        return !disposed && d !== null && !d.done && d.round === round && !Object.values(d.packs).some((p) => p.opener === me && p.number === round);
      };
      await openHiddenPack(host, round, set, true, reuse, still);
    } catch {
      // No set data, or the seed round failed: the next drive() tries again.
    } finally {
      opening = false;
    }
  };

  /** Ask for every pack this drafter has held (confirmed) without its cards for REQUEST_MS, at most every REQUEST_MS each. */
  const askMissing = (d: DraftState): void => {
    const now = Date.now();
    let any = false;
    for (const pack of Object.values(d.packs)) {
      if (!missing(d, pack)) {
        asked.delete(pack.id);
        continue;
      }
      any = true;
      const cur = packVisit(d, pack)!;
      const from = packVisitor(d, pack, cur.k - 1);
      // The hand-over usually follows the pass within a moment: ask only after REQUEST_MS without it, then again
      // every REQUEST_MS.
      const since = asked.get(pack.id);
      if (since === undefined) asked.set(pack.id, now);
      if (since === undefined || now - since < REQUEST_MS) continue;
      asked.set(pack.id, now);
      send(from, pack.id, []);
    }
    if (any && retry === null && !disposed) {
      retry = setTimeout(() => {
        retry = null;
        driver.drive();
      }, REQUEST_MS);
    }
  };

  const driver: DraftDriver = {
    format: 'pass',
    drive() {
      if (disposed) return;
      reconcile();
      // Ask for missing hand-overs in any stage of this draft (the last cards of a pack can arrive after its end).
      const any = passDraftOf(conf(), true);
      if (any !== null) askMissing(any);
      const c = passDraftOf(conf());
      const v = passDraftOf(host.state());
      if (c === null || v === null || v.done) return;
      // Open the own pack of the round (once the round has started in the confirmed state).
      if (!opening && c.round === v.round && !c.done && !Object.values(v.packs).some((p) => p.opener === me && p.number === v.round)) void open(v.round, setForPack(v.sets, v.round));
      // A pick resolved on a history the room abandoned whose new proposal the room refused (another pack was ahead of
      // it in this drafter's queue there): the pack came back resolved, and once it is at the front of the queue the
      // pick is proposed again. It takes nothing more (its cards are in the pool already); the pass follows as usual.
      const front = packOf(c, (c.queues[me] ?? [])[0] ?? '');
      const resolved = front === null || !isPackKey(front.id) ? undefined : held()[front.id];
      if (front !== null && resolved !== undefined && (v.queues[me] ?? [])[0] === front.id) {
        const cur = packVisit(c, front);
        if (cur !== null && cur.holder === me && !cur.picked && resolved.length < front.count && resolved.length === packCountAt(front, picksOf(c), cur.k + 1)) {
          host.dispatch({ type: 'pick', packId: front.id, count: picksFor(c, front.count) });
        }
      }
      // Pass every resolved pack this drafter picked from (confirmed), unless the pass is already proposed.
      for (const pack of Object.values(c.packs)) {
        const cards = held()[pack.id];
        if (cards === undefined || !isPackKey(pack.id) || pack.count === 0 || !picked(c, me, pack) || cards.length !== pack.count) continue;
        const now = packOf(v, pack.id);
        if (now === null || !picked(v, me, now)) continue;
        host.dispatch({ type: 'packPass', packId: pack.id, to: passTarget(c.drafters, me, pack.number), count: pack.count });
      }
    },
    view(): DraftPrivateView {
      const s = host.secrets();
      const ds = draftSecretsOf(s);
      const d = passDraftOf(host.state());
      const base: DraftPrivateView = { format: 'pass', pack: null, picks: 0, marked: [], queued: 0, pool: [...(s.pool ?? [])], timer: null, waitingOn: [] };
      if (d === null) return base;
      const queue = d.queues[me] ?? [];
      base.queued = Math.max(0, queue.length - 1);
      base.waitingOn = waitingOn(d);
      const front = queue[0] === undefined ? null : packOf(d, queue[0]);
      if (front === null) return base;
      if (d.pickTimer) base.timer = { fromSeq: front.sinceSeq, ms: pickTimerMs(front.picks) };
      const cards = Object.hasOwn(ds.held, front.id) && isPackKey(front.id) ? ds.held[front.id]! : null;
      // Shown once its cards are here (and as many as the shared state says it holds).
      if (cards === null || cards.length !== front.count) return base;
      base.pack = { packId: front.id, cards: cards.map((c) => ({ id: c.instanceId, ref: { ...c.ref } })), public: false };
      base.picks = picksFor(d, front.count);
      const ids = new Set(cards.map((c) => c.instanceId));
      base.marked = ds.marked.filter((id) => ids.has(id));
      return base;
    },
    mark(cards) {
      const v = driver.view();
      if (v.pack === null) return;
      const ids = new Set(v.pack.cards.map((c) => c.id));
      const chosen = [...new Set(cards)].filter((id) => ids.has(id)).slice(0, v.picks);
      setFrontMarks(ids, chosen);
    },
    pick(cards) {
      const v = driver.view();
      if (v.pack === null || disposed) return false;
      const ids = new Set(v.pack.cards.map((c) => c.id));
      const chosen = [...new Set(cards)];
      if (chosen.length !== v.picks || chosen.length !== cards.length || !chosen.every((id) => ids.has(id))) return false;
      // Marked first, so a pick timer that wins the race takes the same cards (see the module comment).
      setFrontMarks(ids, chosen);
      host.dispatch({ type: 'pick', packId: v.pack.packId, count: v.picks });
      return true;
    },
    dispose() {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      off();
      offPack();
    },
  };

  /** Replace the marks of the front pack (cards `ids`) by `chosen`, keeping the marks of packs picked and not resolved yet. */
  const setFrontMarks = (ids: ReadonlySet<InstanceId>, chosen: readonly InstanceId[]): void => {
    updateSecrets(host, (ds) => ({ draft: { ...ds, marked: [...ds.marked.filter((id) => !ids.has(id)), ...chosen] } }));
  };

  return driver;
};
