/**
 * The shared leak scan (CLAUDE.md: any code touching hidden information adds its scenario to the shared leak test;
 * PLAN M1-P2 leak test: no message received by peer B and no field in B's state or stores contains the card id of a
 * card that stayed hidden in A's hand or library). Contracts: M1-C.
 *
 * Usage: collect everything the other browser could have seen (its received messages from the debug hook's
 * `net.messages()`, its TableState, its IndexedDB records, its SecretStore) and the strings that must not appear
 * (core/secrets.ts `secretTokens` of the owner: Scryfall ids, salts, nonces of cards that stayed hidden), then
 * `expect(scan(values, forbidden)).toEqual([])`.
 */

/** One forbidden string found in a scanned value (CLAUDE.md shared leak test). */
export interface LeakHit {
  /** Index of the scanned value in `values`. */
  index: number;
  /** JSON-path-like location inside it, e.g. `$.msg.cards[2].ref.sid`, with `#key` for a match in an object key. */
  path: string;
  /** The forbidden string that occurred. */
  token: string;
}

/**
 * Every place where a forbidden string occurs as a substring of a string or object key, at any depth of the values
 * (plain objects, arrays, Maps, Sets; numbers and booleans are skipped). Empty forbidden strings are ignored. A
 * cycle is visited once.
 */
export function scan(values: readonly unknown[], forbidden: readonly string[]): LeakHit[] {
  const tokens = [...new Set(forbidden)].filter((t) => t.length > 0);
  const hits: LeakHit[] = [];
  if (tokens.length === 0) return hits;
  const seen = new WeakSet<object>();

  const check = (index: number, path: string, text: string): void => {
    for (const token of tokens) if (text.includes(token)) hits.push({ index, path, token });
  };

  const walk = (index: number, path: string, v: unknown): void => {
    if (typeof v === 'string') return check(index, path, v);
    if (typeof v !== 'object' || v === null) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(index, `${path}[${i}]`, x));
    } else if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(index, `${path}#key`, k);
        walk(index, `${path}.${String(k)}`, x);
      }
    } else if (v instanceof Set) {
      let i = 0;
      for (const x of v) walk(index, `${path}{${i++}}`, x);
    } else {
      for (const [k, x] of Object.entries(v)) {
        check(index, `${path}.${k}#key`, k);
        walk(index, `${path}.${k}`, x);
      }
    }
  };

  values.forEach((v, i) => walk(i, '$', v));
  return hits;
}
