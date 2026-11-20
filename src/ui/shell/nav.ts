/** Which nav segment a route lights (journey.md J2: PLAY │ DECKS │ HISTORY). M8-P2. */

/** A route as the shell needs it (src/ui/routes.ts Route; M8-C's routes add home, decks, history). */
export interface ShellRoute {
  name: string;
}

/** The nav value of a route, or null for settings, about and diag. */
export function navOf(route: ShellRoute): 'play' | 'decks' | 'history' | null {
  if (route.name === 'home' || route.name === 'solo') return 'play';
  if (route.name.startsWith('deck')) return 'decks';
  if (route.name === 'history') return 'history';
  return null;
}

/** The seat colours the profile popover offers, from the viewer's theme (none without one). */
export function profileColours(theme: { tokens: { colours: { seats: { colour: string }[] } } } | null): string[] {
  return theme ? theme.tokens.colours.seats.map((s) => s.colour) : [];
}
