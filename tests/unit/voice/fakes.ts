/**
 * Fakes for the voice controller's unit tests: media tracks and streams shaped like the browser's, a media-devices stub
 * that counts getUserMedia calls, a recording transport, and a host over a real table (core createTable).
 */
import { createTable } from '../../../src/core/reducer/index';
import type { Format, SeatColourIndex, SeatId, TableState, TeamId } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import type { PeerId } from '../../../src/net/transport';
import type { PeerInfo, PeerPresence, Presence } from '../../../src/net/types';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../../../src/store/types';
import type { PeerAudioSetting, VoiceHost } from '../../../src/voice/types';

let trackIds = 0;

export class FakeTrack {
  readonly id = `track-${++trackIds}`;
  readonly kind = 'audio';
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  readonly clones: FakeTrack[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();
  constructor(readonly deviceId: string | null = null) {}
  clone(): FakeTrack {
    const c = new FakeTrack(this.deviceId);
    c.enabled = this.enabled;
    this.clones.push(c);
    return c;
  }
  stop(): void {
    this.readyState = 'ended';
  }
  addEventListener(type: string, l: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(l);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  /** The browser ends the track (device unplugged). */
  end(): void {
    this.readyState = 'ended';
    for (const l of this.listeners.get('ended') ?? []) l();
  }
}

export class FakeStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

/** Install FakeStream as the global MediaStream (Node has none). */
export function installMediaStream(): void {
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
}

export class FakeMedia {
  readonly calls: MediaStreamConstraints[] = [];
  readonly streams: FakeStream[] = [];
  /** Device ids that are gone (OverconstrainedError). */
  readonly missing = new Set<string>();
  refuse: string | null = null;
  /** When set, getUserMedia waits for this per device id (null: the default device) before it resolves. */
  hold: ((device: string | null) => Promise<void>) | null = null;
  devices: { kind: string; deviceId: string; label: string; groupId: string }[] = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default', groupId: 'g' },
    { kind: 'audioinput', deviceId: 'usb', label: 'USB mic', groupId: 'g2' },
    { kind: 'audiooutput', deviceId: 'spk', label: 'Speakers', groupId: 'g' },
  ];
  getUserMedia = (c?: MediaStreamConstraints): Promise<MediaStream> => {
    this.calls.push(c ?? {});
    if (this.refuse) return Promise.reject(Object.assign(new Error('refused'), { name: this.refuse }));
    const audio = c?.audio;
    const exact = typeof audio === 'object' && audio && typeof audio.deviceId === 'object' && audio.deviceId && 'exact' in audio.deviceId ? String(audio.deviceId.exact) : null;
    if (exact && this.missing.has(exact)) return Promise.reject(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }));
    const s = new FakeStream([new FakeTrack(exact)]);
    this.streams.push(s);
    if (this.hold) return this.hold(exact).then(() => s as unknown as MediaStream);
    return Promise.resolve(s as unknown as MediaStream);
  };
  enumerateDevices = (): Promise<MediaDeviceInfo[]> => Promise.resolve(this.devices as unknown as MediaDeviceInfo[]);
}

export class MemorySettingsStore implements SettingsStore {
  readonly writes: { name: keyof Settings; value: unknown }[] = [];
  values: Settings;
  constructor(initial: Partial<Settings> = {}) {
    this.values = { ...DEFAULT_SETTINGS, ...initial };
  }
  async get<K extends keyof Settings>(name: K): Promise<Settings[K]> {
    return this.values[name];
  }
  async set<K extends keyof Settings>(name: K, value: Settings[K]): Promise<void> {
    this.writes.push({ name, value: structuredClone(value) });
    this.values = { ...this.values, [name]: value };
  }
  async all(): Promise<Settings> {
    return { ...this.values };
  }
}

/** A seat spec for the table: format and who sits where. */
export function table(format: Format, active: SeatId | TeamId = 's0'): TableState {
  const n = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
  const st = createTable({
    game: mtg,
    format,
    seats: Array.from({ length: n }, (_, i) => ({
      name: ['Anna', 'Ben', 'Cara', 'Dan'][i]!,
      colour: i as SeatColourIndex,
      peer: `peer-${i}`,
      ...(format === '2hg' ? { team: i < 2 ? 't0' : 't1' } : {}),
    })),
  });
  return { ...st, stage: 'match', turn: { ...st.turn, active } };
}

export interface Played {
  peer: PeerId;
  stream: FakeStream;
  setting: PeerAudioSetting;
  stopped: boolean;
}

