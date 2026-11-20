/**
 * The debug hook's `bot` part (computer.md section 12; contracts.md Part C): registered by debug/index.ts. The part
 * itself lives in ui/computer/debug.ts, so the `?harness=computer` page (which cannot import debug/) registers the same
 * one. Dev and test builds only.
 */
import { botDebugPart, type BotDebugPart } from '../ui/computer/debug';
import { registerDebug } from '../util/debug';

export type { BotDebugPart };

declare module '../util/debug' {
  interface DebugParts {
    bot: BotDebugPart;
  }
}

/** Install the `bot` part (debug/index.ts calls it). */
export function registerBotDebug(): void {
  registerDebug({ bot: botDebugPart() });
}
