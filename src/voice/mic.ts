/**
 * Microphone and audio on the mesh (DESIGN "Chat and voice", Live voice: acquired once on joining, gated by enabling and
 * disabling the track, echo cancellation, noise suppression and automatic gain on, speaking ring, per-peer volume and
 * mute; Team channel). Contracts: M3-C (stub); implementer: M3-P3.
 *
 * The microphone is acquired once (`join`, from a click). Every connection gets its own clone of the microphone track in
 * its own stream, added to that connection only, so the gate can enable the audio on some connections and not on
 * others: everyone for talk, the teammate's connection only for team talk (DECISIONS [M3-P3]). Opening and closing the
 * mic only flips `enabled` on those clones, so it is instant. The microphone's own track stays live for the level meter
 * behind the speaking ring.
 *
 * Spectators (PLAN Milestone 5, owner decisions: "Spectators listen"; M5-P7): a listen-only controller
 * (`VoiceHost.listenOnly`) never asks for a microphone and never adds a stream, so nothing a spectator says can leave
 * the page; it plays the players' incoming audio and its indicator is 'listening'. On a player's page a spectator's
 * connection gets its own clone like any other, enabled only for audio to everyone ('all': push-to-talk, turn mic, open
 * mic), never for team talk, so team-only audio never reaches a spectator (DECISIONS [M5-P7]).
 */
import { isSeatActive, teammatesOf } from '../core/teams';
import type { SeatId, TableState } from '../core/types';
import type { PeerId } from '../net/transport';
import type { PeerInfo, Presence, Unsubscribe } from '../net/types';
import { DEFAULT_TALK, type Settings } from '../store/types';
import { sameTalk, talkIndicator, talkState } from './modes';
import {
  MIC_CONSTRAINTS,
  TALK_CLOSED,
  type CreateVoice,
  type PeerAudioSetting,
  type TalkIndicatorState,
  type TalkSettings,
  type TalkState,
  type VoiceControls,
  type VoiceHost,
  type VoiceTrackState,
} from './types';

/** A player's volume and mute for a peer nobody adjusted (DESIGN "Chat and voice", Live voice). */
export const DEFAULT_PEER_AUDIO: PeerAudioSetting = Object.freeze({ volume: 1, muted: false });

/** RMS level (0..1) above which a stream counts as speaking (DECISIONS [M3-P3]). */
export const SPEAKING_LEVEL = 0.02;
/** A speaker stays lit this long after the level fell, so the ring does not flicker between words. */
export const SPEAKING_HOLD_MS = 400;
/** How often the level meters are read. */
export const METER_INTERVAL_MS = 100;

/** Reads a stream's current level (0..1); the browser implementation uses an AnalyserNode. */
export interface LevelMeter {
  level(): number;
  stop(): void;
}

/** Makes level meters; null where Web Audio is missing (then the open gate itself counts as speaking). */
export type MeterFactory = (stream: MediaStream) => LevelMeter | null;

/** Test seams beyond the contract's VoiceHost (DECISIONS [M3-P3]). */
export interface VoiceInternals {
  /** Level meters; default Web Audio when the browser has it (created on `join`, after the click). */
  meter?: MeterFactory | null;
  /** Local clock (ms); default Date.now. */
  now?: () => number;
  /**
   * The other players' speaking presence, so `speaking()` includes their rings. The contract's `VoiceHost.presence` only
   * announces; the session passes the engine's presence here (session/voice.ts).
   */
  presence?: Pick<Presence, 'peers' | 'subscribe'>;
}

/** One connection's outgoing audio: a clone of the microphone track in a stream added to that connection only. */
interface Outgoing {
  peerId: string;
  seat: SeatId | null;
  /** A spectator's connection: open talk only, never team talk. */
  spectator: boolean;
  track: MediaStreamTrack;
  stream: MediaStream;
}

/** One connection's incoming audio. */
interface Incoming {
  stream: MediaStream;
  player: { set(setting: PeerAudioSetting): void; stop(): void; resume?(): void };
  meter: LevelMeter | null;
  peerId: string;
  /** Local time of the last level above SPEAKING_LEVEL. */
  loudAt: number | null;
}

