/**
 * The log as a live region and the spoken focus (DESIGN "Input and interaction design", Accessibility: "The log is a
 * live region, so screen readers announce actions"; PLAN M5-P4: polite, not flooding; DECISIONS [M5-C]: 'assertive'
 * only for prompts addressed to this player; spoken names via an accessible mirror).
 */
import { describe, expect, it, vi } from 'vitest';
import { ANNOUNCE, AnnounceQueue, type AnnounceTimers } from '../../../src/ui/a11y/announcer';
import { ANNOUNCE_HISTORY_MAX, describeCard, describeFocus, LogAnnouncements, lineText, zoneLabel } from '../../../src/ui/a11y/index';
import type { Politeness } from '../../../src/ui/a11y/index';
import type { LogLine } from '../../../src/ui/describe';
import { game, namer, table, withCards } from './fixture';

function harness() {
  const out: { text: string; politeness: Politeness }[] = [];
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const t: AnnounceTimers = {
    set(fn, ms) {
      const id = ++seq;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clear(h) {
      timers = timers.filter((x) => x.id !== h);
    },
  };
  const q = new AnnounceQueue({ write: (text, politeness) => out.push({ text, politeness }) }, t);
  const advance = (ms: number) => {
    now += ms;
    for (const x of timers.filter((x) => x.at <= now)) {
      timers = timers.filter((y) => y !== x);
      x.fn();
    }
  };
  return { q, out, advance };
}

describe('AnnounceQueue (the page live region)', () => {
  it('a polite line waits a moment and is spoken once', () => {
    const { q, out, advance } = harness();
    q.announce('Anna taps Llanowar Elves');
    expect(out).toEqual([]);
    advance(ANNOUNCE.batchMs);
    expect(out).toEqual([{ text: 'Anna taps Llanowar Elves', politeness: 'polite' }]);
    advance(5000);
    expect(out).toHaveLength(1);
  });

  it('lines close together become one announcement; a burst becomes a count and the latest line (not flooding)', () => {
    const { q, out, advance } = harness();
    q.announce('Anna taps Forest');
    q.announce('Anna taps Plains');
    advance(ANNOUNCE.batchMs);
    expect(out.map((o) => o.text)).toEqual(['Anna taps Forest. Anna taps Plains']);
    for (let i = 1; i <= 12; i++) q.announce(`Ben draws card ${i}`);
    advance(ANNOUNCE.batchMs);
    expect(out).toHaveLength(2);
    expect(out[1]!.text).toBe('12 new log lines. Latest: Ben draws card 12');
  });

  it('assertive prompts go out at once on their own politeness; focus changes at once, politely', () => {
    const { q, out } = harness();
    q.announce('Anna taps Forest');
    q.announce('Ben asks for responses. Enter: OK. Escape: hold.', 'assertive');
    q.focus('Shock. Your hand, 1 of 7');
    expect(out).toEqual([
      { text: 'Ben asks for responses. Enter: OK. Escape: hold.', politeness: 'assertive' },
      { text: 'Shock. Your hand, 1 of 7', politeness: 'polite' },
    ]);
  });

  it('a passed-on focus is spoken after the log lines waiting in the batch, not before them', () => {
    const { q, out, advance } = harness();
    q.announce('Anna casts Shock');
    q.focusAfterLog('Forest. Your hand, 1 of 6');
    expect(out.map((o) => o.text)).toEqual(['Anna casts Shock', 'Forest. Your hand, 1 of 6']);
    advance(ANNOUNCE.batchMs);
    expect(out).toHaveLength(2);
    // With nothing waiting it is spoken at once.
    q.focusAfterLog('Plains. Your hand, 1 of 5');
    expect(out.at(-1)).toEqual({ text: 'Plains. Your hand, 1 of 5', politeness: 'polite' });
  });

  it('ignores empty text and keeps the last ANNOUNCE_HISTORY_MAX announcements for the debug hook', () => {
    const { q, advance } = harness();
    q.announce('   ');
    q.focus('');
    advance(1000);
    expect(q.history()).toEqual([]);
    for (let i = 0; i < ANNOUNCE_HISTORY_MAX + 20; i++) q.focus(`f${i}`);
    expect(q.history()).toHaveLength(ANNOUNCE_HISTORY_MAX);
    expect(q.history()[0]).toBe('f20');
  });

  it('dispose drops what waits', () => {
    const { q, out, advance } = harness();
    q.announce('late');
    q.dispose();
    advance(1000);
    expect(out).toEqual([]);
  });

  it('runs on real timers by default', () => {
    vi.useFakeTimers();
    try {
      const out: string[] = [];
      const q = new AnnounceQueue({ write: (t) => out.push(t) });
      q.announce('x');
      vi.advanceTimersByTime(ANNOUNCE.batchMs);
      expect(out).toEqual(['x']);
    } finally {
      vi.useRealTimers();
    }
  });
});

const line = (key: string, over: Partial<LogLine> = {}): LogLine => ({ key, kind: 'action', seat: 's1', colour: 1, actor: 'Ben', segs: [{ text: 'taps ' }, { card: 'c1', name: 'Forest' }], at: 0, ...over });

describe('LogAnnouncements (which log lines are new)', () => {
  it('reads nothing out for the log the page opened with, then each new line once', () => {
    const la = new LogAnnouncements('s0');
    expect(la.next([line('a'), line('b')])).toEqual([]);
    expect(la.next([line('a'), line('b'), line('c', { segs: [{ text: 'draws a card' }] })])).toEqual(['Ben draws a card']);
    expect(la.next([line('a'), line('b'), line('c', { segs: [{ text: 'draws a card' }] })])).toEqual([]);
  });

  it('announces a merged line again when its text changes (life changes in one line)', () => {
    const la = new LogAnnouncements('s0');
    la.next([]);
    const life = (t: string) => line('l', { joined: true, segs: [{ text: t }] });
    expect(la.next([life('20 → 19')])).toEqual(['Ben: 20 → 19']);
    expect(la.next([life('20 → 17')])).toEqual(['Ben: 20 → 17']);
  });

  it('an older line that changed in place (a card name resolved late, a seat renamed) is not read out again', () => {
    const la = new LogAnnouncements('s0');
    la.next([]);
    const named = (key: string, name: string) => line(key, { segs: [{ text: 'taps ' }, { card: 'c1', name }] });
    expect(la.next([named('a', 'Card'), named('b', 'Card'), named('c', 'Card')])).toEqual(['Ben taps Card', 'Ben taps Card', 'Ben taps Card']);
    // The card data loaded: every line now names the card. Only the newest is spoken again, never a burst of old lines.
    expect(la.next([named('a', 'Forest'), named('b', 'Forest'), named('c', 'Forest')])).toEqual(['Ben taps Forest']);
    // A rename of the seat changes old lines only, while a new line arrives: just the new line.
    expect(la.next([named('a', 'Forest'), named('b', 'Forest'), named('c', 'Forest'), line('d', { actor: 'Benjamin', segs: [{ text: 'draws a card' }] })])).toEqual(['Benjamin draws a card']);
    expect(la.next([line('a', { actor: 'Benjamin' }), line('b', { actor: 'Benjamin' }), line('c', { actor: 'Benjamin' }), line('d', { actor: 'Benjamin', segs: [{ text: 'draws a card' }] })])).toEqual([]);
  });

  it('does not echo the viewer\'s own chat, but reads others\' chat and system lines', () => {
    const la = new LogAnnouncements('s0');
    la.next([]);
    const out = la.next([
      line('m', { kind: 'chat', seat: 's0', actor: 'Anna', segs: [{ text: 'hi' }] }),
      line('n', { kind: 'chat', seat: 's1', actor: 'Ben', segs: [{ text: 'hello' }] }),
      line('t', { kind: 'chat', seat: 's1', actor: 'Ben', channel: 'team', segs: [{ text: 'attack?' }] }),
      line('s', { kind: 'system', seat: null, colour: null, actor: '', segs: [{ text: 'Ben is away' }] }),
    ]);
    expect(out).toEqual(['Ben: hello', 'Ben (team): attack?', 'Ben is away']);
  });

  it('a log that shrank (a resume replaced it) reads nothing out', () => {
    const la = new LogAnnouncements('s0');
    la.next([line('a'), line('b')]);
    expect(la.next([line('x')])).toEqual([]);
  });

  it('lineText joins the actor and the line as the log panel shows it', () => {
    expect(lineText(line('a'))).toBe('Ben taps Forest');
    expect(lineText(line('c', { kind: 'chat', segs: [{ text: 'gg' }] }))).toBe('Ben: gg');
    expect(lineText(line('d', { kind: 'chat', told: true, segs: [{ text: 'casts Shock: “at you”' }] }))).toBe('Ben casts Shock: “at you”');
  });
});

describe('spoken focus', () => {
  const st = withCards(table('1v1'), [
    { id: 'elf', zone: 'battlefield:s0', tapped: true, counters: { '+1/+1': 2 }, combat: 'attack', pose: { x: 0, y: -250, rot: 90 } },
    { id: 'aura', zone: 'battlefield:s0', attachedTo: 'elf', note: 'enchanted', pose: { x: 10, y: -240, rot: 0 } },
    { id: 'fd', zone: 'battlefield:s1', face: 'down', pose: { x: 0, y: 300, rot: 180 } },
    { id: 'lib', zone: 'library:s1' },
  ]);
  const names = namer({ elf: 'Llanowar Elves', aura: 'Rancor' });

  it('names the card, its state and where it is', () => {
    expect(describeCard(st, 'elf', names)).toBe('Llanowar Elves, tapped, attacking, 2 +1/+1 counters');
    expect(describeCard(st, 'aura', names)).toBe('Rancor, attached to Llanowar Elves, note: enchanted');
    expect(describeFocus(st, game, 's0', { zone: 'battlefield:s0', card: 'elf' }, names)).toMatch(/^Llanowar Elves, tapped.*\. Your battlefield, \d of 2$/);
  });

  it('never names what this browser may not know: another player\'s face-down card stays hidden', () => {
    expect(describeCard(st, 'fd', names)).toBe('Hidden card, face down');
    expect(describeFocus(st, game, 's0', { zone: 'battlefield:s1', card: 'fd' }, names)).toBe("Hidden card, face down. Ben's battlefield, 1 of 1");
  });

  it('a hidden pile and an empty zone name the zone and its count', () => {
    expect(describeFocus(st, game, 's0', { zone: 'library:s1', card: null }, names)).toBe("Ben's library, 1 card, face down");
    expect(describeFocus(st, game, 's0', { zone: 'graveyard:s0', card: null }, names)).toBe('Your graveyard, empty');
    expect(zoneLabel(st, game, 's0', 'stack')).toBe('Stack');
    expect(zoneLabel(st, game, null, 'hand:s0')).toBe("Anna's hand");
  });
});
