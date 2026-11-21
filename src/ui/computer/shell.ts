/**
 * What the computer route adds to the table frame (contracts.md Part C `extraShell`; Part G "Computer opponent"), as
 * plain functions ComputerRoute.svelte renders into the frame's slots: the combat cue for the primary button
 * (`primaryOverride`, with `Main 2` once Sparring counted the human's combat), Sparring's plate menu items (Pause /
 * Resume Sparring, Sparring concedes), whether the one coach mark on the cue is due (once per profile), and the pause
 * while the page is hidden.
 */
import { damageCounted } from '../../bot/cues';
import { CUE_LABELS } from '../../bot/types';
import type { ComputerHandle, TableSession } from '../../session/types';
import type { ComputerGameRecord } from '../../store/types';

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

/** The label of the step after a counted combat (computer.md 5.3). */
export const MAIN2_LABEL = 'Main 2';

/**
 * The primary-button override for the current cue (computer.md 5.3): dispatches the cue as an ordinary logged `ask`;
 * once Sparring counted the human's combat, `Main 2` settles the human's displaced cards and goes to main 2.
 */
export function cueButton(session: TableSession, handle: Pick<ComputerHandle, 'combat' | 'seat'>): CueButton | null {
  const cue = handle.combat();
  const me = session.seat;
  if (!cue && me && damageCounted(session.getState(), session.log(), me, handle.seat)) {
    return {
      label: MAIN2_LABEL,
      run() {
        const st = session.getState();
        const mine = Object.values(st.cards)
          .filter((c) => c.controller === me && c.home !== undefined)
          .map((c) => c.id)
          .sort();
        const group = `${me}.main2${st.seq}.${++rounds}`;
        if (mine.length > 0) session.dispatch({ type: 'settle', cards: mine, group });
        if (st.turn.active === me && st.turn.phase !== 'main2') session.dispatch({ type: 'phaseSet', phase: 'main2', group });
      },
    };
  }
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

/** Whether the coach mark shows: the Attack cue is offered and the profile has not seen the mark (once per profile). */
export function coachDue(cue: CueButton | null, seen: readonly string[]): boolean {
  return cue !== null && cue.label === CUE_LABELS.attack && !seen.includes('coachSparring');
}

/**
 * Pause Sparring while the page is hidden, also when it is hidden already at the start; resume 500 ms after it is
 * visible again (computer.md section 6), unless Sparring stopped meanwhile (`failed`: three throws). Returns the stop
 * function.
 */
export function pauseWhileHidden(handle: Pick<ComputerHandle, 'pause' | 'resume' | 'status'>, doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>): () => void {
  let byUs = false;
  let t: ReturnType<typeof setTimeout> | null = null;
  const on = (): void => {
    if (t) clearTimeout(t);
    t = null;
    if (doc.hidden) {
      const phase = handle.status().phase;
      if (phase !== 'paused' && phase !== 'failed') {
        handle.pause();
        byUs = true;
      }
    } else if (byUs) {
      t = setTimeout(() => {
        t = null;
        byUs = false;
        if (handle.status().phase === 'paused') handle.resume();
      }, 500);
    }
  };
  doc.addEventListener('visibilitychange', on);
  if (doc.hidden) on();
  return () => {
    doc.removeEventListener('visibilitychange', on);
    if (t) clearTimeout(t);
  };
}

/**
 * Rematch (computer.md 2.4): the finished game's record, kept in this page's memory for the new room the game-over
 * overlay opens, so the new game plays the same decks. Never stored: the record holds Sparring's private JWK.
 */
const rematches = new Map<string, ComputerGameRecord>();

/** Keep `record` for the new room `roomId` (one per room; the next open takes it). */
export function keepRematch(roomId: string, record: ComputerGameRecord): void {
  rematches.set(roomId, record);
}

/** The record kept for a rematch in `roomId` (and forget it), or null. */
export function takeRematch(roomId: string): ComputerGameRecord | null {
  const r = rematches.get(roomId) ?? null;
  rematches.delete(roomId);
  return r;
}

