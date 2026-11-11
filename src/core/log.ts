/**
 * The shared timeline of chat and action log, pure (DESIGN "Chat and voice", Text chat: chat lines and action-log lines
 * share one timeline, filterable to chat only or actions only; card names typed in double brackets become hover
 * previews. "Decision log", Permissions: anyone may touch any public card, with attribution; the log and a seat-colour
 * flash keep it honest). PLAN M1-P6.
 *
 * - `parseChatText` splits a chat line into text and `[[card name]]` references.
 * - `mergeTimeline` interleaves log sources (the session's sequenced log, local system lines, own chat lines that are
 *   not sequenced yet) into one ordered timeline without duplicates.
 * - `filterTimeline` keeps the lines of one filter and chat tab.
 * - `attributions` says which other players' cards an action touched, for the attribution flash.
 *
 * Nothing here reads a clock or the DOM; `at` values are display-only wall-clock stamps carried by the entries.
 */
import type { Action, CaptionAction, ChatAction } from './actions';
import type { InstanceId, LogEntry, SeatId, TableState } from './types';

// ---------------------------------------------------------------------------------------------------------------
// [[card name]] references
// ---------------------------------------------------------------------------------------------------------------

/** A piece of a chat line: plain text, or a card named in double brackets (optionally `[[Name|SET]]`). */
export type ChatPart = { text: string } | { card: string; set?: string; raw: string };

/** Longest name accepted inside brackets; the longest printed card name has 141 characters. */
export const MAX_CARD_REF_LENGTH = 160;

const SET_CODE = /^[a-z0-9]{2,6}$/i;

/**
 * Split chat text into plain text and `[[card name]]` references (DESIGN "Chat and voice", Text chat). The name is
 * trimmed and its inner whitespace collapsed; `[[Name|SET]]` adds a set hint. Empty or blank brackets, names longer
 * than MAX_CARD_REF_LENGTH, names containing `[`, `]` or a line break, and unclosed brackets stay plain text. The
 * parts always join back to the original text (`raw` holds the reference as typed).
 */
export function parseChatText(text: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('[[', i)) {
      const close = text.indexOf(']]', i + 2);
      const inner = close < 0 ? null : text.slice(i + 2, close);
      const ref = inner === null ? null : cardRefOf(inner);
      if (ref && close >= 0) {
        // `[[[Shock]]]`: the reference is the innermost `[[Shock]]`; a leading `[` is plain text.
        if (plain) parts.push({ text: plain });
        plain = '';
        const raw = text.slice(i, close + 2);
        parts.push(ref.set ? { card: ref.name, set: ref.set, raw } : { card: ref.name, raw });
        i = close + 2;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

function cardRefOf(inner: string): { name: string; set?: string } | null {
  if (/[[\]\n\r]/.test(inner)) return null;
  let name = inner;
  let set: string | undefined;
  const bar = inner.lastIndexOf('|');
  if (bar >= 0) {
    const hint = inner.slice(bar + 1).trim();
    if (!SET_CODE.test(hint)) return null;
    set = hint.toLowerCase();
    name = inner.slice(0, bar);
  }
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_CARD_REF_LENGTH) return null;
  return set ? { name, set } : { name };
}

/** The card names referenced in a chat line, in order, without duplicates (case-insensitive). */
export function cardRefsIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parseChatText(text)) {
    if (!('card' in p)) continue;
    const k = p.card.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p.card);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline: kinds, merge and filter
// ---------------------------------------------------------------------------------------------------------------

/** What a timeline line is: a chat line (text chat or a final caption), an action line or a local system line. */
export type TimelineKind = 'chat' | 'action' | 'system';

/** The timeline filters (DESIGN "Chat and voice", Text chat: filterable to chat only or actions only). */
export type TimelineFilter = 'all' | 'chat' | 'actions';

export const TIMELINE_FILTERS: readonly TimelineFilter[] = ['all', 'chat', 'actions'];

/** A chat tab (DESIGN "Chat and voice", Text chat: table, team and spectator tabs). Same values as ChatAction's channel. */
export type ChatTab = ChatAction['channel'];

/** Whether an action is a line of conversation: a chat line or a final dictated caption (DESIGN "Chat and voice"). */
export function isChatAction(a: Action): a is ChatAction | CaptionAction {
  return a.type === 'chat' || a.type === 'caption';
}

/** The kind of a log entry in the timeline. */
export function timelineKind(e: LogEntry): TimelineKind {
  if (e.kind === 'system') return 'system';
  return isChatAction(e.action) ? 'chat' : 'action';
}

/** The chat tab of an entry: a chat action's channel; captions are table talk; null for actions and system lines. */
export function chatTabOf(e: LogEntry): ChatTab | null {
  if (e.kind !== 'action') return null;
  if (e.action.type === 'chat') return e.action.channel;
  if (e.action.type === 'caption') return 'table';
  return null;
}

/** An action entry whose action the sequencer has not numbered yet (an own line sent optimistically). */
export function isPending(e: LogEntry): boolean {
  return e.kind === 'action' && e.action.seq === undefined;
}

