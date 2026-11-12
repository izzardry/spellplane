/**
 * The nonces this browser contributes to joint randomness while a round is open (DESIGN "Specification: network
 * protocol and secrecy", Public randomness 1-3, Secret shuffle 2). The SecretStore has no slot for them (decision
 * M1-P2), so they live in local storage until the round is decided: a reload between `rngCommit` and `rngReveal` can
 * still reveal the committed nonce, and a `shuffleNonce` or `rngCommit` proposed again after a refusal or a reload
 * carries the same nonce, so a sequencer cannot refuse until a value it likes arrives (decision M1-P2 retry).
 *
 * Keys are per room and per identity (`?profile=` pages share one origin's local storage but not a key pair). Without
 * local storage (blocked, or Node in unit tests) the nonces are kept in memory for the page.
 */

/** Which round a nonce belongs to: an rng round (own or another seat's) or another seat's shuffle. */
export type NonceKind = 'rng' | 'shuffle';

/** Where open-round nonces are kept. */
export interface NonceStore {
  get(kind: NonceKind, id: string): string | null;
  set(kind: NonceKind, id: string, nonce: string): void;
  delete(kind: NonceKind, id: string): void;
  /** Ids with a kept nonce of `kind`. */
  ids(kind: NonceKind): string[];
}

/** A NonceStore in memory (unit tests share one between a session and its reload). */
export function memoryNonces(): NonceStore {
  const m = new Map<string, string>();
  const k = (kind: NonceKind, id: string): string => `${kind}:${id}`;
  return {
    get: (kind, id) => m.get(k(kind, id)) ?? null,
    set: (kind, id, nonce) => void m.set(k(kind, id), nonce),
    delete: (kind, id) => void m.delete(k(kind, id)),
    ids: (kind) => [...m.keys()].filter((x) => x.startsWith(`${kind}:`)).map((x) => x.slice(kind.length + 1)),
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page's local storage for room `roomId` and identity `peerId`, or memory when local storage is unavailable. */
export function localNonces(roomId: string, peerId: string): NonceStore {
  const ls = storage();
  if (!ls) return memoryNonces();
  const prefix = `spellplane:nonce:${roomId}:${peerId}:`;
  const fallback = memoryNonces();
  const k = (kind: NonceKind, id: string): string => `${prefix}${kind}:${id}`;
  return {
    get(kind, id) {
      try {
        return ls.getItem(k(kind, id)) ?? fallback.get(kind, id);
      } catch {
        return fallback.get(kind, id);
      }
    },
    set(kind, id, nonce) {
      fallback.set(kind, id, nonce);
      try {
        ls.setItem(k(kind, id), nonce);
      } catch {
        /* quota or blocked: the page keeps it in memory */
      }
    },
    delete(kind, id) {
      fallback.delete(kind, id);
      try {
        ls.removeItem(k(kind, id));
      } catch {
        /* nothing to remove */
      }
    },
    ids(kind) {
      const out = new Set(fallback.ids(kind));
      try {
        for (let i = 0; i < ls.length; i++) {
          const key = ls.key(i);
          if (key?.startsWith(`${prefix}${kind}:`)) out.add(key.slice(prefix.length + kind.length + 1));
        }
      } catch {
        /* memory only */
      }
      return [...out];
    },
  };
}
