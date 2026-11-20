/**
 * The rejoin controls of the table on screen, for the parts the frame mounts without them (the plate badge reads the
 * save state from here). Gathering sets it while it is mounted. Implementer: M8-P5.
 */
import type { SessionMuster } from '../../session/types';

let active: SessionMuster | null = null;
const listeners = new Set<() => void>();

/** Make `muster` the table's; returns the function that clears it again. */
export function setActiveMuster(muster: SessionMuster): () => void {
  active = muster;
  for (const l of [...listeners]) l();
  return () => {
    if (active !== muster) return;
    active = null;
    for (const l of [...listeners]) l();
  };
}

/** The rejoin controls of the table on screen, if any. */
export function activeMuster(): SessionMuster | null {
  return active;
}

/** Called whenever the table on screen changes. */
export function onActiveMuster(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
