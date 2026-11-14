/**
 * The test and gate hook window.__spellplane (DESIGN "Specification: code interfaces", SpellplaneDebug; PLAN B0.5).
 * Present in dev and test builds only. Modules register their parts separately with registerDebug (util/debug.ts),
 * so at runtime every member may be missing until its owner registered it.
 */
import type { Action } from '../core/actions';
import type { DeckBuild, InstanceId, Line, Pose, SecretStore, TableState } from '../core/types';
import type { DraftPrivateView } from '../draft/types';
import type { PeerId } from '../net/transport';
import type { ConnectionStatus, NetMessageRecord, PeerInfo } from '../net/types';
import type { DebugCaption, RenderDebug, RigDebug, StackBadgeState, Vec3 } from '../scene/types';
import type { TouchGesture } from '../scene/input/touch';
import type { AuditBundle, AuditVerdict } from '../core/audit';
import type { StorageStatus } from '../store/quota';
import type { RadialMenuState, ThumbAction } from '../ui/touch/actions';
import type { CardFocus } from '../ui/a11y/index';
import type { UpdateStatus } from '../util/pwa';
import type { ThemeId } from '../themes/types';
import type { Caption, SpeechEngineId, TalkIndicatorState, TalkState, VoiceTrackState } from '../voice/types';

/**
 * The network part of the debug hook (DESIGN "Specification: code interfaces", SpellplaneDebug.net; PLAN M1-P2 leak
 * test, M1-G gate: reloads, closing the sequencer page). Added by M1-C as a superset of the design's
 * `{messages, sequencer}`; registered by the networked session's debug assembly (M1-P8).
 */
export interface NetDebug {
  /** Every wire message this page sent or received since it joined, oldest first; the leak test scans the `in` ones. */
  messages(): NetMessageRecord[];
  /** Identity peer id of the current sequencer; '' while none is known. */
  sequencer(): PeerId;
  /** This page's identity peer id. */
  self(): string;
  peers(): PeerInfo[];
  status(): ConnectionStatus;
  /** Last seq applied in order. */
  seq(): number;
  /** Forget the recorded messages (e.g. before a scripted phase of the leak test). */
  clearMessages(): void;
  /** Drop off the network abruptly, without `bye` (simulates a crash or lost connection; peers see silence). */
  kill(): void;
  /** Rejoin after `kill`, as a reconnect would. */
  revive(): Promise<void>;
  /** Leave cleanly with `bye`, as closing the tab does. */
  close(): void;
}

/**
 * The draft part of the debug hook (PLAN M2-G gate: picks, pools and builder state are asserted through the hook,
 * not on pixels). Added by M2-C; registered by M2-P7's session wiring; M2-P4 and M2-P5 may add their surfaces' cards.
 */
export interface DraftDebug {
  /** This page's private draft view, null outside a draft. */
  view(): DraftPrivateView | null;
  /** The deck being built, null before a pool exists. */
  build(): DeckBuild | null;
}

/**
 * The voice part of the debug hook (DESIGN "Chat and voice", Talk modes; PLAN M3-P3: push-to-talk, turn mic and team talk asserted on track state; M3-G
 * talk-mode indicator). Added by M3-C; registered by M3-P3's session wiring.
 */
export interface VoiceDebug {
  talk(): TalkState;
  indicator(): TalkIndicatorState;
  /** Outgoing track state per connection. */
  tracks(): VoiceTrackState[];
}

/**
 * The speech part of the debug hook (DESIGN "Chat and voice", Dictation and captions; CLAUDE.md `?speech=fake`; PLAN M3-P4 fake engine, M3-G fake-engine captions).
 * Added by M3-C; registered by M3-P4's session wiring.
 */
export interface SpeechDebug {
  /** The active engine, null before one was created. */
  engine(): SpeechEngineId | null;
  /** Deliver a transcript through the fake engine if it is listening; false when it is not (no-op outside `?speech=fake`). */
  say(text: string, final?: boolean): boolean;
  /** Captions the caption controller holds now. */
  captions(): Caption[];
  /** Captions drawn by the scene, with their anchors and screen rectangles. */
  drawn(): DebugCaption[];
}

