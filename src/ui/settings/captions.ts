/**
 * Caption helpers for the HUD (M3-P4): captions as the scene draws them (DESIGN "Chat and voice", Placement: a speech
 * bubble in the speaker's seat colour; voice/types.ts Caption → scene/types.ts SceneCaption), the note field as a
 * dictation target, and the speech settings' engine statement.
 */
import type { TableState } from '../../core/types';
import type { SceneCaption } from '../../scene/types';
import type { Caption, DictationTarget, SpeechEngineInfo } from '../../voice/types';

/** The scene's captions for the controller's: the speaker's seat (null for a spectator) and its seat colour. */
export function sceneCaptions(list: readonly Caption[], st: TableState): SceneCaption[] {
  return list.map((c) => {
    const seat = Object.hasOwn(st.seats, c.speaker) ? c.speaker : null;
    return { id: c.id, text: c.text, final: c.final, anchor: c.anchor, seat, colour: seat ? (st.seats[seat]?.colour ?? null) : null, opacity: 1 };
  });
}

/**
 * A text field as a dictation target (DESIGN "Chat and voice", Notes by voice): interim words show after the text the
 * field had, the final text replaces them. Whatever the player types meanwhile is kept: when the field no longer holds
 * what dictation last wrote, its current text (without the interim words still in it) becomes the text the words
 * follow. `read` returns null once the field is gone; at most `max` characters are written.
 */
export function fieldDictation(read: () => string | null, write: (text: string) => void, max: number): Extract<DictationTarget, { kind: 'field' }> {
  /** The field's own text before the words being dictated, while an utterance is in progress. */
  let base: string | null = null;
  /** What dictation last wrote into the field, and the interim words in it. */
  let written: string | null = null;
  let interim = '';
  return {
    kind: 'field',
    insert(text, final) {
      const now = read();
      if (now === null) return;
      if (base === null || now !== written) base = interim && written !== null ? withoutLast(now, interim) : now;
      const b = base.trim();
      const next = (b ? (text ? `${b} ${text}` : b) : text).slice(0, max);
      write(next);
      if (final) {
        base = null;
        written = null;
        interim = '';
      } else {
        written = next;
        interim = text;
      }
    },
  };
}

/** `text` without the last occurrence of `part` (and the space before it). */
function withoutLast(text: string, part: string): string {
  const at = text.lastIndexOf(part);
  if (at < 0) return text;
  return `${text.slice(0, at).replace(/ $/, '')}${text.slice(at + part.length)}`;
}

/**
 * The settings' statement of the active engine and where audio goes (DESIGN "Chat and voice", Engine). An engine that
 * does not run in this browser (Web Speech in Firefox) is not stated as active: dictation is unavailable until an engine
 * that runs here is chosen.
 */
export function engineStatement(active: SpeechEngineInfo, engines: readonly { info: SpeechEngineInfo; available: boolean }[]): { available: boolean; text: string } {
  const listed = engines.find((e) => e.info.id === active.id);
  if (!listed || listed.available) return { available: true, text: `Active engine: ${active.label}. ${active.statement}` };
  const other = engines.find((e) => e.available && e.info.id !== active.id);
  return {
    available: false,
    text: `Dictation is unavailable: ${active.label} does not run in this browser, and no audio is captured.${other ? ` Choose ${other.info.label} below to dictate.` : ''}`,
  };
}