/** Talk settings as stored, repaired field by field (an older or damaged save never breaks the controller). */
export function cleanTalk(raw: unknown): TalkSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof TalkSettings, unknown>>;
  const gate = r.gate === 'turn' || r.gate === 'open' || r.gate === 'ptt' ? r.gate : DEFAULT_TALK.gate;
  let voice = typeof r.voice === 'boolean' ? r.voice : DEFAULT_TALK.voice;
  const dictation = typeof r.dictation === 'boolean' ? r.dictation : DEFAULT_TALK.dictation;
  if (!voice && !dictation) voice = true;
  const muted = typeof r.muted === 'boolean' ? r.muted : false;
  // Left, middle and right stay for the table (select, inspect and pan, menus): only the extra buttons can talk.
  const mouseButton = typeof r.mouseButton === 'number' && Number.isInteger(r.mouseButton) && r.mouseButton >= 3 ? r.mouseButton : null;
  return { gate, voice, dictation, muted, mouseButton };
}

/**
 * The talk settings from a settings record, mapping a pre-M3 `talkMode` once (DECISIONS [M3-C]): a stored mode other
 * than push-to-talk while `talk` still holds the defaults becomes the matching gate ('dictation': push-to-talk with
 * dictation only). Returns whether the mapping happened, so the caller persists it.
 */
export function talkFromSettings(s: Pick<Settings, 'talk' | 'talkMode'>): { talk: TalkSettings; migrated: boolean } {
  const talk = cleanTalk(s.talk);
  const untouched = talk.gate === DEFAULT_TALK.gate && talk.voice === DEFAULT_TALK.voice && talk.dictation === DEFAULT_TALK.dictation && !talk.muted && talk.mouseButton === null;
  if (!untouched || s.talkMode === 'ptt' || !['turn', 'open', 'dictation'].includes(s.talkMode)) return { talk, migrated: false };
  if (s.talkMode === 'dictation') return { talk: { ...talk, gate: 'ptt', voice: false, dictation: true }, migrated: true };
  return { talk: { ...talk, gate: s.talkMode }, migrated: true };
}

function cleanPeerAudio(raw: unknown): PeerAudioSetting {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof PeerAudioSetting, unknown>>;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : 1;
  return { volume, muted: r.muted === true };
}

/** The parts of an audio element the player uses (HTMLAudioElement in the browser). */
export interface PlayableElement {
  volume: number;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** Where user gestures are heard (the window in the browser). */
export type GestureTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Gestures that grant user activation, so a refused `play()` may be retried from them. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * Plays through `el` at the player's volume. Autoplay may be refused until the page saw a gesture (Safari): a refused
 * `play()` is retried on the next pointer, key or touch gesture anywhere on the page, so a player who never joins voice
 * (dictation only, or voice off) still hears the table (DECISIONS [M3-P3]). `join` (a click) resumes as well.
 */
export function elementPlayer(el: PlayableElement, setting: PeerAudioSetting, gestures: GestureTarget | null): Incoming['player'] {
  let stopped = false;
  let waiting = false;
  const apply = (s: PeerAudioSetting): void => {
    el.volume = s.volume;
    el.muted = s.muted;
  };
  const unhook = (): void => {
    if (!waiting || !gestures) return;
    waiting = false;
    for (const g of GESTURES) gestures.removeEventListener(g, onGesture, { capture: true });
  };
  const hook = (): void => {
    if (waiting || stopped || !gestures) return;
    waiting = true;
    for (const g of GESTURES) gestures.addEventListener(g, onGesture, { capture: true });
  };
  const resume = (): void => {
    if (stopped) return;
    let played: Promise<void>;
    try {
      played = Promise.resolve(el.play());
    } catch {
      played = Promise.reject(new Error('play refused'));
    }
    played.then(unhook, hook);
  };
  function onGesture(): void {
    unhook();
    resume();
  }
  apply(setting);
  resume();
  return {
    set: apply,
    resume,
    stop: () => {
      stopped = true;
      unhook();
      el.pause();
    },
  };
}

/** Plays a remote stream through an audio element (the default `VoiceHost.play`). */
function audioElementPlayer(stream: MediaStream, setting: PeerAudioSetting): Incoming['player'] {
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  const player = elementPlayer(el, setting, typeof window === 'undefined' ? null : window);
  return {
    ...player,
    stop: () => {
      player.stop();
      el.srcObject = null;
    },
  };
}

/** Web Audio level meters sharing one AudioContext (created on the join click, so it may start). */
function webAudioMeters(): { make: MeterFactory; close(): void } | null {
  const Ctx = typeof AudioContext === 'function' ? AudioContext : null;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  void ctx.resume().catch(() => undefined);
  return {
    make: (stream) => {
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        return {
          level: () => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += v * v;
            return Math.sqrt(sum / buf.length);
          },
          stop: () => {
            source.disconnect();
            analyser.disconnect();
          },
        };
      } catch {
        return null;
      }
    },
    close: () => void ctx.close().catch(() => undefined),
  };
}

