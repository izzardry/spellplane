/**
 * Leak test of the computer opponent (contracts.md Part A; computer.md 12.1). Owner: M8-P6 replaces the todos.
 */
import { describe, it } from 'vitest';

describe('computer opponent leaks (M8-P6)', () => {
  it.todo('the bot session and the human session see nothing hidden of each other');
  it.todo("BotView never holds the human's hidden cards or the bot's library order");
});
