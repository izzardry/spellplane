/**
 * M3-P1: multi-seat behaviour of the scene and the HUD's seat keys (DESIGN "Combat and annotation", Attack target: with
 * several opponents the attacker drags an attack line to a player avatar or permanent, unassigned attackers show a
 * dashed stub; "Camera and navigation": seat keys 1 to 4 clockwise from you, tap an avatar; "Players, seats and
 * formats"). Tables are built with the real reducer; layouts are Magic's.
 */
import { describe, expect, it } from 'vitest';
import type { ActionDraft } from '../../../src/core/actions';
import type { Anchor, Format, Pose, SecretStore, SeatId, TableState } from '../../../src/core/types';
import { TABLE_FORMAT_SEATS } from '../../../src/core/teams';
import type { ActionId, TableLayout } from '../../../src/games/types';
import { mtg } from '../../../src/games/mtg/index';
import { BirdseyeRig } from '../../../src/scene/camera';
import { lineKindFor } from '../../../src/scene/combat';
import { AVATAR_SPOT_R, fitFrame, markings, viewerAngle } from '../../../src/scene/layout';
import { STUB_LEN, avatarAt, drawnLines, lineDrafts, opponentCount, type AnchorResolver } from '../../../src/scene/lines';
import { forward } from '../../../src/scene/math';
import { Commands, type UiHooks } from '../../../src/ui/commands';
import { FakeSession, RecordingScene } from '../../../src/ui/fakes';
import { act, ok, play, readyTable } from '../core/helpers';
import { applyDrafts } from '../combat/helpers';

const MULTI: Format[] = ['ffa3', 'ffa4', '2hg'];
const ALL: Format[] = ['1v1', ...MULTI];
const seatsOf = (f: Format) => Array.from({ length: TABLE_FORMAT_SEATS[f] }, (_, i) => `s${i}`);

/**
 * A table of `format` with every chair taken and two creatures per seat on its battlefield, in its territory's front row
 * (`<seat>c0`, `<seat>c1`, made from library cards a00/a01, b00/b01, ...).
 */
function table(format: Format): { s: TableState; layout: TableLayout } {
  const layout = mtg.layout(format);
  const n = TABLE_FORMAT_SEATS[format];
  let s = readyTable(4, format, n);
  for (const seat of seatsOf(format)) {
    const sl = layout.seats[s.seats[seat]!.index]!;
    const p = seat === 's0' ? 'a' : seat === 's1' ? 'b' : seat === 's2' ? 'c' : 'd';
    for (let i = 0; i < 2; i++) {
      const f = forward(sl.angle);
      const r = { x: f.y, y: -f.x }; // the owner's right
      const pose: Pose = { x: Math.round(sl.territory.x + f.x * 150 + r.x * (i * 100 - 50)), y: Math.round(sl.territory.y + f.y * 150 + r.y * (i * 100 - 50)), rot: sl.angle };
      s = play(s, `${p}0${i}`, pose, seat);
    }
  }
  return { s, layout };
}

const cardOf = (seat: SeatId, i: number) => `${seat === 's0' ? 'a' : seat === 's1' ? 'b' : seat === 's2' ? 'c' : 'd'}0${i}`;

/** Attack with a creature as the A key does: 110 toward the centre, tapped. */
function attack(s: TableState, layout: TableLayout, card: string): TableState {
  const c = s.cards[card]!;
  const f = forward(layout.seats[s.seats[c.controller]!.index]!.angle);
  return ok(s, act('moveTemp', { card, pose: { x: c.pose.x + f.x * 110, y: c.pose.y + f.y * 110, rot: c.pose.rot }, combat: 'attack', tap: true }, c.controller));
}

/** Line ends at the cards' poses and the seats' avatar spots of the layout. */
function resolver(s: TableState, layout: TableLayout): AnchorResolver {
  return {
    point: (a: Anchor) => {
      if (a.kind === 'card') return s.cards[a.id] ? { x: s.cards[a.id]!.pose.x, y: s.cards[a.id]!.pose.y } : null;
      if (a.kind === 'seat') {
        const sl = layout.seats[s.seats[a.id]?.index ?? -1];
        return sl ? { x: sl.zones.avatar.x, y: sl.zones.avatar.y } : null;
      }
      return null;
    },
    shape: () => ({ kind: 'point' }),
  };
}

function drawn(s: TableState, layout: TableLayout) {
  return drawnLines(
    s,
    resolver(s, layout),
    (id) => (s.zones[s.cards[id]?.zone ?? '']?.kind === 'battlefield' ? s.cards[id]!.pose : null),
    (seat) => opponentCount(s, seat),
    (seat) => forward(layout.seats[s.seats[seat]!.index]!.angle),
  );
}

