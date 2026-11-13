/**
 * Stonetable: physically rendered 3D (DESIGN "Themes and rendering", theme table): carved stone slab with CC0 PBR
 * materials, torch-like directional light, real shadows, cards with thickness and slight lift when held, glowing runes
 * for lines, dust motes in the light; ego camera by default.
 * Stub until M4-P5 (themes/stonetable/*): Paper's look under Stonetable's id and camera. Loaded lazily by themes/index.ts loadTheme.
 */
import { stubTheme } from '../stub';

/** The Stonetable theme (DESIGN "Themes and rendering"). Stub: M4-P5. */
export const stonetable = stubTheme('stonetable', 'Stonetable', { defaultRig: 'ego' }, 'M4-P5');
