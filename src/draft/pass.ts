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
 *   `REQUEST_MS` until they arrive; the copy is answered only to the pack's confirmed holder.
 * - Everything private (held packs, the pool with ids, handed-on copies, marks) is in the own SecretStore, so a
 *   reload in the middle of a pick shows the same pack with the same marks.
 */
import type { RevealedCard } from '../core/commit';
import { passTarget, pickTimerMs, setForPack } from '../core/drafting';
import type { DraftPack, DraftState, InstanceId, PackId, PassDraftSettings, SeatId, TableState } from '../core/types';
import { draftSecretsOf } from './open';
import { addToPool, isPackKey, openHiddenPack, plainCard, SENT_PREFIX, updateSecrets } from './secret';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** How often a drafter asks again for a pack it holds without its cards (ms). */
export const REQUEST_MS = 2000;

/** The running pass draft of `state`, or null. */
function passDraftOf(state: TableState): DraftState | null {
  const d = state.draft;
  if (!d || d.settings.format !== 'pass' || state.stage !== 'draft') return null;
  return d;
}

function packOf(d: DraftState, id: PackId): DraftPack | null {
  return Object.hasOwn(d.packs, id) ? d.packs[id]! : null;
}

/** The cards one pick takes from a pack with `left` cards (core/reducer/pass.ts pickCount). */
function picksFor(d: DraftState, left: number): number {
  return Math.min((d.settings as PassDraftSettings).picks, left);
}

/** The drafter that passes to `seat` in the direction of pack number `number`. */
function passer(d: DraftState, seat: SeatId, number: number): SeatId | null {
  return d.drafters.find((s) => s !== seat && passTarget(d.drafters, s, number) === seat) ?? null;
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

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P2. */
export const createPassDriver: CreateDraftDriver = (host) => {
  const me = host.seat;
  let disposed = false;
  let opening = false;
  /** Whether a remembered unopened pack was already offered once by this driver (a refused one is not offered again). */
  let reused = false;
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

  /**
   * Bring the own secrets in step with the confirmed state: resolve every taken pick (the marked cards, then the first
   * ones), hand on every pack whose pass was sequenced, and forget handed-on copies the receiver has passed on.
   */
  const reconcile = (): void => {
    const d = passDraftOf(conf());
    if (d === null) return;
    for (const [key, cards] of Object.entries(held())) {
      if (!isPackKey(key)) continue;
      const pack = packOf(d, key);
      if (pack === null) continue;
      const done = pack.holder === null && pack.count === 0;
      if ((picked(d, me, pack) || (done && !(d.queues[me] ?? []).includes(pack.id))) && cards.length > pack.count) resolvePick(pack, cards);
    }
    for (const [key, cards] of Object.entries(held())) {
      if (!isPackKey(key)) continue;
      const pack = packOf(d, key);
      if (pack === null || pack.holder === null || pack.holder === me) continue;
      const to = passTarget(d.drafters, me, pack.number);
      // The cards as passed: the pack's count, or the count before the receiver's pick when the pick timer took it.
      const asPassed = cards.length === pack.count || (picked(d, to, pack) && cards.length - picksFor(d, cards.length) === pack.count);
      if (pack.holder !== to || !asPassed) continue;
      // The pass is sequenced: keep the copy for a re-send, then hand the cards over.
      updateSecrets(host, (ds) => {
        const next = { ...ds.held, [SENT_PREFIX + key]: cards };
        delete next[key];
        return { draft: { ...ds, held: next } };
      });
      send(to, key, cards);
    }
    for (const key of Object.keys(held())) {
      if (!key.startsWith(SENT_PREFIX)) continue;
      const id = key.slice(SENT_PREFIX.length);
      const pack = packOf(d, id);
      if (pack !== null && pack.holder === passTarget(d.drafters, me, pack.number)) continue;
      updateSecrets(host, (ds) => {
        const next = { ...ds.held };
        delete next[key];
        return { draft: { ...ds, held: next } };
      });
    }
  };

  /** Decide which cards the pick from `pack` took and move them to the pool. */
  const resolvePick = (pack: DraftPack, cards: readonly RevealedCard[]): void => {
    const k = cards.length - pack.count;
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
      return { draft: { ...pooled.draft, held: next, marked: ds.marked.filter((id) => !take.has(id)) }, pool: pooled.pool };
    });
  };

  const send = (to: SeatId, packId: PackId, cards: readonly RevealedCard[]): void => {
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
    const d = passDraftOf(conf());
    const pack = d === null ? null : packOf(d, packId);
    if (d === null || pack === null) return;
    if (cards.length === 0) {
      // A request: send the copy again, to the pack's confirmed holder only.
      const copy = held()[SENT_PREFIX + packId];
      if (copy !== undefined && pack.holder === from && passTarget(d.drafters, me, pack.number) === from) send(from, packId, copy);
      return;
    }
    if (pack.holder !== me || Object.hasOwn(held(), packId)) return;
    updateSecrets(host, (ds) => ({ draft: { ...ds, held: { ...ds.held, [packId]: cards.map(plainCard) } } }));
    asked.delete(packId);
    reconcile();
    driver.drive();
  });

  const open = async (round: number, set: string): Promise<void> => {
    opening = true;
    const reuse = !reused;
    reused = true;
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
    let missing = false;
    for (const pack of Object.values(d.packs)) {
      if (pack.holder !== me || pack.count === 0 || Object.hasOwn(held(), pack.id) || !isPackKey(pack.id)) continue;
      // The own fresh pack is in the store from its generation; nobody else has it.
      if (pack.opener === me && pack.picks === 0) continue;
      missing = true;
      const from = passer(d, me, pack.number);
      // The hand-over usually follows the pass within a moment: ask only after REQUEST_MS without it, then again
      // every REQUEST_MS.
      const since = asked.get(pack.id);
      if (since === undefined) asked.set(pack.id, now);
      if (from === null || since === undefined || now - since < REQUEST_MS) continue;
      asked.set(pack.id, now);
      send(from, pack.id, []);
    }
    if (missing && retry === null && !disposed) {
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
      const c = passDraftOf(conf());
      const v = passDraftOf(host.state());
      if (c === null || v === null || v.done) return;
      // Open the own pack of the round (once the round has started in the confirmed state).
      if (!opening && c.round === v.round && !c.done && !Object.values(v.packs).some((p) => p.opener === me && p.number === v.round)) void open(v.round, setForPack(v.sets, v.round));
      // Pass every resolved pack this drafter picked from (confirmed), unless the pass is already proposed.
      for (const pack of Object.values(c.packs)) {
        const cards = held()[pack.id];
        if (cards === undefined || !isPackKey(pack.id) || pack.count === 0 || !picked(c, me, pack) || cards.length !== pack.count) continue;
        const now = packOf(v, pack.id);
        if (now === null || !picked(v, me, now)) continue;
        host.dispatch({ type: 'packPass', packId: pack.id, to: passTarget(c.drafters, me, pack.number), count: pack.count });
      }
      askMissing(c);
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
