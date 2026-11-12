/**
 * The speech part of the debug hook (debug/types.ts SpeechDebug; CLAUDE.md `?speech=fake`; PLAN M3-P4 fake engine,
 * M3-G fake-engine captions): the engine in use, transcripts pushed through the fake engine, the captions the session
 * holds and the bubbles the scene draws. Registered by main.ts with the session. Dev and test builds only. M3-P4.
 */
import type { DebugCaption } from '../scene/types';
import type { TableSession } from '../session/types';
import { registerDebug } from '../util/debug';
import { FakeSpeechEngine } from '../voice/fake';
import { createdEngines } from '../voice/speech/index';
import type { Caption, SpeechEngineId } from '../voice/types';

/** Register the `speech` part for `session`. */
export function registerSpeechDebug(session: TableSession): void {
  registerDebug({
    speech: {
      // The engine in use (a created engine that failed to load is not); null before any was created.
      engine: (): SpeechEngineId | null => (session.captions && createdEngines().length > 0 ? session.captions.engine().id : null),
      say(text: string, final = true): boolean {
        const listening = createdEngines().filter((e): e is FakeSpeechEngine => e instanceof FakeSpeechEngine && e.listening);
        for (const e of listening) e.say(text, final);
        return listening.length > 0;
      },
      captions: (): Caption[] => session.captions?.captions() ?? [],
      // The scene registers its bubbles as `captions` (scene/table-scene.ts, SceneDebugParts.captions).
      drawn: (): DebugCaption[] => {
        const hook = window.__spellplane as { captions?: () => DebugCaption[] } | undefined;
        return hook?.captions?.() ?? [];
      },
    },
  });
}
