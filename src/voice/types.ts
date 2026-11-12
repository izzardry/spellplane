/**
 * Voice, dictation and captions (DESIGN "Chat and voice": Talk modes, Live voice, Team channel, Dictation and captions;
 * "Specification: code interfaces": SpeechEngine; "Specification: geometry, layout and motion", Screen layer: captions
 * at most 280 px wide and three lines). Contracts: M3-C.
 * Implementers: M3-P3 (voice/mic.ts, voice/modes.ts, ui/voice/*: microphone, audio tracks on the mesh, talk modes,
 * team talk, speaking indicator, per-peer volume and mute, device picker), M3-P4 (voice/speech/*, voice/captions.ts,
 * scene/captions.ts, ui/settings/Speech.svelte: speech engines, captions, dictation into note fields).
 *
 * voice/ may import core/, net/, store/ and util/ (eslint.config.js); the session wires it to a table.
 */
import type { Anchor, InstanceId, LogEntry, SeatId, StackItemId, TableState } from '../core/types';
import type { SpectatorId } from '../core/teams';
import type { PeerId, Transport } from '../net/transport';
import type { PeerInfo, Presence, Unsubscribe } from '../net/types';
import type { PeerAudioSetting, SettingsStore, TalkSettings } from '../store/types';

export type { PeerAudioSetting, TalkSettings };

// ---------------------------------------------------------------------------------------------------------------------
// Talk modes (DESIGN "Chat and voice", Talk modes; Team channel). M3-P3.
// ---------------------------------------------------------------------------------------------------------------------

/** When the mic opens (DESIGN "Chat and voice", Talk modes): push-to-talk, turn mic (push-to-talk outside the own turn), open mic. */
export type TalkGate = TalkSettings['gate'];

/**
 * Everything the talk state depends on, at one moment (DESIGN "Chat and voice": "The talk key is released on window
 * blur and ignored while a text field has focus"; "Holding the talk key while a card note or stack note field is
 * focused dictates into that field"; Team channel: "Shift plus the talk key sends audio only to the teammate").
 */
export interface TalkInputs {
  settings: TalkSettings;
  /** The talk key (or talk mouse button) is held; the controller clears it on blur. */
  keyHeld: boolean;
  /** Shift was down when the talk key went down (team talk). */
  teamKey: boolean;
  /** It is this seat's turn, or its team's (core/teams.ts isSeatActive). */
  ownTurn: boolean;
  /** The seat has a teammate (Two-Headed Giant); team talk needs one. */
  hasTeammate: boolean;
  /** A text field (chat, search) has focus: the talk key is ignored. */
  textFocus: boolean;
  /** A card note or stack note field has focus: the held talk key dictates into it instead of a caption. */
  noteFocus: boolean;
  /** The browser window has focus; on blur every held key counts as released. */
  windowFocus: boolean;
  /** The microphone was acquired on joining (a click); before that no audio opens (dictation does not need it: the engine listens itself). */
  micReady: boolean;
}

/**
 * What the mic does now (DESIGN "Chat and voice", Talk modes): `audio` 'all' enables the local track on every
 * connection, 'team' on the teammate's connection only, 'off' on none; `dictation` 'caption' transcribes into a
 * caption and a log entry, 'field' into the focused note field, 'off' not at all; `reason` names what opened it.
 */
export interface TalkState {
  audio: 'off' | 'all' | 'team';
  dictation: 'off' | 'caption' | 'field';
  reason: 'key' | 'turn' | 'open' | null;
  muted: boolean;
}

/** The closed talk state (DESIGN "Chat and voice", Live voice: the mic is gated by enabling and disabling the track). */
export const TALK_CLOSED: TalkState = { audio: 'off', dictation: 'off', reason: null, muted: false };

/**
 * The talk-mode indicator (PLAN M3-G screenshot set: "talk-mode indicator states"; DESIGN "Chat and voice", Talk modes):
 * 'noMic' before the mic is acquired, 'muted', 'idle' (gate closed), 'live' (audio to all), 'team' (audio to the
 * teammate), 'dictating' (captions only, no audio).
 */
export type TalkIndicatorState = 'noMic' | 'muted' | 'idle' | 'live' | 'team' | 'dictating';

/** Pure talk-state rule (voice/modes.ts `talkState`; DESIGN "Chat and voice", Talk modes). Implementer: M3-P3. */
export type TalkStateFn = (inputs: TalkInputs) => TalkState;

