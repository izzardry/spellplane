/**
 * The action log as text (DESIGN "Turn flow and confirmation", Action log: every state change is one line with seat
 * colour, actor and card names; life changes within two seconds merge into one line "Anna: 20 → 14"; every undo is
 * shown, and undoing a draw says the card went back on top of the library). Pure, apart from the optional name memo.
 *
 * To keep the log readable: one gesture over several cards (draws, moves or taps sharing a `group`) is one line
 * ("draws 7 cards", "moves A, B and C to their graveyard"); the `reveal` that publishes a card's identity just before
 * the action that makes it public (a play, a cast, a mill) gets no line of its own, since that action names the card;
 * the M0 public trace of a shuffle (a `reorder` of more than one card) reads as a shuffle.
 *
 * Names are frozen when a line is first described (LogContext.names): a card that was hidden when it moved stays
 * "a card" in that line after it becomes public, so the log never ties earlier hidden moves to an identity. The HUD
 * fills the memo from the state just before the action too (ui/chat/watch.ts), so a card this browser could see
 * before the action (a card put from the own hand on the bottom of the library) keeps its name (M1-P6).
 *
 * Chat lines (M1-P6): `[[card name]]` in a chat line becomes a named segment that previews the card on hover
 * (DESIGN "Chat and voice", Text chat; core/log.ts parseChatText).
 */
import type { Action, UndoableAction } from '../core/actions';
import type { ActionLogEntry, Format, InstanceId, LogEntry, SeatId, TableState, ZoneId } from '../core/types';
import { parseZoneId } from '../core/ids';
import { parseChatText, type ChatTab } from '../core/log';
import { isSpectatorId } from '../core/teams';
import { spectatorLabel } from '../net/roles';

/**
 * A piece of a log line: text, a table card that previews on hover, or (chat, M1-P6) a card named in double brackets
 * that previews through the card data (`text` is the name as shown, so text-only readers still read the line).
 */
export type Seg = { text: string } | { card: InstanceId; name: string } | { text: string; named: string; set?: string };

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
  /** The chat tab of a chat line (M1-P6); absent for action and system lines. */
  channel?: ChatTab;
  /** The actor and the text are joined by a colon, as in "Anna: 20 → 14" (a change to the actor's own life). */
  joined?: true;
  /**
   * A caption told with the action it is attached to, as in "Anna casts Shock: 'two damage to your Elf'": the actor
   * starts the action's text, no colon after the name (DESIGN "Chat and voice", Record).
   */
  told?: true;
}

/** What the describer needs besides the entries. */
export interface LogContext {
  state: TableState;
  /** A card's name if this browser may know it, else null. */
  cardName(id: InstanceId): string | null;
  phaseLabel(id: string): string;
  /**
   * Names as first described, keyed by entry and card; filled on first use and read afterwards, so a line keeps the
   * names it was written with. The HUD keeps one memo for the page's life.
   */
  names?: Map<string, string | null>;
  /**
   * The log is the solo table's, whose shuffle is a private reorder of the whole zone (session/solo.ts shuffleNow;
   * core/undo.ts `soloShuffles`): a reorder of several cards reads "shuffles". Elsewhere it never does.
   */
  soloShuffles?: boolean;
}

/** The memo key prefix of an action entry's line (LogContext.names keys are `<entryKey>|<card id>`). */
export function entryKeyOf(e: ActionLogEntry): string {
  return `a-${e.seq}-${e.action.cid}`;
}

/** Window in which life changes merge into one line (DESIGN "Turn flow and confirmation"). */
export const LIFE_MERGE_MS = 2000;

/** Protocol steps that change no visible state and get no line of their own. */
const SILENT = new Set<Action['type']>(['rngCommit', 'shuffleNonce', 'shuffleDone', 'snapshotHash', 'sequencerClaim']);

