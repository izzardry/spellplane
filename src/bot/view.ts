/**
 * The bot's view (computer.md 4.1 and 4.2): the only code that reads state and secrets. It reads the public table, the
 * bot's own hand (identities from its own secret store) and cached card data; never another seat's secrets, never its
 * own library order or the identities of its library (only the count), never identities revealed to it alone.
 */
import type { Action } from '../core/actions';
import { roundPassed } from '../core/reducer/confirm';
import type { CardInstance, CardRef, LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import type { CardData } from '../data/types';
import { adjustedStats, readCard, unknownCard } from './cards';
import { actionsOf, combatCue, cueOf, turnWindow } from './cues';
import type { BotCard, BotPermanent, BotRound, BotView } from './types';

export interface ViewInput {
  state: TableState;
  secrets: SecretStore;
  cardData: (ref: CardRef) => CardData | null;
  log: readonly LogEntry[];
  me: SeatId;
}

/** The other occupied seat of a 1v1 table (the first one in seat order that is not `me`). */
export function opponentOf(state: TableState, me: SeatId): SeatId {
  const others = Object.values(state.seats)
    .filter((s) => s.id !== me)
    .sort((a, b) => a.index - b.index);
  return (others.find((s) => s.name !== '') ?? others[0])?.id ?? me;
}

function count(state: TableState, zone: string): number {
  const z = state.zones[zone];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : z.count;
}

function permanent(c: CardInstance, base: BotCard, me: SeatId): BotPermanent {
  const s = adjustedStats(base, c.counters, c.note);
  const p: BotPermanent = { ...base, ...s, tapped: c.tapped, pose: { ...c.pose }, displaced: c.home !== undefined, owned: c.owner === me };
  if (c.combat !== undefined) p.combat = c.combat;
  return p;
}

/** Build the view (computer.md 4.1). */
export function buildView({ state, secrets, cardData, log, me }: ViewInput): BotView {
  const opp = opponentOf(state, me);
  const dataOf = (ref: CardRef | undefined): CardData | null => (ref ? cardData(ref) : null);

  const battlefield = (seat: SeatId): BotPermanent[] => {
    const z = state.zones[`battlefield:${seat}`];
    if (!z) return [];
    const out: BotPermanent[] = [];
    for (const id of z.ids) {
      const c = state.cards[id];
      if (!c || c.object !== undefined) continue;
      let base: BotCard;
      if (c.identity) base = readCard(id, dataOf(c.identity), c.faceIndex);
      else if (c.owner === me && Object.hasOwn(secrets.identities, id)) base = readCard(id, dataOf(secrets.identities[id]!.card), c.faceIndex);
      else if (c.isToken === true) base = readCard(id, null);
      else base = { ...unknownCard(id) };
      const p = permanent(c, base, me);
      if (c.identity === undefined && c.owner !== me) p.unknown = true;
      out.push(p);
    }
    return out;
  };

  // Own hand: ids from the own secret store, identities only of cards that are in the own hand zone.
  const handZone = state.zones[`hand:${me}`];
  const inHand = new Set(handZone ? handZone.ids : []);
  const hand: BotCard[] = [];
  for (const id of secrets.hand) {
    if (!inHand.has(id)) continue;
    const sec = secrets.identities[id];
    hand.push(readCard(id, sec ? dataOf(sec.card) : null));
  }

  const actions = actionsOf(log);
  const window = turnWindow(actions);
  const own = (a: Action): boolean => a.by === me;
  const mineNow = battlefield(me);
  const onMine = new Set(mineNow.map((p) => p.id));
  const isLand = (id: string): boolean => mineNow.some((p) => p.id === id && p.kind === 'land');
  const arrived = new Set<string>();
  let landPlayed = false;
  let drew = false;
  let attacked = false;
  let steps = 0;
  let phased = false;
  const cueRounds = new Map<string, string | undefined>();
  let combatDone = false;
  for (const a of window) {
    if (a.type === 'ask' && a.by !== me) cueRounds.set(a.round, a.label);
    if (!own(a)) continue;
    steps++;
    if (a.type === 'phaseSet') phased = true;
    if (a.type === 'draw') drew = true;
    if (a.type === 'moveTemp' && a.combat === 'attack') attacked = true;
    if (a.type === 'move' && a.to === `battlefield:${me}` && onMine.has(a.card)) {
      arrived.add(a.card);
      if (isLand(a.card)) landPlayed = true;
    }
    if (a.type === 'stackPush' && a.card !== undefined) arrived.add(a.card);
    if (a.type === 'respond' && cueOf(cueRounds.get(a.round)) === 'blocksDone') combatDone = true;
  }

  // Opening hand: the bot has not acted at the table yet in this game.
  let lastDealt = -1;
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!;
    if (a.by === me && a.type === 'dealt') {
      lastDealt = i;
      break;
    }
  }
  const sinceDeal = lastDealt >= 0 ? actions.slice(lastDealt + 1).filter(own) : [];
  const playedSinceDeal = sinceDeal.some((a) => a.type === 'phaseSet' || a.type === 'move' || a.type === 'stackPush' || a.type === 'turnPass');
  let mulligans = 0;
  let bottomed = 0;
  for (const a of sinceDeal) {
    if (a.type === 'mulligan') {
      mulligans++;
      bottomed = 0;
    }
    if (a.type === 'toZone' && a.to === `library:${me}` && a.position === 'bottom') bottomed++;
  }

  const conf = state.confirm;
  let round: BotRound | null = null;
  if (conf) {
    round = {
      id: conf.id,
      askedBy: conf.askedBy,
      label: conf.label ?? '',
      cue: cueOf(conf.label),
      answered: conf.askedBy === me || conf.responses[me] !== undefined || conf.holder === me,
      passed: roundPassed(state),
    };
    if (conf.about !== undefined) round.about = conf.about;
    if (conf.holder !== undefined) round.holder = conf.holder;
  }

  const active = state.turn.active;
  return {
    me,
    opp,
    turn: { number: state.turn.number, active, phase: state.turn.phase, mine: active === me },
    life: { me: state.seats[me]?.life ?? 0, opp: state.seats[opp]?.life ?? 0 },
    hand,
    library: count(state, `library:${me}`),
    oppHand: count(state, `hand:${opp}`),
    oppLibrary: count(state, `library:${opp}`),
    mine: mineNow,
    theirs: battlefield(opp),
    stack: state.stack.map((s) => ({ id: s.id, controller: s.controller, mine: s.controller === me, ...(s.card !== undefined ? { card: s.card } : {}) })),
    round,
    blocks: Object.values(state.lines)
      .filter((l) => l.kind === 'block' && l.from.kind === 'card' && l.to.kind === 'card')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((l) => ({ blocker: l.from.id, attacker: l.to.id })),
    thisTurn: { fresh: !phased, drew, landPlayed, arrived: [...arrived].sort(), steps, attacked, combatDone },
    opening: { pending: lastDealt >= 0 && !playedSinceDeal && state.stage === 'match', mulligans, bottomed },
    over: state.result !== undefined,
    cue: combatCue(state, log, opp, me),
  };
}
