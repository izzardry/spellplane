/**
 * The speech engines (DESIGN "Chat and voice", Dictation and captions: Engine; "Specification: code interfaces",
 * SpeechEngine; PLAN M3-P4): the Web Speech engine over a scripted recogniser, and the on-device Whisper engine over a
 * fake transformers.js and fake microphone. Nothing here touches the network: the local engine's library is injected,
 * and the test asserts the real loader is not called before `load`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_SPEECH, LOCAL_MODEL_SOURCES, SPEECH_ENGINES, createdEngines } from '../../../src/voice/speech/index';
import { downsampler, LocalWhisperEngine, SEGMENT_MAX_S, TRANSFORMERS_URL, WebAudioCapture, WHISPER_MODEL, type AsrPipeline, type AudioCapture, type ProgressInfo, type TransformersLike } from '../../../src/voice/speech/local';
import { MAX_FAILURES, RETRY_MS, WebSpeechEngine, recognitionCtor, type RecognitionEventLike, type RecognitionLike } from '../../../src/voice/speech/webspeech';

// --- Web Speech ------------------------------------------------------------------------------------------------------

class ScriptedRecognition implements RecognitionLike {
  static all: ScriptedRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: RecognitionEventLike) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stopped = false;
  aborted = false;
  results: { isFinal: boolean; text: string }[] = [];
  constructor() {
    ScriptedRecognition.all.push(this);
  }
  start(): void {
    this.starts++;
    this.results = [];
  }
  stop(): void {
    this.stopped = true;
  }
  abort(): void {
    this.aborted = true;
  }
  /** The browser reports results from `from` on. */
  emit(from: number): void {
    const results = this.results.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: from, results: Object.assign(results, { length: results.length }) });
  }
}

