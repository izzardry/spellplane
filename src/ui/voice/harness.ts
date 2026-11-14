/**
 * Voice module test page (`?harness=voice`, dev and test builds only; PLAN M3-P3 acceptance on Chromium fake media).
 * Mounts the real HUD over a fake four-seat Two-Headed Giant session (you are Anna in s0, teamed with Ben in s1 against
 * Cara and Dan) whose voice is the real controller (voice/mic.ts) on the page's real `navigator.mediaDevices`, with a
 * fake transport of three connections that records the streams added to each. Playwright presses the real talk keys
 * and reads `window.__voiceHarness`. `&watcher=1` adds a fourth connection, Vera, a spectator (M5-P7: spectators hear
 * open talk only, never team talk).
 */
import { mount as mountSvelte } from 'svelte';
import type { SeatId, TableState, TeamId } from '../../core/types';
import type { PeerId } from '../../net/transport';
import type { PeerInfo, PeerPresence } from '../../net/types';
import type { SessionNetStatus } from '../../session/types';
import { paper } from '../../themes/paper/index';
import { registerDebug } from '../../util/debug';
import { createVoiceWith } from '../../voice/mic';
import type { PeerAudioSetting, VoiceControls, VoiceTrackState } from '../../voice/types';
import { FakeCardData, FakeFaces, FakeSession, MemorySettings, RecordingScene, fakeGame, tableWith } from '../fakes';
import Hud from '../Hud.svelte';

/** A stream the fake transport was given: to whom, and the real track's state now. */
export interface SentStream {
  peer: PeerId;
  removed: boolean;
  tracks: { enabled: boolean; readyState: MediaStreamTrackState; kind: string }[];
}

/** The page's harness API (Playwright reads it with page.evaluate). */
export interface VoiceHarness {
  talk(): ReturnType<VoiceControls['state']>;
  indicator(): ReturnType<VoiceControls['indicator']>;
  tracks(): VoiceTrackState[];
  /** Every stream added through the transport, with its real MediaStreamTrack state. */
  sent(): SentStream[];
  /** Give the turn to a seat or a team ('t0' is Anna and Ben's). */
  setActive(active: SeatId | TeamId): void;
  /** Deliver a remote stream from a connection (a silent generated track). */
  remoteStream(from: PeerId): void;
  /** The players' audio settings applied to remote streams, by connection. */
  played(): Record<PeerId, PeerAudioSetting>;
  /** Set another player's presence ring. */
  presenceSpeaking(peerId: string, on: boolean): void;
  speaking(): Record<string, boolean>;
  /** Speaking presence messages this page sent. */
  announced(): boolean[];
  settingsWrites(): { name: string; value: unknown }[];
  setTalk(patch: Parameters<VoiceControls['setTalk']>[0]): Promise<void>;
}

declare global {
  interface Window {
    __voiceHarness?: VoiceHarness;
  }
}

const PLAYERS: PeerInfo[] = [
  { transportId: 't-ben', peerId: 'peer-ben', nickname: 'Ben', seat: 's1', role: 'player', status: 'connected', lastSeq: 0 },
  { transportId: 't-cara', peerId: 'peer-cara', nickname: 'Cara', seat: 's2', role: 'player', status: 'connected', lastSeq: 0 },
  { transportId: 't-dan', peerId: 'peer-dan', nickname: 'Dan', seat: 's3', role: 'player', status: 'connected', lastSeq: 0 },
];
/** A spectator's connection (`&watcher=1`; M5-P7). */
const WATCHER: PeerInfo = { transportId: 't-vera', peerId: 'peer-vera', nickname: 'Vera', seat: null, role: 'spectator', status: 'connected', lastSeq: 0 };
const PEERS: PeerInfo[] = typeof location !== 'undefined' && new URLSearchParams(location.search).get('watcher') === '1' ? [...PLAYERS, WATCHER] : PLAYERS;

/** The fake session with the peers of a four-seat table and a real voice controller. */
class VoiceSession extends FakeSession {
  voiceControls: VoiceControls | null = null;
  get voice(): VoiceControls | undefined {
    return this.voiceControls ?? undefined;
  }
  override netStatus(): SessionNetStatus {
    return { mode: 'net', connection: 'connected', peers: PEERS.map((p) => ({ ...p })), sequencer: null, seq: this.getState().seq };
  }
}

