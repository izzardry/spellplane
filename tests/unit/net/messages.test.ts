/** M1-C wire contracts: every message type has one channel from the design's table (DESIGN "Specification: network protocol and secrecy"). */
import { describe, expect, it } from 'vitest';
import { APP_ID, asWireMessage, handshakeText, MESSAGE_CHANNEL, toMessage, type WireMessage } from '../../../src/net/messages';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

describe('wire messages', () => {
  it('maps the design table onto the four channels', () => {
    const design: Record<string, string[]> = {
      ctl: ['hello', 'welcome', 'syncReq', 'syncRes', 'hb', 'claim', 'hash'],
      act: ['propose', 'seq', 'nack'],
      prv: ['reveal', 'pack', 'teamHand', 'nonce'],
      pres: ['cursor', 'drag', 'speaking', 'typing', 'captionInterim'],
    };
    for (const [channel, types] of Object.entries(design)) {
      for (const t of types) expect(MESSAGE_CHANNEL[t as keyof typeof MESSAGE_CHANNEL], t).toBe(channel);
    }
  });

  it('accepts a known type on its own channel only, with this protocol version', () => {
    const hb: WireMessage = { v: PROTOCOL_VERSION, t: 'hb', seq: 3, sequencer: null };
    expect(asWireMessage('ctl', toMessage(hb))).toBe(hb);
    expect(asWireMessage('act', hb)).toBeNull();
    expect(asWireMessage('ctl', { ...hb, v: PROTOCOL_VERSION + 1 })).toBeNull();
    expect(asWireMessage('ctl', { ...hb, v: 1 })).toBeNull();
    expect(asWireMessage('ctl', { v: PROTOCOL_VERSION, t: 'nope' })).toBeNull();
    expect(asWireMessage('ctl', { v: PROTOCOL_VERSION, t: 'toString' })).toBeNull();
    expect(asWireMessage('ctl', null)).toBeNull();
  });

  it('signs the app id, room, the other side’s nonce and the signer', () => {
    expect(handshakeText('amber-fox-93', 'n0nce', 'abcdef0123456789')).toBe(`${APP_ID}|amber-fox-93|n0nce|abcdef0123456789`);
  });
});
