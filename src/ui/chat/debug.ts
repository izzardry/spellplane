/**
 * The chat part of the debug hook, `window.__spellplane.chat` (dev and test builds; PLAN M1-P6: the attribution flash
 * is observable through the debug hook). Typed into util/debug.ts DebugParts by declaration merging, like
 * debug/session.ts, so no contract file changes.
 */
import type { Flash } from './watch';

export interface ChatDebug {
  /** Every attribution flash since the HUD mounted (up to the last 200), oldest first. */
  flashes(): Flash[];
  /** Flashes still showing; `shown` is whether the card is on the table and drawn with a ring. */
  activeFlashes(): (Flash & { shown: boolean })[];
}

declare module '../../util/debug' {
  interface DebugParts {
    chat: ChatDebug;
  }
}
