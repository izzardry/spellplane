/**
 * The Two-Headed Giant scenarios of the shared leak test (CLAUDE.md: any code touching hidden information adds its
 * scenario to the shared leak test; PLAN M3-P2: "a teammate's page shows the partner's hand identities and an
 * opponent's page never receives them"; DESIGN "Pre-game", Hidden information: Two-Headed Giant draft "Team sees its
 * own packs and pool", sealed "Team pool only"). Used by tests/sim/teams/*.test.ts.
 *
 * The live teammate hand is scanned with the shared scanner itself (tests/leak/leak.ts `leakScan`, one owner against
 * one opponent, with decks of distinct printings so that every Scryfall id is evidence). For the draft packs:
 * - `teamKnowledge`: what each team may know of the draft packs, from the public log alone: every remaining card of a
 *   pack at every moment the team held it (its turns), and in sealed every card of its own packs.
 */
import { reduce } from '../../src/core/reducer';
import { packRemaining } from '../../src/core/reducer/pass';
import type { TableState } from '../../src/core/types';
import type { SequencedAction } from '../../src/net/messages';

/** The instance ids each team may know of the draft packs (see the module comment). */
export function teamKnowledge(start: TableState, log: readonly SequencedAction[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(Object.keys(start.teams).map((t) => [t, new Set<string>()]));
  let state = start;
  for (const a of log) {
    state = reduce(state, a);
    const d = state.draft;
    if (d === undefined) continue;
    for (const p of Object.values(d.packs)) {
      if (d.settings.format === 'teamSealed') {
        const team = state.seats[p.opener]?.team;
        if (team !== undefined) for (const id of p.commitment.instanceIds) out.get(team)?.add(id);
      } else if (p.holder !== null) {
        for (const id of packRemaining(d, p)) out.get(p.holder)?.add(id);
      }
    }
  }
  return out;
}
