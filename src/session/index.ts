// session: the local game client gluing core, store and data (PLAN M0-P7).
import type { SoloSessionOptions, TableSession } from './types';

export * from './types';

/** Create or restore the solo table (PLAN M0-P7). Stub from M0-C; implementer: M0-P7. */
export function createSoloSession(_opts: SoloSessionOptions): Promise<TableSession> {
  return Promise.reject(new Error('not implemented: M0-P7'));
}
