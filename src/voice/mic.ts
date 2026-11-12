/**
 * Microphone and audio on the mesh (DESIGN "Chat and voice", Live voice: acquired once on joining, gated by enabling and
 * disabling the track, echo cancellation, noise suppression and automatic gain on, speaking ring, per-peer volume and
 * mute; Team channel). Contracts: M3-C (stub); implementer: M3-P3.
 */
import type { CreateVoice } from './types';

/** Create the voice controller (voice/types.ts VoiceControls). Implementer: M3-P3. */
export const createVoice: CreateVoice = () => {
  throw new Error('not implemented: M3-P3');
};
