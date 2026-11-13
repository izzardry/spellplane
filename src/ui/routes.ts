/**
 * Hash routes of the app shell (DESIGN "Multiplayer architecture": a table is a shareable link; PLAN M1 `/#/diag`).
 * `#/` is the solo table in milestone 0; rooms, the lobby and the diagnostics page arrive in later milestones.
 */
export type Route =
  | { name: 'solo' }
  /**
   * `#/t/<room>/<key>`: the networked table; with `/watch` appended (`watch: true`) the same table joined as a spectator
   * without a chair (DESIGN "Players, seats and formats", Spectators; DECISIONS [M3-C]; M3-P5).
   */
  | { name: 'room'; room: string; key: string; watch?: true }
  | { name: 'lobby' }
  /** `#/settings` and `#/about`: the settings panel and the About panel as pages (PLAN M5-P5). */
  | { name: 'settings' }
  | { name: 'about' }
  | { name: 'diag' }
  /** `#/diag/<room>/<key>`: the connection check joining a diagnostics room another machine started (M1-P5). */
  | { name: 'diagJoin'; room: string; key: string }
  | { name: 'notFound'; hash: string };

/** The last path segment of a spectator's table link (`#/t/<room>/<key>/watch`). */
export const WATCH = 'watch';

/** Parse `location.hash`. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  if (path === '' || path === '/') return { name: 'solo' };
  const parts = path.replace(/^\//, '').split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] === 't' && parts.length === 3 && parts[1] && parts[2]) return { name: 'room', room: parts[1], key: parts[2] };
  if (parts[0] === 't' && parts.length === 4 && parts[1] && parts[2] && parts[3] === WATCH) return { name: 'room', room: parts[1], key: parts[2], watch: true };
  if (parts.length === 1 && parts[0] === 'lobby') return { name: 'lobby' };
  if (parts.length === 1 && parts[0] === 'diag') return { name: 'diag' };
  if (parts.length === 1 && parts[0] === 'settings') return { name: 'settings' };
  if (parts.length === 1 && parts[0] === 'about') return { name: 'about' };
  if (parts[0] === 'diag' && parts.length === 3 && parts[1] && parts[2]) return { name: 'diagJoin', room: parts[1], key: parts[2] };
  return { name: 'notFound', hash };
}

/** The hash for a route. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'solo':
      return '#/';
    case 'room':
      return `#/t/${encodeURIComponent(route.room)}/${encodeURIComponent(route.key)}${route.watch ? `/${WATCH}` : ''}`;
    case 'lobby':
      return '#/lobby';
    case 'diag':
      return '#/diag';
    case 'settings':
      return '#/settings';
    case 'about':
      return '#/about';
    case 'diagJoin':
      return `#/diag/${encodeURIComponent(route.room)}/${encodeURIComponent(route.key)}`;
    case 'notFound':
      return route.hash;
  }
}
