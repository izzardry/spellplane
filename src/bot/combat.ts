/**
 * Combat for Sparring (computer.md 5.5 and 5.6): which creatures attack, which block, and the bookkeeping model that
 * counts a combat that is on the table when a cue arrives. Pure and deterministic.
 */
import type { InstanceId } from '../core/types';
import { has } from './cards';
import type { BotCard, BotPermanent, BotProfile } from './types';

/** What fights: a creature's id, size and keywords. */
export type Fighter = Pick<BotCard, 'id' | 'power' | 'toughness' | 'keywords' | 'mv'>;

/** The result of one combat (computer.md 5.6). */
export interface CombatOutcome {
  /** Damage the attacking side's unblocked (or trampling) creatures deal to the defending player. */
  toDefender: number;
  /** Life each side gains through lifelink. */
  lifelink: { attacker: number; defender: number };
  /** Creatures that die, attackers and blockers. */
  dead: InstanceId[];
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Count a combat (computer.md 5.6): first and double strike deal damage first and creatures killed then deal none; an
 * unblocked attacker deals its power to the defender; a blocked attacker deals lethal damage to its blockers in order
 * (1 is lethal with deathtouch), with trample the rest to the player; each blocker deals its power to the attacker; a
 * creature with damage at least its toughness, or any damage from deathtouch, dies unless indestructible; lifelink
 * gains its controller the damage dealt. `blocks` maps an attacker to its blockers in damage order.
 */
export function combatResult(attackers: readonly Fighter[], blocks: ReadonlyMap<InstanceId, readonly Fighter[]>): CombatOutcome {
  const damage = new Map<InstanceId, number>();
  const touched = new Set<InstanceId>();
  const all = new Map<InstanceId, Fighter>();
  const side = new Map<InstanceId, 'attacker' | 'defender'>();
  for (const a of attackers) {
    all.set(a.id, a);
    side.set(a.id, 'attacker');
    for (const b of blocks.get(a.id) ?? []) {
      all.set(b.id, b);
      side.set(b.id, 'defender');
    }
  }
  const out: CombatOutcome = { toDefender: 0, lifelink: { attacker: 0, defender: 0 }, dead: [] };
  const dead = new Set<InstanceId>();
  const isDead = (f: Fighter): boolean => !has(f, 'indestructible') && ((damage.get(f.id) ?? 0) >= f.toughness || touched.has(f.id) || f.toughness <= 0);
  const hit = (source: Fighter, target: Fighter, n: number): void => {
    if (n <= 0) return;
    damage.set(target.id, (damage.get(target.id) ?? 0) + n);
    if (has(source, 'deathtouch')) touched.add(target.id);
    gain(source, n);
  };
  const gain = (source: Fighter, n: number): void => {
    if (n > 0 && has(source, 'lifelink')) out.lifelink[side.get(source.id)!] += n;
  };
  const strikes = (f: Fighter, step: 1 | 2): boolean => (step === 1 ? has(f, 'first strike') || has(f, 'double strike') : !has(f, 'first strike') || has(f, 'double strike'));

  for (const step of [1, 2] as const) {
    const hits: (() => void)[] = [];
    for (const a of attackers) {
      if (dead.has(a.id)) continue;
      const blockers = blocks.get(a.id) ?? [];
      if (strikes(a, step) && a.power > 0) {
        if (blockers.length === 0) {
          hits.push(() => {
            out.toDefender += a.power;
            gain(a, a.power);
          });
        } else {
          const alive = blockers.filter((b) => !dead.has(b.id));
          let left = a.power;
          const plan: [Fighter, number][] = [];
          for (const [i, b] of alive.entries()) {
            const lethal = has(a, 'deathtouch') ? 1 : Math.max(0, b.toughness - (damage.get(b.id) ?? 0));
            const n = i === alive.length - 1 && !has(a, 'trample') ? left : Math.min(left, Math.max(lethal, 0));
            plan.push([b, n]);
            left -= n;
          }
          const trample = has(a, 'trample') && left > 0 ? left : 0;
          hits.push(() => {
            for (const [b, n] of plan) hit(a, b, n);
            if (trample > 0) {
              out.toDefender += trample;
              gain(a, trample);
            }
          });
        }
      }
      for (const b of blockers) if (!dead.has(b.id) && strikes(b, step) && b.power > 0) hits.push(() => hit(b, a, b.power));
    }
    for (const h of hits) h();
    for (const f of all.values()) if (!dead.has(f.id) && isDead(f)) dead.add(f.id);
  }
  out.dead = [...dead].sort();
  return out;
}

/** Whether `blocker` may block `attacker` alone (computer.md 5.5: flying needs flying or reach; menace is not blocked; one blocker each). */
export function canBlock(blocker: BotPermanent, attacker: BotPermanent): boolean {
  if (blocker.tapped || blocker.kind !== 'creature') return false;
  if (has(attacker, 'menace')) return false;
  if (has(attacker, 'flying') && !has(blocker, 'flying') && !has(blocker, 'reach')) return false;
  return true;
}

/** One attacker against one blocker: who dies. */
export function duel(attacker: Fighter, blocker: Fighter): { attackerDies: boolean; blockerDies: boolean } {
  const r = combatResult([attacker], new Map([[attacker.id, [blocker]]]));
  return { attackerDies: r.dead.includes(attacker.id), blockerDies: r.dead.includes(blocker.id) };
}

/**
 * The creatures that attack (computer.md 5.5): untapped, not summoning sick (unless haste), not defenders; Gentle
 * attacks when no untapped opposing creature can block it and kill it; Steady also when every blocker that kills it
 * also dies and costs at least as much mana.
 */
export function chooseAttackers(mine: readonly BotPermanent[], theirs: readonly BotPermanent[], sick: ReadonlySet<InstanceId>, profile: BotProfile): BotPermanent[] {
  const blockers = theirs.filter((c) => c.kind === 'creature' && !c.tapped);
  return mine
    .filter((c) => c.kind === 'creature' && !c.tapped && !c.displaced && !has(c, 'defender') && c.power > 0 && (!sick.has(c.id) || has(c, 'haste')))
    .filter((a) =>
      blockers.every((b) => {
        if (!canBlock(b, a)) return true;
        const d = duel(a, b);
        if (!d.attackerDies) return true;
        return profile.trades && d.blockerDies && b.mv >= a.mv;
      }),
    )
    .sort(byId);
}

/**
 * Blocks (computer.md 5.5): Gentle blocks when the blocker kills the attacker and survives; Steady also when both die
 * and the attacker costs at least as much; a chump block only when the unblocked damage would be lethal. One blocker
 * per attacker; no gang blocks.
 */
export function chooseBlocks(attackers: readonly BotPermanent[], mine: readonly BotPermanent[], life: number, profile: BotProfile): { blocker: InstanceId; attacker: InstanceId }[] {
  const free = mine.filter((c) => c.kind === 'creature' && !c.tapped && c.combat === undefined).sort((a, b) => a.mv - b.mv || a.power - b.power || byId(a, b));
  const used = new Set<InstanceId>();
  const pairs: { blocker: InstanceId; attacker: InstanceId }[] = [];
  const order = [...attackers].sort((a, b) => b.power - a.power || byId(a, b));
  for (const a of order) {
    const options = free.filter((b) => !used.has(b.id) && canBlock(b, a));
    const good = options.find((b) => {
      const d = duel(a, b);
      return d.attackerDies && !d.blockerDies;
    });
    const trade = profile.trades
      ? options.find((b) => {
          const d = duel(a, b);
          return d.attackerDies && d.blockerDies && a.mv >= b.mv;
        })
      : undefined;
    const pick = good ?? trade;
    if (pick) {
      used.add(pick.id);
      pairs.push({ blocker: pick.id, attacker: a.id });
    }
  }
  // Chump blocks only against lethal damage.
  const blocked = new Set(pairs.map((p) => p.attacker));
  let unblocked = order.filter((a) => !blocked.has(a.id)).reduce((n, a) => n + a.power, 0);
  for (const a of order) {
    if (unblocked < life) break;
    if (blocked.has(a.id)) continue;
    const b = free.find((x) => !used.has(x.id) && canBlock(x, a));
    if (!b) continue;
    used.add(b.id);
    blocked.add(a.id);
    pairs.push({ blocker: b.id, attacker: a.id });
    unblocked -= a.power;
  }
  return pairs;
}