/** Anna's Two-Headed Giant table: teams t0 (s0, s1) and t1 (s2, s3), team t0's turn. */
function twoHeadedGiant(): TableState {
  const { state } = tableWith(['Anna', 'Ben', 'Cara', 'Dan'], []);
  const ids = ['peer-anna', 'peer-ben', 'peer-cara', 'peer-dan'];
  Object.values(state.seats).forEach((s, i) => {
    s.peer = ids[i]!;
    s.team = i < 2 ? 't0' : 't1';
    s.life = 30;
  });
  state.teams = { t0: { id: 't0', seats: ['s0', 's1'], life: 30, counters: {} }, t1: { id: 't1', seats: ['s2', 's3'], life: 30, counters: {} } };
  state.format = '2hg';
  state.stage = 'match';
  state.turn = { ...state.turn, active: 't0' };
  return state;
}

/** A silent audio track (a remote peer's stream). */
function silentStream(): MediaStream {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  return dest.stream;
}

export function mount(target: HTMLElement): void {
  target.textContent = '';
  document.documentElement.style.cssText = 'margin:0;height:100%;overflow:hidden';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#fff';

  const data = new FakeCardData();
  const state = twoHeadedGiant();
  const session = new VoiceSession(state, { seat: 's0', identities: {}, libraryOrder: [], hand: [], audit: [], received: {} }, data, 's0');
  const settings = new MemorySettings({}, null);
  const sent: { peer: PeerId; stream: MediaStream; removed: boolean }[] = [];
  const streamHandlers: ((stream: MediaStream, from: PeerId) => void)[] = [];
  const played: Record<PeerId, PeerAudioSetting> = {};
  const announced: boolean[] = [];
  const presencePeers = new Map<string, PeerPresence>();
  const presenceListeners = new Set<(peers: PeerPresence[]) => void>();

  const voice = createVoiceWith(
    {
      transport: {
        selfId: 't-anna',
        addStream: (stream, to) => {
          if (to) sent.push({ peer: to, stream, removed: false });
        },
        removeStream: (stream, to) => {
          for (const s of sent) if (s.stream === stream && s.peer === to) s.removed = true;
        },
        onStream: (h) => streamHandlers.push(h),
      },
      peers: () => PEERS.map((p) => ({ ...p })),
      onPeers: () => () => undefined,
      state: () => session.getState(),
      seat: () => 's0',
      onState: (l) => session.subscribe(l),
      presence: {
        speaking: (on) => announced.push(on),
      },
      media: navigator.mediaDevices,
      settings,
      play: (peer, _stream, setting) => {
        played[peer] = setting;
        return { set: (s) => (played[peer] = s), stop: () => delete played[peer] };
      },
    },
    {
      presence: {
        peers: () => [...presencePeers.values()],
        subscribe: (l) => {
          presenceListeners.add(l);
          return () => presenceListeners.delete(l);
        },
      },
    },
  );
  session.voiceControls = voice;
  registerDebug({ voice: { talk: () => voice.state(), indicator: () => voice.indicator(), tracks: () => voice.tracks() } });

  const host = document.createElement('div');
  target.appendChild(host);
  // A text field outside the HUD, as a search box would be: the talk key must not fire while it has focus.
  const search = document.createElement('input');
  search.dataset.testid = 'harness-text';
  search.placeholder = 'Search';
  search.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:1000';
  target.appendChild(search);
  mountSvelte(Hud, {
    target: host,
    props: { session, createScene: () => new RecordingScene(), faces: new FakeFaces(data), cardData: data, game: fakeGame(), theme: paper, settings },
  });

  window.__voiceHarness = {
    talk: () => voice.state(),
    indicator: () => voice.indicator(),
    tracks: () => voice.tracks(),
    sent: () =>
      sent.map((s) => ({
        peer: s.peer,
        removed: s.removed,
        tracks: s.stream.getTracks().map((t) => ({ enabled: t.enabled, readyState: t.readyState, kind: t.kind })),
      })),
    setActive: (active) => session.setState({ ...session.getState(), turn: { ...session.getState().turn, active } }),
    remoteStream: (from) => {
      const stream = silentStream();
      for (const h of streamHandlers) h(stream, from);
    },
    played: () => ({ ...played }),
    presenceSpeaking: (peerId, on) => {
      const p = PEERS.find((x) => x.peerId === peerId);
      presencePeers.set(peerId, { peerId, seat: p?.seat ?? null, cursor: null, over: null, drag: [], speaking: on, typing: null, caption: null, at: Date.now() });
      for (const l of presenceListeners) l([...presencePeers.values()]);
    },
    speaking: () => voice.speaking(),
    announced: () => [...announced],
    settingsWrites: () => JSON.parse(JSON.stringify(settings.writes)) as { name: string; value: unknown }[],
    setTalk: (patch) => voice.setTalk(patch),
  };
}
