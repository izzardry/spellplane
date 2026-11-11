/**
 * The canonical default keymap (DESIGN "Input and interaction design": this table is authoritative where another
 * section differs). Real data, owned by M0-C; M0-P4 binds it and offers remapping.
 */
import type { ActionId, KeyBinding, KeyChord, KeyContext, KeyTrigger, Keymap } from '../types';

function b(group: KeyBinding['group'], action: ActionId, label: string, chord: KeyChord, opts: { context?: KeyContext; trigger?: KeyTrigger } = {}): KeyBinding {
  return { action, chord, context: opts.context ?? 'table', trigger: opts.trigger ?? 'press', group, label };
}

const k = (key: string, mods: Omit<KeyChord, 'key'> = {}): KeyChord => ({ key, ...mods });

/** The Magic default keymap (DESIGN "Input and interaction design", Canonical default keymap). */
export const MTG_KEYMAP: Keymap = [
  // Card
  b('Card', 'tap', 'Tap / untap', k('t')),
  b('Card', 'flip', 'Flip face-down / up', k('f')),
  b('Card', 'transform', 'Transform', k('f', { shift: true })),
  b('Card', 'rotate180', 'Rotate 180°', k('t', { shift: true })),
  b('Card', 'counterAdd', 'Add counter', k('+')),
  b('Card', 'counterAdd', 'Add counter', k('=')),
  b('Card', 'counterRemove', 'Remove counter', k('-')),
  b('Card', 'note', 'Note', k('n')),
  b('Card', 'copy', 'Token copy', k('x')),
  b('Card', 'revealTo', 'Reveal to…', k('w')),
  b('Card', 'peek', 'Peek', k('f', { alt: true })),
  b('Card', 'ping', 'Ping (double press)', k('i'), { trigger: 'double' }),
  b('Card', 'zoomTo', 'Zoom to card or pile', k('z')),
  b('Card', 'inspect', 'Inspect (hold)', k(' '), { trigger: 'hold' }),
  // Zones
  b('Zones', 'toGraveyard', 'To graveyard', k('g')),
  b('Zones', 'toExile', 'To exile', k('e')),
  b('Zones', 'toHand', 'To hand', k('h')),
  b('Zones', 'toLibraryTop', 'To library top', k('l')),
  b('Zones', 'toLibraryBottom', 'To library bottom', k('l', { shift: true })),
  b('Zones', 'cast', 'Cast to stack', k('c')),
  // Library
  b('Library', 'draw', 'Draw', k('d')),
  b('Library', 'drawN', 'Draw N', k('d', { shift: true })),
  b('Library', 'shuffle', 'Shuffle', k('s')),
  b('Library', 'mulligan', 'Mulligan', k('m', { ctrl: true })),
  // Combat
  b('Combat', 'attack', 'Attack', k('a')),
  b('Combat', 'attackNoTap', 'Attack without tapping', k('a', { shift: true })),
  b('Combat', 'settle', 'Settle (bring back)', k('b')),
  // Stack
  b('Stack', 'ability', 'Add ability or trigger', k('q')),
  b('Stack', 'resolve', 'Resolve top', k('r')),
  b('Stack', 'counterTop', 'Counter top', k('r', { shift: true })),
  // Turn
  b('Turn', 'nextPhase', 'Next phase', k('Tab')),
  b('Turn', 'nextTurn', 'Next turn', k('Enter', { ctrl: true })),
  b('Turn', 'untapAll', 'Untap all', k('u', { ctrl: true })),
  b('Turn', 'autoPass', 'Pass until end of turn', k('F6')),
  // Confirm
  b('Confirm', 'ask', 'Ask', k('k')),
  b('Confirm', 'confirmOk', 'OK', k('Enter'), { context: 'prompt' }),
  b('Confirm', 'confirmHold', 'Hold', k('Escape'), { context: 'prompt' }),
  b('Confirm', 'confirmHold', 'Hold', k('h'), { context: 'prompt' }),
  // Table
  b('Table', 'tidy', 'Tidy', k('y')),
  b('Table', 'token', 'Create token', k('t', { ctrl: true })),
  b('Table', 'rollDie', 'Roll die', k('i', { ctrl: true })),
  b('Table', 'flipCoin', 'Flip coin', k('i', { ctrl: true, shift: true })),
  b('Table', 'undo', 'Undo', k('z', { ctrl: true })),
  // Talk
  b('Talk', 'talk', 'Talk (hold)', k('v'), { trigger: 'hold' }),
  b('Talk', 'teamTalk', 'Team talk (hold)', k('v', { shift: true }), { trigger: 'hold' }),
  b('Talk', 'mute', 'Mute', k('m')),
  b('Talk', 'focusChat', 'Focus chat', k('Enter')),
  // View
  b('View', 'perspective', 'Switch perspective', k('p')),
  b('View', 'fitTable', 'Fit table', k('0')),
  b('View', 'seat1', 'Own seat', k('1')),
  b('View', 'seat2', 'Seat 2 (clockwise)', k('2')),
  b('View', 'seat3', 'Seat 3 (clockwise)', k('3')),
  b('View', 'seat4', 'Seat 4 (clockwise)', k('4')),
  b('View', 'ownSide', 'Own side', k('Home')),
  b('View', 'help', 'Cheat sheet', k('?')),
];

/** Canonical text of a chord, e.g. 'Ctrl+Shift+I', for cheat sheets and duplicate checks (DESIGN "Input and interaction design"). */
export function chordToString(c: KeyChord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  const name = c.key === ' ' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key;
  parts.push(name);
  return parts.join('+');
}
