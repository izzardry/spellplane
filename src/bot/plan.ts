/**
 * How Sparring plays (computer.md section 5): `decide(view, profile, seed)` returns the next single step, or null when
 * there is nothing to do (wait). Pure: the same view, profile and seed give the same step. Where a choice needs
 * randomness (ties) it uses `keyed(seed, turn, step, salt)`, a stateless hash, so a resumed game continues identically.
 * The bot never acts on cards it does not own: the human's creatures it counts as dead get a ping.
 */
import { sha256Sync } from '../core/sha256';
import type { InstanceId, PhaseId, Pose } from '../core/types';
import { has } from './cards';
import { chooseAttackers, chooseBlocks, combatResult, type Fighter } from './combat';
import { pay } from './mana';
import { attackPose, blockPose, freePose } from './place';
import type { BotCard, BotPermanent, BotProfile, BotStep, BotStepKind, BotView, Colour } from './types';
import { COLOURS } from './types';

/** A number in [0, 1) from the seed and a key; no generator state (computer.md section 9). */
export function keyed(seed: string, turn: number, step: number, salt: string): number {
  const h = sha256Sync(`${seed}|${turn}|${step}|${salt}`);
  return parseInt(h.slice(0, 8), 16) / 0x100000000;
}

/** What the runner adds: step kinds refused three times this turn, skipped until the turn changes (computer.md 10.4). */
export interface DecideContext {
  skip?: ReadonlySet<BotStepKind>;
  /** The table's format for poses; default '1v1'. */
  format?: '1v1';
  /** Sparring's seat index (1 at a computer table). */
  seatIndex?: number;
  /** Sparring's seat angle (180 at a computer table). */
  seatRot?: number;
}

/** A turn of more steps than this ends itself (computer.md 5.2, Watchdog). */
export const WATCHDOG_STEPS = 80;

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const MAIN = new Set(['main1', 'main2']);

/** The lands and creatures Sparring may tap for mana: untapped own lands. */
function manaLands(view: BotView): BotPermanent[] {
  return view.mine.filter((p) => p.owned && p.kind === 'land' && !p.tapped && !p.displaced);
}

/** How much the hand wants each colour (sum of coloured symbols of its castable-kind cards). */
function colourNeed(cards: readonly BotCard[]): Partial<Record<Colour, number>> {
  const need: Partial<Record<Colour, number>> = {};
  for (const c of cards) if (c.kind === 'creature' && c.cost) for (const col of COLOURS) need[col] = (need[col] ?? 0) + (c.cost.colours[col] ?? 0);
  return need;
}

/** The land to play: one that adds a colour the hand needs and the own lands lack; else the first (computer.md 5.2 row 5). */
function chooseLand(view: BotView, profile: BotProfile): BotCard | null {
  const lands = view.hand.filter((c) => c.kind === 'land').sort(byId);
  if (lands.length === 0) return null;
  if (profile.level === 'gentle') return lands[0]!;
  const have = new Set(view.mine.filter((p) => p.kind === 'land').flatMap((p) => p.produces));
  const need = colourNeed(view.hand);
  const lacking = COLOURS.filter((c) => (need[c] ?? 0) > 0 && !have.has(c));
  return lands.find((l) => l.produces.some((c) => lacking.includes(c))) ?? lands[0]!;
}

/** The creature to cast and how to pay (computer.md 5.5 casting order), or null. */
function chooseCast(view: BotView, profile: BotProfile, seed: string): { card: BotCard; pay: InstanceId[] } | null {
  const lands = manaLands(view);
  const options: { card: BotCard; pay: InstanceId[] }[] = [];
  for (const c of view.hand) {
    if (c.kind !== 'creature' || !c.cost) continue;
    const rest = view.hand.filter((x) => x.id !== c.id);
    const p = pay(c.cost, lands, colourNeed(rest));
    if (p) options.push({ card: c, pay: p });
  }
  if (options.length === 0) return null;
  const score = (o: { card: BotCard }): number => (profile.casting === 'cheapest' ? -o.card.mv : o.card.mv);
  const best = Math.max(...options.map(score));
  const top = options.filter((o) => score(o) === best);
  const power = Math.max(...top.map((o) => o.card.power + o.card.toughness));
  const tied = top.filter((o) => o.card.power + o.card.toughness === power).sort((a, b) => byId(a.card, b.card));
  if (tied.length === 1) return tied[0]!;
  return tied[Math.floor(keyed(seed, view.turn.number, view.thisTurn.steps, 'cast') * tied.length)]!;
}

/** Cards to discard down to seven: cards it cannot play first, then the most expensive (computer.md 5.2 row 15). */
function chooseDiscards(hand: readonly BotCard[], n: number): InstanceId[] {
  const playable = (c: BotCard): boolean => c.kind === 'land' || (c.kind === 'creature' && c.cost !== null);
  return [...hand]
    .sort((a, b) => Number(playable(a)) - Number(playable(b)) || b.mv - a.mv || byId(a, b))
    .slice(0, n)
    .map((c) => c.id);
}