let ids = 0;
const newId = (p: string) => `${p}-${++ids}`;

describe('opponents and the unassigned-attacker stub', () => {
  it('counts the opposing sides: one in 1v1, two and three in free-for-all, one team in Two-Headed Giant', () => {
    const want: Record<Format, number> = { '1v1': 1, ffa3: 2, ffa4: 3, '2hg': 1 };
    for (const f of ALL) {
      const { s } = table(f);
      for (const seat of seatsOf(f)) expect(opponentCount(s, seat), `${f} ${seat}`).toBe(want[f]);
    }
  });

  it('an empty chair is no opponent', () => {
    const { s } = table('ffa4');
    const left = ok(s, act('seatLeave', { seat: 's3' }, 's3'));
    expect(opponentCount(left, 's0')).toBe(2);
  });

  it.each(MULTI.filter((f) => f !== '2hg'))('%s: an attacker without an attack line shows a dashed stub toward the table centre', (f) => {
    const { s: s0, layout } = table(f);
    for (const seat of seatsOf(f)) {
      const s = attack(s0, layout, cardOf(seat, 0));
      const stubs = drawn(s, layout).filter((l) => l.source === 'stub');
      expect(stubs).toHaveLength(1);
      const stub = stubs[0]!;
      expect(stub).toMatchObject({ id: `stub:${cardOf(seat, 0)}`, kind: 'attack', by: seat, dashed: true });
      // From the attacker, STUB_LEN toward the centre along its seat's forward axis.
      const c = s.cards[cardOf(seat, 0)]!.pose;
      expect(stub.from).toEqual({ x: c.x, y: c.y });
      expect(Math.hypot(stub.to.x - c.x, stub.to.y - c.y)).toBeCloseTo(STUB_LEN);
      expect(Math.hypot(stub.to.x, stub.to.y)).toBeLessThan(Math.hypot(c.x, c.y));
    }
  });

  it('1v1 and Two-Headed Giant: the target is implicit, no stub', () => {
    for (const f of ['1v1', '2hg'] as const) {
      const { s: s0, layout } = table(f);
      const s = attack(s0, layout, 'a00');
      expect(drawn(s, layout).filter((l) => l.source === 'stub'), f).toEqual([]);
    }
  });

  it('an attack line to a player or a permanent replaces the stub; settling removes both', () => {
    const { s: s0, layout } = table('ffa4');
    let s = attack(s0, layout, 'a00');
    s = applyDrafts(s, lineDrafts(s, { kind: 'card', id: 'a00' }, { kind: 'seat', id: 's2' }, false, newId));
    expect(drawn(s, layout).filter((l) => l.source === 'stub')).toEqual([]);
    s = ok(s, act('settle', { cards: ['a00'] }));
    expect(Object.values(s.lines)).toEqual([]);
    expect(drawn(s, layout)).toEqual([]);
  });
});

describe('attack-target lines to every opponent', () => {
  it.each(MULTI)('%s: one attacker per opponent draws an attack line to that player\'s avatar; each ends at that avatar', (f) => {
    const { s: s0, layout } = table(f);
    let s = s0;
    const opponents = seatsOf(f).filter((x) => x !== 's0' && s.seats[x]!.team === undefined);
    const targets = f === '2hg' ? ['s2', 's3'] : opponents;
    targets.forEach((seat, i) => {
      // a00 and a01 attack; an attacker beyond the second reuses a00 (one target each: the new line replaces the old).
      const attacker = cardOf('s0', i % 2);
      if (!s.cards[attacker]!.combat) s = attack(s, layout, attacker);
      const drafts = lineDrafts(s, { kind: 'card', id: attacker }, { kind: 'seat', id: seat }, false, newId);
      expect(drafts.at(-1)).toMatchObject({ type: 'lineAdd', kind: 'attack', from: { kind: 'card', id: attacker }, to: { kind: 'seat', id: seat } });
      s = applyDrafts(s, drafts);
      const l = drawn(s, layout).find((x) => x.source === 'state' && x.to.x === layout.seats[s.seats[seat]!.index]!.zones.avatar.x && x.to.y === layout.seats[s.seats[seat]!.index]!.zones.avatar.y);
      expect(l, `line to ${seat}`).toMatchObject({ kind: 'attack', by: 's0' });
    });
    // Each attacker has exactly one attack line.
    const perAttacker = new Map<string, number>();
    for (const l of Object.values(s.lines)) if (l.kind === 'attack' && l.from.kind === 'card') perAttacker.set(l.from.id, (perAttacker.get(l.from.id) ?? 0) + 1);
    expect([...perAttacker.values()].every((n) => n === 1)).toBe(true);
  });

  it.each(MULTI)('%s: an attack line can go to every opponent\'s permanent (a planeswalker), never as an attack to a teammate\'s', (f) => {
    const { s: s0, layout } = table(f);
    let s = attack(s0, layout, 'a00');
    for (const seat of seatsOf(f).filter((x) => x !== 's0')) {
      const target = cardOf(seat, 1);
      const teammate = s.seats[seat]!.team !== undefined && s.seats[seat]!.team === s.seats.s0!.team;
      const kind = lineKindFor(s, { kind: 'card', id: 'a00' }, { kind: 'card', id: target }, false);
      expect(kind, `${f} a00 -> ${target}`).toBe(teammate ? 'target' : 'attack');
      expect(lineKindFor(s, { kind: 'card', id: 'a00' }, { kind: 'seat', id: seat }, false)).toBe(teammate ? 'target' : 'attack');
      s = applyDrafts(s, lineDrafts(s, { kind: 'card', id: 'a00' }, { kind: 'card', id: target }, false, newId));
      const ends = drawn(s, layout).find((l) => l.source === 'state' && l.to.x === s.cards[target]!.pose.x && l.to.y === s.cards[target]!.pose.y);
      expect(ends?.kind).toBe(teammate ? 'target' : 'attack');
    }
  });
});