// ---------------------------------------------------------------------------------------------------------------------
// Live voice on the mesh (DESIGN "Chat and voice", Live voice; "Multiplayer architecture": audio tracks on the same
// peer connections). M3-P3.
// ---------------------------------------------------------------------------------------------------------------------

/** The part of `navigator.mediaDevices` voice uses; tests inject Chromium's fake media or a stub (DESIGN "Chat and voice", Live voice). */
export type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;

/**
 * Audio constraints the mic is acquired with (DESIGN "Chat and voice", Live voice: "Echo cancellation, noise
 * suppression and automatic gain stay on"; Opus at speech bitrates is the browser's WebRTC default).
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** One connection's outgoing audio as the gate set it (DESIGN "Chat and voice", Live voice and Team channel; debug hook and PLAN M3-P3 tests: "team talk enables the track only on the teammate's connection"). */
export interface VoiceTrackState {
  /** Transport id of the connection. */
  peer: PeerId;
  /** Identity peer id behind it, '' before its hello. */
  peerId: string;
  seat: SeatId | null;
  /** The local track sent on this connection is enabled. */
  enabled: boolean;
}

/**
 * What voice needs from the table (DESIGN "Chat and voice", Live voice). The session builds it from its NetEngine and
 * transport; the solo table has no voice. Added by M3-C; built by M3-P3's session wiring.
 */
export interface VoiceHost {
  /** Media on the peer connections; `addStream`/`removeStream`/`onStream` are absent on transports without media (BroadcastChannel). */
  transport: Pick<Transport, 'selfId' | 'addStream' | 'removeStream' | 'onStream'>;
  /** The engine's peers (transport id, identity peer id, seat, role). */
  peers(): PeerInfo[];
  onPeers(listener: (peers: PeerInfo[]) => void): Unsubscribe;
  /** The shared state (turn, teams) and this browser's seat; null for a spectator. */
  state(): TableState;
  seat(): SeatId | null;
  onState(listener: (state: TableState) => void): Unsubscribe;
  /**
   * Announces the speaking ring on `pres` (never during team talk; DECISIONS [M3-C]). `peers` and `subscribe` (added by
   * M3-P3, optional) let `VoiceControls.speaking` include the other players' presence rings.
   */
  presence: Pick<Presence, 'speaking'> & Partial<Pick<Presence, 'peers' | 'subscribe'>>;
  media: MediaDevicesLike;
  settings: SettingsStore;
  /** Plays a remote peer's audio at the player's volume; injectable so unit tests need no audio output. */
  play?(peer: PeerId, stream: MediaStream, setting: PeerAudioSetting): { set(setting: PeerAudioSetting): void; stop(): void };
}

/**
 * The player's voice controls (DESIGN "Chat and voice": Talk modes, Live voice, Team channel). The HUD feeds key and
 * focus events in; the controller gates the local track per connection. Added by M3-C; implementer: M3-P3 (voice/mic.ts,
 * voice/modes.ts).
 */
export interface VoiceControls {
  /** Acquire the microphone once (call from the join click, which also satisfies autoplay rules) with MIC_CONSTRAINTS and the chosen device. */
  join(): Promise<void>;
  /** Whether the mic was acquired. */
  readonly joined: boolean;
  talk(): TalkSettings;
  /** Change and persist the talk mode (settings key 'talk'). */
  setTalk(patch: Partial<TalkSettings>): Promise<void>;
  /** Talk key or talk mouse button down; `team` when Shift was held. Ignored while a text field (not a note field) has focus. */
  keyDown(team: boolean): void;
  keyUp(): void;
  /** Focus changes the gate depends on: window blur releases the key; text and note field focus. */
  focus(change: { window?: boolean; text?: boolean; note?: boolean }): void;
  /** The open-mic mute toggle (M). */
  toggleMute(): void;
  state(): TalkState;
  indicator(): TalkIndicatorState;
  subscribe(listener: (state: TalkState) => void): Unsubscribe;
  /** Audio input devices for the device picker (PLAN M3-P3), and the chosen one (null: default). */
  devices(): Promise<MediaDeviceInfo[]>;
  setDevice(deviceId: string | null): Promise<void>;
  /** The chosen device id (settings key 'micDevice'), null for the default. Added by M3-P3 (optional) for the picker. */
  device?(): string | null;
  /** Personal volume and mute per other player by identity peer id (DESIGN "Chat and voice", Live voice). */
  peerAudio(peerId: string): PeerAudioSetting;
  setPeerAudio(peerId: string, setting: PeerAudioSetting): Promise<void>;
  /** Who is speaking now by identity peer id: presence rings plus the teammate's team talk detected from its audio. */
  speaking(): Record<string, boolean>;
  /** Outgoing track state per connection (debug hook). */
  tracks(): VoiceTrackState[];
  /** Release the mic and remove the streams. */
  dispose(): void;
}

