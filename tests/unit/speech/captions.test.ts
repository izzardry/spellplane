/**
 * PLAN M3-P4 (fake engine), unit level: dictated captions (DESIGN "Chat and voice", Dictation and captions).
 *
 * - Placement: a caption is anchored to the card or stack item the speaker last acted on or is hovering; with no card
 *   context it has no anchor and sits beside the speaker's avatar; it grows with interim words and fades a few seconds
 *   after the final result.
 * - Record: the final transcript is a `caption` action in the log, attached (`about`) to that action.
 * - Notes by voice: while a note field has focus, dictation goes there instead.
 * - Hidden information: a caption never names a card in a hand or library.
 * - Engines: the local model is never created or downloaded unless the player chooses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../../src/core/types';
import { CAPTION_LINGER_MS, TALK_CLOSED, type CaptionControls, type LocalSpeechEngine, type SpeechEngine, type SpeechListener } from '../../../src/voice/types';
import { createCaptions, FINAL_GRACE_MS, INTERIM_STALE_MS, lastTouched, publicAnchor, speechLang } from '../../../src/voice/captions';
import { FakeSpeechEngine } from '../../../src/voice/fake';
import { P, play, readyTable } from '../core/helpers';
import { act, countingFactory, memorySettings, OPEN, TestTable } from './helpers';

/** Two seats, each with two cards on its battlefield (a00, a01 for s0; b00, b01 for s1) and eight in the library. */
function table(me = 's0'): TestTable {
  let s = readyTable(10);
  s = play(s, 'a00', P(-100, -250));
  s = play(s, 'a01', P(100, -250));
  s = play(s, 'b00', P(-100, 250, 180), 's1');
  s = play(s, 'b01', P(100, 250, 180), 's1');
  const t = new TestTable(s, me);
  // The setup is history before the controller starts.
  return t;
}