/**
 * Interleave log sources into one timeline (DESIGN "Chat and voice": one timeline). Sequenced action entries are
 * ordered by seq; a system line follows the action of its seq (it records the last applied seq when written); entries
 * with the same place keep their source order (earlier sources first) and their order within the source. An action
 * that appears in several sources (same cid) is kept once, preferring a sequenced copy over a pending one. Pending
 * entries (no seq yet) follow every sequenced entry in the order they were sent (`at`). Total and stable; the inputs
 * are not changed.
 */
export function mergeTimeline(...sources: readonly (readonly LogEntry[])[]): LogEntry[] {
  type Keyed = { e: LogEntry; src: number; idx: number };
  /** Position in `all` of the kept copy of each action, by cid. */
  const byCid = new Map<string, number>();
  const all: Keyed[] = [];
  sources.forEach((source, src) => {
    source.forEach((e, idx) => {
      const k: Keyed = { e, src, idx };
      if (e.kind === 'action') {
        const at = byCid.get(e.action.cid);
        if (at !== undefined) {
          if (isPending(all[at]!.e) && !isPending(e)) all[at] = k;
          return;
        }
        byCid.set(e.action.cid, all.length);
      }
      all.push(k);
    });
  });
  const place = (k: Keyed): [number, number, number] => {
    if (isPending(k.e)) return [1, k.e.at, 0];
    return [0, k.e.seq, k.e.kind === 'action' ? 0 : 1];
  };
  return all
    .map((k) => ({ k, p: place(k) }))
    .sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1] || a.p[2] - b.p[2] || a.k.src - b.k.src || a.k.idx - b.k.idx)
    .map(({ k }) => k.e);
}

/** What filterTimeline needs of a line. */
export interface TimelineItem {
  kind: TimelineKind;
  /** The chat tab of a chat line; absent means the table tab. */
  channel?: ChatTab;
}

/**
 * Keep the lines a filter shows (DESIGN "Chat and voice", Text chat): 'all' everything, 'chat' only chat lines,
 * 'actions' action lines and system lines. Chat lines show only on their own tab (`tab`, default 'table'); action
 * and system lines show on every tab. Order is kept.
 */
export function filterTimeline<T extends TimelineItem>(items: readonly T[], filter: TimelineFilter, tab: ChatTab = 'table'): T[] {
  return items.filter((l) => {
    if (l.kind === 'chat') return filter !== 'actions' && (l.channel ?? 'table') === tab;
    return filter !== 'chat';
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------------------------------------------

/** One card of another player that an action touched (DESIGN "Decision log", Permissions: with attribution). */
export interface Attribution {
  card: InstanceId;
  /** Whose card it is: its controller, the seat whose territory it sits in (its owner's for cards in hidden zones). */
  of: SeatId;
  /** Who touched it. */
  by: SeatId;
}

/** The cards an action changes (not cards it only refers to, like a ping, a line, an ability's source or a copy's original). */
export function touchedCards(a: Action): InstanceId[] {
  switch (a.type) {
    case 'move':
    case 'moveTemp':
    case 'tap':
    case 'flip':
    case 'transform':
    case 'rotate':
    case 'counter':
    case 'note':
    case 'attach':
    case 'detach':
    case 'pile':
    case 'toZone':
    case 'remove':
    case 'hide':
      return [a.card];
    case 'settle':
      return a.cards ? [...a.cards] : [];
    case 'tidy':
      return Object.keys(a.poses).sort();
    case 'stackPush':
      return a.card ? [a.card] : [];
    case 'lookAt':
      return a.card ? [a.card] : [];
    case 'draw':
      return [a.instanceId];
    case 'undo':
      return touchedCards({ ...a.inverse, by: a.by } as Action);
    default:
      return [];
  }
}

/**
 * The other players' cards `a` touched (DESIGN "Decision log", Permissions: anyone may touch any public card, with
 * attribution). A card is another player's when another seat controls it (it sits in their territory) in `before`,
 * the state the action applied to; `after` is consulted only for a card `before` lacks. A stolen card the actor now
 * controls is the actor's to use; taking an own card back from another player's side is touching theirs. Each card at
 * most once, in action order.
 */
export function attributions(a: Action, before: TableState, after?: TableState): Attribution[] {
  const out: Attribution[] = [];
  const seen = new Set<InstanceId>();
  for (const id of touchedCards(a)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = before.cards[id] ?? after?.cards[id];
    const of = c ? (c.controller ?? c.owner) : undefined;
    if (of && of !== a.by) out.push({ card: id, of, by: a.by });
  }
  return out;
}

/** Every instance id an action mentions that is a card in `state` (touched or only referred to), in field order. */
export function cardsMentioned(a: Action, state: TableState): InstanceId[] {
  const out: InstanceId[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      if (state.cards[v] && !out.includes(v)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) visit(x);
  };
  const { by: _by, cid: _cid, group: _group, ...rest } = a;
  if (rest.type === 'tidy') visit(Object.keys(rest.poses));
  visit(rest);
  return out;
}
