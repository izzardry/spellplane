/**
 * Placeholder themes until their packages land (PLAN Milestone 4: Dusk M4-P3, Wyrm M4-P4, Stonetable M4-P5). A stub is
 * Paper's look under the theme's id, name and default camera (DESIGN "Themes and rendering", theme table), so the
 * theme picker, lazy loading and hot-swap (M4-P6, M4-P2) can be built and tested before the themes exist. Each theme
 * package replaces its stub; this file goes when the last one has. Added by M4-C.
 */
import { paper } from './paper/index';
import type { CameraDefaults, Theme, ThemeId } from './types';

/** A Paper-looking theme that names the package that implements it (`pkg`, e.g. 'M4-P3'). Added by M4-C. */
export function stubTheme(id: Exclude<ThemeId, 'paper'>, label: string, camera: CameraDefaults, pkg: string): Theme & { stub: string } {
  return { ...paper, id, label, camera, stub: pkg };
}