/** Let promises (settings, engine creation) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function fakeOf(t: TestTable): FakeSpeechEngine {
  const f = t.engines[0] as ReturnType<typeof countingFactory>;
  const e = f.created.at(-1);
  if (!(e instanceof FakeSpeechEngine)) throw new Error('no fake engine was created');
  return e;
}

let controls: CaptionControls | null = null;
async function start(t: TestTable, opts: { talk?: boolean } = {}): Promise<CaptionControls> {
  controls = createCaptions(t.host(opts));
  await flush();
  return controls;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  controls?.dispose();
  controls = null;
  vi.useRealTimers();
});

describe('lastTouched: the card or stack item a seat last acted on (DESIGN "Chat and voice", Placement and Record)', () => {
  it('names the speaker’s last card action and its cid, ignoring other seats', () => {
    const t = table();
    const tap = t.apply(act('tap', { card: 'a01', tapped: true }));
    t.apply(act('tap', { card: 'b00', tapped: true }, 's1'));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'card', id: 'a01' }, about: tap.cid });
    expect(lastTouched(t.log, 's1')?.anchor).toEqual({ kind: 'card', id: 'b00' });
  });

  it('passes over chat, earlier captions and undone actions', () => {
    const t = table();
    const move = t.apply(act('move', { card: 'a00', to: 'battlefield:s0', pose: P(0, -300) }));
    const tap = t.apply(act('tap', { card: 'a01', tapped: true }));
    t.apply(act('chat', { text: 'hm', channel: 'table' }));
    t.apply(act('caption', { text: 'earlier', anchor: { kind: 'card', id: 'a01' }, about: tap.cid }));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'card', id: 'a01' }, about: tap.cid });
    t.apply(act('undo', { of: tap.cid, inverse: act('tap', { card: 'a01', tapped: false }) }));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'card', id: 'a00' }, about: move.cid });
  });

  it('a turn pass or a life change ends the card context; an empty log has none', () => {
    const t = table();
    expect(lastTouched([], 's0')).toBeNull();
    t.apply(act('tap', { card: 'a01', tapped: true }));
    t.apply(act('life', { seat: 's1', delta: -3 }));
    expect(lastTouched(t.log, 's0')).toBeNull();
    t.apply(act('tap', { card: 'a00', tapped: true }));
    expect(lastTouched(t.log, 's0')?.anchor).toEqual({ kind: 'card', id: 'a00' });
    t.apply(act('turnPass', { to: 's1' }));
    expect(lastTouched(t.log, 's0')).toBeNull();
  });

  it('a spell is its card (also once resolved), an ability its stack item', () => {
    const t = table();
    const push = t.apply(act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'card', id: 'a01' }, about: push.cid });
    const resolve = t.apply(act('stackResolve', { item: 'i1' }));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'card', id: 'a01' }, about: resolve.cid });
    const ability = t.apply(act('stackPush', { item: 'i2', kind: 'ability', source: 'a00' }));
    expect(lastTouched(t.log, 's0')).toEqual({ anchor: { kind: 'stackItem', id: 'i2' }, about: ability.cid });
  });

  it('publicAnchor names only cards in public zones, live stack items and seats', () => {
    const t = table();
    expect(publicAnchor(t.state, { kind: 'card', id: 'a00' })).toEqual({ kind: 'card', id: 'a00' });
    expect(publicAnchor(t.state, { kind: 'card', id: 'a05' })).toBeNull(); // in the library
    expect(publicAnchor(t.state, { kind: 'card', id: 'nope' })).toBeNull();
    expect(publicAnchor(t.state, { kind: 'stackItem', id: 'i9' })).toBeNull();
    expect(publicAnchor(t.state, { kind: 'seat', id: 's1' })).toEqual({ kind: 'seat', id: 's1' });
  });
});

describe('own captions with the fake engine (PLAN M3-P4)', () => {
  it('a final transcript makes a caption anchored to the last-touched card and a log entry attached to that action', async () => {
    const t = table();
    const tap = t.apply(act('tap', { card: 'a01', tapped: true }));
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    const engine = fakeOf(t);
    expect(engine.listening).toBe(true);

    engine.say('two', false);
    engine.say('two damage to', false);
    const shown = c.captions();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ speaker: 's0', text: 'two damage to', final: false, anchor: { kind: 'card', id: 'a01' } });
    // Interim words go to the others on presence with the anchor, never into the log.
    expect(t.interims.at(-1)).toEqual({ text: 'two damage to', anchor: { kind: 'card', id: 'a01' } });
    expect(t.captionsSent()).toHaveLength(0);

    engine.say('two damage to your Elf', true);
    const sent = t.captionsSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ by: 's0', text: 'two damage to your Elf', anchor: { kind: 'card', id: 'a01' }, about: tap.cid });
    // One bubble: the final keeps the interim's id.
    const final = c.captions();
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ id: shown[0]!.id, final: true, about: tap.cid });

    // It fades a few seconds after the final result.
    await vi.advanceTimersByTimeAsync(CAPTION_LINGER_MS - 100);
    expect(c.captions()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(c.captions()).toHaveLength(0);
    // The interim presence is cleared once the others had the final.
    expect(t.interims.at(-1)).toEqual({ text: null, anchor: null });
  });

  it('with no card context the caption has no anchor and is attached to no action (it sits at the avatar)', async () => {
    const t = table();
    t.apply(act('tap', { card: 'a01', tapped: true }));
    t.apply(act('turnPass', { to: 's1' }));
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    fakeOf(t).say('your go', true);
    const [sent] = t.captionsSent();
    expect(sent?.text).toBe('your go');
    expect(sent?.anchor).toBeUndefined();
    expect(sent?.about).toBeUndefined();
    expect(c.captions()[0]?.anchor).toBeNull();
  });

  it('a hovered card on the table is the anchor; the record still names the action last acted on', async () => {
    const t = table();
    const push = t.apply(act('stackPush', { item: 'shock', kind: 'spell', card: 'a01' }));
    const c = await start(t);
    c.hover({ kind: 'card', id: 'b00' });
    t.setTalk(OPEN);
    await flush();
    fakeOf(t).say('two damage to your Elf', true);
    expect(t.captionsSent()[0]).toMatchObject({ anchor: { kind: 'card', id: 'b00' }, about: push.cid });
  });

  it('never names a card in a hidden zone: a hovered library card or a last-touched card gone to the hand', async () => {
    const t = table();
    const draw = t.apply(act('draw', { instanceId: 'a05' }));
    const c = await start(t);
    c.hover({ kind: 'card', id: 'a06' });
    t.setTalk(OPEN);
    await flush();
    const engine = fakeOf(t);
    engine.say('need a land', false);
    engine.say('need a land', true);
    const [sent] = t.captionsSent();
    expect(sent?.anchor).toBeUndefined();
    expect(sent?.about).toBe(draw.cid);
    expect(t.interims.every((i) => i.anchor === null)).toBe(true);
    expect(JSON.stringify([...t.interims, ...c.captions(), sent])).not.toMatch(/a05|a06/);
  });

  it('the anchor is fixed when the utterance starts', async () => {
    const t = table();
    t.apply(act('tap', { card: 'a00', tapped: true }));
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    const engine = fakeOf(t);
    engine.say('attack with', false);
    t.apply(act('tap', { card: 'a01', tapped: true }));
    engine.say('attack with both', true);
    expect(t.captionsSent()[0]?.anchor).toEqual({ kind: 'card', id: 'a00' });
    expect(c.captions()).toHaveLength(1);
  });

  it('nothing is transcribed and no engine is created while dictation is off', async () => {
    const t = table();
    const c = await start(t);
    expect((t.engines[0] as ReturnType<typeof countingFactory>).created).toHaveLength(0);
    t.setTalk({ ...TALK_CLOSED, audio: 'all', reason: 'key' }); // live voice only
    await flush();
    expect((t.engines[0] as ReturnType<typeof countingFactory>).created).toHaveLength(0);
    t.setTalk(OPEN);
    await flush();
    t.setTalk(TALK_CLOSED);
    await flush();
    expect(fakeOf(t).listening).toBe(false);
    fakeOf(t).say('should not appear', true);
    await vi.advanceTimersByTimeAsync(FINAL_GRACE_MS + 10);
    expect(c.captions()).toHaveLength(0);
    expect(t.captionsSent()).toHaveLength(0);
  });

  it('without a talk source nothing is dictated', async () => {
    const t = table();
    await start(t, { talk: false });
    expect((t.engines[0] as ReturnType<typeof countingFactory>).created).toHaveLength(0);
  });

  it('keeps the final that comes just after the talk key is released, and finishes an utterance whose final never comes', async () => {
    // An engine that hands out its listener so the test can deliver after stop (as Web Speech does).
    let listener: SpeechListener | null = null;
    const late: SpeechEngine = { id: 'fake', available: async () => true, start: (_l, on) => (listener = on), stop: () => undefined };
    const t = new TestTable(table().state, 's0', memorySettings(), [countingFactory('fake', () => late)]);
    t.apply(act('tap', { card: 'a00', tapped: true }));
    await start(t);
    t.setTalk(OPEN);
    await flush();
    listener!('first words', false);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(500);
    listener!('first words here', true);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['first words here']);

    t.setTalk(OPEN);
    await flush();
    listener!('second try', false);
    t.setTalk(TALK_CLOSED);
    await vi.advanceTimersByTimeAsync(FINAL_GRACE_MS + 10);
    // The words the others already saw become the final caption.
    expect(t.captionsSent().map((a) => a.text)).toEqual(['first words here', 'second try']);
    listener!('too late', true);
    expect(t.captionsSent()).toHaveLength(2);
  });

  it('an empty final drops the interim caption and clears it on presence', async () => {
    const t = table();
    const c = await start(t);
    t.setTalk(OPEN);
    await flush();
    fakeOf(t).say('uh', false);
    fakeOf(t).say('', true);
    expect(c.captions()).toHaveLength(0);
    expect(t.interims.at(-1)).toEqual({ text: null, anchor: null });
    expect(t.captionsSent()).toHaveLength(0);
  });
});

describe('other players’ captions', () => {
  function peerLog(t: TestTable): LogEntry[] {
    return t.log;
  }

  it('show the interim from presence, then the final from the log as the same bubble, then fade', async () => {
    const t = table('s1');
    const c = await start(t);
    t.setPeer({ peerId: 'anna', seat: 's0', caption: { text: 'two damage', anchor: { kind: 'card', id: 'a01' } } });
    expect(c.captions()).toEqual([expect.objectContaining({ speaker: 's0', text: 'two damage', final: false, anchor: { kind: 'card', id: 'a01' } })]);
    const id = c.captions()[0]!.id;
    const tap = t.apply(act('tap', { card: 'a01', tapped: true }));
    t.apply(act('caption', { text: 'two damage to your Elf', anchor: { kind: 'card', id: 'a01' }, about: tap.cid }));
    expect(c.captions()).toEqual([expect.objectContaining({ id, speaker: 's0', text: 'two damage to your Elf', final: true, about: tap.cid })]);
    expect(peerLog(t).at(-1)).toMatchObject({ action: { type: 'caption', about: tap.cid } });
    // The spent interim is not shown again, also after the final has faded.
    await vi.advanceTimersByTimeAsync(CAPTION_LINGER_MS + 10);
    expect(c.captions()).toHaveLength(0);
    t.setPeer({ peerId: 'anna', cursor: { x: 1, y: 1 } });
    expect(c.captions()).toHaveLength(0);
    // The next utterance is a new bubble.
    t.setPeer({ peerId: 'anna', caption: null });
    t.setPeer({ peerId: 'anna', caption: { text: 'and', anchor: null } });
    expect(c.captions()).toEqual([expect.objectContaining({ text: 'and', final: false, anchor: null })]);
    expect(c.captions()[0]!.id).not.toBe(id);
  });

  it('drop an interim whose final never came', async () => {
    const t = table('s1');
    const c = await start(t);
    t.setPeer({ peerId: 'anna', seat: 's0', caption: { text: 'hello', anchor: null } });
    expect(c.captions()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(INTERIM_STALE_MS + 10);
    expect(c.captions()).toHaveLength(0);
  });

  it('a cleared presence caption removes the interim bubble', async () => {
    const t = table('s1');
    const c = await start(t);
    t.setPeer({ peerId: 'anna', seat: 's0', caption: { text: 'hm', anchor: null } });
    t.setPeer({ peerId: 'anna', caption: null });
    expect(c.captions()).toHaveLength(0);
  });

  it('captions in the log from before this page started are history, not bubbles', async () => {
    const t = table('s1');
    t.apply(act('caption', { text: 'old' }));
    const c = await start(t);
    expect(c.captions()).toHaveLength(0);
    t.apply(act('caption', { text: 'new' }));
    expect(c.captions().map((x) => x.text)).toEqual(['new']);
  });
});

describe('dictation into note fields (DESIGN "Chat and voice", Notes by voice)', () => {
  it('a focused field gets the interim and final text, and no caption is sent', async () => {
    const t = table();
    const c = await start(t);
    const got: [string, boolean][] = [];
    c.dictateInto({ kind: 'field', insert: (text, final) => got.push([text, final]) });
    t.setTalk({ ...OPEN, dictation: 'field' });
    await flush();
    fakeOf(t).say('flying', false);
    fakeOf(t).say('flying until end of turn', true);
    expect(got).toEqual([
      ['flying', false],
      ['flying until end of turn', true],
    ]);
    expect(c.captions()).toHaveLength(0);
    expect(t.captionsSent()).toHaveLength(0);
    expect(t.interims).toHaveLength(0);
    // Leaving the field returns dictation to captions.
    c.dictateInto(null);
    fakeOf(t).say('now a caption', true);
    expect(t.captionsSent().map((a) => a.text)).toEqual(['now a caption']);
  });

  it('a card note or stack note target is written with the note actions, after any note already there', async () => {
    const t = table();
    t.apply(act('note', { card: 'a00', text: 'kicked' }));
    t.apply(act('stackPush', { item: 'trig', kind: 'trigger', source: 'a01' }));
    const c = await start(t);
    t.setTalk({ ...OPEN, dictation: 'field' });
    await flush();
    c.dictateInto({ kind: 'cardNote', card: 'a00' });
    fakeOf(t).say('gets plus two', true);
    expect(t.state.cards.a00?.note).toBe('kicked gets plus two');
    c.dictateInto({ kind: 'stackNote', item: 'trig' });
    fakeOf(t).say('targets Ben', true);
    expect(t.state.stack.find((i) => i.id === 'trig')?.note).toBe('targets Ben');
    expect(t.captionsSent()).toHaveLength(0);
  });
});

describe('engines and language (DESIGN "Chat and voice", Engine and Language)', () => {
  function realish(): { web: ReturnType<typeof countingFactory>; local: ReturnType<typeof countingFactory>; loads: number[] } {
    const loads: number[] = [];
    const web = countingFactory('webspeech');
    const local = countingFactory('local', () => {
      const e = new FakeSpeechEngine() as unknown as LocalSpeechEngine & { loadedFlag: boolean };
      Object.assign(e, {
        id: 'local',
        loaded: false,
        load: async (on?: (l: number, t: number) => void) => {
          loads.push(1);
          on?.(5, 10);
          on?.(10, 10);
        },
      });
      return e;
    });
    return { web, local, loads };
  }

  it('the local model is not created, let alone downloaded, unless it is chosen', async () => {
    const { web, local, loads } = realish();
    const t = new TestTable(table().state, 's0', memorySettings(), [web, local]);
    const c = await start(t);
    expect(c.engine().id).toBe('webspeech');
    const listed = await c.engines();
    expect(listed.map((e) => [e.info.id, e.available])).toEqual([
      ['webspeech', true],
      ['local', true],
    ]);
    t.setTalk(OPEN);
    await flush();
    expect(web.created).toHaveLength(1);
    expect(local.created).toHaveLength(0);
    expect(loads).toHaveLength(0);

    const progress: [number, number][] = [];
    await c.setEngine('local', (l, n) => progress.push([l, n]));
    expect(local.created).toHaveLength(1);
    expect(loads).toHaveLength(1);
    expect(progress.at(-1)).toEqual([10, 10]);
    expect(c.engine().id).toBe('local');
    expect(t.settings.data.speechEngine).toBe('local');
    // The open microphone moved to the new engine.
    await flush();
    expect((local.created[0] as FakeSpeechEngine).listening).toBe(true);
    expect((web.created[0] as FakeSpeechEngine).listening).toBe(false);
  });

  it('a failed download keeps the engine as it was', async () => {
    const web = countingFactory('webspeech');
    const local = countingFactory('local', () => Object.assign(new FakeSpeechEngine(), { id: 'local', load: () => Promise.reject(new Error('offline')) }) as unknown as SpeechEngine);
    const t = new TestTable(table().state, 's0', memorySettings(), [web, local]);
    const c = await start(t);
    await expect(c.setEngine('local')).rejects.toThrow('offline');
    expect(c.engine().id).toBe('webspeech');
    expect(t.settings.data.speechEngine).toBe('webspeech');
  });

  it('a stored choice of the local model is honoured and warmed up; the fake engine wins under ?speech=fake', async () => {
    const { web, local, loads } = realish();
    const t = new TestTable(table().state, 's0', memorySettings({ speechEngine: 'local' }), [web, local]);
    const c = await start(t);
    expect(c.engine().id).toBe('local');
    // It was chosen earlier, so it loads (from the browser's cache) right away.
    expect(local.created).toHaveLength(1);
    expect(loads).toHaveLength(1);
    c.dispose();
    const f = new TestTable(table().state, 's0', memorySettings({ speechEngine: 'local' }), [countingFactory('fake')]);
    const cf = await start(f);
    expect(cf.engine().id).toBe('fake');
  });

  it('the language defaults to the browser’s and a chosen one is stored and used by the engine', async () => {
    expect(speechLang('en', 'de-DE')).toBe('de-DE');
    expect(speechLang('fr-FR', 'de-DE')).toBe('fr-FR');
    expect(speechLang(null, null)).toBe('en');
    const t = table();
    const c = await start(t);
    await c.setLang('it-IT');
    expect(c.lang()).toBe('it-IT');
    expect(t.settings.data.speechLang).toBe('it-IT');
    t.setTalk(OPEN);
    await flush();
    expect(fakeOf(t).lang).toBe('it-IT');
    // Switching language while listening restarts the engine in it.
    await c.setLang('de-DE');
    await flush();
    expect(fakeOf(t).lang).toBe('de-DE');
    expect(fakeOf(t).listening).toBe(true);
  });
});
