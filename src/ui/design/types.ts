/** Shared prop types of the kit (docs/design/m8/contracts.md Part B). Added by M8-P1. */
/** The four control heights: xs 28, sm 36, md 44, lg 56 px (visual.md V4). */
export type Size = 'xs' | 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
export type ManaLetter = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaColour = 'W' | 'U' | 'B' | 'R' | 'G';
/** px of each size (LAYOUT.control). */
export const SIZE_PX: Readonly<Record<Size, number>> = { xs: 28, sm: 36, md: 44, lg: 56 };
/** Icon size inside a control of each height (visual.md A6). */
export const ICON_PX: Readonly<Record<Size, number>> = { xs: 16, sm: 16, md: 20, lg: 24 };
