/**
 * Shared fixture for the HUD unit tests: a 1v1 table with fake session, recording scene and recorded UI hooks, wired to
 * the key engine exactly as the HUD wires them (src/ui/Hud.svelte).
 */
import type { KeyChord, Keymap } from '../../../src/games/types';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { Commands, promptKeys, type UiHooks } from '../../../src/ui/commands';
import { FakeCardData, FakeSession, RecordingScene, fakeGame, tableWith, type FakeCardSpec } from '../../../src/ui/fakes';
import { KeyEngine, type KeyInput } from '../../../src/ui/keymap';
import type { ConfirmRound, InstanceId, StackItem } from '../../../src/core/types';

/** Default cards: own battlefield, hand, library, graveyard; a face-down own card; an opponent's creature. */
export const CARDS: FakeCardSpec[] = [
  { id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -200, y: -300, rot: 0 } },
  { id: 'bf2', zone: 'battlefield:s0', sid: 'sid-caller', tapped: true, pose: { x: -100, y: -300, rot: 90 } },
  { id: 'dfc', zone: 'battlefield:s0', sid: 'sid-dfc', pose: { x: 0, y: -300, rot: 0 } },
  { id: 'fd1', zone: 'battlefield:s0', sid: 'sid-bear', face: 'down', pose: { x: 100, y: -300, rot: 0 } },
  { id: 'h1', zone: 'hand:s0', sid: 'sid-bolt' },
  { id: 'h2', zone: 'hand:s0', sid: 'sid-bear' },
  { id: 'lib1', zone: 'library:s0', sid: 'sid-land' },
  { id: 'lib2', zone: 'library:s0', sid: 'sid-bear' },
  { id: 'gy1', zone: 'graveyard:s0', sid: 'sid-land' },
  { id: 'opp1', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 0, y: 300, rot: 180 } },
  { id: 'opph', zone: 'hand:s1' },
];

export type UiCall = { hook: keyof UiHooks; args: unknown[] };

export interface Rig {
  session: FakeSession;
  scene: RecordingScene;
  commands: Commands;
  engine: KeyEngine;
  ui: UiCall[];
  view: { hovered: InstanceId | null; selection: InstanceId[]; keyFocus?: boolean };
  clock: { t: number };
  /** Press (keydown + keyup) a chord as a browser would send it. */
  press(chord: KeyChord, opts?: { inText?: boolean; repeat?: boolean }): boolean;
  down(chord: KeyChord, opts?: { inText?: boolean; repeat?: boolean }): boolean;
  up(chord: KeyChord): void;
}

export function rig(opts: { cards?: FakeCardSpec[]; names?: string[]; hovered?: InstanceId | null; selection?: InstanceId[]; confirm?: ConfirmRound; stack?: StackItem[]; keymap?: Keymap } = {}): Rig {
  const names = opts.names ?? ['Anna', 'Ben'];
  const seatExists = (zone: string) => !zone.includes(':') || Number(zone.split(':s')[1]) < names.length;
  const { state, secrets } = tableWith(names, (opts.cards ?? CARDS).filter((c) => seatExists(c.zone)));
  if (opts.confirm) state.confirm = opts.confirm;
  if (opts.stack) state.stack = opts.stack;
  const clock = { t: 1_000_000 };
  const session = new FakeSession(state, secrets, new FakeCardData(), 's0', () => clock.t);
  const scene = new RecordingScene();
  const ui: UiCall[] = [];
  const hooks = new Proxy({} as UiHooks, {
    get: (_t, hook: string) => (...args: unknown[]) => {
      ui.push({ hook: hook as keyof UiHooks, args });
    },
  });
  const view = { hovered: opts.hovered ?? null, selection: opts.selection ?? [] };
  let n = 0;
  const commands = new Commands({ session, game: fakeGame(), scene: () => scene, view: () => view, ui: hooks, newId: (p) => `${p}${++n}`, now: () => clock.t });
  const engine = new KeyEngine(opts.keymap ?? MTG_KEYMAP, { start: (b) => commands.run(b.action, 'start'), end: (b) => commands.run(b.action, 'end') }, () => promptKeys(session.getState(), session.seat), () => clock.t);
  const down = (chord: KeyChord, o: { inText?: boolean; repeat?: boolean } = {}) => engine.keydown({ ...eventFor(chord), repeat: !!o.repeat }, !!o.inText);
  const up = (chord: KeyChord) => void engine.keyup(eventFor(chord));
  const press = (chord: KeyChord, o: { inText?: boolean; repeat?: boolean } = {}) => {
    const r = down(chord, o);
    up(chord);
    return r;
  };
  return { session, scene, commands, engine, ui, view, clock, press, down, up };
}

const SHIFTED: Record<string, string> = { '+': 'Equal', '?': 'Slash' };
const CODES: Record<string, string> = { ' ': 'Space', '-': 'Minus', '=': 'Equal', Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Home: 'Home', F6: 'F6' };

/** The KeyboardEvent fields a US-layout browser sends for a chord: letters upper-cased under Shift, `+` and `?` with Shift down. */
export function eventFor(chord: KeyChord): KeyInput {
  const k = chord.key;
  const letter = /^[a-z]$/.test(k);
  const code = letter ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : (SHIFTED[k] ?? CODES[k] ?? k);
  return {
    key: letter && chord.shift ? k.toUpperCase() : k,
    code,
    ctrlKey: !!chord.ctrl,
    altKey: !!chord.alt,
    shiftKey: !!chord.shift || k in SHIFTED,
    metaKey: false,
  };
}

/** Dispatched actions without the stamped fields, for comparisons. */
export function drafts(r: Rig): Record<string, unknown>[] {
  return r.session.dispatched.map((a) => {
    const { by: _by, cid: _cid, seq: _seq, ...rest } = a;
    return rest;
  });
}
