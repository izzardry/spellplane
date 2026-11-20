/**
 * The card-feel channel between the table scene and the HUD (PLAN Milestone 7, Owner decisions after the first design
 * round, Almost haptic card handling; M7-P4). The scene cannot import the HUD (module direction ui → scene), so the few
 * things the HUD shows of a drag go through here, by value and only on change, never once per frame:
 *
 * - `cue`: a sound cue of the viewer's own gesture (pickup, snap, drop), which no log line rings; ui/sound.ts plays it.
 * - `look`: the table's theme id, so the sound player picks the look's synthesised cues.
 * - `handRoom`: a card dragged over the hand fan (its screen x), so the fan makes room; null when it leaves.
 *
 * Plain strings and numbers: util imports nothing from scene, themes or ui.
 */

type Listener<T> = (value: T) => void;

class Channel<T> {
  private listeners = new Set<Listener<T>>();
  constructor(public value: T) {}
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of [...this.listeners]) {
      try {
        l(next);
      } catch {
        // A listener that fails never reaches the scene.
      }
    }
  }
  subscribe(l: Listener<T>): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** Sound cues of the viewer's own gestures, in order (each emit is one cue; no state is kept). */
class CueChannel {
  private listeners = new Set<Listener<string>>();
  emit(cue: string): void {
    for (const l of [...this.listeners]) {
      try {
        l(cue);
      } catch {
        // A cue that fails stays silent.
      }
    }
  }
  subscribe(l: Listener<string>): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** A card dragged over the hand fan: the pointer's x in CSS px (viewport), or null. */
export const handRoom = new Channel<number | null>(null);
/** The table scene's theme id (a look's theme id is the look's id), or null before a scene exists. */
export const tableTheme = new Channel<string | null>(null);
/** Sound cues of the viewer's own gestures. */
export const feelCues = new CueChannel();
