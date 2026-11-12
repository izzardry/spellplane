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
import type { Vec3 } from '../scene/types';

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
}

// Types registerDebug (util/debug.ts) against SpellplaneDebug without util/ importing debug/.
declare module '../util/debug' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface DebugParts extends SpellplaneDebug {}
}
