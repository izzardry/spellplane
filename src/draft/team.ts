/**
 * Two-Headed Giant draft and sealed (DESIGN "Pre-game: draft, sealed and deck building": Two-Headed Giant draft, teams
 * pick two cards per pack into a shared team pool, 6 packs per team, "Team sees its own packs and pool"; Two-Headed
 * Giant sealed, 8 packs per team, shared pool; "Specification: card data, packs and draft formats", Draft formats:
 * passing goes team to team, alternating direction per round). The drafter is the team (core/types.ts DrafterId); both
 * teammates' browsers hold the team's packs and pool, shared on the pair channel with `draftCards`.
 * Contracts: M3-C (stubs); implementer: M3-P2, with the reducer cases in core/reducer/pass.ts.
 *
 * It reuses the pass draft's machinery (DECISIONS [M3-P2]): every pack comes from a fresh pack seed of its opener with
 * M2-P1's generator and is opened face down with sorted ids and commitments only (draft/secret.ts `openHiddenPack`);
 * the pack's identities stay in the private draft secrets (`DraftSecrets.held[packId]`: every card of the pack this
 * browser knows, in pack order).
 *
 * - Who may know a card (`entitled`, from the confirmed shared state only): the members of the team that holds a pack
 *   may know its remaining cards; a team may know the cards it took (`DraftState.taken[team]`, named by the team's
 *   picks); in sealed a team may know every card of its own packs. Nothing else is ever sent.
 * - Sharing: every browser sends each seat what that seat may know of a pack and this browser knows, once per change
 *   (the opener to its teammate when its pack is opened; both members of a team that just picked to both members of the
 *   team the rest of the pack went to; a teammate the cards of a pick). A browser that lacks cards its team may know
 *   asks every other seat (`draftCards` with no cards, about `team:need`) after REQUEST_MS and then every REQUEST_MS;
 *   each answers with what the asker may know. Received cards are taken only when they open the pack's commitment in
 *   shared state (core/commit.ts verifyReveal); cards that arrive before this browser applied their pack wait.
 * - The pool: in the draft the team's picks in pick order (`taken[team]`), in sealed the team's packs in team pack order
 *   with their cards in pack order, each prefix as far as this browser knows the cards; kept with ids under
 *   TEAM_POOL and as refs in `SecretStore.pool`, so the builder of either teammate shows the whole team pool.
 * - Picking: a pick names the cards it takes (core/reducer/pass.ts), so either teammate's pick adds the same cards to
 *   both teammates' pools. Marks stay local.
 */
import { verifyReveal, type RevealedCard } from '../core/commit';
import { pickTimerMs, setForPack } from '../core/drafting';
import { packRemaining } from '../core/reducer/pass';
import { draftTeamOf, opensInRound, teamMembers, teamSealedNumbers } from '../core/teams';
import type { DraftPack, DraftState, InstanceId, PackId, SeatId, TableState, TeamDraftSettings, TeamSealedSettings } from '../core/types';
import { draftSecretsOf } from './open';
import { openHiddenPack, plainCard, updateSecrets } from './secret';
import type { CreateDraftDriver, DraftDriver, DraftHost, DraftPrivateView } from './types';

/** `DraftSecrets.held` key of the team pool with ids and salts, in pool order. */
export const TEAM_POOL = 'team:pool';
/** `draftCards` about-tag of team pack cards. */
export const TEAM_CARDS = 'team:cards';
/** `draftCards` about-tag of a request for the cards this browser's team may know (no cards). */
export const TEAM_NEED = 'team:need';
/** How long a browser waits for cards its team may know before it asks, and then between requests (ms). */
export const REQUEST_MS = 2000;
/** How many sequenced actions received cards wait for their pack to appear in shared state. */
const WAIT_ACTIONS = 200;

type TeamFormat = 'teamDraft' | 'teamSealed';

/** The Two-Headed Giant draft of `state` in `format`, in any stage of it (the pool can still be completing in build). */
function teamDraftOf(state: TableState, format: TeamFormat): DraftState | null {
  const d = state.draft;
  return d !== undefined && d.settings.format === format ? d : null;
}

/** The pack of a card id: the pack whose commitment lists it. */
function packOfCard(d: DraftState, id: InstanceId): DraftPack | null {
  for (const p of Object.values(d.packs)) if (p.commitment.instanceIds.includes(id)) return p;
  return null;
}

/**
 * The ids of `pack` seat `seat` may know now (see the module comment): the remaining cards while its team holds the
 * pack, the cards its team took, every card of its team's sealed pack. Empty for a seat without a drafting team.
 */
