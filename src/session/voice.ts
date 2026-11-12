/**
 * Live voice for a networked table (DESIGN "Chat and voice", Live voice, Team channel; PLAN M3-P3): builds the
 * VoiceHost from the session's current engine and transport and creates the voice controller (voice/mic.ts). The
 * session replaces its engine and transport when it gives up a table it started alone (session/net.ts `rejoin`), so
 * every part of the host reads the current one. Also registers the debug hook's `voice` part (dev and test builds).
 * Implementer: M3-P3.
 */
import type { TableState } from '../core/types';
import type { PeerId, Transport } from '../net/transport';
import type { NetEngine, PeerPresence, Unsubscribe } from '../net/types';
import { registerDebug } from '../util/debug';
import { createVoice } from '../voice/mic';
import type { VoiceControls, VoiceHost } from '../voice/types';
import type { VoiceSessionOptions } from './types';

/** What the voice wiring needs from a networked session. */
export interface VoicePort {
  /** The session's current engine. */
  engine(): NetEngine;
  /** The transport under the current engine, null before one was made. */
  transport(): Transport | null;
  /** The view and every change of it. */
  state(): TableState;
  subscribe(listener: (state: TableState) => void): Unsubscribe;
  /** Peers and connection changes (they survive a new engine). */
  subscribeNet(listener: () => void): Unsubscribe;
}

/** The voice host over a session port: every call goes to the current engine and transport. */
export function voiceHost(port: VoicePort, opts: VoiceSessionOptions): VoiceHost {
  const streamHandlers: ((stream: MediaStream, from: PeerId) => void)[] = [];
  const hooked = new WeakSet<Transport>();
  /** Listen for incoming audio on a transport once. */
  const hook = (t: Transport | null): void => {
    if (!t || hooked.has(t)) return;
    hooked.add(t);
    t.onStream?.((stream, from) => {
      // A stream from a transport the session dropped is ignored.
      if (port.transport() !== t) return;
      for (const h of streamHandlers) h(stream, from);
    });
  };
  // Presence listeners follow the current engine.
  const presenceListeners = new Set<(peers: PeerPresence[]) => void>();
  let presenceOf: NetEngine | null = null;
  let presenceUnsub: Unsubscribe | null = null;
  const followPresence = (): void => {
    const eng = port.engine();
    if (eng === presenceOf) return;
    presenceUnsub?.();
    presenceOf = eng;
    presenceUnsub = eng.presence.subscribe((peers) => {
      for (const l of [...presenceListeners]) l(peers);
    });
  };
  return {
    transport: {
      get selfId(): PeerId {
        return port.transport()?.selfId ?? '';
      },
      addStream: (stream, to) => port.transport()?.addStream?.(stream, to),
      removeStream: (stream, to) => port.transport()?.removeStream?.(stream, to),
      onStream: (handler) => {
        streamHandlers.push(handler);
        hook(port.transport());
      },
    },
    peers: () => port.engine().peers(),
    onPeers: (listener) =>
      port.subscribeNet(() => {
        hook(port.transport());
        followPresence();
        listener(port.engine().peers());
      }),
    state: () => port.state(),
    seat: () => port.engine().seat(),
    onState: (listener) => port.subscribe(listener),
    presence: {
      speaking: (on) => port.engine().presence.speaking(on),
      peers: () => port.engine().presence.peers(),
      subscribe: (listener) => {
        followPresence();
        presenceListeners.add(listener);
        return () => {
          presenceListeners.delete(listener);
          if (presenceListeners.size === 0) {
            presenceUnsub?.();
            presenceUnsub = null;
            presenceOf = null;
          }
        };
      },
    },
    media: opts.media,
    settings: opts.settings,
  };
}

/** The debug hook's `voice` part for `voice` (debug/types.ts VoiceDebug). */
function registerVoiceDebug(voice: VoiceControls): void {
  registerDebug({
    voice: {
      talk: () => voice.state(),
      indicator: () => voice.indicator(),
      tracks: () => voice.tracks(),
    },
  });
}

/** Voice for a networked session (PLAN M3-P3); dispose it with the session. */
export function createSessionVoice(port: VoicePort, opts: VoiceSessionOptions): VoiceControls {
  const voice = createVoice(voiceHost(port, opts));
  registerVoiceDebug(voice);
  return voice;
}

/** Remembers the transport a factory made last (the session's current one). */
export function latestTransport(make: () => Transport): { make: () => Transport; current: () => Transport | null } {
  let last: Transport | null = null;
  return {
    make: () => (last = make()),
    current: () => last,
  };
}