describe('Web Speech engine', () => {
  beforeEach(() => {
    ScriptedRecognition.all = [];
  });

  it('is unavailable without SpeechRecognition (Firefox) and finds the WebKit-prefixed one', async () => {
    expect(recognitionCtor({})).toBeNull();
    expect(recognitionCtor({ webkitSpeechRecognition: ScriptedRecognition })).toBe(ScriptedRecognition);
    expect(await new WebSpeechEngine(null).available()).toBe(false);
    expect(await new WebSpeechEngine(ScriptedRecognition).available()).toBe(true);
    // Starting where there is no recogniser does nothing (and does not throw).
    new WebSpeechEngine(null).start('en-US', () => undefined);
  });

  it('listens continuously in the player’s language: interim text grows, each final result is one utterance', () => {
    const got: [string, boolean][] = [];
    const e = new WebSpeechEngine(ScriptedRecognition);
    e.start('de-DE', (t, f) => got.push([t, f]));
    const rec = ScriptedRecognition.all[0]!;
    expect(rec).toMatchObject({ lang: 'de-DE', continuous: true, interimResults: true, starts: 1 });
    rec.results = [{ isFinal: false, text: 'zwei' }];
    rec.emit(0);
    rec.results = [{ isFinal: false, text: 'zwei Schaden' }];
    rec.emit(0);
    rec.results = [{ isFinal: true, text: ' zwei Schaden an deinen Elfen ' }];
    rec.emit(0);
    // A repeated report of the same final result is not a second utterance.
    rec.emit(0);
    rec.results.push({ isFinal: false, text: 'und' });
    rec.emit(1);
    expect(got).toEqual([
      ['zwei', false],
      ['zwei Schaden', false],
      ['zwei Schaden an deinen Elfen', true],
      ['und', false],
    ]);
  });

  it('restarts after the browser ends a session on silence, until stopped; a final after stop still arrives', () => {
    const got: [string, boolean][] = [];
    const e = new WebSpeechEngine(ScriptedRecognition);
    e.start('en-US', (t, f) => got.push([t, f]));
    const rec = ScriptedRecognition.all[0]!;
    rec.onend?.();
    expect(rec.starts).toBe(2);
    e.stop();
    expect(rec.stopped).toBe(true);
    rec.results = [{ isFinal: true, text: 'pass' }];
    rec.emit(0);
    rec.onend?.();
    expect(rec.starts).toBe(2);
    expect(got).toEqual([['pass', true]]);
  });

  it('gives up after the microphone or service is refused', () => {
    const e = new WebSpeechEngine(ScriptedRecognition);
    e.start('en-US', () => undefined);
    const rec = ScriptedRecognition.all[0]!;
    rec.onerror?.({ error: 'not-allowed' });
    rec.onend?.();
    expect(rec.starts).toBe(1);
  });

  it('after a failing session (speech service unreachable) restarts with a growing wait, and gives up after a few in a row', () => {
    vi.useFakeTimers();
    try {
      const e = new WebSpeechEngine(ScriptedRecognition);
      e.start('en-US', () => undefined);
      const rec = ScriptedRecognition.all[0]!;
      // Silence is not a failure: the restart is immediate.
      rec.onerror?.({ error: 'no-speech' });
      rec.onend?.();
      expect(rec.starts).toBe(2);
      let waited = 0;
      for (let i = 1; i < MAX_FAILURES; i++) {
        rec.onerror?.({ error: 'network' });
        rec.onend?.();
        expect(rec.starts).toBe(1 + i);
        const wait = RETRY_MS * 2 ** (i - 1);
        vi.advanceTimersByTime(wait - 1);
        expect(rec.starts).toBe(1 + i);
        vi.advanceTimersByTime(1);
        expect(rec.starts).toBe(2 + i);
        waited += wait;
      }
      expect(waited).toBeGreaterThan(RETRY_MS * MAX_FAILURES);
      rec.onerror?.({ error: 'network' });
      rec.onend?.();
      vi.advanceTimersByTime(60_000);
      expect(rec.starts).toBe(1 + MAX_FAILURES);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a result resets the failure count, and stop cancels a pending restart', () => {
    vi.useFakeTimers();
    try {
      const e = new WebSpeechEngine(ScriptedRecognition);
      e.start('en-US', () => undefined);
      const rec = ScriptedRecognition.all[0]!;
      for (let i = 0; i < MAX_FAILURES - 1; i++) {
        rec.onerror?.({ error: 'aborted' });
        rec.onend?.();
        vi.advanceTimersByTime(60_000);
      }
      rec.results = [{ isFinal: false, text: 'hi' }];
      rec.emit(0);
      rec.onerror?.({ error: 'network' });
      rec.onend?.();
      vi.advanceTimersByTime(RETRY_MS);
      expect(rec.starts).toBe(1 + MAX_FAILURES);
      rec.onerror?.({ error: 'network' });
      rec.onend?.();
      e.stop();
      vi.advanceTimersByTime(60_000);
      expect(rec.starts).toBe(1 + MAX_FAILURES);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new start drops the previous session’s pending words', () => {
    const got: string[] = [];
    const e = new WebSpeechEngine(ScriptedRecognition);
    e.start('en-US', (t) => got.push(`a:${t}`));
    const first = ScriptedRecognition.all[0]!;
    e.start('en-US', (t) => got.push(`b:${t}`));
    expect(first.aborted).toBe(true);
    first.results = [{ isFinal: true, text: 'old' }];
    first.emit(0);
    expect(got).toEqual([]);
  });

  it('a start after a stop (the talk key pressed again) leaves the stopping session to deliver its final to its own listener', () => {
    const got: string[] = [];
    const e = new WebSpeechEngine(ScriptedRecognition);
    e.start('en-US', (t, f) => got.push(`a:${t}:${f}`));
    const first = ScriptedRecognition.all[0]!;
    e.stop();
    e.start('en-US', (t, f) => got.push(`b:${t}:${f}`));
    const second = ScriptedRecognition.all[1]!;
    expect(first.aborted).toBe(false);
    expect(second.starts).toBe(1);
    first.results = [{ isFinal: true, text: 'attack with both' }];
    first.emit(0);
    // The stopped session ends without restarting; the new one listens on.
    first.onend?.();
    expect(first.starts).toBe(1);
    second.results = [{ isFinal: true, text: 'pass' }];
    second.emit(0);
    expect(got).toEqual(['a:attack with both:true', 'b:pass:true']);
  });

  it('where a browser runs one recognition at a time, the stopping session gives way to the new one', () => {
    class OneAtATime extends ScriptedRecognition {
      static live: OneAtATime | null = null;
      override start(): void {
        if (OneAtATime.live && OneAtATime.live !== this && !OneAtATime.live.aborted) throw new Error('InvalidStateError');
        OneAtATime.live = this;
        super.start();
      }
    }
    const e = new WebSpeechEngine(OneAtATime);
    e.start('en-US', () => undefined);
    e.stop();
    e.start('en-US', () => undefined);
    const [first, second] = ScriptedRecognition.all;
    expect(first?.aborted).toBe(true);
    expect(second?.starts).toBe(1);
  });
});

// --- On-device model -------------------------------------------------------------------------------------------------

class FakeCapture implements AudioCapture {
  buf: number[] = [];
  begun = 0;
  closed = false;
  recording = false;
  async begin(): Promise<void> {
    this.begun++;
    this.buf = [];
    this.recording = true;
  }
  /** Record `seconds` of audio at `level` (0.1 is speech, 0 silence). */
  feed(seconds: number, level = 0.1): void {
    if (!this.recording) return;
    const n = Math.round(seconds * 16000);
    for (let i = 0; i < n; i++) this.buf.push(level);
  }
  samples(): Float32Array {
    return Float32Array.from(this.buf);
  }
  cut(): Float32Array {
    const out = Float32Array.from(this.buf);
    this.buf = [];
    return out;
  }
  end(): Float32Array {
    this.recording = false;
    return Float32Array.from(this.buf);
  }
  close(): void {
    this.closed = true;
  }
}

function fakeTransformers(say: (seconds: number) => string): { lib: TransformersLike; calls: { model: string; opts: unknown }[]; runs: { seconds: number; opts: unknown }[] } {
  const calls: { model: string; opts: unknown }[] = [];
  const runs: { seconds: number; opts: unknown }[] = [];
  const lib: TransformersLike = {
    pipeline: async (_task, model, opts) => {
      calls.push({ model, opts });
      const p = (f: string, loaded: number, total: number): ProgressInfo => ({ status: 'progress', file: f, loaded, total });
      opts.progress_callback?.({ status: 'initiate', file: 'encoder.onnx' });
      opts.progress_callback?.(p('encoder.onnx', 10, 40));
      opts.progress_callback?.(p('decoder.onnx', 5, 60));
      opts.progress_callback?.({ status: 'done', file: 'encoder.onnx' });
      opts.progress_callback?.({ status: 'done', file: 'decoder.onnx' });
      return async (audio, o) => {
        runs.push({ seconds: audio.length / 16000, opts: o });
        return { text: ` ${say(audio.length / 16000)} ` };
      };
    },
  };
  return { lib, calls, runs };
}

describe('on-device Whisper engine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches nothing until it is loaded, then reports the download progress across the model files', async () => {
    const library = vi.fn(async () => fakeTransformers(() => 'x').lib);
    const e = new LocalWhisperEngine({ library, capture: () => new FakeCapture(), webgpu: false });
    expect(e.loaded).toBe(false);
    expect(library).not.toHaveBeenCalled();
    const progress: [number, number][] = [];
    await e.load((l, t) => progress.push([l, t]));
    expect(library).toHaveBeenCalledTimes(1);
    expect(e.loaded).toBe(true);
    expect(progress.at(-1)).toEqual([100, 100]);
    expect(progress.some(([l, t]) => l < t)).toBe(true);
    // Loading again is free.
    await e.load();
    expect(library).toHaveBeenCalledTimes(1);
  });

  it('runs Whisper on WebGPU when offered, else 8-bit on WASM', async () => {
    for (const webgpu of [true, false]) {
      const f = fakeTransformers(() => 'x');
      const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => new FakeCapture(), webgpu });
      await e.load();
      expect(f.calls[0]?.model).toBe(WHISPER_MODEL);
      expect(f.calls[0]?.opts).toMatchObject(webgpu ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } } : { device: 'wasm', dtype: 'q8' });
    }
  });

  it('a failed download can be retried', async () => {
    let n = 0;
    const f = fakeTransformers(() => 'x');
    const e = new LocalWhisperEngine({ library: async () => (++n === 1 ? Promise.reject(new Error('offline')) : f.lib), capture: () => new FakeCapture() });
    await expect(e.load()).rejects.toThrow('offline');
    await e.load();
    expect(e.loaded).toBe(true);
  });

  it('transcribes the growing utterance for interim text and the whole of it for the final, in the chosen language', async () => {
    const f = fakeTransformers((s) => (s < 2 ? 'two' : 'two damage'));
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => cap, webgpu: false, interimMs: 1000 });
    await e.load();
    const got: [string, boolean][] = [];
    e.start('de-DE', (t, fin) => got.push([t, fin]));
    await vi.advanceTimersByTimeAsync(0);
    expect(cap.begun).toBe(1);
    cap.feed(1);
    await vi.advanceTimersByTimeAsync(1000);
    cap.feed(1.5);
    await vi.advanceTimersByTimeAsync(1000);
    e.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([
      ['two', false],
      ['two damage', false],
      ['two damage', true],
    ]);
    expect(f.runs.at(-1)?.opts).toMatchObject({ language: 'de', task: 'transcribe' });
    // Stopped: no more interim passes.
    await vi.advanceTimersByTimeAsync(5000);
    expect(got).toHaveLength(3);
    e.dispose();
    expect(cap.closed).toBe(true);
  });

  /** Feed audio in real time: `seconds` at `level`, a quarter second at a time, with the timers running. */
  async function speak(cap: FakeCapture, seconds: number, level = 0.1): Promise<void> {
    for (let t = 0; t < seconds; t += 0.25) {
      cap.feed(0.25, level);
      await vi.advanceTimersByTimeAsync(250);
    }
  }

  it('an open microphone gives one final transcript per spoken phrase, transcribing only the current phrase', async () => {
    const f = fakeTransformers((s) => `phrase of ${Math.round(s)} s`);
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => cap, webgpu: false });
    await e.load();
    const got: [string, boolean][] = [];
    e.start('en-US', (t, fin) => got.push([t, fin]));
    await vi.advanceTimersByTimeAsync(0);
    // Silence first: nothing is transcribed and nothing piles up.
    await speak(cap, 10, 0);
    expect(f.runs).toEqual([]);
    expect(cap.buf.length).toBeLessThan(16000);
    // Two phrases with a pause after each.
    await speak(cap, 2);
    await speak(cap, 1, 0);
    await speak(cap, 3);
    await speak(cap, 1, 0);
    const finals = got.filter(([, fin]) => fin).map(([t]) => t);
    expect(finals).toHaveLength(2);
    // Each final holds its own phrase (and the pause that ended it), not everything heard so far.
    expect(Math.max(...f.runs.map((r) => r.seconds))).toBeLessThanOrEqual(4);
    // The interim text of a phrase comes before its final, and the next phrase's after it.
    const firstFinal = got.findIndex(([, fin]) => fin);
    expect(got.slice(0, firstFinal).every(([, fin]) => !fin)).toBe(true);
    expect(got.slice(0, firstFinal).length).toBeGreaterThan(0);
    e.stop();
    e.dispose();
  });

  it('a phrase without a pause is cut at the segment length cap, so a whole turn or game never becomes one utterance', async () => {
    const f = fakeTransformers((s) => `speech of ${Math.round(s)} s`);
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => cap, webgpu: false });
    await e.load();
    const got: [string, boolean][] = [];
    e.start('en-US', (t, fin) => got.push([t, fin]));
    await vi.advanceTimersByTimeAsync(0);
    await speak(cap, 120);
    const finals = got.filter(([, fin]) => fin);
    expect(finals.length).toBeGreaterThanOrEqual(4);
    // No transcription ever covers more than one segment.
    expect(Math.max(...f.runs.map((r) => r.seconds))).toBeLessThanOrEqual(SEGMENT_MAX_S);
    // Releasing the key ends the last segment with its own final.
    e.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(got.filter(([, fin]) => fin).length).toBe(finals.length + 1);
    e.dispose();
  });

  it('trailing silence after the last phrase is not transcribed when listening stops', async () => {
    const f = fakeTransformers(() => 'pass the turn');
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => cap, webgpu: false });
    await e.load();
    const got: [string, boolean][] = [];
    e.start('en-US', (t, fin) => got.push([t, fin]));
    await vi.advanceTimersByTimeAsync(0);
    await speak(cap, 1.5);
    await speak(cap, 1, 0);
    expect(got.filter(([, fin]) => fin)).toEqual([['pass the turn', true]]);
    const runs = f.runs.length;
    await speak(cap, 0.5, 0);
    e.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.runs.length).toBe(runs);
    expect(got.filter(([, fin]) => fin)).toHaveLength(1);
    e.dispose();
  });

  it('dispose releases the microphone and frees the model', async () => {
    const disposed: number[] = [];
    const lib: TransformersLike = {
      pipeline: async () => Object.assign(async () => ({ text: 'x' }), { dispose: () => void disposed.push(1) }) as AsrPipeline,
    };
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => lib, capture: () => cap, webgpu: false });
    await e.load();
    e.start('en', () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    e.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(cap.closed).toBe(true);
    expect(disposed).toEqual([1]);
    expect(e.loaded).toBe(false);
  });

  it('a press too short for words ends without a transcription', async () => {
    const f = fakeTransformers(() => 'phantom');
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => cap, webgpu: false });
    await e.load();
    const got: unknown[] = [];
    e.start('en-US', (...a) => got.push(a));
    await vi.advanceTimersByTimeAsync(0);
    cap.feed(0.1);
    e.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
    expect(f.runs).toEqual([]);
  });

  it('settles a stopped listener only once every transcription queued for it has been passed on', async () => {
    const texts = ['attack with both', 'no blocks'];
    let i = 0;
    const pipe: AsrPipeline = async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return { text: texts[i++] ?? '?' };
    };
    const cap = new FakeCapture();
    const e = new LocalWhisperEngine({ library: async () => ({ pipeline: async () => pipe }), capture: () => cap, webgpu: false });
    await e.load();
    const first: string[] = [];
    const second: string[] = [];
    const onFirst = (t: string, final: boolean): number => final ? first.push(t) : 0;
    const onSecond = (t: string, final: boolean): number => final ? second.push(t) : 0;
    // Owed nothing: a listener never started, or started and stopped without words.
    await e.settled(onFirst);
    e.start('en', onFirst);
    await vi.advanceTimersByTimeAsync(0);
    cap.feed(0.6);
    e.stop();
    e.start('en', onSecond);
    await vi.advanceTimersByTimeAsync(0);
    cap.feed(0.6);
    e.stop();
    let firstSettled = false;
    let secondSettled = false;
    void e.settled(onFirst).then(() => (firstSettled = true));
    void e.settled(onSecond).then(() => (secondSettled = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect([firstSettled, secondSettled]).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual(['attack with both']);
    expect([firstSettled, secondSettled]).toEqual([true, false]);
    // The second phrase waited behind the first: it is settled 4 s after its release, with its final passed on.
    await vi.advanceTimersByTimeAsync(2000);
    expect(second).toEqual(['no blocks']);
    expect(secondSettled).toBe(true);
  });

  it('a listener still listening is not settled', async () => {
    const f = fakeTransformers(() => 'x');
    const e = new LocalWhisperEngine({ library: async () => f.lib, capture: () => new FakeCapture(), webgpu: false });
    await e.load();
    const on = (): void => undefined;
    e.start('en', on);
    let settled = false;
    void e.settled(on).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    e.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });
});

