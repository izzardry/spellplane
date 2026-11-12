/**
 * Fixtures for the combat and lines tests (PLAN M1-P4). Tables are built with the real reducer (core); the HUD's
 * combat keys run through the real Commands (ui/commands.ts) over a session that records drafts, and the drafts are
 * then applied with the real reducer, so a test sees exactly what a key press does to shared state.
 */
import { expect } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { explain, reduce } from '../../../src/core/reducer';
import type { InstanceId, SecretStore, SeatId, TableState } from '../../../src/core/types';
import type { ActionId } from '../../../src/games/types';
import { mtg } from '../../../src/games/mtg';
import { Commands, type UiHooks } from '../../../src/ui/commands';
import { FakeSession } from '../../../src/ui/fakes';
import { seatAngle } from '../../../src/ui/geometry';
import type { CombatContext } from '../../../src/scene/combat';
import { act, ok, play, readyTable } from '../core/helpers';

export { act, card, ok, no, P, play, readyTable, withoutSeq } from '../core/helpers';

let cid = 0;

/** Stamp drafts as the session would and apply them all with the real reducer; every one must apply. */
export function applyDrafts(state: TableState, drafts: readonly ActionDraft[], by: SeatId = 's0'): TableState {
  let s = state;
  for (const d of drafts) {
    const a = { ...d, by, cid: `c${++cid}` } as Action;
    expect(explain(s, a), `${a.type} should apply`).toBeNull();
    s = reduce(s, a);
  }
  return s;
}

/** Run one keymap action as the HUD does (hover and selection given) and return the drafts it dispatched. */
export function press(state: TableState, action: ActionId, view: { hovered?: InstanceId | null; selection?: InstanceId[] } = {}, seat: SeatId = 's0'): ActionDraft[] {
  const secrets: SecretStore = { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
  const session = new FakeSession(structuredClone(state), secrets, undefined, seat, () => 0);
  const ui = new Proxy({} as UiHooks, { get: () => () => undefined });
  let n = 0;
  const commands = new Commands({
    session,
    game: mtg,
    scene: () => null,
    view: () => ({ hovered: view.hovered ?? null, selection: view.selection ?? [] }),
    ui,
    newId: (p) => `${p}-k${++n}`,
    now: () => 0,
  });
  commands.run(action, 'start');
  return session.dispatched.map((a) => {
    const { by: _by, cid: _cid, seq: _seq, ...rest } = a;
    return rest as ActionDraft;
  });
}

let ids = 0;
/** Seat angles of the real 1v1 layout (seat 0 at 0°, seat 1 at 180°); ids unique across the test file. */
export function ctxFor(state: TableState): CombatContext {
  const layout = mtg.layout(state.format);
  return { angleOf: (seat) => seatAngle(layout, state, seat), newId: (p) => `${p}-${++ids}` };
}

/**
 * A ready 1v1 table with creatures in play: seat 0 has a00, a01, a02 in its front row; seat 1 has b00, b01, b02 in
 * its front row (rotated 180°, as its own cards rest).
 */
export function board(): TableState {
  let s = readyTable(6);
  s = play(s, 'a00', { x: -150, y: -200, rot: 0 });
  s = play(s, 'a01', { x: 0, y: -200, rot: 0 });
  s = play(s, 'a02', { x: 150, y: -200, rot: 0 });
  s = play(s, 'b00', { x: -150, y: 200, rot: 180 }, 's1');
  s = play(s, 'b01', { x: 0, y: 200, rot: 180 }, 's1');
  s = play(s, 'b02', { x: 150, y: 200, rot: 180 }, 's1');
  return s;
}

/** Put a line on the table. */
export function line(state: TableState, id: string, kind: 'target' | 'attack' | 'block' | 'attach' | 'mark', from: { kind: 'card' | 'seat' | 'stackItem'; id: string }, to: { kind: 'card' | 'seat' | 'stackItem'; id: string }, by = 's0'): TableState {
  return ok(state, act('lineAdd', { line: id, kind, from, to }, by));
}
