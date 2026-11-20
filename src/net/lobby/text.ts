/** The texts lobby signatures cover (matchmaking.md 2.4). */
import { canonicalJson } from '../../core/hash';
import type { Ticket } from './messages';

/** The canonical JSON of a ticket without its signature, prefixed with the protocol tag. */
export function ticketText(ticket: Omit<Ticket, 'sig'> | Ticket): string {
  const { sig: _sig, ...rest } = ticket as Ticket;
  return `spellplane-v1|ticket|${canonicalJson(rest)}`;
}
