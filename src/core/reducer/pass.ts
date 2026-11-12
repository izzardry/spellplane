/**
 * Reducer cases of the pass draft, Pick-Two and sealed (DESIGN "Specification: card data, packs and draft formats",
 * Draft formats; "Specification: network protocol and secrecy", Draft packs: `packOpen` publishes the commitments,
 * `pick {packId, count}` keeps picked identities with the picker, `packPass {packId, to, count}` hands the rest on).
 * Called through core/reducer/drafting.ts. Contracts: M2-C (stubs); implementer: M2-P2. The Two-Headed Giant
 * variants ('teamDraft', 'teamSealed') come here too and are M3-P2's.
 *
 * Pass draft (and Pick-Two):
 * - Each drafter opens one pack per round (`packOpen` with `number` = the round), generated from a fresh pack seed
 *   (the secret-shuffle round named by `sid`, purpose 'pack', owned by the opener, its latest, not used before). The
 *   action lists the pack's sorted opaque ids and sorted commitments only; its identities never enter shared state.
 *   The pack joins the back of its opener's queue.
 * - `pick {packId, count}` takes `count` = min(picks per pass, cards left) from the pack at the front of the picker's
 *   queue and names no card. The pack then leaves the queue but stays with the picker (`holder`) until its
 *   `packPass`; an emptied pack is done (`holder: null`). The next pack of the queue comes to the front, and its pick
 *   timer starts at this seq (`sinceSeq`).
 * - `packPass {packId, to, count}` hands a picked-from pack (held, not queued, `count` = cards left) to the next
 *   drafter in the round's direction (core/drafting.ts `passTarget`: left in rounds 0, 2, …, right in 1, 3, …); it
 *   joins the back of that drafter's queue. Its cards travel on the pair channel (net/private.ts).
 * - A round ends when every drafter's pack of it is open and empty; the next round starts, or after `packs` rounds
 *   the draft is done.
 * - `draftTimeout {packId, picks}` (the sequencer's clock, core/drafting.ts `draftDeadlines`) takes the pick of the
 *   pack at the front of its holder's queue for the holder: the same public effect as the holder's `pick`. The
 *   holder's browser then takes the marked cards, or else the first ones, privately (DESIGN pick timer: "on expiry
 *   the marked card, or else the first card, is taken"), so the pick happens on the sequencer's clock even while the
 *   holder is away (DECISIONS [M2-P2]).
 *
 * Sealed: each drafter opens `packs` packs in order (`number` 0, 1, …); their cards go straight to the opener's pool
 * (the pack is left with `count: 0`, no holder). Done when every drafter opened all of its packs.
 *
 * Pure and total like the rest of the reducer.
 */
import type { ActionOf } from '../actions';
import { passDirection, passTarget, setForPack } from '../drafting';
import { shuffleReady } from '../rng';
import type { DrafterId, DraftPack, DraftState, InstanceId, PackId, PassDraftSettings, SealedSettings, SeatId } from '../types';
import type { Draft } from './draft';
import { checkId, checkInt, checkString, own, reject } from './util';

/** Most cards one pack may hold (real boosters hold at most about twenty). */
export const MAX_PACK_CARDS = 64;
/** Longest commit string accepted. */
const MAX_SECRET = 256;

/** The seq this action gets: its own once sequenced, else the next one (an optimistic copy). */
function seqOf(d: Draft, a: { seq?: number }): number {
  return a.seq ?? d.base.seq + 1;
}

/** The running draft, writable, when it is of format `format`; refuses outside the draft stage, after the end, or in another format. */
function running(d: Draft, format: 'pass' | 'sealed'): DraftState {
  const cur = d.draft;
  if (cur === null) reject('no draft is in progress');
  if (d.base.stage !== 'draft') reject('the table is not in the draft stage');
  if (cur.settings.format !== format) reject(`this is a ${cur.settings.format} draft, not ${format}`);
  if (cur.done) reject('the draft is over');
  return d.draftW();
}

function checkDrafter(draft: DraftState, by: unknown): SeatId {
  const seat = checkId(by, 'seat');
  if (!draft.drafters.includes(seat)) reject(`${seat} is not drafting`);
  return seat;
}

/** Refuse the Two-Headed Giant formats (M3-P2) and say which format a draft is. */
function formatOf(d: Draft): string {
  const f = d.draft?.settings.format;
  if (f === undefined) reject('no draft is in progress');
  if (f === 'teamDraft' || f === 'teamSealed') reject(`the Two-Headed Giant formats are not implemented yet (M3-P2)`);
  return f;
}