const t = (text: string): Seg => ({ text });
/** The spectators a targeted reveal names, as the log says it (M3-P5). */
const spectatorsText = (n: number): string[] => (n === 0 ? [] : [n === 1 ? 'a spectator' : `${n} spectators`]);

/** Table formats as the log names them (DESIGN "Players, seats and formats"). Added by M3-C. */
const FORMAT_LABEL: Readonly<Record<Format, string>> = { '1v1': '1v1', ffa3: 'three-player free-for-all', ffa4: 'four-player free-for-all', '2hg': 'Two-Headed Giant' };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The card an action is about, for actions that name one card. */
function cardOf(a: Action): InstanceId | null {
  if (a.type === 'stackPush') return a.card ?? null;
  if ('card' in a && typeof a.card === 'string') return a.card;
  return null;
}

/** Join card names as "A", "A and B", "A, B and C". */
function joinCards(cards: Seg[]): Seg[] {
  const out: Seg[] = [];
  cards.forEach((c, i) => {
    if (i > 0) out.push(t(i === cards.length - 1 ? ' and ' : ', '));
    out.push(c);
  });
  return out;
}

/** Build the lines for `entries` (oldest first). */
export function logLines(entries: readonly LogEntry[], ctx: LogContext): LogLine[] {
  const st = ctx.state;
  const seatName = (s: SeatId) => st.seats[s]?.name ?? st.teams[s]?.seats.map((x) => st.seats[x]?.name ?? x).join(' & ') ?? s;
  // The entry being described: its card names are memoised under its key.
  let entryKey = '';
  const card = (id: InstanceId): Seg => {
    const memo = ctx.names;
    const k = `${entryKey}|${id}`;
    let name: string | null;
    if (memo?.has(k)) name = memo.get(k) ?? null;
    else {
      name = ctx.cardName(id);
      memo?.set(k, name);
    }
    return name ? { card: id, name } : { card: id, name: 'a card' };
  };
  /** A word of a line frozen like a name, under `<entryKey>|#<tag>` (M1-P6: a look at the whole library is a search). */
  const frozen = (tag: string, compute: () => string): string => {
    const memo = ctx.names;
    const k = `${entryKey}|#${tag}`;
    const kept = memo?.get(k);
    if (kept !== undefined && kept !== null) return kept;
    const v = compute();
    memo?.set(k, v);
    return v;
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
  // "Anna: 20 → 14" for the actor's own life, "Cleo: team 30 → 28" for the own team's, else "Anna changes life of Ben: 20 → 18".
  const ownLife = (by: SeatId, key: string): boolean => key === by || key === st.seats[by]?.team;
  const lifeText = (by: SeatId, key: string, from: number, to: number): string =>
    key === by ? `${from} → ${to}` : ownLife(by, key) ? `team ${from} → ${to}` : `changes life of ${seatName(key)}: ${from} → ${to}`;
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
  // Who holds which chair so far in these entries: a chair taken again by its holder is a rename or a colour change.
  const chairs: Chairs = { held: new Map(), moves: new Set() };
  // A line that later actions of the same gesture (same type, actor, group and destination) fold into.
  let merge: { line: LogLine; sig: string; a: Action; cards: Seg[] } | null = null;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.kind === 'system') {
      lines.push({ key: `sys-${e.seq}-${lines.length}`, kind: 'system', seat: null, colour: null, actor: '', segs: [t(e.text)], at: e.at, level: e.level });
      lastLife = null;
      merge = null;
      continue;
    }
    const a = e.action;
    byCid.set(a.cid, a);
    entryKey = entryKeyOf(e);
    const life = lifeDelta(a);
    if (life) {
      const before = running.get(life.key) ?? currentLife(life.key);
      const after = before + life.delta;
      running.set(life.key, after);
      if (a.type === 'life' && lastLife && lastLife.key === life.key && lastLife.by === a.by && e.at - lastLife.at <= LIFE_MERGE_MS) {
        lastLife.line.segs = [t(lifeText(a.by, life.key, lastLife.from, after))];
        lastLife.at = e.at;
        continue;
      }
      if (a.type === 'life') {
        const line: LogLine = { key: entryKey, kind: 'action', seat: a.by, colour: st.seats[a.by]?.colour ?? null, actor: seatName(a.by), segs: [t(lifeText(a.by, life.key, before, after))], at: e.at, ...(ownLife(a.by, life.key) ? { joined: true as const } : {}) };
        lines.push(line);
        lastLife = { line, key: life.key, by: a.by, at: e.at, from: before };
        continue;
      }
    }
    lastLife = null;
    if (SILENT.has(a.type)) continue;
    if (a.type === 'reveal') {
      // The action right after a reveal by the same seat that is about the same card names it; no line of its own.
      const next = entries.slice(i + 1).find((x) => x.kind === 'action' && !SILENT.has(x.action.type));
      if (next?.kind === 'action' && next.action.by === a.by && cardOf(next.action) === a.instanceId) continue;
    }
    const d: Describers = { card, zone, seatName, stackItem, phaseLabel: ctx.phaseLabel, state: st, original: (cid) => byCid.get(cid) ?? null, frozen, ...(ctx.soloShuffles === true ? { soloShuffles: true } : {}) };
    const sig = mergeSig(a);
    if (sig !== null && merge && merge.sig === sig) {
      // A draw stays unnamed: it adds a count, not a card.
      merge.cards.push(a.type === 'draw' ? t('a card') : card(cardOf(a)!));
      merge.line.segs = mergedSegs(merge.a, merge.cards, d);
      merge.line.at = e.at;
      continue;
    }
    const chair = chairLine(a, chairs);
    if (chair === 'skip') continue;
    const told = toldWith(a, d);
    const segs = chair ?? told ?? describe(a, d);
    if (!segs) continue;
    // An answer is the answering seat's line, also when the sequencer's clock sent it for that seat (a timeout).
    const who = a.type === 'respond' ? a.seat : a.by;
    // A spectator's line names it by the nickname its chat carries, never by its raw id (M3-P5, net/roles.ts).
    const actor = isSpectatorId(who) ? spectatorLabel(a.type === 'chat' ? a.name : undefined) : seatName(who);
    const line: LogLine = { key: entryKey, kind: a.type === 'chat' || a.type === 'caption' ? 'chat' : 'action', seat: who, colour: st.seats[who]?.colour ?? null, actor, segs, at: e.at };
    if (a.type === 'chat') line.channel = a.channel;
    if (told) line.told = true;
    lines.push(line);
    merge = sig === null ? null : { line, sig, a, cards: [a.type === 'draw' ? t('a card') : card(cardOf(a)!)] };
  }
  return lines;
}

