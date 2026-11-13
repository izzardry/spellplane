/**
 * Where dictated words end up when transcription is slow or the note field changes under a held talk key (DESIGN
 * "Chat and voice", Dictation and captions: Record — "the final transcript is stored on the action in the log"; Notes by
 * voice — "Holding the talk key while a card note or stack note field is focused dictates into that field").
 *
 * - A final the on-device model still owes (queued behind another phrase, or a long phrase) reaches the log in full,
 *   however long after the release it comes.
 * - Words spoken into a note field never become a public caption or interim: not when the field closes (Escape) under
 *   the held key, not when it blurs before the talk state changes, not when it is removed without a focusout.
 * - Presence shows the newest utterance's words; a note-field utterance does not hold a finished caption on presence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptions } from '../../../src/voice/captions';
import { LocalWhisperEngine, type AsrPipeline, type TransformersLike } from '../../../src/voice/speech/local';
import { TALK_CLOSED, type CaptionControls, type DictationTarget, type SpeechEngine, type SpeechListener, type TalkState } from '../../../src/voice/types';
import { P, play, readyTable } from '../core/helpers';
import { act, countingFactory, memorySettings, OPEN, ScriptCapture, TestTable } from './helpers';

const FIELD: TalkState = { audio: 'off', dictation: 'field', reason: 'key', muted: false };

function base() {
  let s = readyTable(10);
  s = play(s, 'a00', P(-100, -250));
  s = play(s, 'a01', P(100, -250));
  return s;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

/** A table whose engine is the on-device model on a scripted microphone, transcribing with `pipe`. */
function localTable(pipe: AsrPipeline): { t: TestTable; cap: ScriptCapture } {
  const cap = new ScriptCapture();
  const lib: TransformersLike = { pipeline: async () => pipe };
  const t = new TestTable(base(), 's0', memorySettings(), [countingFactory('local', () => new LocalWhisperEngine({ library: async () => lib, capture: () => cap, webgpu: false }))]);
  t.apply(act('tap', { card: 'a00', tapped: true }));
  return { t, cap };
}

let controls: CaptionControls | null = null;
async function start(t: TestTable): Promise<CaptionControls> {
  controls = createCaptions(t.host());
  await flush();
  return controls;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  controls?.dispose();
  controls = null;
  vi.useRealTimers();
});

describe('a slow on-device transcription still reaches the log', () => {
  it('two quick short phrases: the second final, queued behind the first, is not lost', async () => {
    const texts = ['attack with both', 'no blocks'];
    let i = 0;
    const { t, cap } = localTable(async () => {
      await new Promise((r) => setTimeout(r, 1800));
      return { text: texts[i++] ?? '?' };
    });
    await start(t);
    t.setTalk(OPEN);
    await flush();
    cap.feed(0.6);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(200);
    t.setTalk(OPEN);
    await flush();
    cap.feed(0.6);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['attack with both', 'no blocks']);
  });

  it('a long phrase with interim words: the log gets the final text, not a stale interim', async () => {
    const { t, cap } = localTable(async (audio) => {
      await new Promise((r) => setTimeout(r, 2000));
      return { text: audio.length > 16000 * 3 ? 'attack with both and pass the turn' : 'attack' };
    });
    await start(t);
    t.setTalk(OPEN);
    await flush();
    cap.feed(1.2);
    await vi.advanceTimersByTimeAsync(1000);
    cap.feed(2.5);
    await vi.advanceTimersByTimeAsync(1000);
    cap.feed(1.0);
    await vi.advanceTimersByTimeAsync(1000);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['attack with both and pass the turn']);
  });

  it('a transcription that never settles is given up after the safety cap, with the words the others saw', async () => {
    let interimDone = false;
    const { t, cap } = localTable(async () => {
      if (!interimDone) {
        interimDone = true;
        await new Promise((r) => setTimeout(r, 100));
        return { text: 'attack' };
      }
      return new Promise<never>(() => undefined);
    });
    await start(t);
    t.setTalk(OPEN);
    await flush();
    cap.feed(1.2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.interims.at(-1)?.text).toBe('attack');
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.captionsSent()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['attack']);
  });
});

