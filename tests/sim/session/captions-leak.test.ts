/**
 * The dictated-captions scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its
 * scenario; DESIGN "Chat and voice", Dictation and captions; PLAN M3-P4). A dictates over the real networked sessions
 * with the fake engine while hovering a card in its hand, right after drawing (the last card it touched is in its
 * hand), and then about a card it played face down. Neither the interim captions on presence nor the `caption`
 * actions name a card of A's hand or library, nothing B received carries a hidden identity (the shared scanner), and
 * the face-down card is named by its public id only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TALK } from '../../../src/store/types';
import { FakeSpeechEngine } from '../../../src/voice/fake';
import { createdEngines, FAKE_SPEECH } from '../../../src/voice/speech/index';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { scan } from '../../leak/scan';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

function listeningFake(): FakeSpeechEngine {
  const e = createdEngines().filter((x): x is FakeSpeechEngine => x instanceof FakeSpeechEngine && x.listening);
  if (e.length !== 1) throw new Error(`expected one listening fake engine, found ${e.length}`);
  return e[0]!;
}

describe('shared leak test: dictated captions', () => {
  it('captions never name a hidden card, and nothing B received carries A’s hidden identities', async () => {
    const network = net({ seed: 11, delay: { min: 0, max: 120 }, faultyChannels: ['act', 'ctl', 'pres'] });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers.push(A, B);
    // A dictates with an open gate (no talk key needed); B only listens.
    await A.stores.settings.set('talk', { ...DEFAULT_TALK, voice: false, dictation: true, gate: 'open' });
    const a = await open(network, A, {}, { voice: { media: {} as never, settings: A.stores.settings, engines: [FAKE_SPEECH] } });
    const b = await open(network, B);
    await waitConverged([a, b], 'both seated');
    const shownToB = trackDisclosures(a, 's1');
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'A ready');
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'B ready');
    await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
    await settle(a.draw(7));
    await waitConverged([a, b], 'A’s opening hand');
    expect(a.captions).toBeDefined();
    await until(() => createdEngines().some((e) => e instanceof FakeSpeechEngine && e.listening), 5_000, 'A’s engine to listen');

    // Hovering a hand card, the last touched card in the hand: the caption names no card.
    const hand = [...a.secrets().hand];
    a.captions!.hover({ kind: 'card', id: hand[0]! });
    const engine = listeningFake();
    engine.say('I need a', false);
    engine.say('I need a land', true);
    await until(() => b.log().some((e) => e.kind === 'action' && e.action.type === 'caption'), 10_000, 'B to get the caption');
    const first = b.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'caption' ? [e.action] : []))[0]!;
    expect(first.text).toBe('I need a land');
    expect(first.anchor).toBeUndefined();

    // A plays a card face down and talks about it: the public instance id is the anchor, the identity stays with A.
    const faceDown = a.secrets().hand[1]!;
    a.playFaceDown(faceDown, 'battlefield:s0', { x: 60, y: -200, rot: 0 });
    await waitConverged([a, b], 'the face-down play');
    a.captions!.hover(null);
    engine.say('morph', false);
    engine.say('morph, pay three later', true);
    await until(() => b.log().filter((e) => e.kind === 'action' && e.action.type === 'caption').length === 2, 10_000, 'the second caption');
    await waitConverged([a, b], 'the captions');
    const second = b.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'caption' ? [e.action] : []))[1]!;
    expect(second.anchor).toEqual({ kind: 'card', id: faceDown });
    expect(b.engine.confirmedState().cards[faceDown]!.identity).toBeUndefined();

    // Every caption and interim B received: no id of a card in A's hand or library.
    const state = a.engine.confirmedState();
    const hidden = Object.values(state.cards)
      .filter((c) => c.owner === 's0' && state.zones[c.zone]?.visibility !== 'public')
      .map((c) => c.id);
    expect(hidden.length).toBeGreaterThan(40);
    const observed = await observedBy(network, B);
    const captionStuff = observed.flatMap((m) => {
      const out: unknown[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          if (o.t === 'captionInterim' || o.type === 'caption') out.push(o);
          else Object.values(o).forEach(walk);
        }
      };
      walk(m);
      return out;
    });
    expect(captionStuff.some((m) => (m as { t?: string }).t === 'captionInterim')).toBe(true);
    expect(scan(captionStuff, hidden)).toEqual([]);

    const input = { observed, owner: { state, secrets: a.secrets() }, disclosed: shownToB };
    expect(forbiddenFor(input).tokens.length).toBeGreaterThan(40);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });
});
