/**
 * The teammate's hand fan and the team reveal targets (DESIGN "Players, seats and formats", Two-Headed Giant: "Each
 * teammate's hand is visible live to the other, shown as a second, smaller fan above the player's own"; "Multiplayer
 * architecture", Targeted reveal: "Showing a card to one player or to a teammate"). Pure, in CSS pixels. M3-P2.
 */
import { CARD_ASPECT, HAND_GAP_PX, TEAM_FAN_INSET, type FanBox } from '../hand';
import { SCREEN_LAYER } from '../../core/geometry';
import { revealRecipients } from '../../core/teams';
import type { SeatId, TableState } from '../../core/types';
import { TEAM_FAN_HEIGHT } from '../types';

/** The teammate's fan may use this fraction of the viewport width (narrower than the own fan's 80%). */
export const TEAM_FAN_WIDTH_FRACTION = 0.6;
/** Gap between the top of the own fan and the bottom of the teammate's fan (CSS px). */
export const TEAM_FAN_GAP_PX = 12;
/** A hovered teammate card grows to this fraction of the viewport height. */
export const TEAM_FAN_HOVER_FRACTION = 0.3;

/** The bottom edge of the teammate's fan above the viewport's bottom: the own fan's height plus a gap. */
export function teamFanBottom(vh: number): number {
  return vh * SCREEN_LAYER.handCardViewportFraction + TEAM_FAN_GAP_PX;
}

/**
 * The top edge of the teammate's fan, label included (the room the table fit keeps for it, ui/hand.ts fitInsets),
 * above the viewport's bottom. The HUD's above-hand stack (confirmation prompt, toast, untap offer) sits above this
 * line while the fan is shown, so the fan never covers it.
 */
export function teamFanTop(vh: number): number {
  return teamFanBottom(vh) + vh * TEAM_FAN_HEIGHT + TEAM_FAN_INSET.label;
}

/**
 * Layout of `n` teammate cards in a `vw` x `vh` viewport, card `hovered` (index) raised: cards at TEAM_FAN_HEIGHT of
 * the viewport height, side by side while they fit TEAM_FAN_WIDTH_FRACTION of the width, then overlapping, centred;
 * every box sits `teamFanBottom(vh)` above the bottom edge, so it never covers the own fan.
 */
export function teamFanLayout(n: number, vw: number, vh: number, hovered: number | null = null): FanBox[] {
  if (n <= 0) return [];
  const h = vh * TEAM_FAN_HEIGHT;
  const w = h * CARD_ASPECT;
  const maxWidth = vw * TEAM_FAN_WIDTH_FRACTION;
  const natural = n * w + (n - 1) * HAND_GAP_PX;
  const step = n === 1 ? 0 : natural <= maxWidth ? w + HAND_GAP_PX : (maxWidth - w) / (n - 1);
  const total = w + (n - 1) * step;
  const left0 = (vw - total) / 2;
  const bottom = teamFanBottom(vh);
  const boxes: FanBox[] = [];
  for (let i = 0; i < n; i++) {
    const left = left0 + i * step;
    if (i === hovered) {
      const hh = vh * TEAM_FAN_HOVER_FRACTION;
      const hw = hh * CARD_ASPECT;
      const centred = left + w / 2 - hw / 2;
      boxes.push({ left: Math.min(Math.max(0, centred), Math.max(0, vw - hw)), bottom, width: hw, height: hh, z: n + 1 });
    } else boxes.push({ left, bottom, width: w, height: h, z: i + 1 });
  }
  return boxes;
}

/** One way to reveal cards: a label and the seats the public `revealTo` names. */
export interface RevealChoice {
  id: string;
  label: string;
  seats: SeatId[];
}

/**
 * The team reveal targets for `me` at a Two-Headed Giant table (core/teams.ts RevealTarget `{kind: 'team'}`, expanded
 * with `revealRecipients`): the own teammate(s) as "My team", and each opposing team by its players' names. Empty
 * without teams.
 */
export function teamRevealChoices(state: TableState, me: SeatId): RevealChoice[] {
  const out: RevealChoice[] = [];
  const mine = Object.hasOwn(state.seats, me) ? state.seats[me]!.team : undefined;
  const teams = Object.values(state.teams).sort((a, b) => Math.min(...a.seats.map((s) => state.seats[s]?.index ?? 9)) - Math.min(...b.seats.map((s) => state.seats[s]?.index ?? 9)));
  for (const t of teams) {
    const seats = revealRecipients(state, me, { kind: 'team', team: t.id }).seats.filter((s) => (state.seats[s]?.name ?? '').trim() !== '');
    if (seats.length === 0) continue;
    const names = seats.map((s) => state.seats[s]!.name).join(' & ');
    out.push({ id: `team:${t.id}`, label: t.id === mine ? `My team (${names})` : `Team ${names}`, seats });
  }
  return out;
}