describe('words spoken into a note field never become a caption', () => {
  function noteTable() {
    return localTable(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { text: 'their elf is a bluff' };
    });
  }

  it('the note field closes (Escape) while the talk key is still held', async () => {
    const { t, cap } = noteTable();
    const c = await start(t);
    let field = '';
    c.dictateInto({ kind: 'field', insert: (text) => (field = text) });
    t.setTalk(FIELD);
    await flush();
    cap.feed(0.6);
    // Escape: the HUD's note editor goes away and hands dictation back; the key is still held, so the talk rule now
    // says caption.
    c.dictateInto(null);
    t.setTalk(OPEN);
    cap.feed(1.0, 0);
    await vi.advanceTimersByTimeAsync(3000);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(5000);
    expect({ field, captions: t.captionsSent().map((a) => a.text), interims: t.interims.map((i) => i.text) }).toEqual({ field: 'their elf is a bluff', captions: [], interims: [] });
  });

  it('the field blurs before the talk state changes (dictation off: the key only dictated into the field)', async () => {
    const { t, cap } = noteTable();
    const c = await start(t);
    let field = '';
    c.dictateInto({ kind: 'field', insert: (text) => (field = text) });
    t.setTalk(FIELD);
    await flush();
    cap.feed(0.6);
    // The input's blur clears the target first; the window's focusout then closes the talk state.
    c.dictateInto(null);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(5000);
    expect({ field, captions: t.captionsSent().map((a) => a.text), interims: t.interims.map((i) => i.text) }).toEqual({ field: 'their elf is a bluff', captions: [], interims: [] });
  });

  it('the field is removed without a focusout: words after it, still under the field state, are dropped', async () => {
    const { t, cap } = noteTable();
    const c = await start(t);
    let field = '';
    c.dictateInto({ kind: 'field', insert: (text) => (field = text) });
    t.setTalk(FIELD);
    await flush();
    cap.feed(0.6);
    // Removed (Enter saved the note): the target is cleared, the talk state still says field.
    c.dictateInto(null);
    await flush();
    cap.feed(0.6);
    cap.feed(1.0, 0);
    await vi.advanceTimersByTimeAsync(3000);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(5000);
    expect({ field, captions: t.captionsSent().map((a) => a.text), interims: t.interims.map((i) => i.text) }).toEqual({ field: 'their elf is a bluff', captions: [], interims: [] });
  });

  it('a late final of a note-field press goes to that field even after the target changed', async () => {
    const listeners: SpeechListener[] = [];
    const late: SpeechEngine = { id: 'fake', available: async () => true, start: (_l, on) => void listeners.push(on), stop: () => undefined };
    const t = new TestTable(base(), 's0', memorySettings(), [countingFactory('fake', () => late)]);
    const c = await start(t);
    const got: string[] = [];
    c.dictateInto({ kind: 'field', insert: (text, final) => final && got.push(text) });
    t.setTalk(FIELD);
    await flush();
    t.setTalk(TALK_CLOSED);
    c.dictateInto(null);
    listeners[0]!('their elf is a bluff', true);
    expect(got).toEqual(['their elf is a bluff']);
    expect(t.captionsSent()).toHaveLength(0);
  });

  it('a field target set while the caption key is held splits the run: earlier words caption, later words go to the field', async () => {
    const listeners: SpeechListener[] = [];
    const late: SpeechEngine = { id: 'fake', available: async () => true, start: (_l, on) => void listeners.push(on), stop: () => undefined };
    const t = new TestTable(base(), 's0', memorySettings(), [countingFactory('fake', () => late)]);
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    listeners[0]!('attack', false);
    const got: string[] = [];
    const target: DictationTarget = { kind: 'field', insert: (text, final) => final && got.push(text) };
    c.dictateInto(target);
    t.setTalk(FIELD);
    await flush();
    expect(listeners).toHaveLength(2);
    listeners[1]!('flying', true);
    listeners[0]!('attack with both', true);
    expect(got).toEqual(['flying']);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['attack with both']);
  });
});

describe('presence follows the newest utterance', () => {
  it('a late interim of an older press does not replace the newer press’s words on presence', async () => {
    const listeners: SpeechListener[] = [];
    const late: SpeechEngine = { id: 'fake', available: async () => true, start: (_l, on) => void listeners.push(on), stop: () => undefined };
    const t = new TestTable(base(), 's0', memorySettings(), [countingFactory('fake', () => late)]);
    await start(t);
    t.setTalk(OPEN);
    await flush();
    listeners[0]!('attack', false);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(200);
    t.setTalk(OPEN);
    await flush();
    listeners[1]!('and then', false);
    listeners[0]!('attack with', false);
    expect(t.interims.at(-1)?.text).toBe('and then');
  });

  it('a note-field utterance does not keep a finished caption’s interim on presence', async () => {
    const listeners: SpeechListener[] = [];
    const late: SpeechEngine = { id: 'fake', available: async () => true, start: (_l, on) => void listeners.push(on), stop: () => undefined };
    const t = new TestTable(base(), 's0', memorySettings(), [countingFactory('fake', () => late)]);
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    listeners[0]!('hello', false);
    listeners[0]!('hello there', true);
    c.dictateInto({ kind: 'field', insert: () => undefined });
    t.setTalk(FIELD);
    await flush();
    listeners.at(-1)!('note words', false);
    await vi.advanceTimersByTimeAsync(2500);
    expect(t.interims.at(-1)).toEqual({ text: null, anchor: null });
  });
});
