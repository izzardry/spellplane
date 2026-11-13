/**
 * Dusk: moody, low-key (DESIGN "Themes and rendering", theme table): dark felt under a single warm lamp, soft contact
 * shadows, vignette, soft bloom on lines, slow light falloff, muted ambience; bird's-eye, slightly tilted.
 * Stub until M4-P3 (themes/dusk/*): Paper's look under Dusk's id and camera. Loaded lazily by themes/index.ts loadTheme.
 */
import { stubTheme } from '../stub';

/** The Dusk theme (DESIGN "Themes and rendering"). Stub: M4-P3. */
export const dusk = stubTheme('dusk', 'Dusk', { defaultRig: 'birdseye', birdseyeTiltDeg: 10 }, 'M4-P3');