/** The voice controller (voice/types.ts VoiceControls). */
class Voice implements VoiceControls {
  private settings: TalkSettings = DEFAULT_TALK;
  private chosenDevice: string | null = null;
  private peerSettings: Record<string, PeerAudioSetting> = {};
  private readonly loaded: Promise<void>;
  private isLoaded = false;

  private source: MediaStreamTrack | null = null;
  private micStream: MediaStream | null = null;
  private joining: Promise<void> | null = null;
  private readonly out = new Map<PeerId, Outgoing>();
  private readonly inc = new Map<PeerId, Incoming>();
  /** Transport ids the engine listed at some point (an incoming stream of one that left is dropped). */
  private readonly listed = new Set<PeerId>();

  private keyHeld = false;
  private teamKey = false;
  private textFocus = false;
  private noteFocus = false;
  private windowFocus = true;
  private current: TalkState = TALK_CLOSED;

  private meters: { make: MeterFactory; close(): void } | null = null;
  private ownMeter: LevelMeter | null = null;
  private ownLoudAt: number | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  /** What the speaking presence last said. */
  private announced = false;
  private lastSpeaking = '';

  private readonly listeners = new Set<(state: TalkState) => void>();
  private readonly unsubs: Unsubscribe[] = [];
  private disposed = false;
  /** A spectator's listen-only session: no microphone, no outgoing audio, keys ignored. */
  private readonly listenOnly: boolean;

  constructor(
    private readonly host: VoiceHost,
    private readonly internals: VoiceInternals,
  ) {
    this.listenOnly = host.listenOnly === true;
    this.loaded = this.load().finally(() => {
      this.isLoaded = true;
    });
    this.unsubs.push(
      host.onPeers(() => this.sync()),
      host.onState(() => this.sync()),
    );
    const presenceChanged = internals.presence?.subscribe(() => this.speakingChanged());
    if (presenceChanged) this.unsubs.push(presenceChanged);
    host.transport.onStream?.((stream, from) => this.incoming(stream, from));
    this.sync();
  }

  private now(): number {
    return (this.internals.now ?? Date.now)();
  }

  private async load(): Promise<void> {
    let all: Settings;
    try {
      all = await this.host.settings.all();
    } catch {
      return;
    }
    if (this.disposed) return;
    const { talk, migrated } = talkFromSettings(all);
    this.settings = talk;
    this.chosenDevice = typeof all.micDevice === 'string' && all.micDevice ? all.micDevice : null;
    const peers: Record<string, PeerAudioSetting> = {};
    if (typeof all.peerAudio === 'object' && all.peerAudio !== null) for (const [k, v] of Object.entries(all.peerAudio)) peers[k] = cleanPeerAudio(v);
    // A change made before the load finished wins over the stored value.
    this.peerSettings = { ...peers, ...this.peerSettings };
    if (migrated) {
      await this.host.settings.set('talk', talk).catch(() => undefined);
      await this.host.settings.set('talkMode', 'ptt').catch(() => undefined);
    }
    for (const [t, i] of this.inc) i.player.set(this.peerAudioOf(i.peerId || this.peerIdOf(t)));
    this.recompute();
    this.emit();
  }

