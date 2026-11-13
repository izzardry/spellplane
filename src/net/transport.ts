/**
 * The transport seam (docs/DESIGN.md, "Specification: code interfaces").
 * Implementations: Trystero (production, M1-P1), loopback (in-process tests), broadcast (BroadcastChannel, e2e).
 */
export type PeerId = string;
export type Channel = 'ctl' | 'act' | 'prv' | 'pres';
export const CHANNELS: readonly Channel[] = ['ctl', 'act', 'prv', 'pres'];

/** Every wire message is a JSON object `{v: 1, t: <type>, ...}`. */
export interface Message {
  v: 1;
  t: string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: Message, from: PeerId) => void;
export type PeerHandler = (event: 'join' | 'leave', peer: PeerId) => void;

export interface Transport {
  /** This browser's peer id on the transport. */
  readonly selfId: PeerId;
  join(roomId: string, roomKey: string): Promise<void>;
  leave(): void;
  peers(): PeerId[];
  /** Without `to` the message goes to every peer; with `to` only to that peer. */
  send(channel: Channel, msg: Message, to?: PeerId): void;
  on(channel: Channel, handler: MessageHandler): void;
  onPeer(handler: PeerHandler): void;
  /** Send audio to every peer, or to `to` only (DESIGN "Chat and voice", Live voice: audio tracks on the same peer connections). */
  addStream?(stream: MediaStream, to?: PeerId): void;
  /** Stop sending a stream added with `addStream` (to every peer, or to `to` only). Added by M3-C for M3-P3 (Trystero `removeStream`). */
  removeStream?(stream: MediaStream, to?: PeerId): void;
  onStream?(handler: (stream: MediaStream, from: PeerId) => void): void;
}
