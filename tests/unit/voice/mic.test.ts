/**
 * PLAN M3-P3 (unit level; the browser specs repeat the acceptance on Chromium fake media): the voice controller over a
 * recording transport. DESIGN "Chat and voice", Live voice: the microphone is acquired once on joining and gated by
 * enabling and disabling the track; echo cancellation, noise suppression and automatic gain stay on; the talk key is
 * released on window blur and ignored while a text field has focus; a speaking ring; a personal volume and mute per
 * other player. Talk modes: push-to-talk, turn mic (the active team's mics in Two-Headed Giant), open mic with mute.
 * Team channel: Shift plus the talk key sends audio only to the teammate. PLAN: device picker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceWith, talkFromSettings, type LevelMeter } from '../../../src/voice/mic';
import { MIC_CONSTRAINTS, type VoiceControls } from '../../../src/voice/types';
import { DEFAULT_TALK } from '../../../src/store/types';
import { FakeHost, type FakeStream, installMediaStream, peersOf, settle, table } from './fakes';

beforeEach(() => installMediaStream());

let open: VoiceControls[] = [];
afterEach(() => {
  for (const v of open) v.dispose();
  open = [];
  vi.useRealTimers();
});

/** A controller over `fake`, without level meters (the open gate counts as speaking). */
async function voiceOver(fake: FakeHost, join = true): Promise<ReturnType<typeof createVoiceWith>> {
  const v = createVoiceWith(fake.host(), { meter: null });
  open.push(v);
  await settle();
  if (join) await v.join();
  return v;
}

const enabled = (fake: FakeHost, ...to: string[]) => to.map((t) => fake.enabledTo(t));

describe('the microphone is acquired once, on joining', () => {
  it('asks for audio with echo cancellation, noise suppression and automatic gain, once', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake, false);
    expect(v.joined).toBe(false);
    expect(fake.media.calls).toEqual([]);
    expect(v.indicator()).toBe('noMic');
    await Promise.all([v.join(), v.join()]);
    await v.join();
    expect(fake.media.calls).toHaveLength(1);
    expect(fake.media.calls[0]).toEqual({ audio: { ...MIC_CONSTRAINTS }, video: false });
    expect(MIC_CONSTRAINTS).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(v.joined).toBe(true);
    expect(v.indicator()).toBe('idle');
  });

  it('a refused microphone leaves voice unjoined and says why', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    fake.media.refuse = 'NotAllowedError';
    const v = await voiceOver(fake, false);
    await expect(v.join()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(v.joined).toBe(false);
    v.keyDown(false);
    expect(v.state().audio).toBe('off');
    expect(v.tracks()).toEqual([]);
    // A later click may try again.
    fake.media.refuse = null;
    await v.join();
    expect(v.joined).toBe(true);
  });

  it('every connection gets its own track, disabled until the gate opens; the mic’s own track is never sent', async () => {
    const fake = new FakeHost({ state: table('ffa3') });
    await voiceOver(fake);
    expect(fake.added.map((a) => a.to).sort()).toEqual(['t1', 't2']);
    const mic = fake.media.streams[0]!.getAudioTracks()[0]!;
    const sent = fake.added.map((a) => a.stream.getAudioTracks()[0]!);
    expect(new Set(sent).size).toBe(2);
    expect(sent).not.toContain(mic);
    expect(sent.every((t) => !t.enabled)).toBe(true);
    // Never broadcast without a target: per-connection streams are what lets team talk reach the teammate only.
    expect(fake.added.every((a) => a.to !== undefined)).toBe(true);
  });
});

describe('push-to-talk', () => {
  it('enables the local track on every connection only while the key is held', async () => {
    const fake = new FakeHost({ state: table('ffa4') });
    const v = await voiceOver(fake);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
    v.keyDown(false);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([true, true, true]);
    expect(v.indicator()).toBe('live');
    expect(v.tracks().map((t) => t.enabled)).toEqual([true, true, true]);
    v.keyUp();
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
    expect(v.indicator()).toBe('idle');
  });

  it('window blur releases the key; focus coming back does not reopen it until it is pressed again', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(true);
    v.focus({ window: false });
    expect(fake.enabledTo('t1')).toBe(false);
    // A key-down while the window has no focus (it cannot have one) is ignored.
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(false);
    v.focus({ window: true });
    expect(fake.enabledTo('t1')).toBe(false);
    v.keyUp();
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(true);
  });

  it('the talk key is ignored while a text field has focus, and focusing one releases a held key', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    v.focus({ text: true });
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(false);
    expect(v.state().reason).toBeNull();
    v.focus({ text: false });
    expect(fake.enabledTo('t1')).toBe(false);
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(true);
    v.focus({ text: true });
    expect(fake.enabledTo('t1')).toBe(false);
    v.focus({ text: false });
    expect(fake.enabledTo('t1')).toBe(false);
  });
});

