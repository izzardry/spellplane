/**
 * Hash routes of the app (docs/design/m8/contracts.md Part C; journey.md section 3; decks.md section 1). Everything
 * stays in the URL fragment, which never reaches the host. `#/` (and the empty hash) is Home; the table sandbox moved
 * to `#/solo`; `#/lobby` keeps the legacy start page (frozen, linked from nowhere). Screens are routes so the
 * browser's Back works; sheets, overlays and the queue are states, not routes. Revised by M8-C.
 */
export type Route =
  /** `#/` and the empty hash: Home (journey.md 4.1). */
  | { name: 'home' }
  /** `#/decks`: the deck library (decks.md D1). `#/build` redirects here. */
  | { name: 'decks' }
  /** `#/decks/new` and `#/decks/new/<path>` (`boosters`, `custom`, `simple`, `import`): the new-deck chooser (decks.md D2). */
  | { name: 'deckNew'; path?: string }
  /** `#/decks/<id>`: the deck page (decks.md D5). `#/build/<id>` redirects here. */
  | { name: 'deck'; id: string }
  /** `#/decks/<id>/open`: opening a booster deck's packs (decks.md D4). */
  | { name: 'deckOpen'; id: string }
  /** `#/history`: all games (journey.md 4.14). */
  | { name: 'history' }
  /** `#/p/<room>`: a practice table alone (computer.md section 11). */
  | { name: 'practice'; room: string }
  /** `#/c/<room>`: a game against Sparring (computer.md section 3). */
  | { name: 'computer'; room: string }
  /** `#/solo`: the table sandbox (was `#/`), linked from nowhere. */
  | { name: 'solo' }
  /**
   * `#/t/<room>/<key>`: the networked table; with `/watch` appended (`watch: true`) the same table joined as a spectator
   * without a chair (DESIGN "Players, seats and formats", Spectators; DECISIONS [M3-C]; M3-P5). With
   * `/rejoin/<seat>/<token>` a re-invite link that claims a seat (persistence.md section 7).
   */
  | { name: 'room'; room: string; key: string; watch?: true; rejoin?: { seat: string; token: string } }
  /** `#/lobby`: the legacy start page (frozen; contracts.md Part C). */
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

/** The path segment of a re-invite link (`#/t/<room>/<key>/rejoin/<seat>/<token>`; persistence.md section 7). */
export const REJOIN = 'rejoin';

/** Routes inside the shell (Home, Decks, History, Settings, About, Diag): App wraps them in ui/shell/Shell.svelte (contracts.md Part C). */
export function isShellRoute(route: Route): boolean {
  switch (route.name) {
    case 'home':
    case 'decks':
    case 'deckNew':
    case 'deck':
    case 'deckOpen':
    case 'history':
    case 'settings':
    case 'about':
    case 'diag':
    case 'diagJoin':
      return true;
    default:
      return false;
  }
}

/** Routes that mount a table (they render ui/table/TableFrame.svelte). */
export function isTableRoute(route: Route): boolean {
  return route.name === 'solo' || route.name === 'room' || route.name === 'practice' || route.name === 'computer';
}

/** Parse `location.hash`. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  if (path === '' || path === '/') return { name: 'home' };
  const parts = path.replace(/^\//, '').split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [head, a, b] = parts;
  const n = parts.length;
  if (head === 't' && a && b) {
    if (n === 3) return { name: 'room', room: a, key: b };
    if (n === 4 && parts[3] === WATCH) return { name: 'room', room: a, key: b, watch: true };
    if (n === 6 && parts[3] === REJOIN && parts[4] && parts[5]) return { name: 'room', room: a, key: b, rejoin: { seat: parts[4], token: parts[5] } };
  }
  if (n === 1) {
    switch (head) {
      case 'solo':
        return { name: 'solo' };
      case 'lobby':
        return { name: 'lobby' };
      case 'diag':
        return { name: 'diag' };
      case 'settings':
        return { name: 'settings' };
      case 'about':
        return { name: 'about' };
      case 'history':
        return { name: 'history' };
      case 'decks':
      case 'build':
        return { name: 'decks' };
    }
  }
  if (head === 'decks' && a) {
    if (a === 'new' && n === 2) return { name: 'deckNew' };
    if (a === 'new' && n === 3 && b) return { name: 'deckNew', path: b };
    if (n === 2) return { name: 'deck', id: a };
    if (n === 3 && b === 'open') return { name: 'deckOpen', id: a };
  }
  if (head === 'build' && a && n === 2) return { name: 'deck', id: a };
  if (head === 'p' && a && n === 2) return { name: 'practice', room: a };
  if (head === 'c' && a && n === 2) return { name: 'computer', room: a };
  if (head === 'diag' && n === 3 && a && b) return { name: 'diagJoin', room: a, key: b };
  return { name: 'notFound', hash };
}

/** The hash for a route. */
export function routeHash(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'decks':
      return '#/decks';
    case 'deckNew':
      return route.path ? `#/decks/new/${e(route.path)}` : '#/decks/new';
    case 'deck':
      return `#/decks/${e(route.id)}`;
    case 'deckOpen':
      return `#/decks/${e(route.id)}/open`;
    case 'history':
      return '#/history';
    case 'practice':
      return `#/p/${e(route.room)}`;
    case 'computer':
      return `#/c/${e(route.room)}`;
    case 'solo':
      return '#/solo';
    case 'room': {
      const base = `#/t/${e(route.room)}/${e(route.key)}`;
      if (route.rejoin) return `${base}/${REJOIN}/${e(route.rejoin.seat)}/${e(route.rejoin.token)}`;
      return route.watch ? `${base}/${WATCH}` : base;
    }
    case 'lobby':
      return '#/lobby';
    case 'diag':
      return '#/diag';
    case 'settings':
      return '#/settings';
    case 'about':
      return '#/about';
    case 'diagJoin':
      return `#/diag/${e(route.room)}/${e(route.key)}`;
    case 'notFound':
      return route.hash;
  }
}