/** The checked public part of a hidden `packOpen`. */
interface HiddenPack {
  packId: PackId;
  ids: InstanceId[];
  commits: string[];
  number: number;
  set: string;
}

/**
 * Check a face-down `packOpen` of `by`: a new pack id; 1 to MAX_PACK_CARDS cards with as many sorted commitments and
 * sorted, unused opaque ids; no identities; generated from a pack-seed round of `by` that is sealed, its latest, and
 * newer than its previous pack; the set of the pack number.
 */
function checkHiddenOpen(d: Draft, draft: DraftState, by: SeatId, a: ActionOf<'packOpen'>): HiddenPack {
  const packId = checkId(a.packId, 'pack');
  if (own(draft.packs, packId)) reject(`pack ${packId} is already open`);
  if (a.public === true || a.cards !== undefined) reject('this pack stays hidden: only its holder sees its cards');
  const count = checkInt(a.count, 'pack size', 1, MAX_PACK_CARDS);
  if (!Array.isArray(a.commits)) reject('a pack needs its commitments');
  const commits = (a.commits as unknown[]).map((c) => checkString(c, 'commit', MAX_SECRET));
  if (commits.length !== count) reject(`a pack of ${count} cards needs ${count} commitments`);
  for (const c of commits) if (c === '') reject('invalid commit');
  for (let i = 1; i < commits.length; i++) if (commits[i - 1]! > commits[i]!) reject('pack commitments must be sorted');
  if (!Array.isArray(a.instanceIds)) reject('a pack needs its opaque ids');
  if (a.instanceIds.length !== count) reject(`a pack of ${count} cards lists ${count} card ids`);
  const ids = (a.instanceIds as unknown[]).map((id) => checkId(id, 'card'));
  // Sorted, so the list says nothing about the pack order (rare first) or which id is which card.
  for (let i = 1; i < ids.length; i++) if (!(ids[i - 1]! < ids[i]!)) reject('pack ids must be sorted and unique');
  const used = new Set<InstanceId>();
  for (const p of Object.values(draft.packs)) for (const id of p.commitment.instanceIds) used.add(id);
  for (const id of ids) if (used.has(id) || d.cards.has(id)) reject(`card id ${id} is already in use`);
  // The pack was generated from a secret-shuffle seed its opener could not choose (DESIGN "Draft packs").
  const sid = checkId(a.sid, 'shuffle');
  const round = own(d.base.shuffles, sid);
  if (!round || round.purpose !== 'pack') reject(`${sid} is not a pack-seed round`);
  if (round.owner !== by) reject(`pack-seed round ${sid} belongs to ${round.owner}`);
  if (round.orderHash === null && !shuffleReady(d.base, sid)) reject(`pack-seed round ${sid} still waits for peer nonces`);
  // One round per pack, and the opener's latest: the opener cannot run several rounds and keep the pack it likes best.
  for (const p of Object.values(draft.packs)) {
    if (p.opener === by && p.commitment.atSeq >= round.startSeq) reject(`pack-seed round ${sid} is older than pack ${p.id}: each pack needs a fresh round`);
  }
  for (const r of Object.values(d.base.shuffles)) {
    if (r.purpose === 'pack' && r.owner === by && r.startSeq > round.startSeq) reject(`pack-seed round ${sid} is not ${by}'s latest (${r.id} is)`);
  }
  const number = checkInt(a.number, 'pack number', 0, 1000);
  const set = checkString(a.set, 'set code', 16);
  if (set !== setForPack(draft.sets, number)) reject(`pack ${number + 1} is of set ${setForPack(draft.sets, number)}`);
  return { packId, ids, commits, number, set };
}

function recordPack(draft: DraftState, by: SeatId, p: HiddenPack, seq: number, holder: SeatId | null, count: number): DraftPack {
  const pack: DraftPack = {
    id: p.packId,
    opener: by,
    number: p.number,
    set: p.set,
    commitment: { seat: by, commits: [...p.commits], instanceIds: [...p.ids], atSeq: seq },
    count,
    holder,
    picks: 0,
    sinceSeq: seq,
  };
  draft.packs[p.packId] = pack;
  return pack;
}

/** Put `pack` at the back of `drafter`'s queue; its pick timer starts now when it is the front pack. */
function enqueue(draft: DraftState, drafter: SeatId, pack: DraftPack, seq: number): void {
  const queue = (draft.queues[drafter] ??= []);
  queue.push(pack.id);
  pack.holder = drafter;
  if (queue.length === 1) pack.sinceSeq = seq;
}

