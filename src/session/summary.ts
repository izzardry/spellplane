/**
 * A table as a History summary (persistence.md section 3: `summarise(state, secrets, prior, heads)`, pure). Stub by
 * M8-C: returns the prior summary unchanged. M8-P2 owns the file.
 */
import type { SecretStore, TableState } from '../core/types';
import type { GameSummary } from '../store/types';
import type { KnownHead } from './types';

/** The summary of `state` for History (persistence.md section 3). Stub: the prior summary. */
export function summarise(_state: TableState, _secrets: SecretStore | null, prior: GameSummary, _heads: KnownHead | null): GameSummary {
  return prior;
}
