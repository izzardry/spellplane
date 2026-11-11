/**
 * The action log as text (DESIGN "Turn flow and confirmation", Action log: every state change is one line with seat
 * colour, actor and card names; life changes within two seconds merge into one line "Anna: 20 → 14"; every undo is
 * shown, and undoing a draw says the card went back on top of the library). Pure.
 */
import type { Action, UndoableAction } from '../core/actions';
import type { InstanceId, LogEntry, SeatId, TableState, ZoneId } from '../core/types';
import { parseZoneId } from '../core/ids';

/** A piece of a log line: text, or a card name that previews on hover. */
export type Seg = { text: string } | { card: InstanceId; name: string };

/** One rendered log line (DESIGN "Turn flow and confirmation", Action log). */
export interface LogLine {
  key: string;
  kind: 'action' | 'chat' | 'system';
  /** Acting seat; null for system lines. */
  seat: SeatId | null;
  colour: number | null;
  actor: string;
  segs: Seg[];
  at: number;
  level?: 'info' | 'warn';
}

/** What the describer needs besides the entries. */
export interface LogContext {
  state: TableState;
  /** A card's name if this browser may know it, else null. */
  cardName(id: InstanceId): string | null;
  phaseLabel(id: string): string;
}

/** Window in which life changes merge into one line (DESIGN "Turn flow and confirmation"). */
export const LIFE_MERGE_MS = 2000;

/** Protocol steps that change no visible state and get no line of their own. */
const SILENT = new Set<Action['type']>(['rngCommit', 'shuffleNonce', 'shuffleDone', 'snapshotHash', 'sequencerClaim']);

const t = (text: string): Seg => ({ text });

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Build the lines for `entries` (oldest first). */
export function logLines(entries: readonly LogEntry[], ctx: LogContext): LogLine[] {
  const st = ctx.state;
  const seatName = (s: SeatId) => st.seats[s]?.name ?? st.teams[s]?.seats.map((x) => st.seats[x]?.name ?? x).join(' & ') ?? s;
  const card = (id: InstanceId): Seg => {
    const name = ctx.cardName(id);
    return name ? { card: id, name } : { card: id, name: 'a card' };
  };
  const zone = (z: ZoneId, actor: SeatId): string => {
    const { kind, seat } = parseZoneId(z);
    if (!seat) return `the ${kind}`;
    return seat === actor ? `their ${kind}` : `${seatName(seat)}'s ${kind}`;
  };
  const stackItem = (id: string): Seg => {
    const item = st.stack.find((i) => i.id === id);
    const cardId = item?.card ?? item?.source;
    return cardId ? card(cardId) : t('a stack item');
  };

  // Life: values before each change, starting from current life minus every recorded delta.
  const lifeKey = (s: SeatId) => st.seats[s]?.team ?? s;
  const currentLife = (k: string) => st.teams[k]?.life ?? st.seats[k]?.life ?? 0;
  const lifeDelta = (a: Action): { key: string; delta: number } | null => {
    if (a.type === 'life') return { key: lifeKey(a.seat), delta: a.delta };
    if (a.type === 'undo' && a.inverse.type === 'life') return { key: lifeKey(a.inverse.seat), delta: a.inverse.delta };
    return null;
  };
  const running = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'action') continue;
    const d = lifeDelta(e.action);
    if (d) running.set(d.key, (running.get(d.key) ?? currentLife(d.key)) - d.delta);
  }
  // `running` now holds the life before the first change per key.

  const byCid = new Map<string, Action>();
  const lines: LogLine[] = [];
  let lastLife: { line: LogLine; key: string; by: SeatId; at: number; from: number } | null = null;

  for (const e of entries) {
    if (e.kind === 'system') {
      lines.push({ key: `sys-${e.seq}-${lines.length}`, kind: 'system', seat: null, colour: null, actor: '', segs: [t(e.text)], at: e.at, level: e.level });
      lastLife = null;
      continue;
    }
    const a = e.action;
    byCid.set(a.cid, a);
    const life = lifeDelta(a);
    if (life) {
      const before = running.get(life.key) ?? currentLife(life.key);
      const after = before + life.delta;
      running.set(life.key, after);
      if (a.type === 'life' && lastLife && lastLife.key === life.key && lastLife.by === a.by && e.at - lastLife.at <= LIFE_MERGE_MS) {
        lastLife.line.segs = [t(`${seatName(life.key)}: ${lastLife.from} → ${after}`)];
        lastLife.at = e.at;
        continue;
      }
      if (a.type === 'life') {
        const line: LogLine = { key: `a-${e.seq}-${a.cid}`, kind: 'action', seat: a.by, colour: st.seats[a.by]?.colour ?? null, actor: seatName(a.by), segs: [t(`${seatName(life.key)}: ${before} → ${after}`)], at: e.at };
        lines.push(line);
        lastLife = { line, key: life.key, by: a.by, at: e.at, from: before };
        continue;
      }
    }
    lastLife = null;
    if (SILENT.has(a.type)) continue;
    const segs = describe(a, { card, zone, seatName, stackItem, phaseLabel: ctx.phaseLabel, state: st, original: (cid) => byCid.get(cid) ?? null });
    if (!segs) continue;
    lines.push({ key: `a-${e.seq}-${a.cid}`, kind: a.type === 'chat' || a.type === 'caption' ? 'chat' : 'action', seat: a.by, colour: st.seats[a.by]?.colour ?? null, actor: seatName(a.by), segs, at: e.at });
  }
  return lines;
}

