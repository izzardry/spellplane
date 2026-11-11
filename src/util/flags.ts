/**
 * URL flags used by the test harnesses (docs/PLAN.md, B0.5).
 * Read from the query string; the hash is reserved for routing.
 *
 *   ?profile=a          namespaces IndexedDB and caches so several pages act as different people
 *   ?transport=local    BroadcastChannel transport instead of Trystero
 *   ?faces=placeholder  procedurally drawn card faces instead of Scryfall images
 *   ?speech=fake        injectable speech engine (tests drive it through the debug hook)
 */
export interface Flags {
  profile: string | null;
  transport: 'trystero' | 'local';
  faces: 'scryfall' | 'placeholder';
  speech: 'fake' | null;
}

export function parseFlags(search: string): Flags {
  const p = new URLSearchParams(search);
  const profile = p.get('profile');
  return {
    profile: profile && /^[a-z0-9_-]{1,32}$/i.test(profile) ? profile : null,
    transport: p.get('transport') === 'local' ? 'local' : 'trystero',
    faces: p.get('faces') === 'placeholder' ? 'placeholder' : 'scryfall',
    speech: p.get('speech') === 'fake' ? 'fake' : null,
  };
}

let cached: Flags | null = null;

/** Flags of the current page. Outside a browser this returns the defaults. */
export function flags(): Flags {
  if (!cached) cached = parseFlags(typeof location === 'undefined' ? '' : location.search);
  return cached;
}