describe('turn mic', () => {
  it('enables the track exactly for the player’s own turn', async () => {
    const fake = new FakeHost({ state: table('ffa3', 's1'), seat: 's0' });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'turn' });
    expect(enabled(fake, 't1', 't2')).toEqual([false, false]);
    fake.setActive('s0');
    expect(enabled(fake, 't1', 't2')).toEqual([true, true]);
    expect(v.state()).toMatchObject({ audio: 'all', reason: 'turn' });
    fake.setActive('s2');
    expect(enabled(fake, 't1', 't2')).toEqual([false, false]);
    // Outside the own turn it is push-to-talk.
    v.keyDown(false);
    expect(enabled(fake, 't1', 't2')).toEqual([true, true]);
    v.keyUp();
    expect(enabled(fake, 't1', 't2')).toEqual([false, false]);
    // Releasing the key during the own turn leaves the turn mic open.
    fake.setActive('s0');
    v.keyDown(false);
    v.keyUp();
    expect(enabled(fake, 't1', 't2')).toEqual([true, true]);
  });

  it('in Two-Headed Giant the active team’s mics open, the other team’s stay closed', async () => {
    const anna = new FakeHost({ state: table('2hg', 't0'), seat: 's0' });
    const cara = new FakeHost({ state: table('2hg', 't0'), seat: 's2' });
    const va = await voiceOver(anna);
    const vc = await voiceOver(cara);
    await va.setTalk({ gate: 'turn' });
    await vc.setTalk({ gate: 'turn' });
    expect(va.state().audio).toBe('all');
    expect(vc.state().audio).toBe('off');
    anna.setActive('t1');
    cara.setActive('t1');
    expect(va.state().audio).toBe('off');
    expect(vc.state().audio).toBe('all');
  });

  it('a page without a seat (a spectator) has no own turn', async () => {
    const fake = new FakeHost({ state: table('1v1', 's0'), seat: null });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'turn' });
    expect(v.state().audio).toBe('off');
  });
});

describe('team talk', () => {
  it('enables the track only on the teammate’s connection', async () => {
    const fake = new FakeHost({ state: table('2hg', 't1'), seat: 's0' });
    const v = await voiceOver(fake);
    v.keyDown(true);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([true, false, false]);
    expect(v.indicator()).toBe('team');
    expect(v.tracks().find((t) => t.peer === 't1')).toMatchObject({ seat: 's1', enabled: true });
    v.keyUp();
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
  });

  it('narrows an open turn mic to the teammate while held, then opens it to the table again', async () => {
    const fake = new FakeHost({ state: table('2hg', 't0'), seat: 's1' });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'turn' });
    expect(enabled(fake, 't0', 't2', 't3')).toEqual([true, true, true]);
    v.keyDown(true);
    expect(enabled(fake, 't0', 't2', 't3')).toEqual([true, false, false]);
    v.keyUp();
    expect(enabled(fake, 't0', 't2', 't3')).toEqual([true, true, true]);
  });

  it('is not announced on the broadcast speaking presence, while talk to everyone is', async () => {
    const fake = new FakeHost({ state: table('2hg', 't1'), seat: 's0' });
    const v = await voiceOver(fake);
    v.keyDown(true);
    expect(fake.announced).toEqual([]);
    v.keyUp();
    v.keyDown(false);
    expect(fake.announced).toEqual([true]);
    v.keyUp();
    expect(fake.announced).toEqual([true, false]);
  });

  it('follows the seat the teammate holds in the shared state, and a connection whose seat changed', async () => {
    const st = table('2hg', 't1');
    // Ben's connection did not say its seat in its hello yet; the shared state does.
    const peers = peersOf(st, 's0').map((p) => ({ ...p, seat: null }));
    const fake = new FakeHost({ state: st, seat: 's0', peers });
    const v = await voiceOver(fake);
    v.keyDown(true);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([true, false, false]);
  });

  it('without a teammate (free-for-all) Shift plus the talk key opens nothing', async () => {
    const fake = new FakeHost({ state: table('ffa4'), seat: 's0' });
    const v = await voiceOver(fake);
    v.keyDown(true);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
  });

  it('a teammate who connects while team talk is held gets the open track; an opponent who connects does not', async () => {
    const st = table('2hg', 't1');
    const all = peersOf(st, 's0');
    const fake = new FakeHost({ state: st, seat: 's0', peers: all.filter((p) => p.seat === 's2') });
    const v = await voiceOver(fake);
    v.keyDown(true);
    fake.setPeers(all);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([true, false, false]);
  });
});