// --- Microphone capture ----------------------------------------------------------------------------------------------

describe('Web Audio microphone capture', () => {
  type Track = { enabled: boolean; stopped: boolean; stop(): void };
  let nodes: { onaudioprocess: ((e: { inputBuffer: { getChannelData(n: number): Float32Array } }) => void) | null }[] = [];
  let contexts = 0;
  beforeEach(() => {
    nodes = [];
    contexts = 0;
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        constructor() {
          contexts++;
        }
        createMediaStreamSource() {
          return { connect: () => undefined };
        }
        createScriptProcessor() {
          const node = { onaudioprocess: null, connect: () => undefined, disconnect: () => undefined };
          nodes.push(node);
          return node;
        }
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A microphone whose permission prompt the test answers. */
  function prompt(): { media: { getUserMedia(): Promise<MediaStream> }; allow(): void; tracks: Track[] } {
    const tracks: Track[] = [];
    const pending: ((s: MediaStream) => void)[] = [];
    return {
      tracks,
      media: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            pending.push(resolve);
          }),
      },
      allow() {
        const track: Track = {
          enabled: true,
          stopped: false,
          stop() {
            this.stopped = true;
          },
        };
        tracks.push(track);
        const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
        pending.shift()?.(stream);
      },
    };
  }
  const buffer = { inputBuffer: { getChannelData: () => new Float32Array(4096) } };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('records while begun and disables the microphone when ended', async () => {
    const mic = prompt();
    const cap = new WebAudioCapture(mic.media as never);
    const begun = cap.begin();
    mic.allow();
    await begun;
    expect(mic.tracks[0]?.enabled).toBe(true);
    nodes[0]?.onaudioprocess?.(buffer);
    expect(cap.end().length).toBe(4096);
    expect(mic.tracks[0]?.enabled).toBe(false);
    nodes[0]?.onaudioprocess?.(buffer);
    expect(cap.samples().length).toBe(0);
  });

  it('a key released while the permission prompt is open records nothing and leaves the microphone disabled', async () => {
    const mic = prompt();
    const cap = new WebAudioCapture(mic.media as never);
    const begun = cap.begin();
    cap.end();
    mic.allow();
    await begun;
    expect(mic.tracks[0]?.enabled).toBe(false);
    nodes[0]?.onaudioprocess?.(buffer);
    expect(cap.samples().length).toBe(0);
    // The next press records as usual, without asking again.
    await cap.begin();
    nodes[0]?.onaudioprocess?.(buffer);
    expect(cap.samples().length).toBe(4096);
    expect(mic.tracks).toHaveLength(1);
  });

  it('closed while the prompt is open: the late stream is stopped at once', async () => {
    const mic = prompt();
    const cap = new WebAudioCapture(mic.media as never);
    const begun = cap.begin();
    cap.close();
    mic.allow();
    await begun;
    expect(mic.tracks[0]?.stopped).toBe(true);
    expect(contexts).toBe(0);
  });

  it('through the engine: stop during the prompt leaves nothing recording', async () => {
    const mic = prompt();
    const cap = new WebAudioCapture(mic.media as never);
    const e = new LocalWhisperEngine({ library: async () => fakeTransformers(() => 'x').lib, capture: () => cap, webgpu: false });
    await e.load();
    e.start('en', () => undefined);
    await settle();
    e.stop();
    mic.allow();
    await settle();
    nodes[0]?.onaudioprocess?.(buffer);
    expect(cap.samples().length).toBe(0);
    expect(mic.tracks[0]?.enabled).toBe(false);
    e.dispose();
    expect(mic.tracks[0]?.stopped).toBe(true);
  });

  it('where the microphone cannot join a 16 kHz context (Firefox), records at the device rate and brings it down to 16 kHz', async () => {
    const rates: (number | undefined)[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        sampleRate: number;
        constructor(opts?: { sampleRate?: number }) {
          rates.push(opts?.sampleRate);
          this.sampleRate = opts?.sampleRate ?? 48_000;
        }
        createMediaStreamSource() {
          if (this.sampleRate !== 48_000) throw new DOMException('Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported.', 'NotSupportedError');
          return { connect: () => undefined };
        }
        createScriptProcessor() {
          const node = { onaudioprocess: null, connect: () => undefined, disconnect: () => undefined };
          nodes.push(node);
          return node;
        }
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
      },
    );
    const mic = prompt();
    const cap = new WebAudioCapture(mic.media as never);
    const begun = cap.begin();
    mic.allow();
    await begun;
    expect(rates).toEqual([16_000, undefined]);
    const second = { inputBuffer: { getChannelData: () => new Float32Array(48_000).fill(0.5) } };
    nodes[0]?.onaudioprocess?.(second);
    const got = cap.end();
    expect(got.length).toBe(16_000);
    expect(got[100]).toBeCloseTo(0.5);
  });
});