/**
 * A caption's line with the action it is attached to (`about`), as in "Anna casts Shock: 'two damage to your Elf'"
 * (DESIGN "Chat and voice", Record), or null for the plain "Anna: …": no `about`, an action not in these entries, one
 * by another seat (the speaker starts the line) or one without a line of its own.
 */
function toldWith(a: Action, d: Describers): Seg[] | null {
  if (a.type !== 'caption' || a.about === undefined) return null;
  const about = d.original(a.about);
  if (!about || about.by !== a.by || about.type === 'caption' || about.type === 'chat') return null;
  const action = describe(about, d);
  const words = describe(a, d);
  return action && words ? [...action, t(": '"), ...words, t("'")] : null;
}

/** The name a chair carries before its player saved a nickname (session/net.ts DEFAULT_NICKNAME). */
const PLACEHOLDER_NAME = 'Player';

interface Chairs {
  held: Map<SeatId, { name: string; colour: number; peer: string | undefined }>;
  /** Groups of chair moves (take the new chair, leave the old one): the leave gets no line of its own. */
  moves: Set<string>;
}

/**
 * The line of a chair action, or 'skip', or null for the ordinary text. A holder taking its own chair again (the lobby
 * does so to change the colour or the name) says what changed instead of "takes a seat" a second time; leaving the old
 * chair of a move says nothing (the take says it).
 */
