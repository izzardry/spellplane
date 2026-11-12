/**
 * Client side of the Winston draft (DESIGN "Specification: card data, packs and draft formats", Winston: face-down stack, three piles, private looks).
 * Contracts: M2-C (stub); implementer: M2-P3.
 *
 * Dealing (DECISIONS [M2-C], [M2-P3]): the dealer's browser (`WinstonState.dealer`, the first seat) generates every
 * pack from its own pack seed and opens it face down: commitments only, no ids, so shared state never tells which pack
 * (or set) a stack card came from. The last `packOpen` lists every id of the stack and deals it (core/open.ts
 * `winstonDeal`); the identities stay in the dealer's browser.
 *
 * Private looks: whenever the confirmed state has the other player looking at a pile, the dealer sends that pile's
 * identities to that player only (`draftCards` on the pair channel, net/draftcards.ts), together with every card that
 * player took and was not shown yet (the top stack card after declining the last pile). A disclosure counts as made
 * only once `sendCards` delivered it to a connected peer; until then every sequenced action and every drive() retries.
 * A message can still be lost after delivery (the peer drops right then), so the other player asks again: whenever its
 * confirmed state has it looking at a pile, or owning a taken card, whose identity it lacks, it sends an empty
 * `draftCards` (about `winston:need`) to the dealer, who answers with everything that player may see now. Nothing about
 * a pile the dealer looks at ever leaves the dealer's browser.
 *
 * The other player checks every received card against the commitments of all Winston packs together and the ids of
 * the dealt stack (core/open.ts `winstonCommitment`) and keeps only those; it shows a pile once it knows every card of
 * it. The dealer, holding the stack, could know every card; its view shows a pile only while it is the active player.
 */
import { verifyReveal, type RevealedCard } from '../core/commit';
import { setForPack } from '../core/drafting';
import { otherDrafter, winstonActive, winstonCommitment, winstonDealt, winstonStep } from '../core/open';
import type { DraftState, InstanceId, SeatId, TableState } from '../core/types';
import {
  WINSTON_SEEN,
  baseView,
  draftSecretsOf,
  generateOwnPack,
  heldIdentities,
  keepGenerated,
  openDraftOf,
  reconcilePool,
  setMarked,
  updateDraftSecrets,
  winstonOpenDraft,
} from './open';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** Most received cards held back until the stack is dealt. */
const MAX_WAITING = 500;
/** The `about` of the other player's request for what it may see (an empty `draftCards`). */
export const WINSTON_NEED = 'winston:need';
/** drive() calls before the other player repeats an unanswered request for the same confirmed state. */
const NEED_REPEAT = 25;

