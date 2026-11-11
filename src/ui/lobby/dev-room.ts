/**
 * Dev and test wiring of the table route and the start and diagnostics pages until M1-P8 hands App a networked
 * session (PLAN M1-P5: build against the contracts with fakes). Loaded lazily from App.svelte when
 * `__SPELLPLANE_DEBUG__` is set; production builds never include it. Tests choose a transport with the URL flag
 * `?transport=local` (BroadcastTransport) or with `window.__spellplaneTransport = 'silent' | 'unreachable'` set by an
 * init script (a network that never connects, relays that never answer).
 */
import { BroadcastTransport } from '../../net/broadcast';
import type { PeerId, Transport } from '../../net/transport';
import { randomId } from '../../session/secrecy';
import type { LocalStores } from '../../store/stores';
import type { IdentityStore } from '../../store/types';
import { flags } from '../../util/flags';
import { stateHash } from '../../core/hash';
import type { CardDataSource, ParseResult } from '../../data/types';
import { registerDebug } from '../../util/debug';
import { parsePlainList } from '../deck';
import type { GameDefinition } from '../../games/types';
import type { DiagProps, RoomLink } from '../types';
import { createLocalSession, SilentTransport, UnreachableTransport, type LocalSession } from './local-session';
import { lobbyStores } from './start';

declare global {
  interface Window {
    /** Test override of the dev transport (dev and test builds only). */
    __spellplaneTransport?: 'silent' | 'unreachable' | 'local';
  }
}

/** The transport kind dev wiring uses, or null when only the real (M1-P1/P8) transport would do. */
export function devTransportKind(): 'silent' | 'unreachable' | 'local' | null {
  const forced = typeof window === 'undefined' ? undefined : window.__spellplaneTransport;
  if (forced === 'silent' || forced === 'unreachable' || forced === 'local') return forced;
  return flags().transport === 'local' ? 'local' : null;
}

/** A dev transport of `kind` with a fresh transport id. */
export function devTransport(kind: 'silent' | 'unreachable' | 'local'): Transport {
  const id: PeerId = randomId('t');
  if (kind === 'silent') return new SilentTransport(id);
  if (kind === 'unreachable') return new UnreachableTransport(id);
  return new BroadcastTransport(id);
}

/** An identity store that also tells the stand-in session about nickname changes. */
function linkedIdentity(identity: IdentityStore, session: () => LocalSession | null): IdentityStore {
  return {
    get: () => identity.get(),
    async setNickname(name) {
      await identity.setNickname(name);
      session()?.setNickname(name);
    },
    setSeatColour: (c) => identity.setSeatColour(c),
  };
}

/** Join `link` with the stand-in session over the dev transport. */
export async function openDevRoom(
  link: RoomLink,
  deps: { game: GameDefinition; cardData: CardDataSource; parseDecklist?: (text: string) => ParseResult },
): Promise<{ session: LocalSession; identity: IdentityStore; stores: LocalStores }> {
  const kind = devTransportKind();
  if (!kind) throw new Error('No network transport in this build yet.');
  const s = await lobbyStores();
  const me = await s.identity.get();
  let session: LocalSession | null = null;
  const identity = linkedIdentity(s.identity, () => session);
  session = await createLocalSession({
    game: deps.game,
    cardData: deps.cardData,
    roomId: link.roomId,
    roomKey: link.roomKey,
    transport: devTransport(kind),
    identity: { peerId: me.peerId, nickname: me.nickname || 'Player', seatColour: me.seatColour },
  });
  registerRoomDebug(session, deps.cardData, deps.parseDecklist ?? parsePlainList);
  return { session, identity, stores: s };
}

/** The debug hook's session parts for the stand-in session (as debug/session.ts registers them for the solo table). */
function registerRoomDebug(session: LocalSession, cardData: CardDataSource, parse: (text: string) => ParseResult): void {
  registerDebug({
    state: () => session.getState(),
    secrets: () => session.secrets(),
    dispatch: (action) => {
      session.dispatch(action);
    },
    session: {
      hash: () => stateHash(session.getState()),
      importDeck: (deck) => session.importDeck(deck),
      importDecklist: async (text) => {
        const parsed = parse(text);
        const resolved = await cardData.resolveDeck(parsed.list);
        await session.importDeck({ main: resolved.main, side: resolved.side });
        return { main: resolved.main.length, side: resolved.side.length, errors: [...parsed.errors, ...resolved.errors].map((e) => `${e.line}: ${e.message}`) };
      },
      shuffle: (zone) => session.shuffle(zone),
      draw: (n) => session.draw(n),
      mulligan: () => session.mulligan(),
      lookAt: (zone, n) => session.lookAt(zone, n),
      undo: () => session.undo(),
      canUndo: () => session.canUndo(),
      log: () => session.log(),
      saved: () => session.whenSaved(),
    },
  });
}

/** Diagnostics props over the dev transport; without one, creating the transport fails with a plain reason. */
export function devDiagProps(room: { roomId: string; roomKey: string } | null): DiagProps {
  const kind = devTransportKind();
  return {
    createTransport: () => {
      if (!kind) throw new Error('the peer-to-peer transport is not wired into this build yet');
      return devTransport(kind);
    },
    room,
    now: () => Date.now(),
  };
}
