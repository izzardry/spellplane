/**
 * The ease of the camera's look moves (fit, seat keys, zoom to a card, follow; DESIGN "Specification: geometry, layout
 * and motion", Camera rigs: 400 ms). M4-P1's blend between the two rigs became the one continuous tilt
 * (scene/camera/tilt.ts, scene/camera/rig.ts; M7-P3), which moves with a spring instead.
 */

/** Ease-in-out cubic: the look moves' progress curve (as the bird's-eye rig's eases, scene/camera/birdseye.ts). */
export const easeBlend = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
