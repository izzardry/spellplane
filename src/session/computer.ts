/**
 * A game against Sparring, the computer opponent (computer.md sections 3 and 10). Stub by M8-C: both factories reject
 * naming the package, so `SOLO` offers `ALONE` only. M8-P6 owns the file.
 */
import type { ComputerGame } from './types';

/** What a new computer game needs (computer.md section 3). M8-P6 may add optional members. */
export interface ComputerGameOptions {
  roomId: string;
  /** The human's deck record id, or null for a starter deck. */
  deckId: string | null;
}

/** Whether this build has a computer opponent (false for M8-C's stub). */
export const COMPUTER_AVAILABLE: boolean = false;

/** Create a computer game (computer.md section 3). Stub: rejects. */
export function createComputerGame(_opts: ComputerGameOptions): Promise<ComputerGame> {
  return Promise.reject(new Error('not implemented: M8-P6'));
}

/** Resume a saved computer game (computer.md 10.3). Stub: rejects. */
export function resumeComputerGame(_roomId: string): Promise<ComputerGame> {
  return Promise.reject(new Error('not implemented: M8-P6'));
}