describe('avatar spots: line ends, taps and markings', () => {
  it.each(ALL)('%s: each seat\'s avatar spot resolves to that seat, and nowhere else does', (f) => {
    const { s, layout } = table(f);
    for (const seat of seatsOf(f)) {
      const a = layout.seats[s.seats[seat]!.index]!.zones.avatar;
      expect(avatarAt(s, layout, a)).toEqual({ kind: 'seat', id: seat });
      expect(avatarAt(s, layout, { x: a.x + AVATAR_SPOT_R - 1, y: a.y })).toEqual({ kind: 'seat', id: seat });
    }
    expect(avatarAt(s, layout, { x: 0, y: 0 })).toBeNull();
  });

  it.each(ALL)('%s: the markings ring every seat\'s avatar spot and name it, upright for the viewer', (f) => {
    const layout = mtg.layout(f);
    const names = ['Anna', 'Ben', 'Cleo', 'Dan'];
    for (const viewer of layout.seats) {
      const m = markings(layout, mtg, viewer.angle, layout.seats.length, names);
      for (const sl of layout.seats) {
        const label = m.labels.find((l) => l.key === `av:${sl.index}`);
        expect(label, `${f} seat ${sl.index}`).toMatchObject({ text: names[sl.index], x: sl.zones.avatar.x, y: sl.zones.avatar.y, rot: viewer.angle });
        // A ring of segments at the spot's radius.
        let onRing = 0;
        for (let i = 0; i < m.segments.length; i += 4) {
          const d = Math.hypot(m.segments[i]! - sl.zones.avatar.x, m.segments[i + 1]! - sl.zones.avatar.y);
          if (Math.abs(d - AVATAR_SPOT_R) < 1e-6) onRing++;
        }
        expect(onRing).toBeGreaterThanOrEqual(16);
      }
    }
  });
});

