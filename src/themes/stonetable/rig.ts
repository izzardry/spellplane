/**
 * Stonetable's light rig and tone (DESIGN "Themes and rendering", Stonetable: "torch-like directional light, real
 * shadows"). Positions are mm in the viewer's frame (themes/types.ts LightSpec: x right, y away from the viewer, z up),
 * so the torch always burns behind the viewer's left shoulder whichever seat they hold.
 *
 * The torch is a shadow-casting spot light high and far enough away that its rays cross the table at a steady, low
 * angle like a directional light, while its cone gives a torch's falloff toward the far corners and it flickers (the
 * LightSpec flicker exists only for spot and point lights; reduced motion stills it). A cold, dim moonlight from the far
 * side and a faint warm bounce keep the shadowed side readable. The torch is the key light that may shade card faces
 * by at most the theme's faceShade (scene/lights.ts keyLightOf: the first shadow-casting light).
 */
import type { LightSpec, LightingSettings } from '../types';

/** The torch (key light). */
export const TORCH: Extract<LightSpec, { kind: 'spot' }> = {
  kind: 'spot',
  colour: '#ffdab4',
  intensity: 3.5,
  position: [-640, -980, 1380],
  target: [90, 60, 0],
  angleDeg: 52,
  penumbra: 0.55,
  decay: 0,
  distance: 0,
  castShadow: true,
  flicker: { amplitude: 0.09, hz: 1.15 },
};

/** Cold moonlight from the far right, no shadow. */
export const MOON: Extract<LightSpec, { kind: 'directional' }> = {
  kind: 'directional',
  colour: '#8ea4c6',
  intensity: 0.55,
  position: [700, 1100, 1500],
  castShadow: false,
};

/** Sky and bounce. */
export const BOUNCE: Extract<LightSpec, { kind: 'hemisphere' }> = { kind: 'hemisphere', sky: '#66666a', ground: '#0d0b09', intensity: 0.6 };

/** The scene around the slab: a dark hall. */
export const HALL = '#0b0a08';

export const STONETABLE_LIGHTING: LightingSettings = {
  lit: true,
  lights: [BOUNCE, TORCH, MOON],
  toneMapping: 'aces',
  exposure: 1.0,
  background: HALL,
  // No distance fog: the bird's-eye rig looks from metres away and would be fogged out (camera distance, not depth).
  fog: null,
};