/** `packOpen` of a hidden pack: records the pack, its commitments and size, and queues it at its opener (sealed: straight into the pool). */
export function packOpen(d: Draft, a: ActionOf<'packOpen'>): void {
  const f = formatOf(d);
  if (f === 'sealed') return sealedOpen(d, a);
  if (f !== 'pass') reject(`packOpen of a hidden pack does not apply to a ${f} draft`);
  const draft = running(d, 'pass');
  const by = checkDrafter(draft, a.by);
  const p = checkHiddenOpen(d, draft, by, a);
  if (p.number !== draft.round) reject(`round ${draft.round + 1} opens pack ${draft.round + 1}`);
  if (Object.values(draft.packs).some((x) => x.opener === by && x.number === p.number)) reject(`${by} already opened pack ${p.number + 1}`);
  const seq = seqOf(d, a);
  const pack = recordPack(draft, by, p, seq, by, p.ids.length);
  enqueue(draft, by, pack, seq);
}

function sealedOpen(d: Draft, a: ActionOf<'packOpen'>): void {
  const draft = running(d, 'sealed');
  const by = checkDrafter(draft, a.by);
  const total = (draft.settings as SealedSettings).packs;
  const opened = Object.values(draft.packs).filter((x) => x.opener === by).length;
  if (opened >= total) reject(`${by} opened all ${total} packs`);
  const p = checkHiddenOpen(d, draft, by, a);
  if (p.number !== opened) reject(`the next pack of ${by} is pack ${opened + 1}`);
  // The cards go straight to the opener's pool: nothing is left in the pack.
  recordPack(draft, by, p, seqOf(d, a), null, 0);
  draft.pools[by] = (draft.pools[by] ?? 0) + p.ids.length;
  const all = draft.drafters.every((s) => Object.values(draft.packs).filter((x) => x.opener === s).length >= total);
  if (all) draft.done = true;
}

/** The cards one pick takes from a pack with `left` cards: the picks per pass, or the rest of a short pack. */
export function pickCount(settings: PassDraftSettings, left: number): number {
  return Math.min(settings.picks, left);
}

/**
 * One holder's turn at a pack ("visit"): visit 0 is the opener's, visit k the k-th holder after it in the pack's
 * direction. Each visit takes one pick, so a pack's history follows from its opener, number, size and picks alone,
 * whichever actions a browser applied in between (a snapshot, a reload). Used by the reducer's peers: the pair channel
 * (net/private.ts) and the driver (draft/pass.ts).
 */
export interface PackVisit {
  /** 0-based visit index. */
  k: number;
  /** The drafter of this visit. */
  holder: DrafterId;
  /** Its pick is taken (the pack awaits its `packPass`, or is empty). */
  picked: boolean;
}

/** Picks per pass of a draft whose hidden packs travel (pass draft; the Two-Headed Giant draft), or null. */
export function picksPerPass(draft: DraftState): number | null {
  const s = draft.settings;
  return s.format === 'pass' || s.format === 'teamDraft' ? Math.max(1, s.picks) : null;
}

/** The drafter of visit `k` of `pack` (core/drafting.ts passTarget applied `k` times from the opener). */
export function packVisitor(draft: DraftState, pack: DraftPack, k: number): DrafterId {
  const n = draft.drafters.length;
  const i = draft.drafters.indexOf(pack.opener);
  const step = passDirection(pack.number) === 'left' ? 1 : n - 1;
  return draft.drafters[(i + ((k * step) % n) + n) % n]!;
}

/** Cards in `pack` at the start of visit `k`: its size less `picks` per earlier visit. */
export function packCountAt(pack: DraftPack, picks: number, k: number): number {
  return Math.max(0, pack.commitment.instanceIds.length - picks * k);
}

/** The pack's current visit: at the front or in the queue of its holder, picked and awaiting its pass, or the last one of an empty pack. */
export function packVisit(draft: DraftState, pack: DraftPack): PackVisit | null {
  if (!draft.drafters.includes(pack.opener)) return null;
  if (pack.holder !== null) {
    const queued = (draft.queues[pack.holder] ?? []).includes(pack.id);
    if (queued) return { k: pack.picks, holder: pack.holder, picked: false };
    if (pack.picks === 0) return null;
    return { k: pack.picks - 1, holder: pack.holder, picked: true };
  }
  if (pack.picks === 0) return null;
  return { k: pack.picks - 1, holder: packVisitor(draft, pack, pack.picks - 1), picked: true };
}

