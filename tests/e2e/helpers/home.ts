/**
 * Helpers for the Home and History harness pages (`?harness=home`, `?harness=history`): open a profile, seed decks and
 * games, set the fake matchmaker's status. M8-P2.
 */
import { expect, type Page } from '@playwright/test';
import type { DeckRecord, GameSummary } from '../../../src/store/types';

export async function openHomeHarness(page: Page, opts: { profile: string; harness?: 'home' | 'history'; hash?: string; query?: Record<string, string> }): Promise<void> {
  const q = new URLSearchParams({ harness: opts.harness ?? 'home', profile: opts.profile, faces: 'placeholder', ...opts.query });
  await page.goto(`./?${q.toString()}${opts.hash ? `#${opts.hash}` : ''}`);
  await expect.poll(() => page.evaluate(() => window.__homeHarness?.ready === true)).toBe(true);
}

export async function seedDecks(page: Page, decks: DeckRecord[]): Promise<void> {
  await page.evaluate((d) => window.__homeHarness!.seedDecks(d), decks);
}

export async function seedGames(page: Page, games: GameSummary[]): Promise<void> {
  await page.evaluate((g) => window.__homeHarness!.seedGames(g), games);
}

/** A custom deck of `cards` cards with a summary (the hero reads only the summary). */
export function fixtureDeck(id: string, name: string, cards: number, extra: Partial<DeckRecord> = {}): DeckRecord {
  const main = Array.from({ length: cards }, (_, i) => ({ sid: `${id}-${i % 15}` }));
  return {
    id,
    name,
    main,
    side: [],
    source: 'built',
    kind: 'custom',
    size: 60,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    summary: {
      v: 1,
      at: 1_700_000_000_000,
      cards,
      lands: Math.round(cards * 0.4),
      colours: ['R', 'G'],
      curve: [0, 6, 10, 8, 5, 3, 1, 1],
      avgMv: 2.9,
      unknown: 0,
      strength: { v: 1, score: 54, band: 'solid', parts: { quality: 0.5, curve: 0.6, interaction: 0.4, consistency: 0.6, mana: 0.7 }, basis: 'rarity', complete: true },
      simple: true,
      maxCopies: 4,
      cover: main[0] ?? null,
      fan: main.slice(0, 5),
    },
    ...extra,
  };
}

/** A History row: an unfinished 1v1 against Ben at turn 3, Ben to act. */
export function fixtureGame(code: string, at: number, extra: Partial<GameSummary> = {}): GameSummary {
  return {
    code,
    key: 'a2V5LWtleS1rZXkta2V5AA',
    kind: 'private',
    format: '1v1',
    decks: 'constructed',
    seat: 's0',
    deck: { id: 'gruul', name: 'Gruul Stompy' },
    players: [
      { seat: 's0', name: 'Ann', colour: 0, life: 20, away: false, me: true },
      { seat: 's1', name: 'Ben', colour: 1, life: 17, away: false, me: false },
    ],
    stage: 'match',
    game: 0,
    turn: 3,
    active: 's1',
    seq: 40,
    hash: 'h',
    knownHead: null,
    handLost: false,
    recoveries: 0,
    takeovers: 0,
    createdAt: at,
    lastPlayedAt: at,
    savedAt: at,
    bytes: 0,
    actions: 12,
    thumb: { w: 400, h: 300, cards: [[100, 200, 0, 0], [220, 80, 1, 1]] },
    ...extra,
  };
}
