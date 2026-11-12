/**
 * Presence for a table without peers (DESIGN "Players, seats and formats", Other players' cursors: there are none in
 * solo play). Added by M1-C for the solo session's TableSession.presence.
 */
import type { Presence } from '../net/types';

/** Presence that sends nothing and never hears anyone (net/types.ts Presence). */
export const NULL_PRESENCE: Presence = Object.freeze({
  cursor: () => undefined,
  drag: () => undefined,
  speaking: () => undefined,
  typing: () => undefined,
  captionInterim: () => undefined,
  peers: () => [],
  subscribe: () => () => undefined,
});
