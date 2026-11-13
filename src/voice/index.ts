// voice: mic gating, talk modes, speech engines, captions (DESIGN "Chat and voice"; PLAN M3-P3, M3-P4).
export * from './types';
export * from './fake';
export { talkState, talkIndicator } from './modes';
export { createVoice } from './mic';
export { createCaptions, lastTouched } from './captions';
export { FAKE_SPEECH, SPEECH_ENGINES } from './speech/index';
export { createHoldAloneGate } from './hold';
