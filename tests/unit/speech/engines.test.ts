/**
 * The speech engines (DESIGN "Chat and voice", Dictation and captions: Engine; "Specification: code interfaces",
 * SpeechEngine; PLAN M3-P4): the Web Speech engine over a scripted recogniser, and the on-device Whisper engine over a
 * fake transformers.js and fake microphone. Nothing here touches the network: the local engine's library is injected,
 * and the test asserts the real loader is not called before `load`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_SPEECH, SPEECH_ENGINES, createdEngines } from '../../../src/voice/speech/index';
import { LocalWhisperEngine, WebAudioCapture, WHISPER_MODEL, type AsrPipeline, type AudioCapture, type ProgressInfo, type TransformersLike } from '../../../src/voice/speech/local';
import { WebSpeechEngine, recognitionCtor, type RecognitionEventLike, type RecognitionLike } from '../../../src/voice/speech/webspeech';

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
  feed(seconds: number): void {
    if (this.recording) this.buf.push(...new Array<number>(Math.round(seconds * 16000)).fill(0.1));
  }
  samples(): Float32Array {
    return Float32Array.from(this.buf);
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
});

// --- Factories -------------------------------------------------------------------------------------------------------

describe('engine factories', () => {
  it('state where audio goes for each engine, and the local model’s download size', () => {
    expect(SPEECH_ENGINES.webspeech.info).toMatchObject({ audio: 'vendor', statement: expect.stringMatching(/browser vendor/) });
    expect(SPEECH_ENGINES.local.info).toMatchObject({ audio: 'device', statement: expect.stringMatching(/stays on this device/) });
    expect(SPEECH_ENGINES.local.info.downloadBytes).toBeGreaterThan(10_000_000);
    expect(FAKE_SPEECH.info.audio).toBe('none');
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
