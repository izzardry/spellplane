/**
 * Empty and error states (PLAN M5-P5: "error and empty states everywhere (no deck, no cards found, no peers, relay
 * unreachable, storage full, failed image)"; DESIGN "Input and interaction design", Nothing modal: "prompts are inline
 * and dismissible, and the table stays live under them"; "Multiplayer architecture", No relay fallback: the lobby
 * "says so plainly, with the usual remedies").
 *
 * One catalogue, so every place that shows a state says the same thing: a short title, a sentence on what it means and
 * what to do, and whether it is a problem (alert) or just empty (status).
 */
import { RELAYS_TEXT, REMEDIES } from '../lobby/connectivity';

export type EmptyStateId = 'noDeck' | 'noCardsFound' | 'noPeers' | 'relayUnreachable' | 'storageFull' | 'failedImage' | 'searchUnreachable';

export interface EmptyStateText {
  title: string;
  text: string;
  /** 'alert' for a problem the player should act on, 'status' for something merely empty. */
  tone: 'status' | 'alert';
}

export const EMPTY_STATES: Readonly<Record<EmptyStateId, EmptyStateText>> = {
  noDeck: {
    title: 'No deck yet',
    text: 'Import a decklist to put your library on the table, or open the lobby to draft with friends.',
    tone: 'status',
  },
  noCardsFound: {
    title: 'No cards found',
    text: 'Nothing matches that search. Check the spelling, or try part of the name.',
    tone: 'status',
  },
  searchUnreachable: {
    title: 'Card search unavailable',
    text: 'Scryfall could not be reached, so nothing could be searched. Cards already loaded keep working; try again in a moment.',
    tone: 'alert',
  },
  noPeers: {
    title: 'No other players connected',
    text: `Nobody else is at this table right now. Share the table link; when another player opens it, they appear here. ${REMEDIES}`,
    tone: 'status',
  },
  relayUnreachable: {
    title: 'Relays unreachable',
    text: RELAYS_TEXT,
    tone: 'alert',
  },
  storageFull: {
    title: 'Storage full',
    text: 'This browser has no space left for Spellplane, so the table may not be saved. Free some space (Settings → Storage shows what is used), or remove saved tables and cached images you no longer need.',
    tone: 'alert',
  },
  failedImage: {
    title: 'Image unavailable',
    text: 'This card image could not be loaded. The card still works; its name is shown instead.',
    tone: 'alert',
  },
};
