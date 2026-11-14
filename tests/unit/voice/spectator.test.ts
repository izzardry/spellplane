/**
 * PLAN Milestone 5, owner decisions: "Spectators listen. A spectator gets a listen-only voice session: they hear the
 * table's open voice but never talk, and team-only talk never reaches them." (VoiceHost.listenOnly, the 'listening'
 * indicator.) DESIGN "Chat and voice": open voice is push-to-talk, the turn mic and the open mic; the team channel
 * "sends audio only to the teammate".
 *
 * Two sides: the spectator's own controller (no microphone, no outgoing stream, keys ignored, plays the players), and
 * the secrecy check on every player's page: a spectator's connection carries open talk only, never team talk, whatever
 * the talk settings, keys, turn and focus.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PeerInfo } from '../../../src/net/types';
import { spectatorIdOf } from '../../../src/core/teams';
import { indicatorLabel } from '../../../src/ui/voice/labels';
import { createVoiceWith } from '../../../src/voice/mic';
import { DEFAULT_TALK } from '../../../src/store/types';
import { voiceWiring, type VoicePort } from '../../../src/session/voice';
import type { NetEngine } from '../../../src/net/types';
import type { Transport } from '../../../src/net/transport';
import { FakeHost, FakeMedia, MemorySettingsStore, installMediaStream, peersOf, settle, table } from './fakes';

beforeEach(() => installMediaStream());

const watcher = (n = 1, extra: Partial<PeerInfo> = {}): PeerInfo => ({
  transportId: `tv${n}`,
  peerId: `peer-v${n}`,
  nickname: `Viewer ${n}`,
  seat: null,
  role: 'spectator',
  status: 'connected',
  lastSeq: 0,
  ...extra,
});

/** The spectator's own page: no seat, the players as peers, listen-only. */
async function spectatorVoice(format: Parameters<typeof table>[0] = '2hg') {
  const st = table(format, 't0');
  const fake = new FakeHost({ state: st, seat: null, peers: peersOf(st, null) });
  const host = { ...fake.host(), listenOnly: true };
  const voice = createVoiceWith(host, { meter: null, presence: fake.presenceSeam() });
  await settle();
  return { fake, voice };
}

describe("a spectator's listen-only session", () => {
  it('shows "Listening", never asks for a microphone and never adds a stream, even after "join"', async () => {
    const { fake, voice } = await spectatorVoice();
    expect(voice.indicator()).toBe('listening');
    expect(indicatorLabel(voice.indicator(), voice.talk(), 'Ctrl')).toBe('Listening');
    await voice.join();
    await settle();
    expect(fake.media.calls).toEqual([]);
    expect(fake.added).toEqual([]);
    expect(voice.tracks()).toEqual([]);
    expect(voice.joined).toBe(false);
    expect(voice.indicator()).toBe('listening');
  });

  it('ignores the talk key, team talk, the turn mic and the open mic: nothing ever opens', async () => {
    const { fake, voice } = await spectatorVoice();
    for (const gate of ['ptt', 'turn', 'open'] as const) {
      await voice.setTalk({ gate, voice: true, dictation: true });
      voice.keyDown(false);
      expect(voice.state()).toMatchObject({ audio: 'off', dictation: 'off' });
      voice.keyUp();
      voice.keyDown(true);
      expect(voice.state()).toMatchObject({ audio: 'off', dictation: 'off' });
      voice.keyUp();
      voice.focus({ note: true });
      voice.keyDown(false);
      expect(voice.state().dictation).toBe('off');
      voice.keyUp();
      voice.focus({ note: false });
    }
    await voice.setDevice('usb');
    expect(fake.media.calls).toEqual([]);
    expect(fake.added).toEqual([]);
    // It never announces itself as speaking.
    expect(fake.announced).toEqual([]);
  });

  it("plays the players' incoming audio at its own volume and mute per player", async () => {
    const { fake, voice } = await spectatorVoice();
    fake.stream('t0');
    fake.stream('t2');
    expect(fake.played.map((p) => p.peer)).toEqual(['t0', 't2']);
    await voice.setPeerAudio('peer-2', { volume: 0.5, muted: true });
    expect(fake.played.find((p) => p.peer === 't2')!.setting).toEqual({ volume: 0.5, muted: true });
    voice.dispose();
    expect(fake.played.every((p) => p.stopped)).toBe(true);
  });

  it('shows the players speaking from their presence and audio', async () => {
    const { fake, voice } = await spectatorVoice();
    fake.presence('peer-1', true);
    expect(voice.speaking()).toEqual({ 'peer-1': true });
  });

  it('the session wiring passes listen-only through to the controller host', () => {
    const port: VoicePort = {
      engine: () => ({ peers: () => [], seat: () => null, presence: { speaking: () => undefined, peers: () => [], subscribe: () => () => undefined } }) as unknown as NetEngine,
      transport: () => ({ selfId: 'me' }) as unknown as Transport,
      state: () => table('1v1'),
      subscribe: () => () => undefined,
      subscribeNet: () => () => undefined,
    };
    const opts = { media: new FakeMedia(), settings: new MemorySettingsStore(), engines: [] };
    expect(voiceWiring(port, opts, { listenOnly: true }).host.listenOnly).toBe(true);
    expect(voiceWiring(port, opts).host.listenOnly).toBeUndefined();
  });
});