describe('open mic and mute', () => {
  it('open mic is always on; M mutes and unmutes it', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'open' });
    expect(fake.enabledTo('t1')).toBe(true);
    v.focus({ window: false });
    expect(fake.enabledTo('t1')).toBe(true);
    v.toggleMute();
    expect(fake.enabledTo('t1')).toBe(false);
    expect(v.indicator()).toBe('muted');
    v.toggleMute();
    expect(fake.enabledTo('t1')).toBe(true);
    // Two quick toggles land on the start.
    v.toggleMute();
    v.toggleMute();
    expect(fake.enabledTo('t1')).toBe(true);
    await settle();
    expect(fake.settings.values.talk.muted).toBe(false);
  });

  it('mute also closes the held talk key and team talk', async () => {
    const fake = new FakeHost({ state: table('2hg'), seat: 's0' });
    const v = await voiceOver(fake);
    v.toggleMute();
    v.keyDown(false);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
    v.keyUp();
    v.keyDown(true);
    expect(enabled(fake, 't1', 't2', 't3')).toEqual([false, false, false]);
  });
});

describe('connections come and go', () => {
  it('a peer joining later gets a track in the current gate state; a peer leaving loses it', async () => {
    const st = table('ffa3');
    const all = peersOf(st, 's0');
    const fake = new FakeHost({ state: st, peers: [all[0]!] });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'open' });
    fake.setPeers(all);
    expect(enabled(fake, 't1', 't2')).toEqual([true, true]);
    const toCara = fake.sentTo('t2')!;
    fake.setPeers([all[0]!]);
    expect(fake.removed.map((r) => r.to)).toEqual(['t2']);
    expect(toCara.getAudioTracks()[0]!.readyState).toBe('ended');
    expect(v.tracks().map((t) => t.peer)).toEqual(['t1']);
  });

  it('a connection still in its handshake gets no audio', async () => {
    const st = table('1v1');
    const fake = new FakeHost({ state: st, peers: [{ ...peersOf(st, 's0')[0]!, peerId: '', status: 'handshake' }] });
    const v = await voiceOver(fake);
    await v.setTalk({ gate: 'open' });
    expect(fake.added).toEqual([]);
    fake.setPeers(peersOf(st, 's0'));
    expect(fake.enabledTo('t1')).toBe(true);
  });
});

describe('device picker', () => {
  it('lists audio inputs, persists the choice and moves every connection to the new microphone', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    expect((await v.devices()).map((d) => d.deviceId)).toEqual(['default', 'usb']);
    v.keyDown(false);
    const before = fake.sentTo('t1')!;
    await v.setDevice('usb');
    expect(fake.settings.values.micDevice).toBe('usb');
    expect(v.device?.()).toBe('usb');
    expect(fake.media.calls.at(-1)).toEqual({ audio: { ...MIC_CONSTRAINTS, deviceId: { exact: 'usb' } }, video: false });
    const after = fake.sentTo('t1')!;
    expect(after).not.toBe(before);
    // The old microphone is released and the gate state carries over.
    expect(fake.media.streams[0]!.getAudioTracks()[0]!.readyState).toBe('ended');
    expect(after.getAudioTracks()[0]!.enabled).toBe(true);
    expect((after.getAudioTracks()[0] as unknown as { deviceId: string }).deviceId).toBe('usb');
  });

  it('joins with the stored device, and falls back to the default one when it is gone', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { micDevice: 'usb' } });
    fake.media.missing.add('usb');
    const v = await voiceOver(fake);
    expect(v.joined).toBe(true);
    expect(fake.media.calls).toEqual([
      { audio: { ...MIC_CONSTRAINTS, deviceId: { exact: 'usb' } }, video: false },
      { audio: { ...MIC_CONSTRAINTS }, video: false },
    ]);
  });

  it('choosing a device before joining only stores it', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake, false);
    await v.setDevice('usb');
    expect(fake.media.calls).toEqual([]);
    await v.join();
    expect(fake.media.calls[0]).toEqual({ audio: { ...MIC_CONSTRAINTS, deviceId: { exact: 'usb' } }, video: false });
  });

  it('a microphone that goes away (unplugged) leaves voice unjoined, so the player can join again', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    v.keyDown(false);
    (fake.media.streams[0]!.getAudioTracks()[0] as unknown as { end(): void }).end();
    expect(v.joined).toBe(false);
    expect(v.indicator()).toBe('noMic');
    expect(fake.sentTo('t1')).toBeNull();
    await v.join();
    expect(fake.enabledTo('t1')).toBe(true);
  });
});

