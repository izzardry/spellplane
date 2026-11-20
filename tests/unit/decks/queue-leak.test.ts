/**
 * Leak test (contracts.md Part A; decks.md section 7 "What may leave the browser"): `queueDeckInfo` holds six facts and
 * no card id, name or colour. Owner: M8-P3 replaces the todo.
 */
import { describe, it } from 'vitest';

describe('queue deck info leak (M8-P3)', () => {
  it.todo('queueDeckInfo holds six facts and no card id, name or colour');
});
