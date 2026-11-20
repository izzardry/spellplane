/**
 * URL flags used by the test harnesses (docs/PLAN.md, B0.5).
 * Read from the query string; the hash is reserved for routing.
 *
 *   ?profile=a          namespaces IndexedDB and caches so several pages act as different people
 *   ?transport=local    BroadcastChannel transport instead of Trystero
 *   ?faces=placeholder  procedurally drawn card faces instead of Scryfall images
 *   ?speech=fake        injectable speech engine (tests drive it through the debug hook)
 *   ?fps                the frame meter (M7-A0: fps, frame times, render size); every build, production included
 *   ?render=a,b         renderer switches for measuring (M7-A0, scene/switches.ts), e.g. render=noadapt,fullpr
 */
export interface Flags {
  profile: string | null;
  transport: 'trystero' | 'local';
  faces: 'scryfall' | 'placeholder';
  speech: 'fake' | null;
  /** Show the frame meter (`?fps`, `?fps=1`; `?fps=0` leaves it to the setting). */
  fps: boolean;
  /** Renderer switches (`?render=noadapt,…`; scene/switches.ts), lower case, in the order given. */
  render: string[];
}

export function parseFlags(search: string): Flags {
  const p = new URLSearchParams(search);
  const profile = p.get('profile');
  return {
    profile: previewProfile(profile && /^[a-z0-9_-]{1,32}$/i.test(profile) ? profile : null),
    transport: p.get('transport') === 'local' ? 'local' : 'trystero',
    faces: p.get('faces') === 'placeholder' ? 'placeholder' : 'scryfall',
    speech: p.get('speech') === 'fake' ? 'fake' : null,
    fps: p.has('fps') && p.get('fps') !== '0' && p.get('fps') !== 'false',
    render: (p.get('render') ?? '').toLowerCase().split(',').map((x) => x.trim()).filter((x) => /^[a-z0-9.=-]{1,24}$/.test(x)),
  };
}

/** The preview build shares the live site's origin: its saved data lives in its own namespace, never the live one's. */
function previewProfile(profile: string | null): string | null {
  if (typeof __SPELLPLANE_PREVIEW__ === 'undefined' || !__SPELLPLANE_PREVIEW__) return profile;
  return profile ? `preview-${profile}` : 'preview';
}

let cached: Flags | null = null;

/** Flags of the current page. Outside a browser this returns the defaults. */
export function flags(): Flags {
  if (!cached) cached = parseFlags(typeof location === 'undefined' ? '' : location.search);
  return cached;
}
