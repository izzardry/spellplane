/**
 * Whether the frame meter is shown (PLAN M7 A0): the `?fps` URL flag, or the "Show frame rate" setting of this
 * browser. The setting is kept in localStorage under the profile's namespace (store/profile.ts): the Settings record
 * (store/types.ts) is a contract file, and a meter is a per-browser diagnostic convenience whose loss costs nothing
 * (DECISIONS M7-A0). Storage that is blocked or throws reads as off.
 */
import { flags } from '../../util/flags';
import { cacheName } from '../../store/profile';
import type { MeterSnapshot } from '../../util/frame-meter';

const KEY = (): string => cacheName('spellplane-show-fps');

function readStored(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY()) === '1';
  } catch {
    return false;
  }
}

let stored = readStored();
const listeners = new Set<(on: boolean) => void>();

/** The "Show frame rate" setting. */
export function showFpsSetting(): boolean {
  return stored;
}

export function setShowFps(on: boolean): void {
  stored = on;
  try {
    if (on) localStorage.setItem(KEY(), '1');
    else localStorage.removeItem(KEY());
  } catch {
    /* blocked storage: on for this page only */
  }
  for (const fn of listeners) fn(meterShown());
}

/** Shown: the URL flag or the setting. */
export function meterShown(): boolean {
  return flags().fps || stored;
}

export function onMeterShown(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const fixed = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : '–');

/** The meter's lines of text for a snapshot (pure; unit-tested). */
export function meterLines(s: MeterSnapshot): string[] {
  const lines: string[] = [];
  if (s.idle) lines.push(`idle · ${Math.round(s.callbacks)} Hz`);
  else lines.push(`${fixed(s.fps, 0)} fps · ${fixed(s.p50)} / ${fixed(s.p95)} ms`);
  lines.push(`max ${fixed(s.max, 0)} ms · p50 / p95`);
  const r = s.render;
  if (r) {
    lines.push(`${r.width}×${r.height} @${fixed(r.pixelRatio, 2)}${r.renderScale !== 1 ? ` (×${fixed(r.renderScale, 2)})` : ''} dpr ${fixed(r.devicePixelRatio, 2)}`);
    lines.push(`${r.theme} · ${r.quality}${r.post.length ? ' · post' : ''}${r.shadows ? ' · shadows' : ''}`);
  } else lines.push('no table');
  return lines;
}
