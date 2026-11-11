/**
 * Hash routes of the app shell (DESIGN "Multiplayer architecture": a table is a shareable link; PLAN M1 `/#/diag`).
 * `#/` is the solo table in milestone 0; rooms, the lobby and the diagnostics page arrive in later milestones.
 */
export type Route =
  | { name: 'solo' }
  | { name: 'room'; room: string; key: string }
  | { name: 'lobby' }
  | { name: 'diag' }
  | { name: 'notFound'; hash: string };

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
  if (parts.length === 1 && parts[0] === 'lobby') return { name: 'lobby' };
  if (parts.length === 1 && parts[0] === 'diag') return { name: 'diag' };
  return { name: 'notFound', hash };
}

/** The hash for a route. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'solo':
      return '#/';
    case 'room':
      return `#/t/${encodeURIComponent(route.room)}/${encodeURIComponent(route.key)}`;
    case 'lobby':
      return '#/lobby';
    case 'diag':
      return '#/diag';
    case 'notFound':
      return route.hash;
  }
}
