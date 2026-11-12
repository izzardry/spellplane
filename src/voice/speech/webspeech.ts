/**
 * The browser's built-in speech recognition (DESIGN "Chat and voice", Dictation and captions: Engine — "The browser's
 * built-in speech recognition is the default (Chrome, Edge, Safari). It is instant and multilingual, but audio is
 * processed by the browser vendor and Firefox does not support it"). Implementer: M3-P4.
 *
 * Continuous recognition with interim results: every result the browser marks final is one utterance (one final
 * transcript); the words after the last final result are the growing interim text. Chrome ends a session after a
 * stretch of silence; while the engine is meant to listen it starts a new one. After an error (the speech service
 * unreachable, the session aborted) the restart waits, longer after each failure in a row, and listening ends after
 * MAX_FAILURES of them. After `stop` the browser still delivers the final result of words already spoken, and the
 * engine passes it on.
 */
import type { SpeechEngine, SpeechListener } from '../types';

/** The part of a SpeechRecognitionResult the engine reads (lib.dom does not declare the Web Speech API). */
export interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

/** The part of a SpeechRecognitionEvent the engine reads. */
export interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike };
}

/** The part of a SpeechRecognition the engine uses. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type RecognitionCtor = new () => RecognitionLike;

/** The page's SpeechRecognition constructor (standard or WebKit-prefixed), or null where the browser has none (Firefox). */
export function recognitionCtor(scope: object = globalThis): RecognitionCtor | null {
  const w = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Errors after which listening cannot go on: the player or the browser refused the microphone or the service. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);
/** Errors that are part of listening: Chrome reports 'no-speech' after a stretch of silence. */
const BENIGN = new Set(['no-speech']);
/** Failures in a row after which listening gives up. */
export const MAX_FAILURES = 5;
/** The wait before the first restart after a failure, ms; it doubles with each further one. */
export const RETRY_MS = 500;

interface Run {
  rec: RecognitionLike;
  on: SpeechListener;
  /** The engine still means to listen (false after `stop` or a fatal error). */
  wanted: boolean;
  /** Results of the current recognition session already passed on as final. */
  finals: Set<number>;
  /** The last interim text passed on, so an unchanged one is not repeated. */
  interim: string;
  /** Failed sessions in a row (an error without a result since). */
  failures: number;
  retry: ReturnType<typeof setTimeout> | null;
}

/** Web Speech engine (voice/types.ts SpeechEngine, id 'webspeech'). */
export class WebSpeechEngine implements SpeechEngine {
  readonly id = 'webspeech' as const;
  private run: Run | null = null;

  constructor(private readonly ctor: RecognitionCtor | null = recognitionCtor()) {}

  available(): Promise<boolean> {
    return Promise.resolve(this.ctor !== null);
  }

  start(lang: string, on: SpeechListener): void {
    if (!this.ctor) return;
    this.halt(true);
    const rec = new this.ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const run: Run = { rec, on, wanted: true, finals: new Set(), interim: '', failures: 0, retry: null };
    rec.onresult = (e) => {
      run.failures = 0;
      this.onResult(run, e);
    };
    rec.onerror = (e) => {
      if (FATAL.has(e.error)) run.wanted = false;
      else if (!BENIGN.has(e.error) && ++run.failures >= MAX_FAILURES) run.wanted = false;
    };
    rec.onend = () => {
      // A new recognition session numbers its results from 0 again.
      run.finals.clear();
      if (!run.wanted || this.run !== run) return;
      const restart = (): void => {
        run.retry = null;
        if (!run.wanted || this.run !== run) return;
        try {
          rec.start();
        } catch {
          run.wanted = false;
        }
      };
      if (run.failures === 0) restart();
      else run.retry = setTimeout(restart, RETRY_MS * 2 ** (run.failures - 1));
    };
    this.run = run;
    try {
      rec.start();
    } catch {
      run.wanted = false;
    }
  }

  stop(): void {
    this.halt(false);
  }

  /** Stop listening; `abort` drops what was not transcribed yet (a restart), otherwise its final still arrives. */
  private halt(abort: boolean): void {
    const run = this.run;
    if (!run) return;
    run.wanted = false;
    if (run.retry !== null) clearTimeout(run.retry);
    run.retry = null;
    if (abort) {
      this.run = null;
      run.rec.onresult = null;
      try {
        run.rec.abort();
      } catch {
        /* already ended */
      }
      return;
    }
    try {
      run.rec.stop();
    } catch {
      /* already ended */
    }
  }

  private onResult(run: Run, e: RecognitionEventLike): void {
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r || r.length === 0) continue;
      const text = (r[0]?.transcript ?? '').trim();
      if (r.isFinal) {
        if (run.finals.has(i)) continue;
        run.finals.add(i);
        run.interim = '';
        run.on(text, true);
      } else if (text) {
        interim = interim ? `${interim} ${text}` : text;
      }
    }
    if (interim && interim !== run.interim) {
      run.interim = interim;
      run.on(interim, false);
    }
  }
}
