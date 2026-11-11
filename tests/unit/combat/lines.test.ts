/**
 * Connection lines and pings, pure geometry (DESIGN "Combat and annotation": a line joins any two things, follows its
 * endpoints, carries an optional label; the five kinds target, attack, block, attachment, persistent mark; the
 * attachment line shows when an attached card is pulled apart; unassigned attackers show a dashed stub when there are
 * several opponents; pings fade after two seconds. "Input and interaction design", Accessibility: seat colours are
 * paired with a line dash).
 */
import { describe, expect, it } from 'vitest';
import type { Anchor, LineKind, Pose, TableState } from '../../../src/core/types';
import { lineKindFor } from '../../../src/scene/combat';
import { ATTACH_APART, LineView, STUB_LEN, arrowSegments, cardReach, cardRing, dashSegment, drawnLines, lineDrafts, lineSourceOf, pingAlpha, pingPad, strokeSegments, trimLine, type AnchorResolver } from '../../../src/scene/lines';
import { paper } from '../../../src/themes/paper';
import type { ActivePing } from '../../../src/scene/types';
import { mtg } from '../../../src/games/mtg';
import { P, act, applyDrafts, board, line, ok } from './helpers';

const resolver = (s: TableState): AnchorResolver => ({
  point: (a: Anchor) => {
    if (a.kind === 'card') return s.cards[a.id] && s.zones[s.cards[a.id]!.zone]?.visibility === 'public' ? { x: s.cards[a.id]!.pose.x, y: s.cards[a.id]!.pose.y } : null;
    if (a.kind === 'seat') return { x: 0, y: a.id === 's0' ? -600 : 600 };
    return null;
  },
  shape: () => ({ kind: 'point' }),
});
const poseOf = (s: TableState) => (id: string): Pose | null => (s.zones[s.cards[id]?.zone ?? '']?.kind === 'battlefield' ? s.cards[id]!.pose : null);
const draw = (s: TableState, opponents = 1) => drawnLines(s, resolver(s), poseOf(s), () => opponents, (seat) => ({ x: 0, y: seat === 's0' ? 1 : -1 }));

describe('which lines are drawn', () => {
  it('all five kinds of state line are drawn, each in its creator’s seat, with its label', () => {
    let s = board();
    const kinds: LineKind[] = ['target', 'attack', 'block', 'attach', 'mark'];
    kinds.forEach((k, i) => {
      s = ok(s, act('lineAdd', { line: `l${i}`, kind: k, from: { kind: 'card', id: 'a00' }, to: { kind: 'card', id: `b0${i % 3}` }, ...(k === 'mark' ? { label: 'copy of' } : {}) }, i % 2 ? 's1' : 's0'));
    });
    const out = draw(s);
    expect(out.map((l) => [l.id, l.kind, l.by, l.source])).toEqual([
      ['l0', 'target', 's0', 'state'],
      ['l1', 'attack', 's1', 'state'],
      ['l2', 'block', 's0', 'state'],
      ['l3', 'attach', 's1', 'state'],
      ['l4', 'mark', 's0', 'state'],
    ]);
    expect(out.find((l) => l.id === 'l4')!.label).toBe('copy of');
  });

  it('a line to a player ends at the avatar', () => {
    let s = board();
    s = line(s, 'p', 'target', { kind: 'card', id: 'a00' }, { kind: 'seat', id: 's1' });
    expect(draw(s)[0]).toMatchObject({ from: { x: -150, y: -200 }, to: { x: 0, y: 600 } });
  });

  it('a line whose end is not drawn is skipped, not drawn to the origin', () => {
    let s = board();
    s = line(s, 'p', 'target', { kind: 'card', id: 'a00' }, { kind: 'card', id: 'b00' });
    const r = resolver(s);
    const out = drawnLines(s, { ...r, point: (a) => (a.kind === 'card' && a.id === 'b00' ? null : r.point(a)) }, poseOf(s), () => 1, () => ({ x: 0, y: 1 }));
    expect(out).toEqual([]);
  });

  it('an attached card shows an attachment line only while pulled apart from its host', () => {
    let s = board();
    s = ok(s, act('reveal', { instanceId: 'a03', ref: { sid: 'sid-aura' }, salt: 'salt-a03' }));
    s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(300, -200) }));
    s = ok(s, act('attach', { card: 'a03', to: 'a00' }));
    expect(draw(s).filter((l) => l.source === 'attach')).toEqual([]);
    // Pulled apart (moved without detaching): the line joins it to its host.
    s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(-150 + ATTACH_APART + 40, -300) }));
    expect(s.cards.a03!.attachedTo).toBe('a00');
    expect(draw(s).filter((l) => l.source === 'attach')).toEqual([
      { id: 'attach:a03', kind: 'attach', by: 's0', from: { x: -80, y: -300 }, to: { x: -150, y: -200 }, source: 'attach', dashed: false },
    ]);
    // Detaching removes it.
    s = ok(s, act('detach', { card: 'a03' }));
    expect(draw(s).filter((l) => l.source === 'attach')).toEqual([]);
  });

  it('an explicit attachment line replaces the derived one (no double line)', () => {
    let s = board();
    s = ok(s, act('reveal', { instanceId: 'a03', ref: { sid: 'sid-aura' }, salt: 'salt-a03' }));
    s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(300, -300) }));
    s = ok(s, act('attach', { card: 'a03', to: 'a00', pose: P(300, -300) }));
    s = line(s, 'x', 'attach', { kind: 'card', id: 'a03' }, { kind: 'card', id: 'a00' });
    expect(draw(s).map((l) => l.id)).toEqual(['x']);
  });

  it('an attacker with no target shows a dashed stub only when its controller has several opponents', () => {
    let s = board();
    s = ok(s, act('moveTemp', { card: 'a00', pose: P(-150, -90), combat: 'attack', tap: true }));
    expect(draw(s, 1)).toEqual([]);
    const stub = draw(s, 2);
    expect(stub).toEqual([{ id: 'stub:a00', kind: 'attack', by: 's0', from: { x: -150, y: -90 }, to: { x: -150, y: -90 + STUB_LEN }, source: 'stub', dashed: true }]);
    // Once it has an attack line, no stub.
    s = line(s, 'atk', 'attack', { kind: 'card', id: 'a00' }, { kind: 'seat', id: 's1' });
    expect(draw(s, 2).map((l) => l.id)).toEqual(['atk']);
  });
});

