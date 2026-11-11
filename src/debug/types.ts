/**
 * The test and gate hook window.__spellplane (DESIGN "Specification: code interfaces", SpellplaneDebug; PLAN B0.5).
 * Present in dev and test builds only. Modules register their parts separately with registerDebug (util/debug.ts),
 * so at runtime every member may be missing until its owner registered it.
 */
import type { Action } from '../core/actions';
import type { InstanceId, Line, Pose, SecretStore, TableState } from '../core/types';
import type { Message, PeerId } from '../net/transport';
import type { Vec3 } from '../scene/types';

/** The full debug hook (DESIGN "Specification: code interfaces"). */
export interface SpellplaneDebug {
  state(): TableState;
  secrets(): SecretStore;
  cards(): { id: InstanceId; pose: Pose; screen: DOMRect; visible: boolean }[];
  camera(): { rig: string; fov: number; position: Vec3; pitch: number };
  lines(): Line[];
  dispatch(action: Action): void;
  net: { messages(): { dir: 'in' | 'out'; channel: string; msg: Message }[]; sequencer(): PeerId };
  frameStats(): { drawCalls: number; textureBytes: number; frameMs: number };
}

// Types registerDebug (util/debug.ts) against SpellplaneDebug without util/ importing debug/.
declare module '../util/debug' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface DebugParts extends SpellplaneDebug {}
}
