/**
 * Client side of the Grid draft (DESIGN "Specification: card data, packs and draft formats", Grid: 3×3 face up, row or column, refill).
 * Contracts: M2-C (stub); implementer: M2-P3.
 *
 * The grid's first player lays it: a fresh pack seed generates one booster, the same seed stream shuffles it, and its
 * first nine cards go face up (`packOpen` with `public: true`); the rest of that booster is never shown and stays in
 * the PackRecord for the audit. The first player takes a row or column, the second a remaining one; the reducer then
 * discards the rest and the other player lays the next grid. Takes are public, so the pool is filled from
 * `DraftState.taken` (draft/open.ts).
 */
import type { TableState } from '../core/types';
import { setForPack } from '../core/drafting';
import { gridLayerDue, gridLineOpen, gridTaker } from '../core/open';
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
  shuffleWith,
} from './open';
import { GRID_CELLS, type CreateDraftDriver, type DraftDriver, type DraftPrivateView } from './types';

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P3. */
export const createGridDriver: CreateDraftDriver = (host) => {
  let laying = false;
  let disposed = false;

  /** The last confirmed state: the pool follows sequenced picks only, never optimistic ones that may be reordered or refused. */
  let confirmed: TableState | null = null;

  const reconcile = (): void => {
    if (confirmed?.draft?.settings.format === 'grid') reconcilePool(host, confirmed, faceUpIdentity(host, confirmed));
  };

  const off = host.onSequenced((a, state) => {
    if (state.draft?.settings.format !== 'grid') return;
    confirmed = state;
    if (a.type === 'packOpen' && Array.isArray(a.cards)) rememberPublicPack(host, a.packId, a.cards);
    reconcile();
  });

  const lay = async (): Promise<void> => {
    const d = openDraftOf(host.state(), 'grid');
    if (d === null || d.grid === undefined) return;
    const index = d.grid.index;
    laying = true;
    try {
      const pack = await generateOwnPack(host, setForPack(d.sets, index));
      if (disposed) return;
      const now = openDraftOf(host.state(), 'grid');
      if (now === null || gridLayerDue(now) !== host.seat || now.grid?.index !== index) return;
      const shown = shuffleWith(pack.cards, pack.stream).slice(0, GRID_CELLS);
      keepGenerated(host, pack, shown);
      host.dispatch(packOpenDraft(pack.packId, shown, pack.seed, index, pack.set, 'up'));
    } catch {
      // No set data or the seed round failed: the next drive() tries again.
    } finally {
      laying = false;
    }
  };

  const driver: DraftDriver = {
    format: 'grid',
    drive() {
      if (disposed) return;
      reconcile();
      const d = openDraftOf(host.state(), 'grid');
      if (d === null || laying) return;
      if (gridLayerDue(d) === host.seat) void lay();
    },
    view(): DraftPrivateView {
      const d = openDraftOf(host.state(), 'grid');
      if (d === null) return baseView(host, 'grid', []);
      const taker = gridTaker(d);
      const layer = gridLayerDue(d);
      const v = baseView(host, 'grid', taker !== null ? [taker] : layer !== null ? [layer] : []);
      v.marked = [];
      return v;
    },
    mark() {
      // A grid take names a whole row or column; nothing to mark.
      setMarked(host, []);
    },
    pick() {
      return false;
    },
    gridTake(line, index) {
      const d = openDraftOf(host.state(), 'grid');
      if (d === null || d.grid === undefined || gridTaker(d) !== host.seat) return false;
      if ((line !== 'row' && line !== 'col') || !gridLineOpen(d.grid, line, index)) return false;
      host.dispatch({ type: 'gridTake', grid: d.grid.index, line, index });
      return true;
    },
    dispose() {
      disposed = true;
      off();
    },
  };
  return driver;
};