/** Create the voice controller (DESIGN "Chat and voice"). Added by M3-C; implementer: M3-P3 (voice/mic.ts). */
export type CreateVoice = (host: VoiceHost) => VoiceControls;

// ---------------------------------------------------------------------------------------------------------------------
// Speech engines (DESIGN "Specification: code interfaces", SpeechEngine; "Chat and voice", Dictation and captions:
// Engine, Language). M3-P4.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A speech engine id (DESIGN "Specification: code interfaces": `'webspeech' | 'local'`, plus the test harness's
 * 'fake' engine, `?speech=fake`, src/voice/fake.ts).
 */
export type SpeechEngineId = 'webspeech' | 'local' | 'fake';

/** Receives transcripts: interim text (final = false) grows, then one final text per utterance (DESIGN "Chat and voice", Placement). */
export type SpeechListener = (text: string, final: boolean) => void;

/**
 * A speech-to-text engine running in the speaker's browser (DESIGN "Specification: code interfaces", SpeechEngine).
 * `start` begins listening in language `lang` (BCP 47) and reports transcripts until `stop`. The fake engine
 * (voice/fake.ts FakeSpeechEngine) satisfies it.
 */
export interface SpeechEngine {
  readonly id: SpeechEngineId;
  /** Whether the engine can run in this browser (Web Speech is missing in Firefox; the local model needs WebGPU or WASM). */
  available(): Promise<boolean>;
  start(lang: string, on: SpeechListener): void;
  stop(): void;
}

/**
 * The in-browser Whisper-class model engine (DESIGN "Chat and voice", Engine: "download an in-browser Whisper-class model
 * through transformers.js, which runs on WebGPU, keeps audio on the device"). `load` downloads the model on demand;
 * nothing is fetched before the player chooses this engine (PLAN M3-P4: "the local-model engine is not downloaded unless
 * chosen"). Implementer: M3-P4 (voice/speech/local.ts, loaded by dynamic import only).
 */
export interface LocalSpeechEngine extends SpeechEngine {
  readonly id: 'local';
  /** Download and initialise the model; reports bytes loaded of the total (total 0 while unknown). */
  load(onProgress?: (loaded: number, total: number) => void): Promise<void>;
  readonly loaded: boolean;
}

/**
 * What the settings panel states about an engine (DESIGN "Chat and voice", Engine: "The settings panel states which
 * engine is active and where audio goes"). `audio` 'vendor': processed by the browser vendor's service; 'device': stays
 * on this device; 'none': no audio is captured (the fake engine).
 */
export interface SpeechEngineInfo {
  id: SpeechEngineId;
  label: string;
  audio: 'vendor' | 'device' | 'none';
  /** The plain statement shown in the settings, e.g. "Audio is sent to your browser's vendor for recognition." */
  statement: string;
  /** Approximate download size in bytes before first use (the local model), else absent. */
  downloadBytes?: number;
}

/**
 * Creates an engine lazily, so the local model's code and weights load only when chosen (DESIGN "Chat and voice",
 * Engine). Implementer: M3-P4 (voice/speech/index.ts SPEECH_ENGINES).
 */
