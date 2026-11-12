/**
 * M3-C contracts: format and team facts, spectator ids, reveal targets, the team layout descriptors, the team-chat rule
 * and the M3 stubs (DESIGN "Players, seats and formats"; "Chat and voice"; "Specification: geometry, layout and
 * motion", Tables and seats). Package acceptance tests live with M3-P1..P5.
 */
import { describe, expect, it } from 'vitest';
import {
  TABLE_FORMAT_SEATS,
  TABLE_FORMAT_TEAMS,
  activeSeats,
  formatTeamSeats,
  isSeatActive,
  isSpectatorId,
  isTeamFormat,
  peerOfSpectator,
  revealRecipients,
  sameTeam,
  spectatorIdOf,
  teamIdOf,
  teamOf,
  teammatesOf,
} from '../../../src/core/teams';
import type { Format } from '../../../src/core/types';
import { mtgLayout, soloLayout } from '../../../src/games/mtg/layout';
import { mtgStartingLife } from '../../../src/games/mtg/index';
import { MESSAGE_CHANNEL } from '../../../src/net/messages';
import { DEFAULT_SETTINGS } from '../../../src/store/types';
import { CAPTION_MAX_LINES, CAPTION_MAX_WIDTH_PX, FAKE_SPEECH, FakeSpeechEngine, SPEECH_ENGINES, TALK_CLOSED, createCaptions, createVoice, talkState } from '../../../src/voice/index';
import { roleProblem, spectatorsOf } from '../../../src/net/roles';
import { createTeamChannel } from '../../../src/net/team';
import { createTeamDraftDriver, createTeamSealedDriver } from '../../../src/draft/team';
import { act, fresh, no, ok } from './helpers';

const FORMATS: Format[] = ['1v1', 'ffa3', 'ffa4', '2hg'];

describe('formats and teams', () => {
  it('seats per format follow the design table', () => {
    expect(TABLE_FORMAT_SEATS).toEqual({ '1v1': 2, ffa3: 3, ffa4: 4, '2hg': 4 });
    for (const f of FORMATS) expect(mtgLayout(f).seats).toHaveLength(TABLE_FORMAT_SEATS[f]);
  });

  it('only Two-Headed Giant has teams: seats 0+1 and 2+3', () => {
    expect(FORMATS.filter(isTeamFormat)).toEqual(['2hg']);
    expect(TABLE_FORMAT_TEAMS['2hg']).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(formatTeamSeats('2hg')).toEqual([
      ['s0', 's1'],
      ['s2', 's3'],
    ]);
    expect(formatTeamSeats('ffa4')).toEqual([]);
    expect(teamIdOf(1)).toBe('t1');
  });

  it('team selectors read the shared team and turn marker', () => {
    const s = fresh('2hg', 4);
    expect(teamOf(s, 's1')?.id).toBe('t0');
    expect(teamOf(s, 's1')?.life).toBe(30);
    expect(teammatesOf(s, 's0')).toEqual(['s1']);
    expect(sameTeam(s, 's2', 's3')).toBe(true);
    expect(sameTeam(s, 's1', 's2')).toBe(false);
    expect(activeSeats(s)).toEqual(['s0', 's1']);
    expect(isSeatActive(s, 's1')).toBe(true);
    expect(isSeatActive(s, 's2')).toBe(false);
    const passed = ok(s, act('turnPass', { to: 't1' }));
    expect(activeSeats(passed)).toEqual(['s2', 's3']);
    // A life change by either teammate updates one shared total (already M0's reducer).
    const hit = ok(passed, act('life', { seat: 's3', delta: -4 }, 's3'));
    expect(hit.teams.t1?.life).toBe(26);
    const one = fresh();
    expect(teamOf(one, 's0')).toBeNull();
    expect(teammatesOf(one, 's0')).toEqual([]);
    expect(activeSeats(one)).toEqual(['s0']);
  });
});

describe('spectators and reveal targets', () => {
  it('spectator ids wrap a peer id and never name a seat', () => {
    const id = spectatorIdOf('0123456789abcdef');
    expect(id).toBe('v:0123456789abcdef');
    expect(isSpectatorId(id)).toBe(true);
    expect(isSpectatorId('s0')).toBe(false);
    expect(isSpectatorId('v:')).toBe(false);
    expect(peerOfSpectator(id)).toBe('0123456789abcdef');
    expect(peerOfSpectator('s1')).toBeNull();
    expect(Object.keys(fresh('2hg', 4).seats).some(isSpectatorId)).toBe(false);
  });

  it('a team target expands to the team without the revealer', () => {
    const s = fresh('2hg', 4);
    expect(revealRecipients(s, 's0', { kind: 'team', team: 't1' })).toEqual({ seats: ['s2', 's3'], spectators: [] });
    expect(revealRecipients(s, 's0', { kind: 'team', team: 't0' })).toEqual({ seats: ['s1'], spectators: [] });
    expect(revealRecipients(s, 's0', { kind: 'seat', seat: 's2' })).toEqual({ seats: ['s2'], spectators: [] });
    expect(revealRecipients(s, 's0', { kind: 'seat', seat: 's0' })).toEqual({ seats: [], spectators: [] });
    expect(revealRecipients(s, 's0', { kind: 'team', team: 'nope' })).toEqual({ seats: [], spectators: [] });
    expect(revealRecipients(s, 's0', { kind: 'spectator', spectator: 'v:abc' })).toEqual({ seats: [], spectators: ['v:abc'] });
  });
});

