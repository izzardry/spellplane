/**
 * The on-device speech engine (DESIGN "Chat and voice", Dictation and captions: Engine — "A player can instead
 * download an in-browser Whisper-class model through transformers.js, which runs on WebGPU, keeps audio on the device
 * and works in every browser"). Implementer: M3-P4.
 *
 * This module is reached only through a dynamic import (voice/speech/index.ts), and transformers.js and the model
 * weights are fetched only by `load`, which runs once the player chose this engine (PLAN M3-P4: "the local-model
 * engine is not downloaded unless chosen"). transformers.js comes from a pinned CDN build rather than the app bundle,
 * so its ONNX runtime is not part of the static site (DECISIONS [M3-P4]); the browser caches both.
 *
 * Transcription: while listening, the microphone (16 kHz mono) is cut into segments, one per spoken phrase. A segment
 * ends after SEGMENT_SILENCE_MS of silence following speech, after SEGMENT_MAX_S, or when listening stops; it is then
 * transcribed once more and passed on as one final transcript, and recording goes on into the next segment. While a
 * segment grows, it alone is transcribed about once a second for the interim caption. Silence before any speech is
 * dropped, so an open microphone (dictation with the open gate, or for the whole own turn) keeps only the current
 * phrase. Audio never leaves the page.
 */
import { MIC_CONSTRAINTS, type LocalSpeechEngine, type MediaDevicesLike, type SpeechListener } from '../types';

/** transformers.js, pinned (loaded from the CDN on demand only). */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
/**
 * Multilingual Whisper base (74 M parameters), converted for transformers.js: about 80 MB on first use with 8-bit
 * weights on WASM (voice/speech/index.ts LOCAL_MODEL_DOWNLOAD_BYTES), somewhat more on WebGPU's full-precision encoder.
 */
export const WHISPER_MODEL = 'onnx-community/whisper-base';
/** Whisper's input rate. */
export const SAMPLE_RATE = 16_000;
/** How often the growing segment is transcribed for the interim caption, ms. */
export const INTERIM_MS = 1000;
/** How often the recorded audio is checked for the end of a phrase, ms. */
export const ENDPOINT_TICK_MS = 250;
/** Silence after speech that ends a segment (one final transcript), ms. */
export const SEGMENT_SILENCE_MS = 700;
/** Longest segment: a phrase without a pause is cut here (Whisper reads 30 s windows), s. */
export const SEGMENT_MAX_S = 25;
/**
 * RMS level (full scale 1) from which a stretch of audio counts as speech. The microphone runs with automatic gain and
 * noise suppression (MIC_CONSTRAINTS), so speech sits far above it and a quiet room far below.
 */
export const SPEECH_RMS = 0.01;
/** Audio is judged speech or silence in windows of this many samples (50 ms). */
const WINDOW = SAMPLE_RATE / 20;
/** Shorter audio is not worth a transcription (a key tap without words), samples. */
const MIN_SAMPLES = SAMPLE_RATE / 4;

/** What a transcription returns (transformers.js AutomaticSpeechRecognitionOutput). */
export type AsrOutput = { text: string } | { text: string }[];
/** The transformers.js speech-recognition pipeline, as far as this engine uses it. */
export type AsrPipeline = ((audio: Float32Array, opts: { language?: string; task?: 'transcribe'; chunk_length_s?: number; stride_length_s?: number }) => Promise<AsrOutput>) & {
  /** Frees the model's WebGPU or WASM memory (transformers.js Pipeline.dispose). */
  dispose?(): Promise<unknown> | void;
};
/** A progress report of transformers.js while it downloads a model file. */
export interface ProgressInfo {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}
/** The part of the transformers.js module this engine uses. */
export interface TransformersLike {
  pipeline(
    task: 'automatic-speech-recognition',
    model: string,
    opts: { device?: 'webgpu' | 'wasm'; dtype?: string | Record<string, string>; progress_callback?: (p: ProgressInfo) => void },
  ): Promise<AsrPipeline>;
}

