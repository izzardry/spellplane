/**
 * Installable app and service-worker updates (PLAN Milestone 5, owner decisions: "Installable on iPad" — a web app
 * manifest and icons, no Wizards marks — and "Updates only between games"; PLAN M5-P3: precache of the app shell;
 * DESIGN "Card data and images", Caching). Shared by src/sw.ts, vite.config.ts and the HUD, so it imports nothing.
 * Contracts: M5-C. Implementer: M5-P3 (icons in public/, the manifest in vite.config.ts, the precache in sw.ts, the
 * update notice in the HUD).
 */

/**
 * The web app manifest (PLAN Milestone 5, owner decisions, Installable on iPad). Paths are relative to the app's base
 * (`/spellplane/`). The icons are Spellplane's own neutral mark (the card-back motif), never a Wizards mark; M5-P3 draws
 * them and may add sizes.
 */
export const WEB_APP_MANIFEST = {
  name: 'Spellplane',
  short_name: 'Spellplane',
  description: 'A trading card game table for friends, peer-to-peer in the browser.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#ffffff',
  theme_color: '#111111',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const;

/** The 180×180 icon iOS Safari uses for the Home Screen (`<link rel="apple-touch-icon">`). */
export const APPLE_TOUCH_ICON = 'icons/apple-touch-icon.png';

/**
 * Messages between the page and the service worker (PLAN Milestone 5, owner decisions, Updates only between games). The
 * new worker installs in the background and waits; the page posts `skipWaiting` to it only where `updateMayApply`
 * allows (ui/update.ts), then reloads once the new worker controls the page.
 */
export const SW_MESSAGE = {
  skipWaiting: 'spellplane:skip-waiting',
} as const;

/** Base name of the app-shell precache (PLAN M5-P3), namespaced like the image cache (store/profile.ts cacheName). */
export const SHELL_CACHE_BASE = 'spellplane-shell';

/** Where an update is pending: the HUD shows `UPDATE_NOTICE` while it waits (PLAN Milestone 5, owner decisions). */
export type UpdateStatus = 'current' | 'available' | 'applying';

/** The notice's text (PLAN Milestone 5, owner decisions: "New version available: it applies after this game"). */
export const UPDATE_NOTICE = 'New version available: it applies after this game';