/** The next phase step of Sparring's turn, or the pass (used after a skipped step). */
function advance(view: BotView): BotStep {
  const order: PhaseId[] = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];
  const i = order.indexOf(view.turn.phase);
  if (i < 0) return { kind: 'phase', phase: 'main1' };
  if (i >= order.length - 1) return { kind: 'passTurn' };
  const next = order[i + 1]!;
  return { kind: 'phase', phase: next === 'upkeep' ? 'draw' : next };
}

function fighter(p: BotPermanent): Fighter {
  return { id: p.id, power: p.power, toughness: p.toughness, keywords: p.keywords, mv: p.mv };
}

/** The booking of a combat on the table (computer.md 5.6), from the bot's side. */
function book(view: BotView, roundId: string, attackerSide: 'me' | 'opp'): BotStep {
  const attackers = (attackerSide === 'me' ? view.mine : view.theirs).filter((p) => p.combat === 'attack');
  const defenders = attackerSide === 'me' ? view.theirs : view.mine;
  const blocks = new Map<InstanceId, Fighter[]>();
  for (const a of attackers) {
    const bs = view.blocks
      .filter((b) => b.attacker === a.id)
      .map((b) => defenders.find((d) => d.id === b.blocker))
      .filter((d): d is BotPermanent => d !== undefined)
      .sort((x, y) => (attackerSide === 'me' ? y.pose.x - x.pose.x : x.pose.x - y.pose.x) || byId(x, y));
    if (bs.length > 0) blocks.set(a.id, bs.map(fighter));
  }
  const r = combatResult(attackers.map(fighter), blocks);
  const life: { seat: string; delta: number }[] = [];
  const lines: string[] = [];
  if (attackerSide === 'opp') {
    if (r.toDefender > 0) {
      life.push({ seat: view.me, delta: -r.toDefender });
      lines.push(`I take ${r.toDefender}.`);
    }
    if (r.lifelink.defender > 0) {
      life.push({ seat: view.me, delta: r.lifelink.defender });
      lines.push(`+${r.lifelink.defender} for me.`);
    }
    if (r.lifelink.attacker > 0) lines.push(`Lifelink: +${r.lifelink.attacker} for you, if I read it right.`);
  } else {
    if (r.toDefender > 0) {
      life.push({ seat: view.opp, delta: -r.toDefender });
      lines.push(`${r.toDefender} to you.`);
    }
    if (r.lifelink.attacker > 0) {
      life.push({ seat: view.me, delta: r.lifelink.attacker });
      lines.push(`+${r.lifelink.attacker} for me.`);
    }
    if (r.lifelink.defender > 0) lines.push(`Lifelink: +${r.lifelink.defender} for you, if I read it right.`);
  }
  const mineIds = new Set(view.mine.filter((p) => p.owned).map((p) => p.id));
  const bury = r.dead.filter((id) => mineIds.has(id));
  const pings = r.dead.filter((id) => !mineIds.has(id) && view.theirs.some((p) => p.id === id));
  for (const id of bury) lines.push(`My ${view.mine.find((p) => p.id === id)!.name} dies.`);
  for (const id of pings) lines.push(`I count your ${view.theirs.find((p) => p.id === id)!.name} as dead. Your move.`);
  if (lines.length === 0) lines.push('No damage.');
  let line = lines.join(' ');
  if (line.length > 200) line = `${line.slice(0, 186).replace(/\s+\S*$/, '')} … see the log.`;
  const settle = view.mine.filter((p) => p.owned && p.displaced && !bury.includes(p.id)).map((p) => p.id);
  return { kind: 'book', round: roundId, life, bury, pings, settle, line };
}

/** The opening-hand step, or null (computer.md 5.2 "Opening hand"). */
function opening(view: BotView, profile: BotProfile): BotStep | null {
  if (!view.opening.pending) return null;
  const lands = view.hand.filter((c) => c.kind === 'land').length;
  if (view.opening.mulligans === 0 && profile.mulligan && view.hand.length === 7 && [0, 1, 6, 7].includes(lands) && view.library > 0) return { kind: 'mulligan' };
  if (view.opening.mulligans > 0 && view.opening.bottomed < view.opening.mulligans && view.hand.length > 7 - view.opening.mulligans) {
    const pick = lands >= 5 ? view.hand.filter((c) => c.kind === 'land').sort(byId)[0]! : [...view.hand].sort((a, b) => b.mv - a.mv || byId(a, b))[0]!;
    return { kind: 'bottom', cards: [pick.id] };
  }
  return null;
}