/** Take the pick of the front pack of `picker`'s queue (a `pick` or a `draftTimeout`). */
function takePick(draft: DraftState, picker: SeatId, pack: DraftPack, seq: number): void {
  const count = pickCount(draft.settings as PassDraftSettings, pack.count);
  pack.count -= count;
  pack.picks += 1;
  draft.pools[picker] = (draft.pools[picker] ?? 0) + count;
  const queue = draft.queues[picker]!;
  queue.shift();
  const front = queue[0];
  if (front !== undefined) draft.packs[front]!.sinceSeq = seq;
  if (pack.count > 0) return;
  // Empty: nothing to pass. The round ends when every pack of it is open and empty.
  pack.holder = null;
  const ofRound = Object.values(draft.packs).filter((p) => p.number === draft.round);
  if (ofRound.length < draft.drafters.length || ofRound.some((p) => p.count > 0)) return;
  if (draft.round + 1 < (draft.settings as PassDraftSettings).packs) draft.round += 1;
  else draft.done = true;
}

/** The pack at the front of `drafter`'s queue, writable, or a rejection. */
function frontPack(draft: DraftState, drafter: SeatId, packId: PackId): DraftPack {
  const front = draft.queues[drafter]?.[0];
  if (front === undefined) reject(`${drafter} holds no pack to pick from`);
  if (front !== packId) reject(`${drafter} picks from pack ${front} first`);
  return draft.packs[front]!;
}

/** `pick` from the pack at the front of the picker's queue: `count` equals the picks per pass, or the rest of the pack. */
export function pick(d: Draft, a: ActionOf<'pick'>): void {
  const f = formatOf(d);
  if (f === 'sealed') reject('sealed has no picks: every pool is opened whole');
  const draft = running(d, 'pass');
  const by = checkDrafter(draft, a.by);
  const pack = frontPack(draft, by, checkId(a.packId, 'pack'));
  // Identities of picked cards stay with the picker (DESIGN "Draft packs").
  if (a.cards !== undefined) reject('a pick from a hidden pack names no card');
  const need = pickCount(draft.settings as PassDraftSettings, pack.count);
  checkInt(a.count, 'pick count', 1, MAX_PACK_CARDS);
  if (a.count !== need) reject(`a pick from this pack takes ${need} card${need === 1 ? '' : 's'}`);
  takePick(draft, by, pack, seqOf(d, a));
}

/** `packPass` to the next drafter in the round's direction; ends a round when every pack of it is empty. */
export function packPass(d: Draft, a: ActionOf<'packPass'>): void {
  const f = formatOf(d);
  if (f !== 'pass') reject(`packs are not passed in a ${f} draft`);
  const draft = running(d, 'pass');
  const by = checkDrafter(draft, a.by);
  const packId = checkId(a.packId, 'pack');
  const pack = own(draft.packs, packId);
  if (!pack) reject(`unknown pack ${packId}`);
  if (pack.holder !== by) reject(`${by} does not hold pack ${packId}`);
  if (draft.queues[by]?.includes(packId)) reject(`${by} picks from pack ${packId} before passing it`);
  if (pack.count === 0) reject(`pack ${packId} is empty`);
  checkInt(a.count, 'card count', 1, MAX_PACK_CARDS);
  if (a.count !== pack.count) reject(`pack ${packId} holds ${pack.count} cards`);
  const to = checkId(a.to, 'drafter');
  const target = passTarget(draft.drafters, by, pack.number);
  if (to !== target) reject(`pack ${pack.number + 1} goes ${passDirection(pack.number)}, to ${target}`);
  enqueue(draft, target, pack, seqOf(d, a));
}

/** `draftTimeout` from the sequencer: the pick timer of the front pack ran out; its pick is taken for the holder (see the module comment). */
export function draftTimeout(d: Draft, a: ActionOf<'draftTimeout'>): void {
  const f = formatOf(d);
  if (f !== 'pass') reject(`a ${f} draft has no pick timer`);
  const draft = running(d, 'pass');
  checkId(a.by, 'seat');
  if (!draft.pickTimer) reject('the pick timer is off');
  const packId = checkId(a.packId, 'pack');
  const pack = own(draft.packs, packId);
  if (!pack) reject(`unknown pack ${packId}`);
  const holder = pack.holder;
  if (holder === null || draft.queues[holder]?.[0] !== packId) reject(`pack ${packId} is not waiting for a pick`);
  const picks = checkInt(a.picks, 'pick number', 0, MAX_PACK_CARDS);
  if (picks !== pack.picks) reject(`the timer of pick ${picks + 1} of pack ${packId} is over`);
  takePick(draft, holder, pack, seqOf(d, a));
}
