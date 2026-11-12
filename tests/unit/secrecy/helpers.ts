/**
 * Shared setup for the secrecy unit tests (PLAN M1-P2): a seeded entropy source, and a table whose seats committed
 * real decks through core/secrets.ts, so every reveal can be checked against a genuine commitment.
 */
import { expect } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { base64url } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { commitDeck, emptySecretStore, type Entropy } from '../../../src/core/secrets';
import type { CardRef, SecretStore, SeatId, TableState } from '../../../src/core/types';
import { mulberry32 } from '../../../src/util/prng';
import { TEST_GAME } from '../core/helpers';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

/** A deterministic stand-in for session/secrecy.ts's randomId/randomSalt (tests only; never for real secrets). */
export function seededEntropy(seed: number, prefix = 'c'): Entropy {
  const rand = mulberry32(seed);
  const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
  return {
    id: () => prefix + Array.from(bytes(16), (b) => ID_ALPHABET[b & 31]).join(''),
    salt: () => base64url(bytes(16)),
  };
}

/** `n` distinct card refs for seat `seat` (distinct Scryfall ids, so a leaked id names exactly one card). */
export function deckRefs(seat: SeatId, n: number): CardRef[] {
  return Array.from({ length: n }, (_, i) => ({ sid: `sid-${seat}-${String(i).padStart(2, '0')}` }));
}

let cidCounter = 0;

/** A shared table plus each seat's own secret store, advanced by stamped actions through the reducer. */
export class SecretTable {
  state: TableState;
  readonly secrets: Record<SeatId, SecretStore> = {};
  readonly entropy: Record<SeatId, Entropy> = {};
  readonly log: Action[] = [];
  readonly start: TableState;

  constructor(names: readonly string[]) {
    this.state = createTable({ game: TEST_GAME, format: names.length === 2 ? '1v1' : names.length === 3 ? 'ffa3' : 'ffa4', seats: names.map((name, i) => ({ name, colour: i })) });
    this.start = this.state;
    names.forEach((_, i) => {
      const seat = `s${i}`;
      this.secrets[seat] = emptySecretStore(seat);
      this.entropy[seat] = seededEntropy(1000 + i, String.fromCharCode(97 + i));
    });
  }

  /** Stamp a draft as `by` with the next seq. */
  stamp(by: SeatId, draft: ActionDraft): Action {
    return { ...draft, by, cid: `c${++cidCounter}`, seq: this.state.seq + 1 } as Action;
  }

  /** Why the draft would be refused, or null. */
  why(by: SeatId, draft: ActionDraft): string | null {
    return explain(this.state, this.stamp(by, draft));
  }

  /** Apply a draft that must apply. */
  apply(by: SeatId, draft: ActionDraft): TableState {
    const a = this.stamp(by, draft);
    const why = explain(this.state, a);
    expect(why, `${a.type} by ${by} should apply`).toBeNull();
    this.state = reduce(this.state, a);
    this.log.push(a);
    return this.state;
  }

  /** Apply a draft that must be refused; the state stays the same object. Returns the reason. */
  refuse(by: SeatId, draft: ActionDraft, reason?: RegExp): string {
    const a = this.stamp(by, draft);
    const next = reduce(this.state, a);
    expect(next, `${a.type} by ${by} should be refused`).toBe(this.state);
    const why = explain(this.state, a) ?? '';
    expect(why).not.toBe('');
    if (reason) expect(why).toMatch(reason);
    return why;
  }

  /** Commit a deck for `seat` (Ready) and keep the owner's secrets. */
  ready(seat: SeatId, cards: readonly CardRef[] = deckRefs(seat, 20)): void {
    const r = commitDeck(this.secrets[seat]!, cards, this.entropy[seat]!);
    this.apply(seat, r.action);
    this.secrets[seat] = r.secrets;
  }
}

/** A table of `names.length` seats, every seat ready with `n` distinct cards. */
export function readySecretTable(names: readonly string[] = ['Anna', 'Ben'], n = 20): SecretTable {
  const t = new SecretTable(names);
  for (let i = 0; i < names.length; i++) t.ready(`s${i}`, deckRefs(`s${i}`, n));
  return t;
}