/** Sparring's answer to an open round asked by the human (computer.md 5.3), or null. */
function answer(view: BotView, profile: BotProfile, ctx: DecideContext): BotStep | null {
  const r = view.round;
  if (!r || r.answered || r.askedBy === view.me) return null;
  const rot = ctx.seatRot ?? 180;
  if (r.cue === 'attack') {
    const attackers = view.theirs.filter((p) => p.combat === 'attack');
    const blocked = new Set(view.blocks.map((b) => b.blocker));
    const free = view.mine.filter((p) => p.owned && !blocked.has(p.id));
    const pairs = ctx.skip?.has('block') ? [] : chooseBlocks(attackers, free, view.life.me, profile);
    const named = (id: string, list: BotPermanent[]): string => list.find((p) => p.id === id)?.name ?? 'it';
    const line = pairs.length === 0 ? 'No blocks.' : pairs.map((p) => `I block ${named(p.attacker, view.theirs)} with ${named(p.blocker, view.mine)}.`).join(' ');
    return {
      kind: 'block',
      round: r.id,
      line,
      pairs: pairs.map((p) => ({ ...p, pose: blockPose(view.theirs.find((a) => a.id === p.attacker)!.pose, rot, view.mine.find((b) => b.id === p.blocker)!.pose.rot) })),
    };
  }
  if (r.cue === 'damage') return book(view, r.id, 'opp');
  if (r.cue === 'blocksDone') return book(view, r.id, 'me');
  return { kind: 'answer', round: r.id };
}

/**
 * The next step (computer.md section 5): answers to the human's rounds and cues first, then conceding at 0 life, the
 * opening hand, and on its own turn the rows of 5.2 in order.
 */
export function decide(view: BotView, profile: BotProfile, seed: string, ctx: DecideContext = {}): BotStep | null {
  if (view.over) return null;
  const reply = answer(view, profile, ctx);
  if (reply) return reply;
  if (view.life.me <= 0) return { kind: 'concede' };
  const open = opening(view, profile);
  if (open) return open;
  if (!view.turn.mine) return null;
  const step = turnStep(view, profile, seed, ctx);
  if (step && ctx.skip?.has(step.kind) && step.kind !== 'passTurn') return advance(view);
  return step;
}

function turnStep(view: BotView, profile: BotProfile, seed: string, ctx: DecideContext): BotStep | null {
  const t = view.thisTurn;
  if (t.steps >= WATCHDOG_STEPS) return { kind: 'passTurn' };
  const phase = view.turn.phase;
  const format = ctx.format ?? '1v1';
  const seatIndex = ctx.seatIndex ?? 1;
  const rot = ctx.seatRot ?? 180;
  if (t.fresh && phase !== 'untap') return { kind: 'phase', phase: 'untap' };
  if (phase === 'untap') {
    const tapped = view.mine.filter((p) => p.owned && p.tapped).map((p) => p.id);
    if (tapped.length > 0) return { kind: 'untap', cards: tapped.sort() };
    return { kind: 'phase', phase: 'draw' };
  }
  if (phase === 'upkeep') return { kind: 'phase', phase: 'draw' };
  if (phase === 'draw') {
    if (!t.drew && !t.firstOfGame && view.library > 0) return { kind: 'draw' };
    return { kind: 'phase', phase: 'main1' };
  }
  if (MAIN.has(phase)) {
    const top = view.stack[view.stack.length - 1];
    if (top) {
      if (!top.mine) return null;
      const r = view.round;
      if (r && r.about === top.id && !r.passed) return null;
      const taken = view.mine.map((p) => p.pose);
      return { kind: 'resolve', item: top.id, pose: freePose(format, seatIndex, taken, 'creature') };
    }
    if (!t.landPlayed) {
      const land = chooseLand(view, profile);
      if (land) return { kind: 'playLand', card: land.id, pose: freePose(format, seatIndex, view.mine.map((p) => p.pose), 'land') };
    }
    const cast = chooseCast(view, profile, seed);
    if (cast) return { kind: 'cast', card: cast.card.id, pay: cast.pay };
    return { kind: 'phase', phase: phase === 'main1' ? 'combat' : 'end' };
  }
  if (phase === 'combat') {
    const out = view.mine.filter((p) => p.combat === 'attack');
    if (out.length > 0) return null; // wait for the human's "Blocks done"
    if (!t.attacked && !t.combatDone) {
      const attackers = chooseAttackers(view.mine.filter((p) => p.owned), view.theirs, new Set(t.arrived), profile);
      if (attackers.length > 0) {
        const line = attackers.length === 1 ? `I attack with ${attackers[0]!.name}.` : `I attack with ${attackers.length}. Block, then press Done.`;
        return { kind: 'attack', line, attackers: attackers.map((a) => ({ card: a.id, pose: attackPose(a.pose, rot), tap: !has(a, 'vigilance') })) };
      }
    }
    const stray = view.mine.filter((p) => p.owned && p.displaced).map((p) => p.id);
    if (stray.length > 0 && t.combatDone) return { kind: 'settle', cards: stray.sort() };
    return { kind: 'phase', phase: 'main2' };
  }
  if (phase === 'end') {
    if (view.hand.length > 7) return { kind: 'discard', cards: chooseDiscards(view.hand, view.hand.length - 7) };
    return { kind: 'passTurn' };
  }
  return { kind: 'phase', phase: 'main1' };
}

/** A pose helper for tests: whether a pose is finite. */
export function finitePose(p: Pose): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.rot);
}