/** A recording VoiceHost over a mutable table and peer list. */
export class FakeHost {
  state: TableState;
  seat: SeatId | null;
  peers: PeerInfo[];
  readonly media = new FakeMedia();
  readonly settings: MemorySettingsStore;
  readonly added: { stream: FakeStream; to: PeerId | undefined }[] = [];
  readonly removed: { stream: FakeStream; to: PeerId | undefined }[] = [];
  readonly announced: boolean[] = [];
  readonly played: Played[] = [];
  presencePeers: PeerPresence[] = [];
  private readonly peerListeners = new Set<(p: PeerInfo[]) => void>();
  private readonly stateListeners = new Set<(s: TableState) => void>();
  private readonly presenceListeners = new Set<(p: PeerPresence[]) => void>();
  private readonly streamHandlers: ((s: MediaStream, from: PeerId) => void)[] = [];

  constructor(opts: { state: TableState; seat?: SeatId | null; peers?: PeerInfo[]; settings?: Partial<Settings> }) {
    this.state = opts.state;
    this.seat = opts.seat === undefined ? 's0' : opts.seat;
    this.peers = opts.peers ?? peersOf(opts.state, this.seat);
    this.settings = new MemorySettingsStore(opts.settings);
  }

  host(withPlayer = true): VoiceHost {
    return {
      transport: {
        selfId: 't-self',
        addStream: (stream, to) => this.added.push({ stream: stream as unknown as FakeStream, to }),
        removeStream: (stream, to) => this.removed.push({ stream: stream as unknown as FakeStream, to }),
        onStream: (h) => this.streamHandlers.push(h),
      },
      peers: () => this.peers.map((p) => ({ ...p })),
      onPeers: (l) => {
        this.peerListeners.add(l);
        return () => this.peerListeners.delete(l);
      },
      state: () => this.state,
      seat: () => this.seat,
      onState: (l) => {
        this.stateListeners.add(l);
        return () => this.stateListeners.delete(l);
      },
      presence: {
        speaking: (on) => this.announced.push(on),
      },
      media: this.media,
      settings: this.settings,
      ...(withPlayer
        ? {
            play: (peer: PeerId, stream: MediaStream, setting: PeerAudioSetting) => {
              const p: Played = { peer, stream: stream as unknown as FakeStream, setting, stopped: false };
              this.played.push(p);
              return { set: (s: PeerAudioSetting) => (p.setting = s), stop: () => (p.stopped = true) };
            },
          }
        : {}),
    };
  }

  /** The other players' speaking presence (voice/mic.ts VoiceInternals.presence). */
  presenceSeam(): Pick<Presence, 'peers' | 'subscribe'> {
    return {
      peers: () => this.presencePeers,
      subscribe: (l) => {
        this.presenceListeners.add(l);
        return () => this.presenceListeners.delete(l);
      },
    };
  }

  setState(state: TableState): void {
    this.state = state;
    for (const l of [...this.stateListeners]) l(state);
  }
  setActive(active: SeatId | TeamId): void {
    this.setState({ ...this.state, turn: { ...this.state.turn, active } });
  }
  setPeers(peers: PeerInfo[]): void {
    this.peers = peers;
    for (const l of [...this.peerListeners]) l(peers);
  }
  stream(from: PeerId): FakeStream {
    const s = new FakeStream([new FakeTrack()]);
    for (const h of this.streamHandlers) h(s as unknown as MediaStream, from);
    return s;
  }
  presence(peerId: string, speaking: boolean): void {
    this.presencePeers = [...this.presencePeers.filter((p) => p.peerId !== peerId), { peerId, seat: null, cursor: null, over: null, drag: [], speaking, typing: null, caption: null, at: 0 }];
    for (const l of [...this.presenceListeners]) l(this.presencePeers);
  }

  /** The stream currently sent to transport `to` (added and not removed). */
  sentTo(to: PeerId): FakeStream | null {
    const live = this.added.filter((a) => a.to === to && !this.removed.some((r) => r.stream === a.stream && r.to === to));
    return live.at(-1)?.stream ?? null;
  }
  /** Whether the track sent to `to` is enabled; null when nothing is sent there. */
  enabledTo(to: PeerId): boolean | null {
    const s = this.sentTo(to);
    return s ? s.getAudioTracks()[0]!.enabled : null;
  }
}

/** Every other seat as a connected peer, transport ids 't<i>'. */
export function peersOf(state: TableState, self: SeatId | null): PeerInfo[] {
  return Object.values(state.seats)
    .filter((s) => s.id !== self)
    .map((s) => ({ transportId: `t${s.index}`, peerId: s.peer ?? '', nickname: s.name, seat: s.id, role: 'player' as const, status: 'connected' as const, lastSeq: 0 }));
}

/** Let pending promises (settings load, getUserMedia) settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