export function entitled(state: TableState, d: DraftState, seat: SeatId, pack: DraftPack): Set<InstanceId> {
  const out = new Set<InstanceId>();
  const team = Object.hasOwn(state.seats, seat) ? state.seats[seat]!.team : undefined;
  if (team === undefined || !d.drafters.includes(team)) return out;
  if (d.settings.format === 'teamSealed') {
    const opener = Object.hasOwn(state.seats, pack.opener) ? state.seats[pack.opener]!.team : undefined;
    if (opener === team) for (const id of pack.commitment.instanceIds) out.add(id);
    return out;
  }
  if (pack.holder === team) for (const id of packRemaining(d, pack)) out.add(id);
  const ids = new Set(pack.commitment.instanceIds);
  for (const id of (d.taken ?? {})[team] ?? []) if (ids.has(id)) out.add(id);
  return out;
}

/** The ids of every pack this browser's team may know (for the own completeness check). */
function ownEntitled(state: TableState, d: DraftState, me: SeatId): Map<PackId, Set<InstanceId>> {
  const out = new Map<PackId, Set<InstanceId>>();
  for (const p of Object.values(d.packs)) {
    const ids = entitled(state, d, me, p);
    if (ids.size > 0) out.set(p.id, ids);
  }
  return out;
}

function create(host: DraftHost, format: TeamFormat): DraftDriver {
  const me = host.seat;
  let disposed = false;
  let opening = false;
  let reused = false;
  /** Pushes done: `${to}|${packId}|${picks}|${count}`; a request from `to` clears its entries. */
  const sent = new Set<string>();
  /** Received cards whose pack this browser has not applied yet. */
  let waiting: { cards: RevealedCard[]; left: number }[] = [];
  /** When cards the team may know were first found missing, and when this browser last asked (local clock). */
  let missingSince: number | null = null;
  let askedAt: number | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  let lastSequenced: TableState = host.confirmedState?.() ?? host.state();
  const conf = (): TableState => host.confirmedState?.() ?? lastSequenced;
  const held = (): Record<string, RevealedCard[]> => draftSecretsOf(host.secrets()).held;
  const known = (packId: PackId): RevealedCard[] => (Object.hasOwn(held(), packId) && packId !== TEAM_POOL ? held()[packId]! : []);

  /** Keep `cards` that open their pack's commitment in `state`; returns the ones whose pack is not there yet. */
  const take = (state: TableState, cards: readonly RevealedCard[]): RevealedCard[] => {
    const d = teamDraftOf(state, format);
    if (d === null) return [...cards];
    const later: RevealedCard[] = [];
    const add = new Map<PackId, RevealedCard[]>();
    for (const c of cards) {
      const pack = packOfCard(d, c.instanceId);
      if (pack === null) {
        later.push(c);
        continue;
      }
      if (pack.id === TEAM_POOL || !verifyReveal(pack.commitment, c)) continue;
      add.set(pack.id, [...(add.get(pack.id) ?? []), plainCard(c)]);
    }
    if (add.size > 0) {
      updateSecrets(host, (ds) => {
        const next = { ...ds.held };
        let changed = false;
        for (const [packId, list] of add) {
          const have = Object.hasOwn(next, packId) ? next[packId]! : [];
          const ids = new Set(have.map((c) => c.instanceId));
          const fresh = list.filter((c) => !ids.has(c.instanceId) && (ids.add(c.instanceId), true));
          if (fresh.length === 0) continue;
          next[packId] = [...have, ...fresh];
          changed = true;
        }
        return { draft: changed ? { ...ds, held: next } : ds };
      });
    }
    return later;
  };

  /** The team pool as far as this browser knows its cards (see the module comment). */
  const poolOf = (state: TableState, d: DraftState): RevealedCard[] => {
    const team = draftTeamOf(state, me);
    if (team === null) return [];
    const byId = new Map<InstanceId, RevealedCard>();
    const out: RevealedCard[] = [];
    if (format === 'teamDraft') {
      for (const id of (d.taken ?? {})[team] ?? []) {
        let c = byId.get(id);
        if (c === undefined) {
          const pack = packOfCard(d, id);
          for (const k of pack === null ? [] : known(pack.id)) byId.set(k.instanceId, k);
          c = byId.get(id);
        }
        if (c === undefined) break;
        out.push(c);
      }
      return out;
    }
    const packs = Object.values(d.packs)
      .filter((p) => Object.hasOwn(state.seats, p.opener) && state.seats[p.opener]!.team === team)
      .sort((a, b) => a.number - b.number);
    for (const p of packs) {
      const cards = known(p.id);
      const ids = new Set(cards.map((c) => c.instanceId));
      if (!p.commitment.instanceIds.every((id) => ids.has(id))) break;
      out.push(...cards.filter((c) => p.commitment.instanceIds.includes(c.instanceId)));
    }
    return out;
  };

  /** Bring the own pool in step with the confirmed state. */
  const reconcilePool = (state: TableState, d: DraftState): void => {
    const pool = poolOf(state, d);
    const s = host.secrets();
    const have = draftSecretsOf(s).held[TEAM_POOL] ?? [];
    if (have.length === pool.length && have.every((c, i) => c.instanceId === pool[i]!.instanceId)) return;
    updateSecrets(host, (ds) => ({ draft: { ...ds, held: { ...ds.held, [TEAM_POOL]: pool.map(plainCard) } }, pool: pool.map((c) => plainCard(c).ref) }));
  };

  /** Send every seat what it may know and this browser knows, once per change (see the module comment). */
  const push = (state: TableState, d: DraftState): void => {
    if (host.sendCards === undefined) return;
    const seats = Object.values(state.seats)
      .filter((s) => s.id !== me && s.name.trim() !== '' && s.team !== undefined && d.drafters.includes(s.team))
      .map((s) => s.id);
    for (const pack of Object.values(d.packs)) {
      const mine = known(pack.id);
      if (mine.length === 0) continue;
      for (const to of seats) {
        const may = entitled(state, d, to, pack);
        const cards = mine.filter((c) => may.has(c.instanceId));
        if (cards.length === 0) continue;
        const key = `${to}|${pack.id}|${pack.picks}|${cards.length}`;
        if (sent.has(key)) continue;
        if (host.sendCards(to, TEAM_CARDS, cards)) sent.add(key);
      }
    }
  };

  /** Whether this browser lacks a card its team may know now. */
  const lacking = (state: TableState, d: DraftState): boolean => {
    for (const [packId, ids] of ownEntitled(state, d, me)) {
      const have = new Set(known(packId).map((c) => c.instanceId));
      for (const id of ids) if (!have.has(id)) return true;
    }
    return false;
  };

  /** Ask the other seats for the cards the team may know, after REQUEST_MS without them and then every REQUEST_MS. */
  const askMissing = (state: TableState, d: DraftState): void => {
    if (!lacking(state, d)) {
      missingSince = null;
      return;
    }
    const now = Date.now();
    missingSince ??= now;
    if (now - missingSince >= REQUEST_MS && (askedAt === null || now - askedAt >= REQUEST_MS) && host.sendCards !== undefined) {
      askedAt = now;
      for (const s of Object.values(state.seats)) if (s.id !== me && s.name.trim() !== '') host.sendCards(s.id, TEAM_NEED, []);
    }
    if (retry === null && !disposed) {
      retry = setTimeout(() => {
        retry = null;
        driver.drive();
      }, REQUEST_MS);
    }
  };

  /** The private side in step with the confirmed state: waiting cards, the pool, the pushes and the requests. */
  const reconcile = (): void => {
    const state = conf();
    const d = teamDraftOf(state, format);
    if (d === null) return;
    if (waiting.length > 0) {
      const again = waiting;
      waiting = [];
      for (const w of again) {
        const later = take(state, w.cards);
        if (later.length > 0 && w.left > 0) waiting.push({ cards: later, left: w.left - 1 });
      }
    }
    reconcilePool(state, d);
    push(state, d);
    askMissing(state, d);
  };

  const off = host.onSequenced((_a, state) => {
    if (teamDraftOf(state, format) === null) return;
    lastSequenced = state;
    reconcile();
  });

  const offCards =
    host.onCards?.((about, cards, from) => {
      if (disposed || (about !== TEAM_CARDS && about !== TEAM_NEED)) return;
      const state = conf();
      if (about === TEAM_NEED) {
        if (cards.length > 0) return;
        for (const key of [...sent]) if (key.startsWith(`${from}|`)) sent.delete(key);
        const d = teamDraftOf(state, format);
        if (d !== null) push(state, d);
        return;
      }
      const later = take(state, cards);
      if (later.length > 0) waiting.push({ cards: later, left: WAIT_ACTIONS });
      driver.drive();
    }) ?? ((): void => undefined);

  /** The running draft in the draft stage, as `state` shows it. */
  const live = (state: TableState): DraftState | null => (state.stage === 'draft' ? teamDraftOf(state, format) : null);

  const open = async (number: number, set: string, still: () => boolean): Promise<void> => {
    opening = true;
    const reuse = !reused;
    reused = true;
    try {
      await openHiddenPack(host, number, set, true, reuse, () => !disposed && still());
    } catch {
      // No set data, or the seed round failed: the next drive() tries again.
    } finally {
      opening = false;
    }
  };

  /** The pack number this browser opens next, or null: its pack of the round (draft), its next team pack (sealed). */
  const owedPack = (state: TableState): number | null => {
    const d = live(state);
    const team = draftTeamOf(state, me);
    if (d === null || d.done || team === null) return null;
    const members = teamMembers(state, team);
    const j = members.indexOf(me);
    const mine = Object.values(d.packs).filter((p) => p.opener === me);
    if (format === 'teamDraft') {
      const packs = (d.settings as TeamDraftSettings).packs;
      if (!opensInRound(packs, members.length, j, d.round) || mine.some((p) => p.number === d.round)) return null;
      return d.round;
    }
    const numbers = teamSealedNumbers((d.settings as TeamSealedSettings).packs, members.length, j);
    return mine.length < numbers.length ? numbers[mine.length]! : null;
  };

  /** Seats the table waits for: a team holding a pack (both members), and members still owing a pack. */
  const waitingOn = (state: TableState, d: DraftState): SeatId[] => {
    if (d.done) return [];
    const out: SeatId[] = [];
    for (const team of d.drafters) {
      const members = teamMembers(state, team);
      const busy = (d.queues[team] ?? []).length > 0;
      for (const [j, seat] of members.entries()) {
        const mine = Object.values(d.packs).filter((p) => p.opener === seat);
        let owes: boolean;
        if (format === 'teamDraft') owes = opensInRound((d.settings as TeamDraftSettings).packs, members.length, j, d.round) && !mine.some((p) => p.number === d.round);
        else owes = mine.length < teamSealedNumbers((d.settings as TeamSealedSettings).packs, members.length, j).length;
        if (busy || owes) out.push(seat);
      }
    }
    return out.sort((a, b) => state.seats[a]!.index - state.seats[b]!.index);
  };

  const driver: DraftDriver = {
    format,
    drive() {
      if (disposed) return;
      reconcile();
      if (opening) return;
      const v = host.state();
      const n = owedPack(v);
      // Only once the confirmed state agrees (a new seed round must start after the previous own pack is sequenced).
      if (n === null || owedPack(conf()) !== n) return;
      const d = live(v)!;
      void open(n, setForPack(d.sets, n), () => owedPack(host.state()) === n);
    },
    view(): DraftPrivateView {
      const s = host.secrets();
      const state = host.state();
      const d = live(state);
      const base: DraftPrivateView = { format, pack: null, picks: 0, marked: [], queued: 0, pool: [...(s.pool ?? [])], timer: null, waitingOn: [] };
      if (d === null) return base;
      base.waitingOn = waitingOn(state, d);
      const team = draftTeamOf(state, me);
      if (format !== 'teamDraft' || team === null) return base;
      const queue = d.queues[team] ?? [];
      base.queued = Math.max(0, queue.length - 1);
      const front = queue[0] === undefined || !Object.hasOwn(d.packs, queue[0]) ? null : d.packs[queue[0]]!;
      if (front === null) return base;
      if (d.pickTimer) base.timer = { fromSeq: front.sinceSeq, ms: pickTimerMs(front.picks) };
      const left = new Set(packRemaining(d, front));
      const cards = known(front.id).filter((c) => left.has(c.instanceId));
      // Shown once every remaining card is here.
      if (cards.length !== left.size || cards.length === 0) return base;
      base.pack = { packId: front.id, cards: cards.map((c) => ({ id: c.instanceId, ref: { ...c.ref } })), public: false };
      base.picks = Math.min(Math.max(1, (d.settings as TeamDraftSettings).picks), front.count);
      base.marked = draftSecretsOf(s).marked.filter((id) => left.has(id));
      return base;
    },
    mark(cards) {
      const v = driver.view();
      if (v.pack === null) return;
      const ids = new Set(v.pack.cards.map((c) => c.id));
      const chosen = [...new Set(cards)].filter((id) => ids.has(id)).slice(0, v.picks);
      updateSecrets(host, (ds) => ({ draft: { ...ds, marked: [...ds.marked.filter((id) => !ids.has(id)), ...chosen] } }));
    },
    pick(cards) {
      const v = driver.view();
      if (v.pack === null || disposed) return false;
      const ids = new Set(v.pack.cards.map((c) => c.id));
      const chosen = [...new Set(cards)];
      if (chosen.length !== v.picks || chosen.length !== cards.length || !chosen.every((id) => ids.has(id))) return false;
      updateSecrets(host, (ds) => ({ draft: { ...ds, marked: ds.marked.filter((id) => !ids.has(id)) } }));
      host.dispatch({ type: 'pick', packId: v.pack.packId, count: v.picks, cards: chosen });
      return true;
    },
    dispose() {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      off();
      offCards();
    },
  };
  return driver;
}

/** The Two-Headed Giant draft driver (draft/types.ts DraftDriver). Implementer: M3-P2. */
export const createTeamDraftDriver: CreateDraftDriver = (host) => create(host, 'teamDraft');

/** The Two-Headed Giant sealed driver (draft/types.ts DraftDriver). Implementer: M3-P2. */
export const createTeamSealedDriver: CreateDraftDriver = (host) => create(host, 'teamSealed');
