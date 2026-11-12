/**
 * Client side of the Rochester draft (DESIGN "Specification: card data, packs and draft formats", Rochester: public pack, snake order, rotating opener, burn count).
 * Contracts: M2-C (stub); implementer: M2-P3.
 *
 * The opener's browser generates the next pack from a fresh pack seed and lays it face up (`packOpen` with
 * `public: true` and every card with its salt). Each drafter picks one named card when the snake order reaches them
 * (core/open.ts `rochesterPicker`); the reducer moves the opener role left once `burn` cards remain. Picks are public,
 * so the pool is filled from `DraftState.taken` and the remembered face-up cards (draft/open.ts).
 */
import type { TableState } from '../core/types';
import { setForPack } from '../core/drafting';
import { rochesterOpenerDue, rochesterPicker, rochesterRound } from '../core/open';
import {
  baseView,
  faceUpIdentity,
  generateOwnPack,
  keepGenerated,
  openDraftOf,
  packOpenDraft,
  reconcilePool,
  rememberPublicPack,
  setMarked,
} from './open';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createRochesterDriver: CreateDraftDriver = (host) => {
  let opening = false;
  let disposed = false;

  /** The last confirmed state: the pool follows sequenced picks only, never optimistic ones that may be reordered or refused. */
  let confirmed: TableState | null = null;

  const reconcile = (): void => {
    if (confirmed?.draft?.settings.format === 'rochester') reconcilePool(host, confirmed, faceUpIdentity(host, confirmed));
  };

  const off = host.onSequenced((a, state) => {
    if (state.draft?.settings.format !== 'rochester') return;
    confirmed = state;
    if (a.type === 'packOpen') rememberPublicPack(host, state, a);
    reconcile();
  });

  const open = async (): Promise<void> => {
    const d = openDraftOf(host.state(), 'rochester');
    if (d === null || d.rochester === undefined) return;
    const opened = d.rochester.opened;
    const number = rochesterRound(opened, d.drafters.length);
    opening = true;
    try {
      const pack = await generateOwnPack(host, setForPack(d.sets, number));
      if (disposed) return;
      const now = openDraftOf(host.state(), 'rochester');
      if (now === null || rochesterOpenerDue(now) !== host.seat || now.rochester?.opened !== opened) return;
      keepGenerated(host, pack);
      host.dispatch(packOpenDraft(pack.packId, pack.cards, pack.seed, number, pack.set, 'up'));
    } catch {
      // No set data or the seed round failed: the next drive() tries again.
    } finally {
      opening = false;
    }
  };

  const driver: DraftDriver = {
    format: 'rochester',
    drive() {
      if (disposed) return;
      reconcile();
      const d = openDraftOf(host.state(), 'rochester');
      if (d === null || opening) return;
      if (rochesterOpenerDue(d) === host.seat) void open();
    },
    view(): DraftPrivateView {
      const d = openDraftOf(host.state(), 'rochester');
      if (d === null || d.rochester === undefined) return baseView(host, 'rochester', []);
      const picker = rochesterPicker(d);
      const due = rochesterOpenerDue(d);
      const v = baseView(host, 'rochester', picker !== null ? [picker] : due !== null ? [due] : []);
      const packId = d.rochester.pack;
      const pack = packId === null ? undefined : d.packs[packId];
      if (pack) v.pack = { packId: pack.id, cards: (pack.cards ?? []).map((c) => ({ id: c.id, ref: { ...c.ref } })), public: true };
      v.picks = 1;
      const ids = new Set((pack?.cards ?? []).map((c) => c.id));
      v.marked = v.marked.filter((id) => ids.has(id));
      return v;
    },
    mark(cards) {
      const d = openDraftOf(host.state(), 'rochester');
      const packId = d?.rochester?.pack ?? null;
      const ids = new Set(packId === null ? [] : (d!.packs[packId]?.cards ?? []).map((c) => c.id));
      setMarked(host, cards.filter((id) => ids.has(id)).slice(0, 1));
    },
    pick(cards) {
      const d = openDraftOf(host.state(), 'rochester');
      if (d === null || d.rochester?.pack == null || cards.length !== 1) return false;
      if (rochesterPicker(d) !== host.seat) return false;
      const pack = d.packs[d.rochester.pack];
      const id = cards[0]!;
      if (!pack || !(pack.cards ?? []).some((c) => c.id === id)) return false;
      host.dispatch({ type: 'pick', packId: pack.id, count: 1, cards: [id] });
      setMarked(host, []);
      return true;
    },
    dispose() {
      disposed = true;
      off();
    },
  };
  return driver;
};
