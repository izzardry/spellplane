/**
 * The speech engines (DESIGN "Chat and voice", Dictation and captions: Engine; "Specification: code interfaces",
 * SpeechEngine): the browser's built-in Web Speech recognition (default) and an in-browser Whisper-class model through
 * transformers.js, loaded by dynamic import only when chosen. Implementer: M3-P4.
 */
import { FakeSpeechEngine } from '../fake';
import type { SpeechEngine, SpeechEngineFactory, SpeechEngineId } from '../types';
import { recognitionCtor, WebSpeechEngine } from './webspeech';

/** Approximate first download of the on-device model (voice/speech/local.ts LOCAL_MODEL_BYTES; kept here so the settings need not load that module). */
export const LOCAL_MODEL_DOWNLOAD_BYTES = 80_000_000;

/**
 * Where the on-device model's download comes from, as the settings state it next to its size (DESIGN "Chat and voice",
 * Engine: a plain statement of what is downloaded): transformers.js (voice/speech/local.ts TRANSFORMERS_URL) and the
 * ONNX runtime it loads from jsDelivr, the Whisper weights (WHISPER_MODEL) from Hugging Face. Kept here so the settings
 * need not load that module.
 */
export const LOCAL_MODEL_SOURCES =
  'It is fetched from jsDelivr (cdn.jsdelivr.net: the transformers.js library and its ONNX runtime) and from Hugging Face (huggingface.co: the Whisper speech model).';

/**
 * A factory that can say whether its engine runs in this browser without creating it, so the settings can list the
 * local model without loading its code (voice/captions.ts `engines()` asks it when the method is there). Local to
 * M3-P4: the contract's SpeechEngineFactory is unchanged.
 */
export type ProbedSpeechEngineFactory = SpeechEngineFactory & { available(): Promise<boolean> };

/** Whether `f` can answer availability without creating its engine. */
export function isProbed(f: SpeechEngineFactory): f is ProbedSpeechEngineFactory {
  return 'available' in f && typeof (f as { available?: unknown }).available === 'function';
}

/** How many created engines the debug hook remembers. */
const TRACKED_MAX = 16;
// Engines created on this page, newest last, for the debug hook (SpeechDebug.engine and say). Dev and test builds
// only, and only the latest few, so production pages keep no engine alive through this list.
const created: SpeechEngine[] = [];
function track<E extends SpeechEngine>(engine: E): E {
  if (!__SPELLPLANE_DEBUG__) return engine;
  created.push(engine);
  if (created.length > TRACKED_MAX) created.splice(0, created.length - TRACKED_MAX);
  return engine;
}

/** Engines created on this page so far, oldest first (debug hook). */
export function createdEngines(): readonly SpeechEngine[] {
  return created;
}

/** The fake engine of the test harness (`?speech=fake`, voice/fake.ts); captures no audio. */
export const FAKE_SPEECH: ProbedSpeechEngineFactory = {
  info: { id: 'fake', label: 'Test engine', audio: 'none', statement: 'Test engine: no audio is captured.' },
  create: () => Promise.resolve(track(new FakeSpeechEngine())),
  available: () => Promise.resolve(true),
};

/** Engine factories the settings offer, default first (DESIGN "Chat and voice", Engine). */
export const SPEECH_ENGINES: Readonly<Record<Exclude<SpeechEngineId, 'fake'>, ProbedSpeechEngineFactory>> = {
  webspeech: {
    info: {
      id: 'webspeech',
      label: 'Browser speech recognition',
      audio: 'vendor',
      statement: 'Audio is processed by your browser vendor (for example Google in Chrome, Apple in Safari) to turn it into text. Only the text reaches the other players.',
    },
    create: () => Promise.resolve(track(new WebSpeechEngine())),
    available: () => Promise.resolve(recognitionCtor() !== null),
  },
  local: {
    info: {
      id: 'local',
      label: 'On-device model (Whisper)',
      audio: 'device',
      statement: 'Audio stays on this device: a speech model downloaded once into this browser turns it into text. Only the text reaches the other players.',
      downloadBytes: LOCAL_MODEL_DOWNLOAD_BYTES,
    },
    // The model's code and weights load only through this import and the engine's `load` (PLAN M3-P4).
    create: () => import('./local').then((m) => track(m.createLocalEngine())),
    available: () => Promise.resolve(typeof WebAssembly === 'object' && typeof AudioContext !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices),
  },
};
