/**
 * The speech engines (DESIGN "Chat and voice", Dictation and captions: Engine; "Specification: code interfaces",
 * SpeechEngine): the browser's built-in Web Speech recognition (default) and an in-browser Whisper-class model through
 * transformers.js, loaded by dynamic import only when chosen. Contracts: M3-C (stubs); implementer: M3-P4.
 */
import { FakeSpeechEngine } from '../fake';
import type { SpeechEngineFactory, SpeechEngineId } from '../types';

const notYet = (): Promise<never> => Promise.reject(new Error('not implemented: M3-P4'));

/** The fake engine of the test harness (`?speech=fake`, voice/fake.ts); captures no audio. */
export const FAKE_SPEECH: SpeechEngineFactory = {
  info: { id: 'fake', label: 'Test engine', audio: 'none', statement: 'Test engine: no audio is captured.' },
  create: () => Promise.resolve(new FakeSpeechEngine()),
};

/** Engine factories the settings offer, default first (DESIGN "Chat and voice", Engine). Implementer: M3-P4. */
export const SPEECH_ENGINES: Readonly<Record<Exclude<SpeechEngineId, 'fake'>, SpeechEngineFactory>> = {
  webspeech: {
    info: { id: 'webspeech', label: 'Browser speech recognition', audio: 'vendor', statement: 'Audio is processed by your browser vendor.' },
    create: notYet,
  },
  local: {
    info: { id: 'local', label: 'On-device model', audio: 'device', statement: 'Audio stays on this device.' },
    create: notYet,
  },
};
