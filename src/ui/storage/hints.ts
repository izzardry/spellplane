/**
 * The two one-time hints of M5-P3 (store/types.ts HintId): `installHomeScreen` (PLAN Milestone 5, owner decisions,
 * Installable on iPad: "shows a one-time hint on iPad and iPhone explaining why" — Safari deletes a site's storage after
 * 7 days without a visit unless it is on the Home Screen) and `persistStorage` (PLAN M5-P3: storage-persistence prompt;
 * DESIGN "Card data and images", Caching: the app requests persistent storage but never depends on it). Pure: the
 * environment is passed in.
 */
import type { HintId } from '../../store/types';

/** What decides whether the hints show. */
export interface HintEnv {
  /** navigator.userAgent. */
  userAgent: string;
  /** navigator.platform (iPadOS reports 'MacIntel' with a desktop user agent). */
  platform: string;
  /** navigator.maxTouchPoints. */
  maxTouchPoints: number;
  /** Running from the Home Screen: navigator.standalone (iOS) or display-mode standalone. */
  standalone: boolean;
}

/** Whether this is an iPhone, iPod or iPad, including iPadOS's desktop-class Safari that calls itself a Mac. */
export function isAppleMobile(env: Pick<HintEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(env.userAgent)) return true;
  // iPadOS 13+: "Macintosh" in the user agent and MacIntel as the platform, but a touch screen (no Mac has one).
  return (env.platform === 'MacIntel' || /\bMacintosh\b/.test(env.userAgent)) && env.maxTouchPoints > 1;
}

/** The Home Screen hint shows on iPhone and iPad in Safari (not from the Home Screen), until dismissed once. */
export function showHomeScreenHint(env: HintEnv, seen: readonly HintId[]): boolean {
  return isAppleMobile(env) && !env.standalone && !seen.includes('installHomeScreen');
}

/**
 * The storage-persistence prompt shows when the browser can keep storage for good, has not done so for Spellplane yet,
 * and the player has not answered the prompt before.
 */
export function showPersistHint(state: { supported: boolean; persisted: boolean }, seen: readonly HintId[]): boolean {
  return state.supported && !state.persisted && !seen.includes('persistStorage');
}

/** `seen` with `id` added once. */
export function withSeen(seen: readonly HintId[], id: HintId): HintId[] {
  return seen.includes(id) ? [...seen] : [...seen, id];
}

/** This page's environment. */
export function pageHintEnv(): HintEnv {
  if (typeof navigator === 'undefined') return { userAgent: '', platform: '', maxTouchPoints: 0, standalone: false };
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone };
}

/** The Home Screen hint's text (PLAN Milestone 5, owner decisions: explain why). */
export const HOME_SCREEN_HINT = {
  title: 'Add Spellplane to your Home Screen',
  body: 'Safari deletes a website’s saved data after 7 days without a visit: your decks, saved tables and your key to reclaim your chair. Apps on the Home Screen keep theirs. Tap the Share button, then “Add to Home Screen”, and open Spellplane from there.',
  backup: 'You can also export a backup of your decks and tables on the start page.',
} as const;

/** The storage-persistence prompt's text. */
export const PERSIST_HINT = {
  title: 'Keep your tables on this device?',
  body: 'When space runs low, the browser may clear what Spellplane saved: your decks, saved tables and hidden cards. Ask it to keep them.',
  granted: 'The browser keeps Spellplane’s data for good.',
  refused: 'The browser did not agree. Spellplane still works; export a backup now and then to be safe.',
} as const;