function chairLine(a: Action, chairs: Chairs): Seg[] | 'skip' | null {
  if (a.type === 'seatTake') {
    const prev = chairs.held.get(a.seat);
    chairs.held.set(a.seat, { name: a.name, colour: a.colour, peer: a.peer });
    if (a.group !== undefined) chairs.moves.add(a.group);
    if (!prev || prev.peer !== a.peer) return a.group !== undefined ? [t('moves to another chair')] : null;
    // A first nickname over the placeholder a chair is taken with before the lobby saved one (session/net.ts
    // DEFAULT_NICKNAME) is no rename worth a line.
    if (prev.name !== a.name) return prev.name === '' || prev.name === PLACEHOLDER_NAME ? 'skip' : [t(`changes their name from ${prev.name}`)];
    return prev.colour !== a.colour ? [t('changes their seat colour')] : 'skip';
  }
  if (a.type === 'seatLeave') {
    chairs.held.delete(a.seat);
    return a.group !== undefined && chairs.moves.has(a.group) ? 'skip' : null;
  }
  return null;
}

/** What makes two actions one gesture's line: draws, moves and taps of one actor sharing a group. Null: never merged. */
function mergeSig(a: Action): string | null {
  if (a.group === undefined) return null;
  if (a.type === 'draw') return `draw|${a.by}|${a.group}|${a.to ?? ''}`;
  if (a.type === 'move') return `move|${a.by}|${a.group}|${a.to}`;
  if (a.type === 'tap') return `tap|${a.by}|${a.group}|${a.tapped}`;
  return null;
}

/** The text of a merged gesture line: `first` is the gesture's first action, `cards` one entry per action. */
function mergedSegs(first: Action, cards: Seg[], d: Describers): Seg[] {
  if (first.type === 'draw') {
    const n = cards.length;
    return [t(first.to && !first.to.startsWith('hand') ? `draws ${plural(n, 'card')} to ${d.zone(first.to, first.by)}` : `draws ${plural(n, 'card')}`)];
  }
  if (first.type === 'move') return [t('moves '), ...joinCards(cards), t(` to ${d.zone(first.to, first.by)}`)];
  if (first.type === 'tap') return [t(first.tapped ? 'taps ' : 'untaps '), ...joinCards(cards)];
  return describe(first, d) ?? [];
}

interface Describers {
  card(id: InstanceId): Seg;
  zone(z: ZoneId, actor: SeatId): string;
  seatName(s: SeatId): string;
  stackItem(id: string): Seg;
  phaseLabel(id: string): string;
  state: TableState;
  original(cid: string): Action | null;
  /** A word computed once per line and kept (see `frozen` in logLines); without a memo it is computed each time. */
  frozen?(tag: string, compute: () => string): string;
  /** LogContext.soloShuffles. */
  soloShuffles?: boolean;
}

/**
 * A private reorder as the log says it (DECISIONS [M5-review]). On the solo table a reorder of several cards is the
 * public trace of its shuffle (session/solo.ts shuffleNow) and reads "shuffles". At a networked table a shuffle is a
 * `shuffleCommit`, so a reorder never reads as one: the honest client moves one card ("moves a card within"); a reorder
 * of more cards says how many of the top it rearranged, which the audit holds it to; a re-issue of the hand's ids
 * rearranges the hand.
 */
