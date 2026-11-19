/**
 * The input part of the debug hook (debug/types.ts InputDebug; PLAN Milestone 7, gate M7-G: games "played by mouse only
 * and one by touch only … with no key pressed (asserted)"). Counts every keydown and pointerdown the page receives, in
 * the capture phase on the window, before any handler can stop it. Dev and test builds only. Added by M7-C.
 */
import { registerDebug } from '../util/debug';

let installed = false;

/** Install the counters once and register `input` on the debug hook. */
export function registerInputDebug(target: Window = window): void {
  if (installed) return;
  installed = true;
  let keys = 0;
  let pointers = { mouse: 0, touch: 0, pen: 0 };
  target.addEventListener('keydown', () => keys++, { capture: true });
  target.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const kind = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
      pointers = { ...pointers, [kind]: pointers[kind] + 1 };
    },
    { capture: true },
  );
  registerDebug({
    input: {
      keydowns: () => keys,
      pointerdowns: () => ({ ...pointers }),
      reset: () => {
        keys = 0;
        pointers = { mouse: 0, touch: 0, pen: 0 };
      },
    },
  });
}