describe('line geometry', () => {
  it('a line between two cards starts and ends at their edges, not under them', () => {
    const a = P(0, 0);
    const b = P(0, 300);
    const seg = trimLine(a, b, { kind: 'card', pose: a }, { kind: 'card', pose: b })!;
    expect(seg.from.y).toBeCloseTo(44 + 1.5);
    expect(seg.to.y).toBeCloseTo(300 - 44 - 1.5);
    // A tapped card is wider along y: 31.5 from its centre.
    const t = P(0, 300, 90);
    expect(trimLine(a, t, { kind: 'card', pose: a }, { kind: 'card', pose: t })!.to.y).toBeCloseTo(300 - 31.5 - 1.5);
    expect(cardReach(P(0, 0, 0), 1, 0)).toBeCloseTo(31.5);
  });

  it('two overlapping ends leave nothing to draw', () => {
    expect(trimLine(P(0, 0), P(10, 10), { kind: 'card', pose: P(0, 0) }, { kind: 'card', pose: P(10, 10) })).toBeNull();
    expect(trimLine(P(0, 0), P(0, 0), { kind: 'point' }, { kind: 'point' })).toBeNull();
  });

  it('dashes alternate dash and gap along the segment and never run past its end', () => {
    const d = dashSegment({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }, [4, 3]);
    expect(d.map((x) => [x.from.x, x.to.x])).toEqual([
      [0, 4],
      [7, 11],
      [14, 18],
    ]);
    const tail = dashSegment({ from: { x: 0, y: 0 }, to: { x: 9, y: 0 } }, [4, 3]);
    expect(tail[tail.length - 1]!.to.x).toBe(9);
    // A degenerate pattern draws a solid line instead of looping.
    expect(dashSegment({ from: { x: 0, y: 0 }, to: { x: 9, y: 0 } }, [0, 0])).toHaveLength(1);
  });

  it("Paper: a seat's dash pattern in screen px becomes table mm at the current zoom; marks are always dashed", () => {
    const seats = paper.tokens.colours.seats;
    const solid = seats.find((s) => s.pattern === 'solid')!;
    const ends = { from: { kind: 'point' as const }, to: { kind: 'point' as const } };
    const l = { from: { x: 0, y: 0 }, to: { x: 0, y: 100 }, dashed: false };
    const target = strokeSegments(l, paper.lineStyle('target', solid), ends, 2, false);
    expect(target).toHaveLength(1);
    const mark = strokeSegments(l, paper.lineStyle('mark', solid), ends, 2, false);
    expect(mark.length).toBeGreaterThan(5);
    // At 2 px/mm a 6 px dash is 3 mm long.
    expect(Math.hypot(mark[0]!.to.x - mark[0]!.from.x, mark[0]!.to.y - mark[0]!.from.y)).toBeCloseTo(3);
  });

  it('the target end carries the theme arrowhead: a triangle for targets, a dot for attachments, none for marks', () => {
    const tip = { x: 0, y: 100 };
    expect(arrowSegments(tip, 0, 1, 'triangle', 5)).toHaveLength(3);
    expect(arrowSegments(tip, 0, 1, 'none', 5)).toHaveLength(0);
    expect(arrowSegments(tip, 0, 1, 'dot', 5).length).toBeGreaterThan(3);
    for (const s of arrowSegments(tip, 0, 1, 'triangle', 5)) expect(Math.max(s.from.y, s.to.y)).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe('ping', () => {
  it('flashes at once and fades to nothing after the theme’s fade time (two seconds in Paper)', () => {
    const fade = paper.motion.pingFadeMs;
    expect(fade).toBe(2000);
    expect(pingAlpha(0, fade)).toBe(1);
    expect(pingAlpha(1000, fade)).toBeCloseTo(0.5);
    expect(pingAlpha(1999, fade)).toBeGreaterThan(0);
    expect(pingAlpha(2000, fade)).toBe(0);
    expect(pingAlpha(5000, fade)).toBe(0);
  });

  it('rings the pinged card just outside its edges, turned with it', () => {
    const ring = cardRing(P(10, 20, 90), 3);
    expect(ring).toHaveLength(4);
    const xs = ring.map((s) => s.from.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(88 + 6);
  });
});

describe('ping layers', () => {
  it('each ping fades on its own schedule: an older ping keeps fading while a newer one shows', () => {
    const s = board();
    let live: ActivePing[] = [{ id: 'p1', target: { kind: 'card', id: 'a00' }, seat: 's0' }];
    const view = new LineView({
      state: () => s,
      pings: () => live,
      layout: () => mtg.layout(s.format),
      viewerSeat: () => 's0',
      theme: () => paper,
      cardPose: (id) => s.cards[id]?.pose ?? null,
      freePose: (id) => s.cards[id]?.pose ?? null,
      pxPerMm: () => 1,
      reduced: () => true,
    });
    const opacities = () => Object.fromEntries(view.pingRings.children.map((o) => [o.name, (o as unknown as { material: { opacity: number } }).material.opacity]));
    expect(view.syncPings(0)).toBe(true);
    live = [...live, { id: 'p2', target: { kind: 'card', id: 'b00' }, seat: 's1' }];
    expect(view.syncPings(1000)).toBe(true);
    // p1 is half way through its fade, p2 starts at full strength.
    expect(view.syncPings(1500)).toBe(true);
    const o = opacities();
    expect(o['ping:p1']).toBeCloseTo(pingAlpha(1500, 2000));
    expect(o['ping:p2']).toBeCloseTo(pingAlpha(500, 2000));
    // p1 faded: its layer goes; p2 still shows.
    expect(view.syncPings(2100)).toBe(true);
    expect(Object.keys(opacities())).toEqual(['ping:p2']);
    expect(view.syncPings(3100)).toBe(false);
    expect(view.pingRings.children).toHaveLength(0);
    view.dispose();
  });
});

describe('ping pulse', () => {
  it('pulses out twice over the first second, then rests just outside the card while it fades', () => {
    expect(pingPad(0)).toBe(2);
    expect(pingPad(250)).toBe(4);
    expect(pingPad(750)).toBe(4);
    for (const t of [1000, 1250, 1500, 1999]) expect(pingPad(t)).toBe(2);
  });
});

describe('what a right-drag draws', () => {
  const card = (id: string): Anchor => ({ kind: 'card', id });
  const seat = (id: string): Anchor => ({ kind: 'seat', id });
  const attacking = () => ok(board(), act('moveTemp', { card: 'a00', pose: P(-150, -90), combat: 'attack', tap: true }));

  it('from an attacker: an attack line to an opposing player or permanent, a target line to anything else', () => {
    const s = attacking();
    expect(lineKindFor(s, card('a00'), seat('s1'), false)).toBe('attack');
    expect(lineKindFor(s, card('a00'), card('b00'), false)).toBe('attack');
    // An ability's target: own permanent, own avatar.
    expect(lineKindFor(s, card('a00'), card('a01'), false)).toBe('target');
    expect(lineKindFor(s, card('a00'), seat('s0'), false)).toBe('target');
    // While nothing is under the pointer the attacker's line previews as an attack line.
    expect(lineKindFor(s, card('a00'), null, false)).toBe('attack');
    // Shift: a persistent mark, whatever the ends.
    expect(lineKindFor(s, card('a00'), seat('s1'), true)).toBe('mark');
    // A creature that does not attack draws target lines.
    expect(lineKindFor(s, card('a01'), seat('s1'), false)).toBe('target');
  });

  it('an attacker can point at a target without losing its attack line; a new attack target replaces the old', () => {
    let s = attacking();
    let n = 0;
    const newId = (p: string) => `${p}-${++n}`;
    s = applyDrafts(s, lineDrafts(s, card('a00'), seat('s1'), false, newId));
    s = applyDrafts(s, lineDrafts(s, card('a00'), card('a01'), false, newId));
    const kinds = () => Object.values(s.lines).map((l) => `${l.kind}:${l.to.id}`).sort();
    expect(kinds()).toEqual(['attack:s1', 'target:a01']);
    const swap = lineDrafts(s, card('a00'), card('b00'), false, newId);
    expect(new Set(swap.map((d) => d.group)).size).toBe(1);
    s = applyDrafts(s, swap);
    expect(kinds()).toEqual(['attack:b00', 'target:a01']);
    // Drawing an existing line again removes it.
    s = applyDrafts(s, lineDrafts(s, card('a00'), card('a01'), false, newId));
    expect(kinds()).toEqual(['attack:b00']);
    // Onto nothing, or onto itself: no line.
    expect(lineDrafts(s, card('a00'), null, false, newId)).toEqual([]);
    expect(lineDrafts(s, card('a00'), card('a00'), false, newId)).toEqual([]);
  });

  it('only public cards are line sources', () => {
    const s = board();
    expect(lineSourceOf(s, 'a00')).toEqual(card('a00'));
    expect(lineSourceOf(s, 'a05')).toBeNull();
    expect(lineSourceOf(s, 'nope')).toBeNull();
  });
});

describe('stack lane line ends (M1-P3 integration)', () => {
  it('a stack item end is drawn where the scene draws the item, and the lane’s extra strokes share the line layer', () => {
    let s = board();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'ability', source: 'a00', round: 'r1' }));
    s = ok(s, act('lineAdd', { line: 'l1', kind: 'target', from: { kind: 'stackItem', id: 'i1' }, to: { kind: 'card', id: 'b00' } }));
    const host = {
      state: () => s,
      pings: () => [],
      layout: () => mtg.layout(s.format),
      viewerSeat: () => 's0',
      theme: () => paper,
      cardPose: (id: string) => s.cards[id]?.pose ?? null,
      freePose: (id: string) => s.cards[id]?.pose ?? null,
      pxPerMm: () => 1,
      reduced: () => true,
    };
    // Without the hook an ability item ends at its source card.
    const plain = new LineView(host);
    expect(plain.point({ kind: 'stackItem', id: 'i1' })).toEqual({ x: -150, y: -200 });
    plain.dispose();
    let extra = [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, colour: '#000', widthPx: 1 }];
    const view = new LineView({ ...host, stackEnd: (item) => (item === 'i1' ? { point: { x: 400, y: 0 }, shape: { kind: 'point' } } : null), extraLines: () => extra });
    expect(view.point({ kind: 'stackItem', id: 'i1' })).toEqual({ x: 400, y: 0 });
    expect(view.shape({ kind: 'stackItem', id: 'i1' })).toEqual({ kind: 'point' });
    expect(view.compute().find((l) => l.id === 'l1')?.from).toEqual({ x: 400, y: 0 });
    s = ok(s, act('lineRemove', { line: 'l1' }));
    view.sync();
    expect(view.lines.object.visible).toBe(true);
    extra = [];
    view.sync();
    expect(view.lines.object.visible).toBe(false);
    view.dispose();
  });
});
