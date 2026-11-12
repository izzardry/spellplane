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

// Engines created on this page, newest last (the debug hook reads them: SpeechDebug.engine and say).
const created: SpeechEngine[] = [];
function track<E extends SpeechEngine>(engine: E): E {
  created.push(engine);
  return engine;
}

/** Engines created on this page so far, oldest first (debug hook). */
export function createdEngines(): readonly SpeechEngine[] {
  return created;
}

/** The fake engine of the test harness (`?speech=fake`, voice/fake.ts); captures no audio. */
export const FAKE_SPEECH: SpeechEngineFactory = {
  info: { id: 'fake', label: 'Test engine', audio: 'none', statement: 'Test engine: no audio is captured.' },
  create: () => Promise.resolve(track(new FakeSpeechEngine())),
  available: () => Promise.resolve(true),
};

/** Engine factories the settings offer, default first (DESIGN "Chat and voice", Engine). */
export const SPEECH_ENGINES: Readonly<Record<Exclude<SpeechEngineId, 'fake'>, SpeechEngineFactory>> = {
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