describe('downsampler', () => {
  it('averages each output sample over the input it stands for, across buffers', () => {
    const down = downsampler(3);
    expect([...down(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]))]).toEqual([1, 4, 7]);
    // A buffer that does not divide evenly carries over into the next.
    const odd = downsampler(48_000 / 16_000);
    expect(odd(new Float32Array(4096)).length + odd(new Float32Array(4096)).length).toBe(Math.floor(8192 / 3));
  });

  it('brings 44.1 kHz down to 16 kHz without drift', () => {
    const down = downsampler(44_100 / 16_000);
    let n = 0;
    for (let i = 0; i < 100; i++) n += down(new Float32Array(441)).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
  });
});

// --- Factories -------------------------------------------------------------------------------------------------------

describe('engine factories', () => {
  it('state where audio goes for each engine, and the local model’s download size', () => {
    expect(SPEECH_ENGINES.webspeech.info).toMatchObject({ audio: 'vendor', statement: expect.stringMatching(/browser vendor/) });
    expect(SPEECH_ENGINES.local.info).toMatchObject({ audio: 'device', statement: expect.stringMatching(/stays on this device/) });
    expect(SPEECH_ENGINES.local.info.downloadBytes).toBeGreaterThan(10_000_000);
    expect(FAKE_SPEECH.info.audio).toBe('none');
  });

  it('name where the on-device model’s code and weights are downloaded from', () => {
    expect(LOCAL_MODEL_SOURCES).toMatch(/jsDelivr/);
    expect(LOCAL_MODEL_SOURCES).toMatch(/Hugging Face/);
    expect(LOCAL_MODEL_SOURCES).toContain(new URL(TRANSFORMERS_URL).host);
    expect(LOCAL_MODEL_SOURCES).toContain('huggingface.co');
  });

  it('creating the local engine loads its code but not the model or transformers.js', async () => {
    const before = createdEngines().length;
    const e = await SPEECH_ENGINES.local.create();
    expect(e.id).toBe('local');
    expect((e as LocalWhisperEngine).loaded).toBe(false);
    expect(createdEngines().length).toBe(before + 1);
  });

  it('report availability without creating an engine', async () => {
    const before = createdEngines().length;
    // Node has no SpeechRecognition.
    expect(await SPEECH_ENGINES.webspeech.available()).toBe(false);
    await SPEECH_ENGINES.local.available();
    expect(createdEngines().length).toBe(before);
  });
});