/**
 * The theme part of the debug hook (DESIGN "Themes and rendering": themes are chosen per viewer, loaded on demand and
 * switchable mid-game without reloading; PLAN M4-G: a mid-game theme switch, screenshot matrix of four themes). Added by
 * M4-C; registered by M4-P6's theme switcher, which also updates the HUD's CSS custom properties and the stored setting.
 */
export interface ThemeDebug {
  /** The theme this page shows. */
  current(): ThemeId;
  /** Load the theme's chunk if needed and switch the scene and HUD to it; resolves once the new theme rendered a frame. */
  set(id: ThemeId): Promise<void>;
  /** Theme chunks loaded so far (lazy loading: only the shown themes). */
  loaded(): ThemeId[];
}

/**
 * The touch part of the debug hook (DESIGN "Input and interaction design", Touch; PLAN M5-P1: gestures pass under
 * Playwright's iPad emulation; M5-G: the evening on an emulated tablet using touch only). Added by M5-C; registered by
 * M5-P1.
 */
export interface TouchDebug {
  /** The last recognised gestures (at most 50), oldest first. */
  gestures(): TouchGesture[];
  /** The radial menu while it shows, else null. */
  radial(): RadialMenuState | null;
  /** The thumb action bar's buttons while it shows, else an empty list. */
  thumbBar(): ThumbAction[];
}

/**
 * The audit part of the debug hook (DESIGN "Multiplayer architecture", Audit; PLAN M5-P2 and M5-G: the audit after the
 * evening). Added by M5-C; registered by M5-P2's session wiring.
 */
export interface AuditDebug {
  /** Every verdict this page computed, oldest game first, seat order within a game. */
  verdicts(): AuditVerdict[];
  /** The bundles this page published. */
  published(): AuditBundle[];
}

/**
 * The storage and update part of the debug hook (PLAN M5-P3: offline and storage; PLAN Milestone 5, owner decisions:
 * updates only between games, persistent storage). Added by M5-C; registered by M5-P3.
 */
export interface StorageDebug {
  status(): Promise<StorageStatus>;
  /** The service-worker update state ('current' in builds without a worker). */
  update(): UpdateStatus;
}

/**
 * The accessibility part of the debug hook (DESIGN "Input and interaction design", Accessibility; PLAN M5-P4). Added by
 * M5-C; registered by M5-P4.
 */
export interface A11yDebug {
  /** The card or zone with keyboard focus, or null. */
  focus(): CardFocus | null;
  /** The live region's announcements, oldest first. */
  announcements(): string[];
}

/** The full debug hook (DESIGN "Specification: code interfaces"). */
export interface SpellplaneDebug {
  state(): TableState;
  secrets(): SecretStore;
  cards(): { id: InstanceId; pose: Pose; screen: DOMRect; visible: boolean }[];
  camera(): { rig: string; fov: number; position: Vec3; pitch: number };
  lines(): Line[];
  dispatch(action: Action): void;
  net: NetDebug;
  frameStats(): { drawCalls: number; textureBytes: number; frameMs: number };
  /** Added by M2-C. */
  draft: DraftDebug;
  /** Added by M3-C. */
  voice: VoiceDebug;
  /** Added by M3-C. */
  speech: SpeechDebug;
  /** Added by M4-C: render statistics and quality (registered by the table scene; M4-P2). */
  render: RenderDebug;
  /** Added by M4-C: camera rig, blend and follow toggles (registered by the table scene; M4-P1). */
  rig: RigDebug;
  /** Added by M4-C: per-viewer theme (registered by the theme switcher; M4-P6). */
  theme: ThemeDebug;
  /** Added by M5-C: touch gestures, radial menu, thumb bar (M5-P1). */
  touch: TouchDebug;
  /** Added by M5-C: audit verdicts and published bundles (M5-P2). */
  audit: AuditDebug;
  /** Added by M5-C: storage use, persistence and the update state (M5-P3). */
  storage: StorageDebug;
  /** Added by M5-C: keyboard focus and live-region announcements (M5-P4). */
  a11y: A11yDebug;
  /** Added by M5-C: the far-zoom stack badge (registered by the table scene; M5-P7). */
  stackBadge(): StackBadgeState;
}

// Types registerDebug (util/debug.ts) against SpellplaneDebug without util/ importing debug/.
declare module '../util/debug' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface DebugParts extends SpellplaneDebug {}
}