/** Records the microphone as 16 kHz mono samples. */
export interface AudioCapture {
  /**
   * Start recording a new utterance (acquires the microphone the first time). An `end` or `close` while it waits for
   * the microphone cancels it: it then records nothing and leaves the microphone disabled.
   */
  begin(): Promise<void>;
  /** The samples recorded so far in this segment. */
  samples(): Float32Array;
  /** Return the segment recorded so far and go on recording into a new one. */
  cut(): Float32Array;
  /** Stop recording and return the segment. */
  end(): Float32Array;
  /** Release the microphone. */
  close(): void;
}

/** Load transformers.js from the pinned CDN build (never called before the player chose this engine). */
export function loadTransformers(): Promise<TransformersLike> {
  return import(/* @vite-ignore */ TRANSFORMERS_URL) as Promise<TransformersLike>;
}

function joinChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Microphone capture through Web Audio at Whisper's rate (echo cancellation, noise suppression and gain on). */
export class WebAudioCapture implements AudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  /** Bumped by every begin, end and close: a begin whose number is no longer current was cancelled while it waited. */
  private generation = 0;
  private closed = false;

  constructor(private readonly media: MediaDevicesLike | null = typeof navigator === 'undefined' ? null : navigator.mediaDevices) {}

  async begin(): Promise<void> {
    const gen = ++this.generation;
    this.chunks = [];
    if (this.closed) throw new Error('The microphone capture was closed');
    let stream = this.stream;
    if (!stream) {
      if (!this.media) throw new Error('This browser offers no microphone');
      const got = await this.media.getUserMedia({ audio: MIC_CONSTRAINTS });
      if (this.closed || this.stream) {
        // Released while the permission prompt was open, or another begin got the microphone first: this stream is
        // surplus, and nothing may keep it.
        for (const t of got.getTracks()) t.stop();
        if (this.closed) return;
      }
      stream = this.stream ?? this.attach(got);
    }
    // The key was released while the prompt was open: the utterance is over before it started.
    if (gen !== this.generation) return;
    for (const t of stream.getAudioTracks()) t.enabled = true;
    await this.ctx?.resume();
    if (gen !== this.generation) {
      for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = false;
      return;
    }
    this.recording = true;
  }

  /** Keep the microphone stream (disabled until a begin enables it) and record it through Web Audio. */
  private attach(stream: MediaStream): MediaStream {
    this.stream = stream;
    for (const t of stream.getAudioTracks()) t.enabled = false;
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = this.ctx.createMediaStreamSource(stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    return stream;
  }

  samples(): Float32Array {
    return joinChunks(this.chunks);
  }

  cut(): Float32Array {
    const out = joinChunks(this.chunks);
    this.chunks = [];
    return out;
  }

  end(): Float32Array {
    this.generation++;
    this.recording = false;
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = false;
    const out = joinChunks(this.chunks);
    this.chunks = [];
    return out;
  }

  close(): void {
    this.generation++;
    this.closed = true;
    this.recording = false;
    this.node?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.ctx = null;
    this.node = null;
  }
}

/** Whether WebGPU is offered (transformers.js then runs the model on the GPU, else on WASM). */
function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as { gpu?: unknown }).gpu != null;
}

function textOf(out: AsrOutput): string {
  return (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).replace(/\s+/g, ' ').trim();
}

export interface LocalEngineOptions {
  /** Loads transformers.js; default the pinned CDN build. Tests inject a fake. */
  library?: () => Promise<TransformersLike>;
  /** Microphone capture; default Web Audio. */
  capture?: () => AudioCapture;
  /** Run on WebGPU; default when the browser offers it. */
  webgpu?: boolean;
  interimMs?: number;
}

