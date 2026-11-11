/**
 * The networked session (PLAN M1-P8): TableSession over a NetEngine (transport, sequencer, sync), the pair channel
 * for hidden information and the sequencer's confirmation timers, with the owner's secret store and local
 * persistence as in the solo session. Contracts: M1-C (session/types.ts NetSession). Implementer: M1-P8.
 */
import type { CreateNetSession } from './types';

/** Join or start the table of `opts.roomId`. Implementer: M1-P8 (the stub rejects). */
export const createNetSession: CreateNetSession = () => Promise.reject(new Error('not implemented: M1-P8'));
