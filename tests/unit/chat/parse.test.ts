/**
 * PLAN M1-P6 acceptance: `[[card name]]` parsing (DESIGN "Chat and voice", Text chat: card names typed in double
 * brackets become hover previews), and the chat line as the log shows it (ui/describe.ts named segments).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { cardRefsIn, MAX_CARD_REF_LENGTH, parseChatText, type ChatPart } from '../../../src/core/log';
import type { LogEntry } from '../../../src/core/types';
import { logLines, type Seg } from '../../../src/ui/describe';
import { tableWith } from '../../../src/ui/fakes';

/** The parts joined back as typed: parsing never loses or changes a character. */
const joined = (parts: ChatPart[]) => parts.map((p) => ('card' in p ? p.raw : p.text)).join('');

describe('[[card name]] parsing (DESIGN "Chat and voice", Text chat)', () => {
  it('a bracketed name becomes a card reference between the plain text around it', () => {
    const text = 'Bolt your [[Grizzly Bears]] now';
    expect(parseChatText(text)).toEqual([{ text: 'Bolt your ' }, { card: 'Grizzly Bears', raw: '[[Grizzly Bears]]' }, { text: ' now' }]);
  });

  it('text without brackets is one plain part; empty text has no parts', () => {
    expect(parseChatText('good game')).toEqual([{ text: 'good game' }]);
    expect(parseChatText('')).toEqual([]);
  });

  it('several references, adjacent references and references at the edges', () => {
    expect(parseChatText('[[Shock]][[Opt]] and [[Duress]]')).toEqual([
      { card: 'Shock', raw: '[[Shock]]' },
      { card: 'Opt', raw: '[[Opt]]' },
      { text: ' and ' },
      { card: 'Duress', raw: '[[Duress]]' },
    ]);
  });

  it('trims the name and collapses inner whitespace; keeps punctuation, commas, apostrophes and double-faced names', () => {
    expect(parseChatText('[[  Ajani,   Adversary of Tyrants ]]')).toEqual([{ card: 'Ajani, Adversary of Tyrants', raw: '[[  Ajani,   Adversary of Tyrants ]]' }]);
    expect(parseChatText("[[Gideon's Reproach]]")[0]).toMatchObject({ card: "Gideon's Reproach" });
    expect(parseChatText('[[Delver of Secrets // Insectile Aberration]]')[0]).toMatchObject({ card: 'Delver of Secrets // Insectile Aberration' });
  });

  it('[[Name|SET]] carries a set hint in lower case; a bar without a set code is no reference', () => {
    expect(parseChatText('[[Shock|M19]]')).toEqual([{ card: 'Shock', set: 'm19', raw: '[[Shock|M19]]' }]);
    expect(parseChatText('[[Shock | m19 ]]')).toEqual([{ card: 'Shock', set: 'm19', raw: '[[Shock | m19 ]]' }]);
    expect(parseChatText('[[Shock|]]')).toEqual([{ text: '[[Shock|]]' }]);
    expect(parseChatText('[[Shock|not a set]]')).toEqual([{ text: '[[Shock|not a set]]' }]);
  });

  it('empty or blank brackets, unclosed brackets and single brackets stay plain text', () => {
    for (const s of ['[[]]', '[[   ]]', '[[Shock', 'Shock]]', '[Shock]', '[[Shock]', 'a [[ b', ']] [[']) {
      expect(parseChatText(s), s).toEqual([{ text: s }]);
    }
  });

  it('a name containing brackets or a line break is no reference; the innermost [[name]] of extra brackets is', () => {
    expect(parseChatText('[[[Shock]]]')).toEqual([{ text: '[' }, { card: 'Shock', raw: '[[Shock]]' }, { text: ']' }]);
    expect(parseChatText('[[a[b]]')).toEqual([{ text: '[[a[b]]' }]);
    expect(parseChatText('[[Grizzly\nBears]]')).toEqual([{ text: '[[Grizzly\nBears]]' }]);
    // An unclosed opener before a good reference does not swallow it.
    expect(parseChatText('[[oops [[Shock]]')).toEqual([{ text: '[[oops ' }, { card: 'Shock', raw: '[[Shock]]' }]);
  });

  it('a name longer than any card name stays plain text', () => {
    const ok = 'x'.repeat(MAX_CARD_REF_LENGTH);
    const long = 'x'.repeat(MAX_CARD_REF_LENGTH + 1);
    expect(parseChatText(`[[${ok}]]`)).toEqual([{ card: ok, raw: `[[${ok}]]` }]);
    expect(parseChatText(`[[${long}]]`)).toEqual([{ text: `[[${long}]]` }]);
  });

  it('the parts always join back to the text as typed', () => {
    for (const s of ['a [[B]] c', '[[[x]]]', '[[ y | m19 ]]!', '[[', ']]]]', '[[a]][[', 'x [[ ]] [[z]]', '[[\n]] [[ok]]']) expect(joined(parseChatText(s)), s).toBe(s);
  });

  it('cardRefsIn lists the names once each, case-insensitively, in order', () => {
    expect(cardRefsIn('[[Shock]] then [[Opt]], then [[shock]] again')).toEqual(['Shock', 'Opt']);
  });
});

describe('chat lines in the log (ui/describe.ts)', () => {
  const entry = (seq: number, action: Partial<Action> & { type: Action['type'] }): LogEntry => ({ kind: 'action', seq, at: 0, action: { by: 's1', cid: `c${seq}`, seq, ...action } as Action });

  it('a chat line shows the actor and the text, with each [[name]] as a named card segment', () => {
    const { state } = tableWith(['Anna', 'Ben'], []);
    const [line] = logLines([entry(1, { type: 'chat', text: 'watch out for [[Shock|m19]] and [[Opt]]', channel: 'table' })], { state, cardName: () => null, phaseLabel: (p) => p });
    expect(line!.kind).toBe('chat');
    expect(line!.actor).toBe('Ben');
    expect(line!.channel).toBe('table');
    expect(line!.segs).toEqual<Seg[]>([{ text: 'watch out for ' }, { text: 'Shock', named: 'Shock', set: 'm19' }, { text: ' and ' }, { text: 'Opt', named: 'Opt' }]);
  });

  it('brackets that are no reference are shown as typed; a team line keeps its tab', () => {
    const { state } = tableWith(['Anna', 'Ben'], []);
    const [line] = logLines([entry(1, { type: 'chat', text: 'array[[0]] is [[ ]]', channel: 'team' })], { state, cardName: () => null, phaseLabel: (p) => p });
    expect(line!.segs.map((s) => ('named' in s ? `<${s.named}>` : 'text' in s ? s.text : '')).join('')).toBe('array<0> is [[ ]]');
    expect(line!.channel).toBe('team');
  });

  it('a final caption is a chat line too, with previews', () => {
    const { state } = tableWith(['Anna', 'Ben'], []);
    const [line] = logLines([entry(1, { type: 'caption', text: 'two damage with [[Shock]]' })], { state, cardName: () => null, phaseLabel: (p) => p });
    expect(line!.kind).toBe('chat');
    expect(line!.segs[1]).toEqual({ text: 'Shock', named: 'Shock' });
  });
});