describe('reducer additions', () => {
  it('team chat never enters the shared log; table and spectator chat do', () => {
    const s = fresh();
    no(s, act('chat', { text: 'psst', channel: 'team' }), /pair channel/);
    ok(s, act('chat', { text: 'gl', channel: 'table' }));
    ok(s, act('chat', { text: 'hi', channel: 'spectator', name: 'Viv' }, spectatorIdOf('0123456789abcdef')));
  });

  it('formatSet is refused until M3-P1 implements it', () => {
    no(fresh(), act('formatSet', { format: 'ffa3', life: 20 }), /M3-P1/);
  });

  it('teamChat travels on the pair channel', () => {
    expect(MESSAGE_CHANNEL.teamChat).toBe('prv');
    expect(MESSAGE_CHANNEL.teamHand).toBe('prv');
  });
});

describe('layout descriptors', () => {
  it('every format lists a clockwise turn order; solo has one seat', () => {
    for (const f of FORMATS) expect(mtgLayout(f).turnOrder).toEqual(mtgLayout(f).seats.map((s) => s.index));
    expect(soloLayout().turnOrder).toEqual([0]);
  });

  it('Two-Headed Giant teams adjoin with no gap and share an avatar outside their near edge', () => {
    const l = mtgLayout('2hg');
    expect(l.teams).toHaveLength(2);
    expect(l.seats.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    const [t0, t1] = l.teams!;
    expect(t0!.seats).toEqual([0, 1]);
    expect(t1!.seats).toEqual([2, 3]);
    expect(t0!.territory).toEqual({ x: 0, y: -330, w: 2200, d: 440, rot: 0 });
    expect(t1!.territory).toEqual({ x: 0, y: 330, w: 2200, d: 440, rot: 180 });
    // Outside the near edge, centred on the team.
    expect(t0!.avatar.x).toBe(0);
    expect(t0!.avatar.y).toBeLessThan(-550);
    expect(t1!.avatar.y).toBeGreaterThan(550);
    for (const f of ['1v1', 'ffa3', 'ffa4'] as const) {
      expect(mtgLayout(f).teams).toBeUndefined();
      expect(mtgLayout(f).seats.every((s) => s.team === undefined)).toBe(true);
    }
    expect(mtgStartingLife('2hg')).toBe(30);
  });
});

describe('voice, captions and settings contracts', () => {
  it('talk defaults: push-to-talk voice, no dictation, not muted', () => {
    expect(DEFAULT_SETTINGS.talk).toEqual({ gate: 'ptt', voice: true, dictation: false, muted: false, mouseButton: null });
    expect(DEFAULT_SETTINGS.micDevice).toBeNull();
    expect(DEFAULT_SETTINGS.peerAudio).toEqual({});
    expect(TALK_CLOSED.audio).toBe('off');
  });

  it('caption limits follow the screen-layer spec', () => {
    expect(CAPTION_MAX_WIDTH_PX).toBe(280);
    expect(CAPTION_MAX_LINES).toBe(3);
  });

  it('the fake engine satisfies the speech-engine interface and captures no audio', async () => {
    const e = await FAKE_SPEECH.create();
    expect(e).toBeInstanceOf(FakeSpeechEngine);
    expect(e.id).toBe('fake');
    expect(FAKE_SPEECH.info.audio).toBe('none');
    expect(SPEECH_ENGINES.webspeech.info.audio).toBe('vendor');
    expect(SPEECH_ENGINES.local.info.audio).toBe('device');
  });

  it('stubs name their package', async () => {
    const host = {} as never;
    expect(() => talkState(host)).toThrow(/M3-P3/);
    expect(() => createVoice(host)).toThrow(/M3-P3/);
    expect(() => createCaptions(host)).toThrow(/M3-P4/);
    await expect(SPEECH_ENGINES.local.create()).rejects.toThrow(/M3-P4/);
    expect(() => roleProblem(fresh(), act('chat', { text: 'x', channel: 'table' }), { role: 'spectator', peerId: 'p', seat: null })).toThrow(/M3-P5/);
    expect(() => spectatorsOf([])).toThrow(/M3-P5/);
    expect(() => createTeamChannel(host)).toThrow(/M3-P2/);
    expect(() => createTeamDraftDriver(host)).toThrow(/M3-P2/);
    expect(() => createTeamSealedDriver(host)).toThrow(/M3-P2/);
  });
});
