/**
 * "Who is typing" (DESIGN "Multiplayer architecture", Shared state: "who is typing or speaking travel on the unreliable
 * channel and are never logged"; "Chat and voice", Text chat; GAPS 22). Implementer: M6-P2.
 *
 * Sending: the chat field announces its tab on presence (`Presence.typing(channel)`) once it holds text, and clears it
 * (null) when the text is sent or emptied, the field loses focus, the tab changes to one that is not announced, or no
 * key was typed for TYPING_IDLE_MS. Team chat is never announced: presence reaches every connection, opponents and
 * spectators included, and the team channel carries text only between teammates (DESIGN "Two-Headed Giant"), so not
 * even the fact that a partner is writing leaves the team (DECISIONS [M6-P2]).
 *
 * Showing: a peer typing on the table or spectator tab is shown to everyone at the table (players and spectators read
 * both tabs); a team tab (from an older or foreign client) only to that seat's teammates. Shown beside the chat field and
 * on the typing player's avatar.
 */
import { teammatesOf } from '../../core/teams';
import type { SeatId, TableState } from '../../core/types';
import type { ChatChannel } from '../../net/messages';
import { spectatorChatName } from '../../net/roles';
import type { PeerInfo, PeerPresence } from '../../net/types';

/** After this long without a keystroke the typing indicator stops (the text stays in the field). */
export const TYPING_IDLE_MS = 5000;

/** The chat tabs a typing indicator is announced for (never 'team'). */
export function announcesTyping(channel: ChatChannel): boolean {
  return channel === 'table' || channel === 'spectator';
}

export interface TypingSenderOptions {
  /** Presence.typing. */
  send(channel: ChatChannel | null): void;
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The chat field's typing announcements (see the module comment). */
export class TypingSender {
  private current: ChatChannel | null = null;
  private timer: unknown = null;
  private readonly idleMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: TypingSenderOptions) {
    this.idleMs = opts.idleMs ?? TYPING_IDLE_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The field's text changed (a keystroke, a paste) on `channel`'s tab. */
  input(text: string, channel: ChatChannel): void {
    if (!text.trim() || !announcesTyping(channel)) {
      this.stop();
      return;
    }
    if (this.current !== channel) {
      this.current = channel;
      this.opts.send(channel);
    }
    this.stopTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.stop();
    }, this.idleMs);
  }

  /** Sent, emptied, blurred or gone: the indicator stops. */
  stop(): void {
    this.stopTimer();
    if (this.current === null) return;
    this.current = null;
    this.opts.send(null);
  }

  /** The tab announced now, or null. */
  channel(): ChatChannel | null {
    return this.current;
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

/** Someone typing whom this viewer may see typing. */
export interface Typer {
  peerId: string;
  /** Their seat, null for a spectator. */
  seat: SeatId | null;
  name: string;
  channel: ChatChannel;
}

/**
 * The peers typing that this viewer may see (see the module comment), by name. `self` is the viewer's seat (or spectator
 * id); `peers` the connections with their nicknames and roles, for spectators' names.
 */
export function typersOf(presence: readonly PeerPresence[], state: TableState, self: string, peers: readonly PeerInfo[] = []): Typer[] {
  const out = new Map<string, Typer>();
  const seated = Object.hasOwn(state.seats, self);
  const mates = seated ? teammatesOf(state, self) : [];
  for (const p of presence) {
    const channel = p.typing;
    if (channel === null || !p.peerId) continue;
    const seat = p.seat !== null && Object.hasOwn(state.seats, p.seat) ? p.seat : null;
    if (seat === self) continue;
    if (channel === 'team' && (seat === null || !mates.includes(seat))) continue;
    if (channel !== 'team' && !announcesTyping(channel)) continue;
    const info = peers.find((q) => q.peerId === p.peerId);
    const name = seat !== null ? state.seats[seat]!.name || 'Player' : `${spectatorChatName(info?.nickname ?? '')} (spectator)`;
    out.set(p.peerId, { peerId: p.peerId, seat, name, channel });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.peerId.localeCompare(b.peerId));
}

const TAB_LABEL: Record<ChatChannel, string> = { table: 'Table', team: 'Team', spectator: 'Spectators' };

/** "Ann is typing…", "Ann and Ben are typing…", "3 people are typing…". */
function names(list: readonly Typer[]): string {
  if (list.length === 1) return `${list[0]!.name} is typing…`;
  if (list.length === 2) return `${list[0]!.name} and ${list[1]!.name} are typing…`;
  return `${list.length} people are typing…`;
}

/**
 * The line beside the chat field for the tab shown: who is typing on it, then who is typing on another tab the viewer
 * can open ("Viv is typing in Spectators"); '' when nobody is.
 */
export function typingText(typers: readonly Typer[], tab: ChatChannel, tabs: readonly ChatChannel[] = [tab]): string {
  const here = typers.filter((t) => t.channel === tab);
  const parts: string[] = here.length ? [names(here)] : [];
  for (const other of tabs) {
    if (other === tab) continue;
    const there = typers.filter((t) => t.channel === other);
    if (there.length) parts.push(`${names(there).replace(/…$/, '')} in ${TAB_LABEL[other]}`);
  }
  return parts.join(' · ');
}

/** Seats typing now that the viewer may see (the avatars' typing marks). */
export function typingSeats(typers: readonly Typer[]): Set<SeatId> {
  return new Set(typers.flatMap((t) => (t.seat ? [t.seat] : [])));
}