  // --- Joining and the device ---------------------------------------------------------------------------------------

  get joined(): boolean {
    return this.source !== null;
  }

  join(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Voice is closed'));
    if (this.listenOnly) {
      // A spectator's "join" only lets the players' audio start (the click satisfies autoplay rules); no microphone.
      for (const i of this.inc.values()) i.player.resume?.();
      return Promise.resolve();
    }
    if (this.source) {
      for (const i of this.inc.values()) i.player.resume?.();
      return Promise.resolve();
    }
    if (this.joining) return this.joining;
    const p = this.acquireFirst().finally(() => {
      if (this.joining === p) this.joining = null;
    });
    this.joining = p;
    return p;
  }

  private async acquireFirst(): Promise<void> {
    await this.loaded;
    const stream = await this.acquire(this.chosenDevice);
    if (this.disposed) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('Voice is closed');
    }
    // One AudioContext for the table, made on the first join (a click, so it may start); a rejoin after the
    // microphone went away reuses it.
    if (this.internals.meter === undefined && !this.meters) this.meters = webAudioMeters();
    this.use(stream);
    for (const i of this.inc.values()) {
      i.player.resume?.();
      if (!i.meter) i.meter = this.makeMeter(i.stream);
    }
    this.startMeters();
    this.sync();
  }

  /** getUserMedia with MIC_CONSTRAINTS and the chosen device; a device that is gone falls back to the default one. */
  private async acquire(device: string | null): Promise<MediaStream> {
    const ask = (id: string | null) => this.host.media.getUserMedia({ audio: id ? { ...MIC_CONSTRAINTS, deviceId: { exact: id } } : { ...MIC_CONSTRAINTS }, video: false });
    if (!device) return ask(null);
    try {
      return await ask(device);
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name === 'OverconstrainedError' || name === 'NotFoundError') return ask(null);
      throw e;
    }
  }

  /** Make `stream` the microphone: every connection gets a fresh clone of its track. */
  private use(stream: MediaStream): void {
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('The microphone gave no audio track');
    }
    const oldStream = this.micStream;
    this.dropOutgoing();
    this.ownMeter?.stop();
    this.source?.removeEventListener?.('ended', this.onEnded);
    if (oldStream) for (const t of oldStream.getTracks()) t.stop();
    this.micStream = stream;
    this.source = track;
    track.addEventListener?.('ended', this.onEnded);
    this.ownMeter = this.makeMeter(stream);
  }

  /** The microphone went away (unplugged, permission revoked): the mic is not ready until the player joins again. */
  private readonly onEnded = (): void => {
    if (this.disposed || !this.source || this.source.readyState !== 'ended') return;
    this.dropOutgoing();
    this.ownMeter?.stop();
    this.ownMeter = null;
    this.source = null;
    this.micStream = null;
    this.recompute();
    // The talk state may not change (the gate was closed), but joined did: the indicator offers "Join voice" again.
    this.emit();
  };

  async devices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await this.host.media.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  device(): string | null {
    return this.chosenDevice;
  }

  async setDevice(deviceId: string | null): Promise<void> {
    if (this.listenOnly) return;
    await this.loaded;
    const id = deviceId || null;
    this.chosenDevice = id;
    await this.host.settings.set('micDevice', id).catch(() => undefined);
    if (!this.source || this.disposed) return;
    const stream = await this.acquire(id);
    // A later pick (or a lost microphone) overtook this one while it was asked for: the newer choice wins.
    if (this.disposed || this.chosenDevice !== id || !this.source) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.use(stream);
    this.sync();
  }

  // --- Talk settings and inputs ---------------------------------------------------------------------------------------

  talk(): TalkSettings {
    return { ...this.settings };
  }

  async setTalk(patch: Partial<TalkSettings>): Promise<void> {
    // Applied at once when the settings are loaded, so two quick toggles never read the same old value.
    if (!this.isLoaded) await this.loaded;
    if (this.disposed) return;
    const merged = { ...this.settings, ...patch };
    // At least one of voice and dictation stays on: a patch turning off the last one is not applied to that field.
    if (merged.voice !== true && merged.dictation !== true) {
      if (patch.voice !== undefined) merged.voice = this.settings.voice;
      if (patch.dictation !== undefined) merged.dictation = this.settings.dictation;
    }
    const next = cleanTalk(merged);
    this.settings = next;
    this.recompute();
    // The settings changed even when the talk state did not (a gate change while closed): the controls redraw.
    this.emit();
    await this.host.settings.set('talk', next).catch(() => undefined);
  }

  keyDown(team: boolean): void {
    // A spectator never talks.
    if (this.listenOnly) return;
    // The talk key is ignored while a text field (not a note field) has focus, and while the window has none.
    if (this.textFocus || !this.windowFocus) return;
    this.keyHeld = true;
    this.teamKey = team;
    this.recompute();
  }

  keyUp(): void {
    if (!this.keyHeld) return;
    this.keyHeld = false;
    this.teamKey = false;
    this.recompute();
  }

  focus(change: { window?: boolean; text?: boolean; note?: boolean }): void {
    if (change.window !== undefined) {
      this.windowFocus = change.window;
      // Window blur releases the key: it does not come back on focus until it is pressed again.
      if (!change.window) {
        this.keyHeld = false;
        this.teamKey = false;
      }
    }
    if (change.text !== undefined) {
      this.textFocus = change.text;
      if (change.text) {
        this.keyHeld = false;
        this.teamKey = false;
      }
    }
    if (change.note !== undefined) this.noteFocus = change.note;
    this.recompute();
  }

  toggleMute(): void {
    if (this.isLoaded) void this.setTalk({ muted: !this.settings.muted });
    else void this.loaded.then(() => this.setTalk({ muted: !this.settings.muted }));
  }

  state(): TalkState {
    return { ...this.current };
  }

  indicator(): TalkIndicatorState {
    if (this.listenOnly) return 'listening';
    return talkIndicator(this.current, this.joined);
  }

  subscribe(listener: (state: TalkState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Per-peer audio -------------------------------------------------------------------------------------------------

  peerAudio(peerId: string): PeerAudioSetting {
    return this.peerAudioOf(peerId);
  }

  private peerAudioOf(peerId: string): PeerAudioSetting {
    return { ...(this.peerSettings[peerId] ?? DEFAULT_PEER_AUDIO) };
  }

  async setPeerAudio(peerId: string, setting: PeerAudioSetting): Promise<void> {
    if (!peerId) return;
    const clean = cleanPeerAudio(setting);
    this.peerSettings = { ...this.peerSettings, [peerId]: clean };
    for (const [t, i] of this.inc) if ((i.peerId || this.peerIdOf(t)) === peerId) i.player.set(clean);
    this.emit();
    await this.loaded;
    await this.host.settings.set('peerAudio', { ...this.peerSettings }).catch(() => undefined);
  }

  // --- Speaking -------------------------------------------------------------------------------------------------------

  speaking(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const p of this.internals.presence?.peers() ?? []) if (p.speaking && p.peerId) out[p.peerId] = true;
    const now = this.now();
    for (const [t, i] of this.inc) {
      const id = i.peerId || this.peerIdOf(t);
      if (id && i.loudAt !== null && now - i.loudAt <= SPEAKING_HOLD_MS) out[id] = true;
    }
    const me = this.ownPeerId();
    if (me && this.ownSpeaking()) out[me] = true;
    return out;
  }

  /**
   * Own speaking: audio open (to everyone or the teammate) while the talk key is held (holding it is the intent to
   * speak), or, for the turn mic and the open mic, where a meter runs, a level above the threshold (DECISIONS [M3-P3]).
   */
  private ownSpeaking(): boolean {
    if (this.current.audio === 'off') return false;
    if (!this.ownMeter || this.current.reason === 'key') return true;
    return this.ownLoudAt !== null && this.now() - this.ownLoudAt <= SPEAKING_HOLD_MS;
  }

  private ownPeerId(): string | null {
    const seat = this.host.seat();
    return seat ? (this.host.state().seats[seat]?.peer ?? null) : null;
  }

  private makeMeter(stream: MediaStream): LevelMeter | null {
    const make = this.internals.meter !== undefined ? this.internals.meter : (this.meters?.make ?? null);
    return make ? make(stream) : null;
  }

  private startMeters(): void {
    if (this.meterTimer || (!this.ownMeter && ![...this.inc.values()].some((i) => i.meter))) return;
    this.meterTimer = setInterval(() => this.readMeters(), METER_INTERVAL_MS);
  }

  /** Read the level meters; a change of who speaks updates the presence ring and the listeners. */
  readMeters(): void {
    const now = this.now();
    if (this.ownMeter && this.ownMeter.level() > SPEAKING_LEVEL) this.ownLoudAt = now;
    for (const i of this.inc.values()) if (i.meter && i.meter.level() > SPEAKING_LEVEL) i.loudAt = now;
    this.announce();
    this.speakingChanged();
  }

  /** Tell the listeners when the set of speakers changed. */
  private speakingChanged(): void {
    if (this.disposed) return;
    const key = JSON.stringify(Object.keys(this.speaking()).sort());
    if (key === this.lastSpeaking) return;
    this.lastSpeaking = key;
    this.emit();
  }

  /**
   * The speaking presence goes to every peer, so it is sent only for audio to everyone; team talk lights the ring on
   * the teammate's side from the incoming audio (DECISIONS [M3-C]).
   */
  private announce(): void {
    const on = !this.listenOnly && this.current.audio === 'all' && this.ownSpeaking();
    if (on === this.announced) return;
    this.announced = on;
    this.host.presence.speaking(on);
  }

  // --- Connections ----------------------------------------------------------------------------------------------------

  private peerIdOf(transportId: PeerId): string {
    return this.host.peers().find((p) => p.transportId === transportId)?.peerId ?? '';
  }

  /** The seat behind a peer: the chair its identity holds in the shared state, else what its hello said. */
  private seatOf(p: PeerInfo, state: TableState): SeatId | null {
    if (p.peerId) for (const [id, s] of Object.entries(state.seats)) if (s.peer === p.peerId) return id;
    return p.seat;
  }

  private incoming(stream: MediaStream, from: PeerId): void {
    if (this.disposed) return;
    const prior = this.inc.get(from);
    if (prior?.stream === stream) return;
    if (prior) this.stopIncoming(from);
    const peerId = this.peerIdOf(from);
    const setting = this.peerAudioOf(peerId);
    const player = this.host.play ? this.host.play(from, stream, setting) : audioElementPlayer(stream, setting);
    this.inc.set(from, { stream, player, peerId, meter: this.source ? this.makeMeter(stream) : null, loudAt: null });
    if (this.source) this.startMeters();
    this.emit();
  }

  private stopIncoming(t: PeerId): void {
    const i = this.inc.get(t);
    if (!i) return;
    this.inc.delete(t);
    i.player.stop();
    i.meter?.stop();
  }

  /** Follow the engine's peers and the table: connections get or lose their stream, and the gate is applied again. */
  private sync(): void {
    if (this.disposed) return;
    const state = this.host.state();
    const peers = this.host.peers();
    const now = new Map(peers.map((p) => [p.transportId, p] as const));
    for (const p of peers) this.listed.add(p.transportId);
    // Incoming audio of a connection the engine dropped stops; its identity is filled in once its hello arrived.
    for (const [t, i] of [...this.inc]) {
      const p = now.get(t);
      if (!p && this.listed.has(t)) this.stopIncoming(t);
      else if (p && p.peerId && p.peerId !== i.peerId) {
        i.peerId = p.peerId;
        i.player.set(this.peerAudioOf(p.peerId));
      }
    }
    for (const [t, o] of [...this.out]) {
      const p = now.get(t);
      if (!p || !p.peerId) this.removeOutgoing(t);
      else {
        o.peerId = p.peerId;
        o.seat = this.seatOf(p, state);
        o.spectator = p.role === 'spectator';
      }
    }
    if (this.source && !this.listenOnly) {
      for (const p of peers) {
        // Audio goes to verified peers only (their hello carried the identity).
        if (!p.peerId || p.status === 'handshake' || this.out.has(p.transportId)) continue;
        this.addOutgoing(p, state);
      }
    }
    this.recompute();
  }

  private addOutgoing(p: PeerInfo, state: TableState): void {
    const source = this.source;
    if (!source || this.listenOnly) return;
    const track = source.clone();
    track.enabled = false;
    const stream = new MediaStream([track]);
    this.out.set(p.transportId, { peerId: p.peerId, seat: this.seatOf(p, state), spectator: p.role === 'spectator', track, stream });
    try {
      this.host.transport.addStream?.(stream, p.transportId);
    } catch {
      // A connection that just closed: the engine drops the peer and the entry goes with it.
    }
  }

  private removeOutgoing(t: PeerId): void {
    const o = this.out.get(t);
    if (!o) return;
    this.out.delete(t);
    o.track.enabled = false;
    o.track.stop();
    try {
      this.host.transport.removeStream?.(o.stream, t);
    } catch {
      // The connection is gone already (or belongs to a transport the session replaced).
    }
  }

  private dropOutgoing(): void {
    for (const t of [...this.out.keys()]) this.removeOutgoing(t);
  }

  // --- The gate -------------------------------------------------------------------------------------------------------

  private recompute(): void {
    if (this.disposed) return;
    const state = this.host.state();
    const seat = this.host.seat();
    const own = seat !== null && state.seats[seat] !== undefined;
    const mates = own ? teammatesOf(state, seat) : [];
    // Turns exist in the match only: the lobby, the draft and deck building have no own turn (DECISIONS [M3-P3]).
    const inMatch = state.stage === 'match';
    // A spectator's controller stays closed whatever its settings say.
    const next = this.listenOnly ? TALK_CLOSED : talkState({
      settings: this.settings,
      keyHeld: this.keyHeld,
      teamKey: this.teamKey,
      ownTurn: own && inMatch && isSeatActive(state, seat),
      hasTeammate: mates.length > 0,
      textFocus: this.textFocus,
      noteFocus: this.noteFocus,
      windowFocus: this.windowFocus,
      micReady: this.joined,
    });
    for (const o of this.out.values()) {
      // Team talk reaches the teammate's connection only: never another player's, never a spectator's.
      const on = next.audio === 'all' || (next.audio === 'team' && !o.spectator && o.seat !== null && mates.includes(o.seat));
      if (o.track.enabled !== on) o.track.enabled = on;
    }
    const changed = !sameTalk(next, this.current);
    this.current = next;
    this.announce();
    if (changed) {
      this.lastSpeaking = JSON.stringify(Object.keys(this.speaking()).sort());
      this.emit();
    } else this.speakingChanged();
  }

  private emit(): void {
    const s = this.state();
    for (const l of [...this.listeners]) l(s);
  }

  tracks(): VoiceTrackState[] {
    return [...this.out].map(([peer, o]) => ({ peer, peerId: o.peerId, seat: o.seat, enabled: o.track.enabled }));
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.announced) this.host.presence.speaking(false);
    this.announced = false;
    this.dropOutgoing();
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) u();
    for (const t of [...this.inc.keys()]) this.stopIncoming(t);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.ownMeter?.stop();
    this.ownMeter = null;
    this.source?.removeEventListener?.('ended', this.onEnded);
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = null;
    this.source = null;
    this.meters?.close();
    this.meters = null;
    this.current = TALK_CLOSED;
    this.listeners.clear();
  }
}

/** Create the voice controller (voice/types.ts VoiceControls). `internals` are seams beyond the contract (presence, level meters, clock). */
export function createVoiceWith(host: VoiceHost, internals: VoiceInternals = {}): VoiceControls & { readMeters(): void; device(): string | null } {
  return new Voice(host, internals);
}

/** The chosen microphone (settings key 'micDevice') of a controller made here, null for the default (the device picker). */
export function chosenDevice(voice: VoiceControls): string | null {
  return voice instanceof Voice ? voice.device() : null;
}

/** Create the voice controller (voice/types.ts VoiceControls). Implementer: M3-P3. */
export const createVoice: CreateVoice = (host) => new Voice(host, {});
