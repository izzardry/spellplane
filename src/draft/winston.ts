/**
 * Client side of the Winston draft (DESIGN "Specification: card data, packs and draft formats", Winston: face-down stack, three piles, private looks).
 * Contracts: M2-C (stub); implementer: M2-P3.
 *
 * Dealing (DECISIONS [M2-C], [M2-P3]): the dealer's browser (`WinstonState.dealer`, the first seat) generates every
 * pack from its own pack seed and opens it face down (commitments and opaque ids only). The last `packOpen` deals the
 * stack in shared state as opaque ids (core/open.ts `winstonDeal`); the identities stay in the dealer's browser.
 *
 * Private looks: whenever the confirmed state has the other player looking at a pile, the dealer sends that pile's
 * identities to that player only (`draftCards` on the pair channel, net/draftcards.ts), together with every card that
 * player took and was not shown yet (the top stack card after declining the last pile). Nothing about a pile the
 * dealer looks at ever leaves the dealer's browser. The other player checks every received card against the opening
 * pack's commitments and keeps only those; it shows a pile once it knows every card of it. The dealer, holding the
 * stack, could know every card; its view shows a pile only while it is the active player.
 */
import { verifyReveal, type RevealedCard } from '../core/commit';
import { setForPack } from '../core/drafting';
import { otherDrafter, winstonActive, winstonDealt, winstonStep } from '../core/open';
import type { DraftState, InstanceId, SeatId, TableState } from '../core/types';
import {
  WINSTON_SEEN,
  baseView,
  generateOwnPack,
  heldIdentities,
  keepGenerated,
  openDraftOf,
  packOpenDraft,
  reconcilePool,
  setMarked,
  updateDraftSecrets,
} from './open';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** Most received cards held back until the shared state knows their pack. */
const MAX_WAITING = 500;

/** The pack whose commitment lists `id`, if any. */
function commitmentOf(d: Readonly<DraftState>, id: InstanceId): DraftState['packs'][string] | null {
  for (const p of Object.values(d.packs)) if (p.commitment.instanceIds.includes(id)) return p;
  return null;
}

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createWinstonDriver: CreateDraftDriver = (host) => {
  let opening = false;
  let disposed = false;
  /**
   * The last state sequenced here (null until the first one): disclosures and the pool follow sequenced states only,
   * never an optimistic one whose own actions may still be refused.
   */
  let confirmed: TableState | null = null;
  let lastCid = 'winston';
  /** Dealer: ids already shown to the other player in this browser session, and the last pile look shown. */
  const shownTaken = new Set<InstanceId>();
  let shownLook: string | null = null;

  const identities = (): Map<InstanceId, RevealedCard> => heldIdentities(host.secrets());

  const reconcile = (): void => {
    if (confirmed?.draft?.settings.format !== 'winston') return;
    const known = identities();
    reconcilePool(host, confirmed, (id) => known.get(id) ?? null);
  };

  /** Dealer: show the other player what it may see in the confirmed state (see the module comment). */
  const disclose = (): void => {
    const d = confirmed === null ? null : openDraftOf(confirmed, 'winston');
    if (d === null || !winstonDealt(d.winston) || d.winston.dealer !== host.seat || host.sendCards === undefined) return;
    const other: SeatId = otherDrafter(d, host.seat);
    const known = identities();
    const ids: InstanceId[] = [];
    for (const id of d.taken?.[other] ?? []) if (!shownTaken.has(id)) ids.push(id);
    const look = winstonActive(d) === other ? `${d.winston.pile}:${d.winston.pileIds[d.winston.pile]!.join(',')}` : null;
    if (look !== null && look !== shownLook) ids.push(...d.winston.pileIds[d.winston.pile]!);
    if (ids.length === 0) return;
    const cards = ids.map((id) => known.get(id)).filter((c): c is RevealedCard => c !== undefined);
    host.sendCards(other, lastCid, cards);
    for (const id of d.taken?.[other] ?? []) shownTaken.add(id);
    if (look !== null) shownLook = look;
  };

  /**
   * Other player: cards from the dealer whose pack this browser does not know yet (the pair channel can overtake the
   * sequenced log); retried after every sequenced action, the oldest dropped beyond `MAX_WAITING`.
   */
  let waiting: { cards: RevealedCard[]; from: SeatId }[] = [];

  /** Other player: keep the dealer's cards that open a Winston pack's commitment; returns the cards whose pack is still unknown. */
  const take = (cards: readonly RevealedCard[], from: SeatId): RevealedCard[] => {
    const d = host.state().draft;
    if (d === undefined || d.settings.format !== 'winston' || d.winston === undefined) return [];
    if (from !== d.winston.dealer || from === host.seat) return [];
    const later: RevealedCard[] = [];
    const verified: RevealedCard[] = [];
    for (const c of cards) {
      const pack = commitmentOf(d, c.instanceId);
      if (pack === null) later.push(c);
      else if (pack.opener === from && verifyReveal(pack.commitment, c)) verified.push(c);
    }
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
    return later;
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
  });

  const offCards =
    host.onCards?.((_about, cards, from) => {
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
      host.dispatch(packOpenDraft(pack.packId, pack.cards, pack.seed, number, pack.set, 'down'));
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
      const total = d.settings.format === 'winston' ? d.settings.packs : 0;
      if (!opening && !winstonDealt(d.winston) && d.winston.dealer === host.seat && Object.keys(d.packs).length < total) void open();
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
