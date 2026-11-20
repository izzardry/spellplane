/** Helpers for the bot's unit tests: fixture cards by name and hand-made views. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCard } from '../../../src/bot/cards';
import type { BotCard, BotPermanent, BotView } from '../../../src/bot/types';
import type { CardData } from '../../../src/data/types';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
export const M19 = JSON.parse(readFileSync(join(FIXTURES, 'scryfall', 'm19.json'), 'utf8')) as CardData[];
export const POOL = JSON.parse(readFileSync(join(FIXTURES, 'scryfall', 'starter-pool.m19.json'), 'utf8')) as CardData[];

export function card(name: string): CardData {
  const c = M19.find((x) => x.name === name);
  if (!c) throw new Error(`no fixture card ${name}`);
  return c;
}

/** A synthetic creature. */
export function creature(id: string, power: number, toughness: number, mv: number, keywords: BotCard['keywords'] = [], extra: Partial<BotPermanent> = {}): BotPermanent {
  return { id, name: id, kind: 'creature', cost: { generic: Math.max(0, mv - 1), colours: mv > 0 ? { R: 1 } : {} }, mv, colours: ['R'], produces: [], power, toughness, keywords, tapped: false, pose: { x: 0, y: 0, rot: 180 }, displaced: false, owned: true, ...extra };
}

export function permanentOf(id: string, name: string, extra: Partial<BotPermanent> = {}): BotPermanent {
  return { ...readCard(id, card(name)), tapped: false, pose: { x: 0, y: 300, rot: 180 }, displaced: false, owned: true, ...extra };
}

export function handCard(id: string, name: string): BotCard {
  return readCard(id, card(name));
}

/** A view of Sparring's own main phase (turn 3) with nothing on the table. */
export function view(over: Partial<BotView> = {}): BotView {
  return {
    me: 's1',
    opp: 's0',
    turn: { number: 4, active: 's1', phase: 'main1', mine: true },
    life: { me: 20, opp: 20 },
    hand: [],
    library: 30,
    oppHand: 6,
    oppLibrary: 30,
    mine: [],
    theirs: [],
    stack: [],
    round: null,
    blocks: [],
    thisTurn: { fresh: false, drew: true, landPlayed: false, arrived: [], steps: 3, attacked: false, combatDone: false },
    opening: { pending: false, mulligans: 0, bottomed: 0 },
    over: false,
    cue: null,
    ...over,
  };
}
