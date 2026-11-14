/**
 * When Scryfall or MTGJSON cannot be reached (PLAN M5-P3: graceful behaviour when Scryfall or MTGJSON is unreachable;
 * DESIGN "Card data and images", Caching: card JSON and set files are cached in IndexedDB and every cache is
 * rebuildable). Requests that cannot reach the service, or get no answer in time, fail with an `UnreachableError` that
 * says so in words a player understands and that cached data still works, so no screen waits forever and no screen
 * shows a bare "Failed to fetch". Cached cards and sets are looked up before any request (data/source.ts,
 * data/mtgjson.ts), so they stay usable offline.
 */

/** The two services the app fetches data from at runtime (DESIGN "Card data and images"). */
export type DataService = 'Scryfall' | 'MTGJSON';

/** Why a request did not get an answer. */
export type UnreachableReason = 'offline' | 'timeout' | 'network';

/**
 * How long a request may take before it counts as unanswered. Scryfall answers API requests in well under a second;
 * MTGJSON set files are 0.8–5 MB (DESIGN "Card data and images"), so a slow mobile connection gets a minute.
 */
export const REQUEST_TIMEOUT_MS: Readonly<Record<DataService, number>> = { Scryfall: 20_000, MTGJSON: 60_000 };

/** What still works without the service, for the message. */
const STILL_WORKS: Readonly<Record<DataService, string>> = {
  Scryfall: 'Cards already loaded on this device still work',
  MTGJSON: 'Sets already loaded on this device still work',
};

/** The message a player sees (no HTTP or browser jargon). */
export function unreachableMessage(service: DataService, reason: UnreachableReason, timeoutMs: number = REQUEST_TIMEOUT_MS[service]): string {
  const still = STILL_WORKS[service];
  switch (reason) {
    case 'offline':
      return `${service} cannot be reached: this device is offline. ${still}; try again when you are back online.`;
    case 'timeout':
      return `${service} did not answer within ${Math.round(timeoutMs / 1000)} seconds. ${still}; try again later.`;
    case 'network':
      return `${service} cannot be reached right now (no connection to it). ${still}; try again later.`;
  }
}

/** A request to Scryfall or MTGJSON that got no answer. */
export class UnreachableError extends Error {
  constructor(
    readonly service: DataService,
    readonly reason: UnreachableReason,
    readonly url: string,
    timeoutMs?: number,
  ) {
    super(unreachableMessage(service, reason, timeoutMs));
    this.name = 'UnreachableError';
  }
}

/** Whether an error says a data service could not be reached. */
export function isUnreachable(e: unknown): e is UnreachableError {
  return e instanceof UnreachableError;
}

export interface GuardOptions {
  /** Default REQUEST_TIMEOUT_MS[service]. */
  timeoutMs?: number;
  /** Whether the browser believes it is online (navigator.onLine); default true outside a browser. */
  online?: () => boolean;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine;
}

/** Whether a thrown value is the browser's failure to fetch or read a response (a TypeError), or an abort. */
function isFetchFailure(e: unknown): boolean {
  return e instanceof TypeError || (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && e.name === 'AbortError');
}

/**
 * Run one request to a data service (`run` fetches with the given signal and reads the answer) under a deadline that
 * covers the answer's body as well. It rejects with an UnreachableError when the request fails before an answer (the
 * browser's TypeError for no connection, DNS or CORS failures, or a body cut off), or when the whole exchange takes
 * longer than the timeout (the request is then aborted). Errors `run` throws itself (an HTTP status it refuses, a body
 * that is not JSON) pass through, and so does an abort the caller asked for (`signal`).
 */
export async function guarded<T>(service: DataService, url: string, run: (signal: AbortSignal) => Promise<T>, opts: GuardOptions & { signal?: AbortSignal | null } = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS[service];
  const online = opts.online ?? browserOnline;
  const controller = new AbortController();
  const outer = opts.signal ?? null;
  const onOuterAbort = (): void => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new UnreachableError(service, 'timeout', url, timeoutMs));
    }, timeoutMs);
  });
  try {
    // A fetch that ignores the signal (a test double, an old polyfill) still cannot outlast the deadline.
    return await Promise.race([run(controller.signal), deadline]);
  } catch (e) {
    if (e instanceof UnreachableError) throw e;
    if (timedOut) throw new UnreachableError(service, 'timeout', url, timeoutMs);
    if (outer?.aborted) throw e;
    if (!isFetchFailure(e)) throw e;
    throw new UnreachableError(service, online() ? 'network' : 'offline', url);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
