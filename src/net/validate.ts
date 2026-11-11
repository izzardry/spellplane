/**
 * Payload checks for received wire messages (DESIGN "Specification: network protocol and secrecy": every message is
 * `{v: 1, t, ...}`; net/messages.ts asWireMessage checks the envelope only). A message from another browser is
 * untrusted input: the engine acts on it only after the fields it reads have the declared types. Implementer: M1-P1.
 */
import type { WireMessage } from './messages';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPose = (v: unknown): boolean => isRec(v) && isNum(v.x) && isNum(v.y) && isNum(v.rot);

/** A plausible action: an object with a string `type`, `by` and `cid` (the reducer checks the rest). */
export function isActionShape(v: unknown): v is Rec & { type: string; by: string; cid: string } {
  return isRec(v) && isId(v.type) && typeof v.by === 'string' && v.by.length <= 256 && isId(v.cid);
}

function isSequenced(v: unknown): boolean {
  return isActionShape(v) && isSeq(v.seq) && v.seq > 0;
}

function isTableState(v: unknown): boolean {
  return (
    isRec(v) &&
    isSeq(v.seq) &&
    isRec(v.seats) &&
    isRec(v.cards) &&
    isRec(v.zones) &&
    Array.isArray(v.stack) &&
    isRec(v.lines) &&
    isRec(v.turn) &&
    isRec(v.commitments) &&
    isRec(v.settings)
  );
}

const PRESENCE_TYPES = new Set(['cursor', 'drag', 'speaking', 'typing', 'captionInterim']);

/** Whether the payload of a message whose envelope `asWireMessage` accepted has the fields the engine reads. */
export function validPayload(m: WireMessage): boolean {
  const r = m as unknown as Rec;
  switch (m.t) {
    case 'hello':
      return (
        isId(r.peerId) &&
        isStr(r.pubKey, 1024) &&
        isStr(r.nickname, 256) &&
        (r.seat === null || isId(r.seat)) &&
        (r.role === 'player' || r.role === 'spectator') &&
        isSeq(r.lastSeq) &&
        isId(r.nonce)
      );
    case 'welcome':
      return isId(r.peerId) && isStr(r.sig, 1024) && (r.sequencer === null || isId(r.sequencer)) && isSeq(r.seq);
    case 'syncReq':
      return isSeq(r.haveSeq);
    case 'syncRes': {
      if (!Array.isArray(r.tail) || !r.tail.every(isSequenced)) return false;
      if (r.snapshot === null) return true;
      return isRec(r.snapshot) && isSeq(r.snapshot.seq) && isTableState(r.snapshot.state) && (r.snapshot.state as Rec).seq === r.snapshot.seq;
    }
    case 'hb':
      return isSeq(r.seq) && (r.sequencer === null || isId(r.sequencer));
    case 'claim':
      return isSeq(r.fromSeq) && typeof r.seat === 'string';
    case 'claimAck':
      return isSeq(r.lastSeq);
    case 'hash':
      return isSeq(r.seq) && isId(r.h);
    case 'bye':
      return typeof r.reason === 'string' && typeof r.version === 'number';
    case 'propose':
      return isId(r.cid) && isActionShape(r.action) && r.action.cid === r.cid && (r.prev === undefined || r.prev === null || isId(r.prev));
    case 'seq':
      return isSeq(r.seq) && isId(r.cid) && isSequenced(r.action) && (r.action as Rec).seq === r.seq && (r.action as Rec).cid === r.cid;
    case 'nack':
      return isId(r.cid) && isStr(r.reason);
    default:
      if (PRESENCE_TYPES.has(m.t)) return validPresence(r);
      // Pair-channel payloads are checked by net/private.ts (M1-P2) against the owner's commitments.
      return true;
  }
}

function validPresence(r: Rec): boolean {
  if (!isSeq(r.n)) return false;
  switch (r.t) {
    case 'cursor':
      return (r.at === null || (isRec(r.at) && isNum(r.at.x) && isNum(r.at.y))) && (r.over === null || isId(r.over));
    case 'drag':
      return Array.isArray(r.cards) && r.cards.length <= 256 && r.cards.every((c: unknown) => isRec(c) && isId(c.id) && isPose(c.pose));
    case 'speaking':
      return typeof r.on === 'boolean';
    case 'typing':
      return r.channel === null || r.channel === 'table' || r.channel === 'team' || r.channel === 'spectator';
    case 'captionInterim':
      return (r.text === null || isStr(r.text, 2000)) && (r.anchor === null || (isRec(r.anchor) && isId(r.anchor.id) && typeof r.anchor.kind === 'string'));
    default:
      return false;
  }
}
