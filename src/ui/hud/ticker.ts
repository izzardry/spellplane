/**
 * The log ticker (docs/design/m7-hud-proposal.md, Activity button: "The last 2–3 events slide in under it and fade
 * after about 6 seconds").
 */
import type { LogLine } from '../describe';

/** Lines the ticker shows at most. */
export const TICKER_LINES = 3;
/** How long a ticker line stays before it has faded (ms). */
export const TICKER_MS = 6000;

/** One line of the ticker as plain text: actor and segments, as the log reads it. */
export function tickerText(line: LogLine): string {
  const text = line.segs.map((s) => ('name' in s ? s.name : s.text)).join('');
  if (!line.actor) return text;
  return line.joined || line.kind === 'chat' ? `${line.actor}: ${text}` : `${line.actor} ${text}`;
}
