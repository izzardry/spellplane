/**
 * The spectator scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario to
 * the shared leak test; PLAN M3-P5; DESIGN "Players, seats and formats", Spectators: a spectator "sees only public
 * zones", and "A player may reveal their hand to a named spectator"). Used by tests/sim/roles/leak.test.ts over real
 * networked sessions and spectator sessions on LoopbackNetwork.
 *
 * A spectator is scanned with the shared scanner (tests/leak/leak.ts) against every seat's hidden cards: what each
 * owner showed this spectator by name (its `revealTo` listing the spectator id) is the only disclosure, taken from the
 * owner's side, plus every public reveal. A reveal to a spectator discloses nothing to the other seats or to the other
 * spectators: they are scanned with the owner's own disclosures to them.
 */
import type { Action } from '../../src/core/actions';
import type { SpectatorId } from '../../src/core/teams';
import type { InstanceId, LogEntry, SecretStore, TableState } from '../../src/core/types';
import type { NetEngine } from '../../src/net/types';
import type { Disclosure } from './leak';

/** The part of a seated session the tracker reads. */
export interface OwnerView {
  readonly seat: string;
  readonly engine: Pick<NetEngine, 'confirmedState' | 'onSequenced'>;
  secrets(): SecretStore;
  log(): LogEntry[];
}

/**
 * What `owner` deliberately showed spectator `to`, from the owner's side: its public reveals and verified flips (those
 * in its log before the call, and those sequenced after), and each `revealTo` that names `to` among its spectators (identity and salt from the owner's store at that
 * moment). A shown card that later goes back into a hidden zone lapses (tests/leak/leak.ts Disclosure).
 */
export function trackSpectatorDisclosures(owner: OwnerView, to: SpectatorId): Disclosure[] {
  const out: Disclosure[] = [];
  let prior: TableState = owner.engine.confirmedState();
  // What the owner made public before tracking started (the spectator may catch up on it from the log): its reveals
  // and verified flips, lapsed when the card is in a hidden zone now.
  for (const e of owner.log()) {
    if (e.kind !== 'action' || e.action.by !== owner.seat) continue;
    const a = e.action;
    const d = a.type === 'reveal' ? { instanceId: a.instanceId, sid: a.ref.sid, salt: a.salt } : a.type === 'flip' && a.ref && a.salt ? { instanceId: a.card, sid: a.ref.sid, salt: a.salt } : null;
    if (!d) continue;
    const now = prior.cards[d.instanceId];
    out.push(now && prior.zones[now.zone]?.visibility === 'public' ? d : { ...d, lapsed: true });
  }
  owner.engine.onSequenced((a: Action) => {
    const next = owner.engine.confirmedState();
    const me = owner.seat;
    const add = (id: InstanceId, sid: string, salt: string): void => void out.push({ instanceId: id, sid, salt });
    if (a.by === me && a.type === 'reveal') add(a.instanceId, a.ref.sid, a.salt);
    if (a.by === me && a.type === 'flip' && a.ref && a.salt) add(a.card, a.ref.sid, a.salt);
    if (a.by === me && a.type === 'revealTo' && (a.spectators ?? []).includes(to)) {
      const s = owner.secrets().identities[a.instanceId];
      if (s) add(a.instanceId, s.card.sid, s.salt);
    }
    for (const d of out) {
      const before = prior.cards[d.instanceId];
      const now = next.cards[d.instanceId];
      if (before && now && prior.zones[before.zone]?.visibility === 'public' && next.zones[now.zone]?.visibility !== 'public') d.lapsed = true;
    }
    prior = next;
  });
  return out;
}