export interface SpeechEngineFactory {
  readonly info: SpeechEngineInfo;
  create(): Promise<SpeechEngine>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Captions (DESIGN "Chat and voice", Dictation and captions: Placement, Record, Notes by voice). M3-P4.
// ---------------------------------------------------------------------------------------------------------------------

/** Caption bubble limits (DESIGN "Specification: geometry, layout and motion", Screen layer: "at most 280 px wide and three lines"). */
export const CAPTION_MAX_WIDTH_PX = 280;
/** Caption bubble line limit (DESIGN "Specification: geometry, layout and motion", Screen layer). */
export const CAPTION_MAX_LINES = 3;
/** How long a final caption stays before it fades (DESIGN "Chat and voice", Placement: "fades a few seconds after the final result"; DECISIONS [M3-C]). */
export const CAPTION_LINGER_MS = 4000;

/**
 * A caption being shown (DESIGN "Chat and voice", Placement): interim text from the `captionInterim` presence message or
 * the speaker's own engine, then the final text of the `caption` action. `anchor` is the card or stack item the speaker
 * last acted on or is hovering; null places it beside the speaker's avatar. Local view data, never shared as is.
 */
export interface Caption {
  /** Stable while the utterance grows: '<speaker>:<n>'. */
  id: string;
  /** The speaking seat (a spectator's id when a spectator dictates). */
  speaker: SeatId | SpectatorId;
  text: string;
  final: boolean;
  anchor: Anchor | null;
  /** The cid of the action the final caption is attached to (CaptionAction.about), if any. */
  about?: string;
  /** Local clock (ms) of the last change; a final caption fades CAPTION_LINGER_MS after it. */
  at: number;
}

/**
 * Where dictation goes while a note field has focus (DESIGN "Chat and voice", Notes by voice: "Holding the talk key
 * while a card note or stack note field is focused dictates into that field"). `field` inserts into any other note
 * field the HUD owns.
 */
export type DictationTarget =
  | { kind: 'cardNote'; card: InstanceId }
  | { kind: 'stackNote'; item: StackItemId }
  | { kind: 'field'; insert(text: string, final: boolean): void };

/**
 * Dictation and captions for one table (DESIGN "Chat and voice", Dictation and captions). Listens while the talk state
 * says `dictation` (voice/types.ts TalkState), sends interim text on presence (`captionInterim`) and the final text as a
 * `caption` action attached to the anchored action, and collects every peer's captions for the scene. Added by M3-C;
 * implementer: M3-P4 (voice/captions.ts).
 */
export interface CaptionControls {
  /** Captions to show now (own and other players'), oldest first. */
  captions(): Caption[];
  subscribe(listener: (captions: Caption[]) => void): Unsubscribe;
  /** The active engine and what the settings panel says about it. */
  engine(): SpeechEngineInfo;
  /** Every engine the settings can offer, with availability. */
  engines(): Promise<{ info: SpeechEngineInfo; available: boolean }[]>;
  /** Choose and persist an engine (settings key 'speechEngine'); choosing 'local' starts its download. */
  setEngine(id: SpeechEngineId, onProgress?: (loaded: number, total: number) => void): Promise<void>;
  lang(): string;
  setLang(lang: string): Promise<void>;
  /** Route dictation into a note field while it has focus; null returns it to captions. */
  dictateInto(target: DictationTarget | null): void;
  /** Hovered card or stack item, for the caption anchor (DESIGN: "last acted on or is hovering"). */
  hover(anchor: Anchor | null): void;
  dispose(): void;
}

/**
 * What captions need from the table (DESIGN "Chat and voice", Dictation and captions). Built by M3-P4's session wiring.
 * Added by M3-C.
 */
export interface CaptionHost {
  /** The own seat, or the spectator id. */
  self(): SeatId | SpectatorId;
  state(): TableState;
  log(): LogEntry[];
  onState(listener: (state: TableState) => void): Unsubscribe;
  /** Dispatch the final `caption` action (the session stamps it). */
  caption(text: string, anchor: Anchor | undefined, about: string | undefined): void;
  /** Write a dictated note (`note` / `stackNote` action). */
  note(target: Exclude<DictationTarget, { kind: 'field' }>, text: string): void;
  presence: Pick<Presence, 'captionInterim' | 'peers' | 'subscribe'>;
  /** The talk state drives listening (VoiceControls.subscribe: dictation 'caption' or 'field'); absent: nothing is dictated. */
  talk?: Pick<VoiceControls, 'state' | 'subscribe'>;
  /** Engine factories by id; with `?speech=fake` the fake engine replaces the others. */
  engines: readonly SpeechEngineFactory[];
  settings: SettingsStore;
  /** Local clock in ms. */
  now(): number;
}

/** Create the caption controller (DESIGN "Chat and voice", Dictation and captions). Added by M3-C; implementer: M3-P4. */
export type CreateCaptions = (host: CaptionHost) => CaptionControls;
