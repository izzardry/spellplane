/**
 * Screen-anchored hand fan geometry (DESIGN "Specification: geometry, layout and motion", Screen layer: cards at 22%
 * of viewport height, overlapping to fit 80% of the width, the hovered card raised to 45% of viewport height;
 * "Camera and navigation", Screen-anchored layer). Pure, in CSS pixels.
 */
import type { InstanceId, SecretStore, TableState } from '../core/types';
import { GEOMETRY, SCREEN_LAYER } from '../core/geometry';

/** Card aspect: width / height = 63 / 88 (DESIGN "Specification: geometry, layout and motion"). */
export const CARD_ASPECT = GEOMETRY.card.w / GEOMETRY.card.h;
/** Gap between hand cards while they fit without overlapping. */
export const HAND_GAP_PX = 8;

/** One card's box: left and bottom edge offsets from the viewport's left and bottom, size. */
export interface FanBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
  /** Paint order, the hovered card on top. */
  z: number;
}

/** Layout of `n` hand cards in a `vw` x `vh` viewport with card `hovered` (index) raised. */
export function fanLayout(n: number, vw: number, vh: number, hovered: number | null = null): FanBox[] {
  if (n <= 0) return [];
  const h = vh * SCREEN_LAYER.handCardViewportFraction;
  const w = h * CARD_ASPECT;
  const maxWidth = vw * SCREEN_LAYER.handWidthFraction;
  const natural = n * w + (n - 1) * HAND_GAP_PX;
  const step = n === 1 ? 0 : natural <= maxWidth ? w + HAND_GAP_PX : (maxWidth - w) / (n - 1);
  const total = w + (n - 1) * step;
  const left0 = (vw - total) / 2;
  const boxes: FanBox[] = [];
  for (let i = 0; i < n; i++) {
    const left = left0 + i * step;
    if (i === hovered) {
      const hh = vh * SCREEN_LAYER.handHoverViewportFraction;
      const hw = hh * CARD_ASPECT;
      const centred = left + w / 2 - hw / 2;
      boxes.push({ left: Math.min(Math.max(0, centred), Math.max(0, vw - hw)), bottom: 0, width: hw, height: hh, z: n + 1 });
    } else boxes.push({ left, bottom: 0, width: w, height: h, z: i + 1 });
  }
  return boxes;
}

/** The fan's own hand in the owner's arrangement (SecretStore.hand), then any hand card the arrangement lacks. */
export function handOrder(state: TableState, secrets: SecretStore, seat: string): InstanceId[] {
  const zone = state.zones[`hand:${seat}`];
  if (!zone) return [];
  const members = new Set(zone.ids);
  const ordered = secrets.hand.filter((id) => members.has(id));
  const seen = new Set(ordered);
  return [...ordered, ...zone.ids.filter((id) => !seen.has(id))];
}

/**
 * Screen edges (CSS px) the HUD's screen-anchored layer covers, for the scene's table fit (DESIGN "Camera and
 * navigation", Screen-anchored layer): `top` the toolbar and turn-strip row, `log` the open log column at the right
 * (300 wide, 8 from the edge, 8 clear), `handGap` the margin above the hand fan (22% of viewport height), `avatars`
 * the avatar column at the left (150 plus padding, 8 from the edge, 8 clear).
 */
export const FIT_INSET = { top: 40, log: 316, handGap: 8, avatars: 190 } as const;

/** The scene host's `data-fit-insets` value, "top right bottom left" in CSS px. */
export function fitInsets(vh: number, logOpen: boolean): string {
  const bottom = Math.round(vh * SCREEN_LAYER.handCardViewportFraction) + FIT_INSET.handGap;
  return `${FIT_INSET.top} ${logOpen ? FIT_INSET.log : 0} ${bottom} ${FIT_INSET.avatars}`;
}