interface Describers {
  card(id: InstanceId): Seg;
  zone(z: ZoneId, actor: SeatId): string;
  seatName(s: SeatId): string;
  stackItem(id: string): Seg;
  phaseLabel(id: string): string;
  state: TableState;
  original(cid: string): Action | null;
}

/** The text of one action, without the actor (who is shown separately). Null for nothing to show. */
export function describe(a: Action, d: Describers): Seg[] | null {
  const { card, zone, seatName, stackItem } = d;
  switch (a.type) {
    case 'move':
      return [t('moves '), card(a.card), t(` to ${zone(a.to, a.by)}`)];
    case 'moveTemp':
      return a.combat === 'attack' ? [t('attacks with '), card(a.card), t(a.tap === false ? ' (no tap)' : '')] : a.combat === 'block' ? [t('blocks with '), card(a.card)] : [t('moves '), card(a.card), t(' temporarily')];
    case 'settle':
      return [t(a.cards ? `settles ${plural(a.cards.length, 'card')}` : 'settles: displaced cards return home')];
    case 'tap':
      return [t(a.tapped ? 'taps ' : 'untaps '), card(a.card)];
    case 'flip':
      return [t('turns '), card(a.card), t(a.face === 'up' ? ' face up' : ' face down')];
    case 'transform':
      return [t('transforms '), card(a.card)];
    case 'rotate':
      return [t('rotates '), card(a.card), t(` ${a.delta}°`)];
    case 'counter':
      return a.delta >= 0 ? [t(`adds ${plural(a.delta, `${a.kind} counter`)} to `), card(a.card)] : [t(`removes ${plural(-a.delta, `${a.kind} counter`)} from `), card(a.card)];
    case 'note':
      return a.text ? [t('notes '), card(a.card), t(`: “${a.text}”`)] : [t('clears the note on '), card(a.card)];
    case 'attach':
      return [t('attaches '), card(a.card), t(' to '), card(a.to)];
    case 'detach':
      return [t('detaches '), card(a.card)];
    case 'pile':
      return a.pile ? [t(a.pile.kind === 'cascade' ? 'cascades ' : 'piles '), card(a.card)] : [t('takes '), card(a.card), t(' out of its pile')];
    case 'tidy':
      return [t('tidies the battlefield')];
    case 'createToken':
      return a.ref ? [t('creates a token: '), card(a.card)] : [t(`creates “${a.label ?? 'an object'}”`)];
    case 'copy':
      return [t('makes a token copy of '), card(a.of)];
    case 'remove':
      return [t('removes '), card(a.card)];
    case 'toZone':
      return [t('puts '), card(a.card), t(a.to.startsWith('library') ? ` on the ${a.position === 'bottom' ? 'bottom' : 'top'} of ${zone(a.to, a.by)}` : ` into ${zone(a.to, a.by)}`)];
    case 'draw':
      return [t(a.to && !a.to.startsWith('hand') ? `draws a card to ${zone(a.to, a.by)}` : 'draws a card')];
    case 'reveal':
      return [t('reveals '), card(a.instanceId)];
    case 'revealTo':
      return [t('reveals '), card(a.instanceId), t(` to ${a.seats.map(seatName).join(', ') || 'nobody'}`)];
    case 'hide':
      return [t('hides '), card(a.card)];
    case 'shuffleCommit':
      return [t(a.purpose === 'pack' ? 'opens a pack' : `shuffles ${zone(a.zone, a.by)}`)];
    case 'reorder':
      return [t(`reorders the top ${plural(a.count, 'card')} of ${zone(a.zone, a.by)}`)];
    case 'lookAt':
      return a.card ? [t('peeks at '), card(a.card)] : [t(`looks at the top ${plural(a.count, 'card')} of ${zone(a.zone, a.by)}`)];
    case 'mulligan':
      return [t(`mulligans (${a.count})`)];
    case 'stackPush':
      if (a.kind === 'spell' && a.card) return [t('casts '), card(a.card)];
      if (a.kind === 'copy') return [t('copies '), a.copyOf ? stackItem(a.copyOf) : t('a stack item')];
      return [t(a.kind === 'trigger' ? 'adds a trigger of ' : 'activates an ability of '), a.source ? card(a.source) : t('a card')];
    case 'stackNote':
      return [t('notes '), stackItem(a.item), t(`: “${a.note}”`)];
    case 'stackResolve':
      return [t('resolves the top of the stack'), t(a.force ? ' before everyone passed' : '')];
    case 'stackCounter':
      return [t('counters the top of the stack')];
    case 'stackReorder':
      return [t('reorders the stack')];
    case 'lineAdd':
      return [t(`draws ${a.kind === 'mark' ? 'a mark' : `a ${a.kind} line`}`), ...(a.label ? [t(` “${a.label}”`)] : [])];
    case 'lineRemove':
      return [t('removes a line')];
    case 'ping':
      return a.target.kind === 'card' ? [t('points at '), card(a.target.id)] : a.target.kind === 'seat' ? [t(`points at ${seatName(a.target.id)}`)] : [t('points at '), stackItem(a.target.id)];
    case 'phaseSet':
      return [t(`moves to ${d.phaseLabel(a.phase)}`)];
    case 'turnPass':
      return [t(`passes the turn to ${seatName(a.to)}`)];
    case 'ask':
      return [t(a.label ? `asks “${a.label}”` : 'asks for responses')];
    case 'respond':
      return [t({ ok: 'passes', hold: 'holds', release: 'releases the hold', timeout: 'passes (timer)' }[a.response])];
    case 'autoPass':
      return [t(a.on ? 'passes until end of turn' : 'stops passing automatically')];
    case 'life':
      return [t(`${seatName(a.seat)}: life ${a.delta >= 0 ? '+' : ''}${a.delta}`)];
    case 'playerCounter':
      return [t(`${a.delta >= 0 ? 'adds' : 'removes'} ${plural(Math.abs(a.delta), a.kind)} ${a.delta >= 0 ? 'to' : 'from'} ${seatName(a.seat)}`)];
    case 'seatTake':
      return [t('takes a seat')];
    case 'seatLeave':
      return [t('leaves the table')];
    case 'ready':
      return [t(`is ready with ${plural(a.instanceIds.length, 'card')}`)];
    case 'rngReveal': {
      const r = d.state.rng[a.rid];
      const what = r?.purpose === 'coin' ? 'flips a coin' : r ? `rolls a d${r.n}` : 'reveals a random result';
      const res = r?.result === null || r?.result === undefined ? '' : r.purpose === 'coin' ? `: ${r.result === 0 ? 'heads' : 'tails'}` : `: ${r.result + 1}`;
      return [t(what + res)];
    }
    case 'packOpen':
      return [t('opens a pack')];
    case 'pick':
      return [t(`picks ${plural(a.count, 'card')}`)];
    case 'packPass':
      return [t(`passes a pack to ${seatName(a.to)}`)];
    case 'pileLook':
      return [t(a.take ? `takes pile ${a.pile + 1}` : `looks at pile ${a.pile + 1}`)];
    case 'gridTake':
      return [t(`takes ${a.line} ${a.index + 1}`)];
    case 'chat':
    case 'caption':
      return [t(a.text)];
    case 'undo': {
      const orig = d.original(a.of);
      if (orig?.type === 'draw') return [t('undoes the draw; the card goes back on top of the library')];
      const inner = orig ? describe(orig, d) : describe(a.inverse as UndoableAction as Action, d);
      return [t('undoes: '), ...(inner ?? [t('an action')])];
    }
    case 'settings':
      return [t(a.settings.passTimerMs !== undefined ? `sets the pass timer to ${a.settings.passTimerMs === null ? 'off' : `${a.settings.passTimerMs / 1000} s`}` : 'changes the table settings')];
    case 'stageSet':
      return [t(`moves the table to ${a.stage}`)];
    default:
      return null;
  }
}
