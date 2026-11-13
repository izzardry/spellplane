/**
 * The log's new lines as live-region announcements (DESIGN "Input and interaction design", Accessibility: "The log is
 * a live region, so screen readers announce actions"; "Turn flow and confirmation", Action log). Pure: the HUD hands
 * every new timeline (ui/describe.ts LogLine[]) to `next`, which returns the texts to announce. What the page showed
 * when it opened (a resume, a reload) is not read out again, nor is a timeline that shrank or was replaced, and the
 * viewer's own chat lines are not echoed back. A line that changed in place (life changes merged into one line) is
 * announced again with its new text. Filters and chat tabs of the log panel do not change what is announced.
 */
import type { SeatId } from '../../core/types';
import type { LogLine } from '../describe';

/** A log line as one sentence: "Anna taps Llanowar Elves", "Ben: good game". */
export function lineText(line: LogLine): string {
  const body = line.segs.map((s) => ('card' in s ? s.name : s.text)).join('');
  if (line.kind === 'system') return body.trim();
  const sep = (line.kind === 'chat' && !line.told) || line.joined ? ': ' : ' ';
  const team = line.kind === 'chat' && line.channel === 'team' ? ' (team)' : '';
  return `${line.actor}${team}${sep}${body}`.trim();
}

/** Which log lines are new since the last call. */
export class LogAnnouncements {
  private seen: Map<string, string> | null = null;
  private count = 0;

  constructor(private readonly me: SeatId | null) {}

  /** The texts to announce for this timeline, oldest first; none the first time. */
  next(lines: readonly LogLine[]): string[] {
    const texts = new Map(lines.map((l) => [l.key, lineText(l)]));
    const prev = this.seen;
    const shrank = lines.length < this.count;
    this.seen = texts;
    this.count = lines.length;
    if (prev === null || shrank) return [];
    const out: string[] = [];
    for (const l of lines) {
      const t = texts.get(l.key)!;
      const before = prev.get(l.key);
      if (before === t) continue;
      // The own chat line is what this viewer just typed; a pending one later reappears from the log under a new key.
      if (l.kind === 'chat' && l.seat !== null && l.seat === this.me) continue;
      out.push(t);
    }
    return out;
  }
}