/** One phrase being recorded: what of it was judged so far, and whether it holds speech. */
interface Segment {
  /** Samples of the segment already judged speech or silence. */
  judged: number;
  /** A window of it was speech. */
  heard: boolean;
  /** Silent samples since the last speech. */
  silent: number;
  /** Interim text was passed on, so the segment owes a final one. */
  spoke: boolean;
}

const newSegment = (): Segment => ({ judged: 0, heard: false, silent: 0, spoke: false });

interface Listening {
  lang: string;
  on: SpeechListener;
  active: boolean;
  seg: Segment;
  /** Time since the last interim pass, ms. */
  sinceInterim: number;
  timer: ReturnType<typeof setInterval> | null;
}

/** Judge the samples of `seg` not judged yet (`audio` is the segment so far), window by window. */
function judge(seg: Segment, audio: Float32Array): void {
  for (let at = seg.judged; at < audio.length; at += WINDOW) {
    const end = Math.min(at + WINDOW, audio.length);
    let sum = 0;
    for (let i = at; i < end; i++) sum += audio[i]! * audio[i]!;
    if (Math.sqrt(sum / (end - at)) >= SPEECH_RMS) {
      seg.heard = true;
      seg.silent = 0;
    } else seg.silent += end - at;
  }
  seg.judged = Math.max(seg.judged, audio.length);
}

/** The on-device Whisper engine (voice/types.ts LocalSpeechEngine). */
export class LocalWhisperEngine implements LocalSpeechEngine {
  readonly id = 'local' as const;
  private pipe: AsrPipeline | null = null;
  private loading: Promise<void> | null = null;
  private capture: AudioCapture | null = null;
  private listening: Listening | null = null;
  /** One transcription at a time; interim passes are skipped while one runs. */
  private busy: Promise<unknown> = Promise.resolve();
  private running = false;

  constructor(private readonly opts: LocalEngineOptions = {}) {}

  get loaded(): boolean {
    return this.pipe !== null;
  }

  available(): Promise<boolean> {
    return Promise.resolve(typeof WebAssembly === 'object' && typeof AudioContext !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices);
  }