describe('incoming audio: per-player volume and mute', () => {
  it('plays each player at the stored volume; a change applies at once and persists by identity', async () => {
    const st = table('ffa3');
    const fake = new FakeHost({ state: st, settings: { peerAudio: { 'peer-2': { volume: 0.25, muted: false } } } });
    const v = await voiceOver(fake);
    fake.stream('t1');
    fake.stream('t2');
    expect(fake.played.map((p) => [p.peer, p.setting])).toEqual([
      ['t1', { volume: 1, muted: false }],
      ['t2', { volume: 0.25, muted: false }],
    ]);
    await v.setPeerAudio('peer-1', { volume: 0.5, muted: true });
    expect(fake.played[0]!.setting).toEqual({ volume: 0.5, muted: true });
    expect(fake.played[1]!.setting).toEqual({ volume: 0.25, muted: false });
    expect(fake.settings.values.peerAudio).toEqual({ 'peer-1': { volume: 0.5, muted: true }, 'peer-2': { volume: 0.25, muted: false } });
    expect(v.peerAudio('peer-1')).toEqual({ volume: 0.5, muted: true });
    expect(v.peerAudio('peer-unknown')).toEqual({ volume: 1, muted: false });
    // Out-of-range volumes are clamped.
    await v.setPeerAudio('peer-1', { volume: 7, muted: false });
    expect(v.peerAudio('peer-1')).toEqual({ volume: 1, muted: false });
  });

  it('a stream from a connection the engine dropped stops playing; a player’s new connection plays at their setting', async () => {
    const st = table('1v1');
    const fake = new FakeHost({ state: st, settings: { peerAudio: { 'peer-1': { volume: 0.3, muted: false } } } });
    await voiceOver(fake);
    fake.stream('t1');
    fake.setPeers([]);
    expect(fake.played[0]!.stopped).toBe(true);
    fake.setPeers([{ ...peersOf(st, 's0')[0]!, transportId: 't1b' }]);
    fake.stream('t1b');
    expect(fake.played[1]!.setting).toEqual({ volume: 0.3, muted: false });
  });

  it('incoming audio plays also before the own microphone is joined', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    await voiceOver(fake, false);
    fake.stream('t1');
    expect(fake.played).toHaveLength(1);
  });
});