function reorderText(a: Extract<Action, { type: 'reorder' }>, where: string, solo: boolean): string {
  if (a.count <= 1 && a.reissue === undefined) return `moves a card within ${where}`;
  if (solo) return `shuffles ${where}`;
  if (a.reissue !== undefined || !a.zone.startsWith('library')) return `rearranges ${where}`;
  return `reorders the top ${plural(a.count, 'card')} of ${where}`;
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
      // Spectators are not in the shared state, so a reveal to them names how many (M3-P5).
      return [t('reveals '), card(a.instanceId), t(` to ${[...a.seats.map(seatName), ...spectatorsText(a.spectators?.length ?? 0)].join(', ') || 'nobody'}`)];
    case 'hide':
      return [t('hides '), card(a.card)];
    case 'shuffleCommit':
      return [t(a.purpose === 'pack' ? 'opens a pack' : `shuffles ${zone(a.zone, a.by)}`)];
    case 'reorder':
      return [t(reorderText(a, zone(a.zone, a.by), d.soloShuffles === true))];
    case 'lookAt': {
      if (a.card) return [t('peeks at '), card(a.card)];
      // A look at every card of the zone is a search (DESIGN "Card manipulation", Library actions; M0-G finding).
      const look = () => {
        const size = d.state.zones[a.zone]?.ids.length;
        return size !== undefined && size > 0 && a.count >= size ? 'search' : 'top';
      };
      const what = d.frozen ? d.frozen('look', look) : look();
      return [t(what === 'search' ? `searches ${zone(a.zone, a.by)}` : `looks at the top ${plural(a.count, 'card')} of ${zone(a.zone, a.by)}`)];
    }
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
      return [t(`draws ${a.kind === 'mark' ? 'a mark' : `${/^[aeiou]/.test(a.kind) ? 'an' : 'a'} ${a.kind} line`}`), ...(a.label ? [t(` “${a.label}”`)] : [])];
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
    case 'recover':
      return [t(`lost their save: their hand and library are discarded; they propose a new hand of ${plural(a.hand, 'card')}`)];
    case 'recoverCommit':
      return [t(`recovers their library with ${plural(a.instanceIds.length, 'card')} from the re-imported deck`)];
    case 'rngReveal': {
      const r = d.state.rng[a.rid];
      const thing = r?.purpose === 'coin' ? 'coin flip' : r ? `d${r.n}` : '';
      // Another seat's reveal is its part of the roller's round, not a roll of its own.
      if (r && r.by !== a.by) return [t(`adds to ${seatName(r.by)}'s ${thing}`)];
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
    case 'draftTimeout':
      return [t('calls time on a pick')];
    case 'lobbySet':
      return [t('changes the lobby settings')];
    case 'formatSet':
      return [t(`sets the table to ${FORMAT_LABEL[a.format] ?? String(a.format)}`)];
    case 'chat':
    case 'caption':
      return parseChatText(a.text).map((p): Seg => ('card' in p ? (p.set ? { text: p.card, named: p.card, set: p.set } : { text: p.card, named: p.card }) : t(p.text)));
    case 'undo': {
      const orig = d.original(a.of);
      if (orig?.type === 'draw') return [t('undoes the draw; the card goes back on top of the library')];
      const inner = orig ? describe(orig, d) : describe(a.inverse as UndoableAction as Action, d);
      return [t('undoes: '), ...(inner ?? [t('an action')])];
    }
    case 'settings':
      return [t(a.settings.passTimerMs !== undefined ? `sets the pass timer to ${a.settings.passTimerMs === null ? 'off' : `${a.settings.passTimerMs / 1000} s`}` : 'changes the table settings')];
    case 'stageSet':
      return [t({ lobby: 'returns the table to the lobby', draft: 'starts the draft', build: 'starts deck building', match: 'starts the game' }[a.stage] ?? `moves the table to ${a.stage}`)];
    case 'auditPublish': {
      // M5-P2: the verdict follows as its own line (session/audit.ts); this one says what was published.
      const game = typeof a.bundle?.game?.game === 'number' ? ` of game ${a.bundle.game.game}` : '';
      const n = Array.isArray(a.bundle?.records) ? a.bundle.records.length : 0;
      return [t(`publishes the audit records${game} (${plural(n, 'record')})`)];
    }
    default:
      return null;
  }
}