describe('secrecy: team audio never reaches a spectator', () => {
  /** A player's page in Two-Headed Giant (Anna, s0, teamed with Ben) with two spectators connected. */
  async function playerWithWatchers(extra: PeerInfo[] = []) {
    const st = table('2hg', 't1');
    const fake = new FakeHost({ state: st, seat: 's0', peers: [...peersOf(st, 's0'), watcher(1), watcher(2), ...extra] });
    const voice = createVoiceWith(fake.host(), { meter: null, presence: fake.presenceSeam() });
    await settle();
    await voice.join();
    await settle();
    return { fake, voice };
  }

  it("each spectator connection gets its own track, closed until the player talks to everyone", async () => {
    const { fake, voice } = await playerWithWatchers();
    expect(voice.tracks().filter((t) => t.peer.startsWith('tv'))).toEqual([
      { peer: 'tv1', peerId: 'peer-v1', seat: null, enabled: false },
      { peer: 'tv2', peerId: 'peer-v2', seat: null, enabled: false },
    ]);
    voice.keyDown(false);
    expect([fake.enabledTo('tv1'), fake.enabledTo('tv2')]).toEqual([true, true]);
    voice.keyUp();
    voice.keyDown(true);
    expect([fake.enabledTo('t1'), fake.enabledTo('tv1'), fake.enabledTo('tv2')]).toEqual([true, false, false]);
  });

  it('a spectator connection that names a teammate\'s chair (its key pair holds one) still never gets team talk', async () => {
    const st = table('2hg', 't1');
    const sneaky = watcher(3, { seat: 's1', peerId: 'peer-1' });
    const { fake, voice } = await playerWithWatchers([sneaky]);
    expect(st.seats.s1!.peer).toBe('peer-1');
    voice.keyDown(true);
    expect(fake.enabledTo('t1')).toBe(true);
    expect(fake.enabledTo('tv3')).toBe(false);
  });

  it('a spectator id as the seat of a spectator connection gets open talk only', async () => {
    const { fake, voice } = await playerWithWatchers([watcher(4, { seat: spectatorIdOf('peer-v4') })]);
    voice.keyDown(true);
    expect(fake.enabledTo('tv4')).toBe(false);
    voice.keyUp();
    voice.keyDown(false);
    expect(fake.enabledTo('tv4')).toBe(true);
  });

  it('property: every spectator connection is enabled exactly when audio goes to everyone, never during team talk', async () => {
    const { fake, voice } = await playerWithWatchers();
    const step = fc.oneof(
      fc.record({ k: fc.constant('key' as const), team: fc.boolean() }),
      fc.record({ k: fc.constant('up' as const) }),
      fc.record({ k: fc.constant('gate' as const), gate: fc.constantFrom('ptt' as const, 'turn' as const, 'open' as const) }),
      fc.record({ k: fc.constant('send' as const), voice: fc.boolean(), dictation: fc.boolean() }),
      fc.record({ k: fc.constant('mute' as const) }),
      fc.record({ k: fc.constant('turn' as const), active: fc.constantFrom('t0' as const, 't1' as const) }),
      fc.record({ k: fc.constant('focus' as const), window: fc.boolean(), text: fc.boolean(), note: fc.boolean() }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 14 }), async (steps) => {
        for (const s of steps) {
          if (s.k === 'key') voice.keyDown(s.team);
          else if (s.k === 'up') voice.keyUp();
          else if (s.k === 'gate') await voice.setTalk({ gate: s.gate });
          else if (s.k === 'send') await voice.setTalk({ voice: s.voice, dictation: s.dictation });
          else if (s.k === 'mute') await voice.setTalk({ muted: !voice.talk().muted });
          else if (s.k === 'turn') fake.setActive(s.active);
          else voice.focus({ window: s.window, text: s.text, note: s.note });
          const audio = voice.state().audio;
          for (const tv of ['tv1', 'tv2']) {
            expect(fake.enabledTo(tv)).toBe(audio === 'all');
            if (audio === 'team') expect(fake.enabledTo(tv)).toBe(false);
          }
        }
        voice.keyUp();
        voice.focus({ window: true, text: false, note: false });
        await voice.setTalk({ ...DEFAULT_TALK });
      }),
      { numRuns: 120 },
    );
  });
});