describe('speaking rings', () => {
  it('lists the players whose presence says they speak, and oneself while talking', async () => {
    const fake = new FakeHost({ state: table('ffa3') });
    const v = await voiceOver(fake);
    const seen: number[] = [];
    v.subscribe(() => seen.push(Object.keys(v.speaking()).length));
    fake.presence('peer-2', true);
    expect(v.speaking()).toEqual({ 'peer-2': true });
    v.keyDown(false);
    expect(v.speaking()).toEqual({ 'peer-2': true, 'peer-0': true });
    fake.presence('peer-2', false);
    v.keyUp();
    expect(v.speaking()).toEqual({});
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it('lights the teammate from its incoming audio (team talk is not on presence), and only above the level', async () => {
    vi.useFakeTimers();
    let clock = 1000;
    const levels = new Map<FakeStream, number>();
    const meter = (s: MediaStream): LevelMeter => ({ level: () => levels.get(s as unknown as FakeStream) ?? 0, stop: () => undefined });
    const fake = new FakeHost({ state: table('2hg'), seat: 's0' });
    const v = createVoiceWith(fake.host(), { meter, now: () => clock });
    open.push(v);
    await vi.advanceTimersByTimeAsync(0);
    await v.join();
    const fromBen = fake.stream('t1');
    v.readMeters();
    expect(v.speaking()).toEqual({});
    levels.set(fromBen, 0.2);
    v.readMeters();
    expect(v.speaking()).toEqual({ 'peer-1': true });
    // It stays lit briefly between words, then goes out.
    levels.set(fromBen, 0);
    clock += 200;
    v.readMeters();
    expect(v.speaking()).toEqual({ 'peer-1': true });
    clock += 500;
    v.readMeters();
    expect(v.speaking()).toEqual({});
    // Own ring with a meter: an open gate alone is not speaking; sound is.
    const mic = fake.media.streams[0]!;
    v.keyDown(false);
    expect(v.speaking()).toEqual({});
    expect(fake.announced).toEqual([]);
    levels.set(mic, 0.3);
    v.readMeters();
    expect(v.speaking()).toEqual({ 'peer-0': true });
    expect(fake.announced).toEqual([true]);
    v.keyUp();
    expect(fake.announced).toEqual([true, false]);
  });
});

describe('settings', () => {
  it('maps a pre-M3 talk mode onto the talk settings once', async () => {
    expect(talkFromSettings({ talk: DEFAULT_TALK, talkMode: 'turn' })).toEqual({ talk: { ...DEFAULT_TALK, gate: 'turn' }, migrated: true });
    expect(talkFromSettings({ talk: DEFAULT_TALK, talkMode: 'dictation' })).toEqual({ talk: { ...DEFAULT_TALK, voice: false, dictation: true }, migrated: true });
    expect(talkFromSettings({ talk: DEFAULT_TALK, talkMode: 'ptt' }).migrated).toBe(false);
    // A talk setting the player already changed wins over the old mode.
    expect(talkFromSettings({ talk: { ...DEFAULT_TALK, gate: 'open' }, talkMode: 'turn' })).toEqual({ talk: { ...DEFAULT_TALK, gate: 'open' }, migrated: false });

    const fake = new FakeHost({ state: table('1v1'), settings: { talkMode: 'open' } });
    const v = await voiceOver(fake);
    expect(v.talk().gate).toBe('open');
    expect(fake.settings.values.talk.gate).toBe('open');
    expect(fake.settings.values.talkMode).toBe('ptt');
  });

  it('repairs a damaged stored talk setting', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { talk: { gate: 'loud', voice: false, dictation: false, muted: 'yes', mouseButton: -3 } as never } });
    const v = await voiceOver(fake);
    expect(v.talk()).toEqual(DEFAULT_TALK);
  });

  it('keeps at least one of voice and dictation on', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    await v.setTalk({ voice: false });
    expect(v.talk()).toMatchObject({ voice: true, dictation: false });
    await v.setTalk({ dictation: true });
    await v.setTalk({ voice: false });
    expect(v.talk()).toMatchObject({ voice: false, dictation: true });
    await v.setTalk({ dictation: false });
    expect(v.talk()).toMatchObject({ voice: false, dictation: true });
    expect(fake.settings.values.talk).toMatchObject({ voice: false, dictation: true });
  });

  it('with voice off the key dictates and opens no audio', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    await v.setTalk({ dictation: true });
    await v.setTalk({ voice: false });
    v.keyDown(false);
    expect(fake.enabledTo('t1')).toBe(false);
    expect(v.indicator()).toBe('dictating');
  });
});

describe('dispose', () => {
  it('releases the microphone, removes every stream, stops playback and says it stopped speaking', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    fake.stream('t1');
    v.keyDown(false);
    v.dispose();
    expect(fake.media.streams[0]!.getAudioTracks()[0]!.readyState).toBe('ended');
    expect(fake.sentTo('t1')).toBeNull();
    expect(fake.played[0]!.stopped).toBe(true);
    expect(fake.announced).toEqual([true, false]);
    expect(v.state().audio).toBe('off');
    await expect(v.join()).rejects.toThrow();
  });

  it('a join still asking for the microphone when the table is left releases it', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake, false);
    const joining = v.join();
    v.dispose();
    await expect(joining).rejects.toThrow();
    expect(fake.media.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))).toBe(true);
    expect(fake.added).toEqual([]);
  });
});
