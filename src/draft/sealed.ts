/**
 * Client side of the sealed pools (DESIGN "Specification: card data, packs and draft formats", Sealed: pools are generated and shown to their owners).
 * Contracts: M2-C (stub); implementer: M2-P2.
 *
 * Each browser opens its `packs` packs one after another, each from a fresh pack seed (the secret-shuffle seed
 * protocol with purpose 'pack') with M2-P1's generator, and proposes a face-down `packOpen` per pack (sorted ids and
 * commitments only; core/reducer/pass.ts puts the count straight into the pool). The cards themselves go to the own
 * pool, in pack order, once the pack's `packOpen` is sequenced; they never leave this browser (DESIGN "Pre-game",
 * Hidden information: "Own pool only").
 */
import type { RevealedCard } from '../core/commit';
import type { DraftState, SealedSettings, SeatId, TableState } from '../core/types';
import { setForPack } from '../core/drafting';
import { draftSecretsOf } from './open';
import { addToPool, openHiddenPack, poolCards, updateSecrets } from './secret';
import type { CreateDraftDriver, DraftDriver, DraftPrivateView } from './types';

/** The running sealed draft of `state`, or null. */
function sealedOf(state: TableState): DraftState | null {
  const d = state.draft;
  if (!d || d.settings.format !== 'sealed' || state.stage !== 'draft') return null;
  return d;
}

function openedBy(d: DraftState, seat: SeatId): number {
  return Object.values(d.packs).filter((p) => p.opener === seat).length;
}

/** The driver (draft/types.ts DraftDriver). Implementer: M2-P2. */
export const createSealedDriver: CreateDraftDriver = (host) => {
  const me = host.seat;
  let disposed = false;
  let opening = false;
  let reused = false;
  let lastSequenced: TableState = host.confirmedState?.() ?? host.state();
  const conf = (): TableState => host.confirmedState?.() ?? lastSequenced;

  /** Move the cards of every own sequenced pack to the pool, in pack order (stopping at a pack whose record is missing). */
  const reconcile = (): void => {
    const state = conf();
    const d = state.draft;
    if (!d || d.settings.format !== 'sealed') return;
    const mine = Object.values(d.packs)
      .filter((p) => p.opener === me)
      .sort((a, b) => a.number - b.number);
    const s = host.secrets();
    const records = draftSecretsOf(s).generated;
    const have = new Set(poolCards(s).map((c) => c.instanceId));
    const add: RevealedCard[] = [];
    for (const p of mine) {
      const r = records.find((g) => g.packId === p.id);
      if (r === undefined) break;
      add.push(...r.cards.filter((c) => !have.has(c.instanceId)));
    }
    if (add.length > 0) updateSecrets(host, (ds, st) => addToPool(ds, st, add));
  };

  const off = host.onSequenced((_a, state) => {
    if (state.draft?.settings.format !== 'sealed') return;
    lastSequenced = state;
    reconcile();
  });

  const open = async (number: number, set: string): Promise<void> => {
    opening = true;
    const reuse = !reused;
    reused = true;
    try {
      const still = (): boolean => {
        const d = sealedOf(host.state());
        return !disposed && d !== null && !d.done && openedBy(d, me) === number;
      };
      await openHiddenPack(host, number, set, false, reuse, still);
    } catch {
      // No set data, or the seed round failed: the next drive() tries again.
    } finally {
      opening = false;
    }
  };

  const driver: DraftDriver = {
    format: 'sealed',
    drive() {
      if (disposed) return;
      reconcile();
      const d = sealedOf(host.state());
      if (d === null || d.done || opening) return;
      const n = openedBy(d, me);
      // One pack at a time: the next pack's seed round must start after this pack's `packOpen` is sequenced
      // (core/reducer/pass.ts: each pack needs a seed round newer than the opener's previous pack).
      const c = sealedOf(conf());
      if (c === null || openedBy(c, me) !== n) return;
      if (n < (d.settings as SealedSettings).packs) void open(n, setForPack(d.sets, n));
    },
    view(): DraftPrivateView {
      const s = host.secrets();
      const d = sealedOf(host.state());
      const total = d === null ? 0 : (d.settings as SealedSettings).packs;
      return {
        format: 'sealed',
        pack: null,
        picks: 0,
        marked: [],
        queued: 0,
        pool: [...(s.pool ?? [])],
        timer: null,
        waitingOn: d === null || d.done ? [] : d.drafters.filter((x) => openedBy(d, x) < total),
      };
    },
    mark() {
      // Sealed has no picks.
    },
    pick() {
      return false;
    },
    dispose() {
      disposed = true;
      off();
    },
  };
  return driver;
};