/** The ids the non-dealer `seat` may hold an identity for in `d`: its taken cards and, while it looks, the pile. */
function mayKnow(d: Readonly<DraftState>, seat: SeatId): { taken: InstanceId[]; look: InstanceId[] } {
  const w = d.winston;
  if (!winstonDealt(w)) return { taken: [], look: [] };
  const look = winstonActive(d) === seat ? [...(w.pileIds[w.pile] ?? [])] : [];
  return { taken: [...(d.taken?.[seat] ?? [])], look };
}

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createWinstonDriver: CreateDraftDriver = (host) => {
  let opening = false;
  let disposed = false;
  /**
   * The last state sequenced here: disclosures, requests and the pool follow sequenced states only, never an optimistic
   * one whose own actions may still be refused. Until the first action is sequenced it is the table at creation: the
   * session creates the driver on load (a reload) or when the draft starts, before this browser has a Winston action
   * of its own pending, so that table is confirmed. Without it a reloaded driver would neither ask for nor answer a
   * missing pile until someone acts, and in Winston only the player waiting for that pile can act.
   */
  let confirmed: TableState = host.state();
  let lastCid = 'winston';
  /** Dealer: ids delivered to the other player in this browser session, and the last pile look delivered. */
  const shown = new Set<InstanceId>();
  let shownLook: string | null = null;
  /** Other player: the confirmed seq of its last delivered request, and drive() calls since. */
  let askedAt: number | null = null;
  let sinceAsked = 0;

  const identities = (): Map<InstanceId, RevealedCard> => heldIdentities(host.secrets());

  const reconcile = (): void => {
    if (confirmed.draft?.settings.format !== 'winston') return;
    const known = identities();
    reconcilePool(host, confirmed, (id) => known.get(id) ?? null);
  };

  /**
   * Dealer: show the other player what it may see in the confirmed state (see the module comment): what was not
   * delivered yet, or everything it may see when `all` (its request). Marked as shown only once delivered.
   */
  const disclose = (all = false): void => {
    const d = openDraftOf(confirmed, 'winston');
    if (d === null || !winstonDealt(d.winston) || d.winston.dealer !== host.seat || host.sendCards === undefined) return;
    const other: SeatId = otherDrafter(d, host.seat);
    const may = mayKnow(d, other);
    const taken = may.taken.filter((id) => all || !shown.has(id));
    const look = may.look.length > 0 ? `${d.winston.pile}:${may.look.join(',')}` : null;
    const pile = look !== null && (all || look !== shownLook) ? may.look : [];
    const ids = [...new Set([...taken, ...pile])];
    if (ids.length === 0) return;
    const known = identities();
    const cards = ids.map((id) => known.get(id)).filter((c): c is RevealedCard => c !== undefined);
    if (!host.sendCards(other, lastCid, cards)) return;
    for (const id of ids) shown.add(id);
    if (pile.length > 0) shownLook = look;
  };

  /** Other player: ask the dealer again when the confirmed state lets it see a card it has no identity for. */
  const askIfMissing = (): void => {
    const d = openDraftOf(confirmed, 'winston');
    if (d === null || !winstonDealt(d.winston) || d.winston.dealer === host.seat || host.sendCards === undefined) return;
    const may = mayKnow(d, host.seat);
    const known = identities();
    if ([...may.taken, ...may.look].every((id) => known.has(id))) {
      askedAt = null;
      return;
    }
    const seq = confirmed.seq;
    if (askedAt === seq && ++sinceAsked < NEED_REPEAT) return;
    if (!host.sendCards(d.winston.dealer, WINSTON_NEED, [])) return;
    askedAt = seq;
    sinceAsked = 0;
  };

  /**
   * Other player: cards from the dealer that arrived before the deal (the pair channel can overtake the sequenced
   * log); retried after every sequenced action, the oldest dropped beyond `MAX_WAITING`.
   */
  let waiting: { cards: RevealedCard[]; from: SeatId }[] = [];

  /** Other player: keep the dealer's cards that open the stack's commitments; returns them all while the stack is not dealt. */
  const take = (cards: readonly RevealedCard[], from: SeatId): RevealedCard[] => {
    const d = host.state().draft;
    if (d === undefined || d.settings.format !== 'winston' || d.winston === undefined) return [];
    if (from !== d.winston.dealer || from === host.seat) return [];
    const commitment = winstonCommitment(d);
    if (commitment === null) return [...cards];
    const verified = cards.filter((c) => verifyReveal(commitment, c));
    if (verified.length > 0) {
      updateDraftSecrets(host, (ds) => {
        const seen = ds.held[WINSTON_SEEN] ?? [];
        const have = new Set(seen.map((c) => c.instanceId));
        const add: RevealedCard[] = [];
        for (const c of verified) {
          if (have.has(c.instanceId)) continue;
          have.add(c.instanceId);
          add.push({ instanceId: c.instanceId, ref: c.ref.foil === true ? { sid: c.ref.sid, foil: true } : { sid: c.ref.sid }, salt: c.salt });
        }
        return add.length === 0 ? ds : { ...ds, held: { ...ds.held, [WINSTON_SEEN]: [...seen, ...add] } };
      });
      reconcile();
    }
    return [];
  };

  const offSeq = host.onSequenced((a, state) => {
    confirmed = state;
    lastCid = a.cid;
    if (state.draft?.settings.format !== 'winston') return;
    if (waiting.length > 0) {
      const retry = waiting;
      waiting = [];
      for (const w of retry) {
        const later = take(w.cards, w.from);
        if (later.length > 0) waiting.push({ cards: later, from: w.from });
      }
    }
    reconcile();
    disclose();
    askIfMissing();
  });

  const offCards =
    host.onCards?.((about, cards, from) => {
      const d = openDraftOf(confirmed, 'winston');
      if (d?.winston?.dealer === host.seat) {
        // The other player's request: answer with everything it may see now.
        if (about === WINSTON_NEED && cards.length === 0 && d.drafters.includes(from) && from !== host.seat) disclose(true);
        return;
      }
      const later = take(cards, from);
      if (later.length === 0) return;
      waiting.push({ cards: later, from });
      while (waiting.reduce((n, w) => n + w.cards.length, 0) > MAX_WAITING) waiting.shift();
    }) ?? ((): void => undefined);

  const open = async (): Promise<void> => {
    const d = openDraftOf(host.state(), 'winston');
    if (d === null) return;
    const number = Object.keys(d.packs).length;
    opening = true;
    try {
      const pack = await generateOwnPack(host, setForPack(d.sets, number));
      if (disposed) return;
      const now = openDraftOf(host.state(), 'winston');
      if (now === null || winstonDealt(now.winston) || Object.keys(now.packs).length !== number) return;
      keepGenerated(host, pack);
      // The dealing (last) pack lists the ids of every pack's cards: the earlier ones from the own records.
      const total = now.settings.format === 'winston' ? now.settings.packs : 0;
      let stack: InstanceId[] | null = null;
      if (number + 1 >= total) {
        const records = new Map(draftSecretsOf(host.secrets()).generated.map((g) => [g.packId, g]));
        const earlier = Object.keys(now.packs).map((id) => records.get(id));
        if (earlier.some((g) => g === undefined)) return;
        stack = [...earlier.flatMap((g) => g!.cards.map((c) => c.instanceId)), ...pack.cards.map((c) => c.instanceId)];
      }
      host.dispatch(winstonOpenDraft(pack.packId, pack.cards, pack.seed, number, pack.set, stack));
    } catch {
      // No set data or the seed round failed: the next drive() tries again.
    } finally {
      opening = false;
    }
  };

  const driver: DraftDriver = {
    format: 'winston',
    drive() {
      if (disposed) return;
      reconcile();
      const d = openDraftOf(host.state(), 'winston');
      if (d === null || d.winston === undefined) return;
      disclose();
      askIfMissing();
      const total = d.settings.format === 'winston' ? d.settings.packs : 0;
      const packs = Object.keys(d.packs).length;
      // One pack at a time: the next pack-seed round starts once the last packOpen is sequenced, since a pack must name
      // the opener's latest round (core/reducer/open.ts).
      const pending = Object.keys(confirmed.draft?.packs ?? {}).length !== packs;
      if (!opening && !pending && !winstonDealt(d.winston) && d.winston.dealer === host.seat && packs < total) void open();
    },
    view(): DraftPrivateView {
      const d = openDraftOf(host.state(), 'winston');
      if (d === null || d.winston === undefined) return baseView(host, 'winston', []);
      const active = winstonActive(d);
      const v = baseView(host, 'winston', active !== null ? [active] : d.done ? [] : [d.winston.dealer]);
      v.marked = [];
      v.picks = 0;
      if (active === host.seat && winstonDealt(d.winston)) {
        const known = identities();
        const ids = d.winston.pileIds[d.winston.pile] ?? [];
        const cards = ids.map((id) => known.get(id));
        if (cards.every((c) => c !== undefined)) v.pile = cards.map((c) => ({ id: c!.instanceId, ref: { ...c!.ref } }));
      }
      return v;
    },
    mark() {
      setMarked(host, []);
    },
    pick() {
      return false;
    },
    pileLook(take) {
      const d = openDraftOf(host.state(), 'winston');
      if (d === null || d.winston === undefined || winstonActive(d) !== host.seat) return false;
      if (typeof winstonStep(d.winston, take) === 'string') return false;
      host.dispatch({ type: 'pileLook', pile: d.winston.pile, take });
      return true;
    },
    dispose() {
      disposed = true;
      offSeq();
      offCards();
    },
  };
  return driver;
};