  load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.pipe) {
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    if (!this.loading) {
      const files = new Map<string, { loaded: number; total: number }>();
      const report = (p: ProgressInfo): void => {
        if (!p.file || (p.status !== 'progress' && p.status !== 'done' && p.status !== 'initiate')) return;
        const prev = files.get(p.file) ?? { loaded: 0, total: 0 };
        const total = p.total ?? prev.total;
        files.set(p.file, { loaded: p.status === 'done' ? total : (p.loaded ?? prev.loaded), total });
        let loaded = 0;
        let sum = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          sum += f.total;
        }
        onProgress?.(loaded, sum);
      };
      const webgpu = this.opts.webgpu ?? hasWebGpu();
      this.loading = (this.opts.library ?? loadTransformers)()
        .then((lib) =>
          lib.pipeline('automatic-speech-recognition', WHISPER_MODEL, {
            device: webgpu ? 'webgpu' : 'wasm',
            // transformers.js's advice for Whisper: a full-precision encoder and a 4-bit decoder on WebGPU, 8-bit on WASM.
            dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
            progress_callback: report,
          }),
        )
        .then((pipe) => {
          this.pipe = pipe;
        })
        .catch((e: unknown) => {
          this.loading = null;
          throw e instanceof Error ? e : new Error(String(e));
        });
    }
    return this.loading;
  }

  start(lang: string, on: SpeechListener): void {
    this.stop();
    const l: Listening = { lang, on, active: true, seg: newSegment(), sinceInterim: 0, timer: null };
    this.listening = l;
    this.capture ??= (this.opts.capture ?? (() => new WebAudioCapture()))();
    const capture = this.capture;
    void this.load()
      .then(() => (l.active ? capture.begin() : undefined))
      .then(() => {
        if (!l.active) return;
        const tick = Math.min(ENDPOINT_TICK_MS, this.interimMs);
        l.timer = setInterval(() => this.tick(l, tick), tick);
      })
      .catch((e: unknown) => {
        l.active = false;
        console.warn('Spellplane: the on-device speech engine could not listen', e);
      });
  }

  stop(): void {
    const l = this.listening;
    if (!l) return;
    this.listening = null;
    const wasActive = l.active;
    l.active = false;
    if (l.timer !== null) clearInterval(l.timer);
    if (!wasActive || !this.capture) return;
    const audio = this.capture.end();
    judge(l.seg, audio);
    // Trailing silence after the last phrase carries no words (and Whisper would invent some).
    this.finish(l.seg.heard ? audio : new Float32Array(0), l.seg, l);
  }

  /** Release the microphone and the model (the engine can start again later, loading the model anew). */
  dispose(): void {
    this.stop();
    this.capture?.close();
    this.capture = null;
    const pipe = this.pipe;
    this.pipe = null;
    this.loading = null;
    // After a transcription still running, so it does not run on freed memory.
    if (pipe?.dispose) void this.busy.then(() => pipe.dispose?.()).catch(() => undefined);
  }

  private get interimMs(): number {
    return this.opts.interimMs ?? INTERIM_MS;
  }

  /** Every ENDPOINT_TICK_MS while listening: end the segment at a pause or the length cap, else an interim pass now and then. */
  private tick(l: Listening, ms: number): void {
    if (!l.active || !this.capture) return;
    const audio = this.capture.samples();
    const seg = l.seg;
    judge(seg, audio);
    if (!seg.heard) {
      // Nothing said yet: the silence is dropped, so the segment starts with the words.
      if (seg.silent >= (SEGMENT_SILENCE_MS * SAMPLE_RATE) / 1000) {
        this.capture.cut();
        l.seg = newSegment();
      }
      return;
    }
    if (seg.silent >= (SEGMENT_SILENCE_MS * SAMPLE_RATE) / 1000 || audio.length >= SEGMENT_MAX_S * SAMPLE_RATE) {
      // The phrase is over: it becomes one final transcript, and recording goes on into the next segment.
      const done = this.capture.cut();
      l.seg = newSegment();
      l.sinceInterim = 0;
      this.finish(done, seg, l);
      return;
    }
    l.sinceInterim += ms;
    if (l.sinceInterim < this.interimMs) return;
    l.sinceInterim = 0;
    if (this.running || audio.length < MIN_SAMPLES) return;
    void this.transcribe(audio, l.lang).then(
      (text) => {
        // Transcriptions run one after another, so this interim always arrives before its segment's final.
        if (l.active && text) {
          seg.spoke = true;
          l.on(text, false);
        }
      },
      () => undefined,
    );
  }

  /** Transcribe a finished segment and pass it on as final (an empty final ends a segment whose interim text was shown). */
  private finish(audio: Float32Array, seg: Segment, l: Listening): void {
    if (audio.length < MIN_SAMPLES) {
      if (seg.spoke) l.on('', true);
      return;
    }
    void this.transcribe(audio, l.lang).then(
      (text) => {
        if (text || seg.spoke) l.on(text, true);
      },
      () => {
        if (seg.spoke) l.on('', true);
      },
    );
  }

  private transcribe(audio: Float32Array, lang: string): Promise<string> {
    const pipe = this.pipe;
    if (!pipe) return Promise.resolve('');
    const language = lang.split('-')[0]?.toLowerCase() || undefined;
    const run = this.busy.then(async () => {
      this.running = true;
      try {
        return textOf(await pipe(audio, { ...(language ? { language } : {}), task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 }));
      } finally {
        this.running = false;
      }
    });
    this.busy = run.catch(() => undefined);
    return run;
  }
}

/** Create the on-device engine (voice/speech/index.ts SPEECH_ENGINES.local, by dynamic import). */
export function createLocalEngine(opts?: LocalEngineOptions): LocalWhisperEngine {
  return new LocalWhisperEngine(opts);
}
