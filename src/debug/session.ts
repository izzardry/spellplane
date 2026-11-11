/**
 * Debug-hook assembly for the app (PLAN M0-P7; DESIGN "Specification: code interfaces", SpellplaneDebug): the session
 * registers `state()`, `secrets()` and `dispatch(action)`; the scene registers `cards()`, `camera()`, `lines()` and
 * `frameStats()` itself when it is created. Beyond the design's members the hook carries `session`, the solo
 * session's private effects and a state hash, so browser tests and the gate drive the table the way the HUD does.
 * Dev and test builds only (registerDebug is a no-op in production, and main.ts imports this module lazily).
 */
import { stateHash } from '../core/hash';
import type { Action } from '../core/actions';
import type { InstanceId, LogEntry, ZoneId } from '../core/types';
import type { CardDataSource, ParseResult } from '../data/types';
import type { DeckImport, LookedCard, SoloSession } from '../session/index';
import { registerDebug } from '../util/debug';

/** The solo session as the debug hook exposes it. Results are plain JSON so Playwright can read them. */
export interface SessionDebug {
  /** SHA-256 of the canonical JSON of the current state (DESIGN "Specification: network protocol and secrecy", Sync). */
  hash(): Promise<string>;
  importDeck(deck: DeckImport): Promise<void>;
  /** Parse and resolve a decklist like the HUD's import dialog, then import it; returns the unresolved lines. */
  importDecklist(text: string): Promise<{ main: number; side: number; errors: string[] }>;
  shuffle(zone?: ZoneId): Promise<void>;
  draw(n?: number): Promise<void>;
  mulligan(): Promise<void>;
  lookAt(zone: ZoneId, n: number): Promise<LookedCard[]>;
  /** Put an own hand or library card onto a battlefield or into exile face down (TableSession.playFaceDown). */
  playFaceDown(card: InstanceId, to: ZoneId): void;
  undo(): boolean;
  canUndo(): boolean;
  log(): LogEntry[];
  /** Resolves once everything applied so far is written to IndexedDB. */
  saved(): Promise<void>;
}

declare module '../util/debug' {
  interface DebugParts {
    session: SessionDebug;
  }
}

export interface SessionDebugDeps {
  cardData: CardDataSource;
  parseDecklist: (text: string) => ParseResult;
}

/** Register the session's parts of window.__spellplane. */
export function registerSessionDebug(session: SoloSession, deps: SessionDebugDeps): void {
  registerDebug({
    state: () => session.getState(),
    secrets: () => session.secrets(),
    dispatch: (action: Action) => {
      session.dispatch(action);
    },
    session: {
      hash: () => stateHash(session.getState()),
      importDeck: (deck) => session.importDeck(deck),
      importDecklist: async (text) => {
        const parsed = deps.parseDecklist(text);
        const resolved = await deps.cardData.resolveDeck(parsed.list);
        await session.importDeck({ main: resolved.main, side: resolved.side });
        return {
          main: resolved.main.length,
          side: resolved.side.length,
          errors: [...parsed.errors, ...resolved.errors].map((e) => `${e.line}: ${e.message}`),
        };
      },
      shuffle: (zone) => session.shuffle(zone),
      draw: (n) => session.draw(n),
      mulligan: () => session.mulligan(),
      lookAt: (zone, n) => session.lookAt(zone, n),
      playFaceDown: (card, to) => {
        session.playFaceDown(card, to);
      },
      undo: () => session.undo(),
      canUndo: () => session.canUndo(),
      log: () => session.log(),
      saved: () => session.whenSaved(),
    },
  });
}
