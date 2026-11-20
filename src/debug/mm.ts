/**
 * The debug hook's `mm` part (matchmaking.md 2.13; PLAN M8-P7 e2e: specs seek through `__spellplane.mm.seek(...)` and
 * drive the matchmaker's timers with `mm.tick(ms)`). Stub by M8-C: forwards to the matchmaker; `tick` does nothing.
 * M8-P7 owns the file.
 */
import type { Matchmaker } from '../session/types';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.mm` for the page's matchmaker. */
export function registerMmDebug(matchmaker: Matchmaker): void {
  registerDebug({
    mm: {
      status: () => matchmaker.status(),
      seek: (config) => matchmaker.seek(config),
      cancel: () => matchmaker.cancel(),
      answer: (accept) => matchmaker.answer(accept),
      tick: () => undefined,
    },
  });
}