describe('the camera: own seat at the bottom, seat keys and fitting', () => {
  const vp = { w: 1440, h: 900 };

  it.each(ALL)('%s: in the fitted view of every viewer the own territory is at the bottom of the screen and the whole table is on screen', (f) => {
    const { s, layout } = table(f);
    for (const me of seatsOf(f)) {
      const angle = viewerAngle(s, layout, me);
      const rig = new BirdseyeRig(layout.table, vp, angle);
      rig.setTable(layout.table, angle, fitFrame(s, layout, me));
      const own = layout.seats[s.seats[me]!.index]!;
      const ownY = rig.tableToScreen(own.territory).y;
      for (const o of layout.seats) {
        if (o === own) continue;
        expect(rig.tableToScreen(o.territory).y, `${f} viewer ${me}, seat ${o.index}`).toBeLessThanOrEqual(ownY + 1e-6);
      }
      expect(ownY).toBeGreaterThan(vp.h / 2);
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const p = rig.tableToScreen({ x: (x * layout.table.w) / 2, y: (y * layout.table.d) / 2 });
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(vp.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(vp.h + 1e-6);
      }
    }
  });

  it.each(ALL)('%s: going to a seat frames its whole territory, centred, whichever way the viewer is turned', (f) => {
    const { s, layout } = table(f);
    for (const me of seatsOf(f)) {
      const angle = viewerAngle(s, layout, me);
      const rig = new BirdseyeRig(layout.table, vp, angle);
      for (const sl of layout.seats) {
        const v = rig.rectView(sl.territory);
        expect(Math.hypot(v.cx - sl.territory.x, v.cy - sl.territory.y), `${f} viewer ${me} to seat ${sl.index}`).toBeLessThan(1);
        rig.view = v;
        const half = { w: sl.territory.w / 2, d: sl.territory.d / 2 };
        for (const [u, w] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          const a = (sl.territory.rot * Math.PI) / 180;
          const lx = u * half.w;
          const ly = w * half.d;
          const p = rig.tableToScreen({ x: sl.territory.x + lx * Math.cos(a) + ly * Math.sin(a), y: sl.territory.y - lx * Math.sin(a) + ly * Math.cos(a) });
          expect(p.x).toBeGreaterThanOrEqual(-1e-6);
          expect(p.x).toBeLessThanOrEqual(vp.w + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(-1e-6);
          expect(p.y).toBeLessThanOrEqual(vp.h + 1e-6);
        }
      }
    }
  });

  /** Run a view key through the HUD's real Commands for seat `me` and return the seats the camera was sent to. */
  function key(s: TableState, me: SeatId, action: ActionId): SeatId[] {
    const secrets: SecretStore = { seat: me, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
    const session = new FakeSession(structuredClone(s), secrets, undefined, me, () => 0);
    const scene = new RecordingScene();
    const commands = new Commands({ session, game: mtg, scene: () => scene as never, view: () => ({ hovered: null, selection: [] }), ui: new Proxy({} as UiHooks, { get: () => () => undefined }), newId, now: () => 0 });
    commands.run(action, 'start');
    return scene.calls.filter((c) => c.method === 'camera.goToSeat').map((c) => c.args[0] as SeatId);
  }

  it.each(ALL)('%s: key 1 goes to the own seat, keys 2 to 4 to the seats clockwise from it, as laid out around the table', (f) => {
    const { s, layout } = table(f);
    const n = TABLE_FORMAT_SEATS[f];
    for (const me of seatsOf(f)) {
      expect(key(s, me, 'seat1')).toEqual([me]);
      expect(key(s, me, 'ownSide')).toEqual([me]);
      const mine = s.seats[me]!.index;
      (['seat2', 'seat3', 'seat4'] as const).forEach((k, i) => {
        const steps = i + 1;
        const got = key(s, me, k);
        if (steps >= n) {
          expect(got, `${f} ${me} ${k}`).toEqual([]);
          return;
        }
        expect(got).toHaveLength(1);
        // That seat is `steps` places clockwise around the table: its polar angle, seen from the own seat, falls by
        // steps of the turn order.
        const target = s.seats[got[0]!]!.index;
        expect(target).toBe(layout.turnOrder![(layout.turnOrder!.indexOf(mine) + steps) % n]);
      });
    }
  });
});

describe('turn order (DESIGN "Players, seats and formats", Turn marker; "Turn flow and confirmation")', () => {
  /** The next active seat or team after `active`, as the HUD's next-turn command proposes it. */
  function next(s: TableState): string {
    const secrets: SecretStore = { seat: 's0', identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
    const session = new FakeSession(structuredClone(s), secrets, undefined, 's0', () => 0);
    const commands = new Commands({ session, game: mtg, scene: () => null, view: () => ({ hovered: null, selection: [] }), ui: new Proxy({} as UiHooks, { get: () => () => undefined }), newId, now: () => 0 });
    commands.run('nextTurn', 'start');
    const pass = session.dispatched.find((a) => a.type === 'turnPass') as (ActionDraft & { to?: string }) | undefined;
    return pass?.to ?? '';
  }

  it.each(['ffa3', 'ffa4'] as const)('%s: per player, clockwise, following the layout\'s turn order', (f) => {
    const { s: s0, layout } = table(f);
    let s = s0;
    const seen: string[] = [s.turn.active];
    for (let i = 0; i < TABLE_FORMAT_SEATS[f]; i++) {
      const to = next(s);
      s = ok(s, act('turnPass', { to }, s.turn.active));
      seen.push(s.turn.active);
    }
    expect(seen).toEqual([...layout.turnOrder!, layout.turnOrder![0]!].map((i) => `s${i}`));
  });

  it('Two-Headed Giant: per team, t0 then t1 then t0', () => {
    const { s: s0 } = table('2hg');
    let s = s0;
    expect(s.turn.active).toBe('t0');
    const seen = [s.turn.active];
    for (let i = 0; i < 2; i++) {
      const to = next(s);
      s = ok(s, act('turnPass', { to }, s.teams[s.turn.active]!.seats[0]!));
      seen.push(s.turn.active);
    }
    expect(seen).toEqual(['t0', 't1', 't0']);
  });
});
