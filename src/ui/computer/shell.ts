/**
 * What the computer route adds to the table frame (contracts.md Part C `extraShell`; Part G "Computer opponent"),
 * without the frame: the combat cue for the HUD's primary button (`primaryOverride`), Sparring's plate badge and plate
 * menu items (Pause / Resume Sparring, Sparring concedes), the one coach mark on the cue (once per profile), and the
 * pause while the page is hidden. ComputerRoute.svelte renders these into the frame's slots once the frame lands on
 * `m8` (M8-C's UI commit); until then this module is the tested part of the route.
 */
import { CUE_LABELS } from '../../bot/types';
import type { ComputerHandle, TableSession } from '../../session/types';

/** The cue button: what the primary button shows instead of its own turn step (null: the HUD's own step). */
export interface CueButton {
  label: string;
  run(): void;
  quiet?: boolean;
}

/** The coach mark on the cue button (contracts.md Part G "Computer opponent" item 2). */
export const CUE_COACH_TEXT = 'Press ATTACK so Sparring can block and count the damage.';
/** The plate badge of Sparring's seat (computer.md D2). */
export const COMPUTER_BADGE = 'COMPUTER';

let rounds = 0;

/** The primary-button override for the current cue (computer.md 5.3): dispatches the cue as an ordinary logged `ask`. */
export function cueButton(session: TableSession, handle: Pick<ComputerHandle, 'combat'>): CueButton | null {
  const cue = handle.combat();
  if (!cue) return null;
  return {
    label: cue.label,
    run() {
      if (handle.combat()?.kind !== cue.kind) return;
      session.dispatch({ type: 'ask', round: `${session.seat}.cue${session.getState().seq}.${++rounds}`, label: CUE_LABELS[cue.kind] });
    },
  };
}

/** One item of Sparring's plate menu (the frame's MenuItem shape). */
export interface PlateItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}

/** Sparring's plate menu (computer.md 2.3; tonight Pause / Resume and Sparring concedes). */
export function plateItems(session: TableSession, handle: ComputerHandle): PlateItem[] {
  const over = session.getState().result !== undefined;
  const paused = handle.status().phase === 'paused' || handle.status().phase === 'failed';
  return [
    paused ? { id: 'resumeSparring', label: 'Resume Sparring', disabled: over, run: () => handle.resume() } : { id: 'pauseSparring', label: 'Pause Sparring', disabled: over, run: () => handle.pause() },
    { id: 'sparringConcedes', label: 'Sparring concedes', danger: true, disabled: over, run: () => handle.concede() },
  ];
}

/** Whether the coach mark shows: a cue is offered and the profile has not seen it (once per profile). */
export function coachDue(cue: CueButton | null, seen: readonly string[]): boolean {
  return cue !== null && !seen.includes('coachSparring');
}

/** Pause Sparring while the page is hidden; resume 500 ms after it is visible again (computer.md section 6). Returns the stop function. */
export function pauseWhileHidden(handle: Pick<ComputerHandle, 'pause' | 'resume' | 'status'>, doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>): () => void {
  let byUs = false;
  let t: ReturnType<typeof setTimeout> | null = null;
  const on = (): void => {
    if (t) clearTimeout(t);
    t = null;
    if (doc.hidden) {
      if (handle.status().phase !== 'paused') {
        handle.pause();
        byUs = true;
      }
    } else if (byUs) {
      t = setTimeout(() => {
        t = null;
        byUs = false;
        handle.resume();
      }, 500);
    }
  };
  doc.addEventListener('visibilitychange', on);
  return () => {
    doc.removeEventListener('visibilitychange', on);
    if (t) clearTimeout(t);
  };
}
