/**
 * The pair channel for hidden information (DESIGN "Multiplayer architecture", Hidden information 4-5;
 * "Specification: network protocol and secrecy", prv). Contracts: M1-C (net/types.ts PrivateChannel).
 * Implementer: M1-P2.
 */
import type { CreatePrivateChannel } from './types';

/** The pair-channel layer over a NetEngine. Implementer: M1-P2 (the stub throws). */
export const createPrivateChannel: CreatePrivateChannel = () => {
  throw new Error('not implemented: M1-P2');
};
