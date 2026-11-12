/**
 * The draft part of the debug hook (DESIGN "Specification: code interfaces", SpellplaneDebug; PLAN M2-G: picks, pools
 * and builder state are asserted through the hook, not on pixels) and the `flow` part, which drives the evening the
 * way the HUD does. Registered by main.ts with the session (M2-P7). Dev and test builds only.
 */
import type { DeckBuild, InstanceId, LobbySettings } from '../core/types';
import type { DraftPrivateView } from '../draft/types';
import type { TableSession } from '../session/types';
import { registerDebug } from '../util/debug';

/** The evening's controls as the debug hook exposes them (session/types.ts EveningControls and DraftControls). */
export interface FlowDebug {
  setLobby(lobby: LobbySettings): void;
  start(): void;
  propose(event: 'nextGame' | 'newDraft'): Promise<boolean>;
  mark(cards: InstanceId[]): void;
  pick(cards: InstanceId[]): boolean;
  pileLook(take: boolean): boolean;
  gridTake(line: 'row' | 'col', index: 0 | 1 | 2): boolean;
  setBuild(build: DeckBuild): void;
  ready(): Promise<void>;
  /** Whether the session offers the draft and the evening. */
  available(): { draft: boolean; evening: boolean };
}

declare module '../util/debug' {
  interface DebugParts {
    flow: FlowDebug;
  }
}

function noDraft(): never {
  throw new Error('this session has no draft');
}

/** Register the `draft` and `flow` parts for `session`. */
export function registerDraftDebug(session: TableSession): void {
  const draft = () => session.draft ?? noDraft();
  const evening = () => session.evening ?? noDraft();
  registerDebug({
    draft: {
      view: (): DraftPrivateView | null => (session.getState().draft !== undefined && session.draft ? session.draft.view() : null),
      build: (): DeckBuild | null => session.draft?.build() ?? null,
    },
    flow: {
      setLobby: (lobby) => void evening().setLobby(lobby),
      start: () => void evening().start(),
      propose: (event) => evening().propose(event),
      mark: (cards) => draft().mark(cards),
      pick: (cards) => draft().pick(cards),
      pileLook: (take) => draft().pileLook(take),
      gridTake: (line, index) => draft().gridTake(line, index),
      setBuild: (build) => draft().setBuild(build),
      ready: () => draft().ready(),
      available: () => ({ draft: session.draft !== undefined, evening: session.evening !== undefined }),
    },
  });
}
