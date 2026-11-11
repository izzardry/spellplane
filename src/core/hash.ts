/**
 * Canonical JSON and state hashing (DESIGN "Specification: network protocol and secrecy", Sync:
 * "the SHA-256 of the canonical JSON of the state"). Implemented by M0-C; pure apart from Web Crypto.
 */
import type { TableState } from './types';

/** A plain JSON value (DESIGN "Data model and protocol": shared state is a plain object). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isPlainObject(v: object): boolean {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const v: unknown = value[i];
          items.push(v === undefined ? 'null' : write(v, `${path}[${i}]`));
        }
        return `[${items.join(',')}]`;
      }
      if (!isPlainObject(value)) throw new TypeError(`canonicalJson: not a plain object at ${path}`);
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = rec[k];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${write(v, `${path}.${k}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}

/**
 * Canonical JSON (DESIGN "Specification: network protocol and secrecy", Sync): object keys sorted by UTF-16 code
 * units, no whitespace, `undefined` properties omitted (array holes become null) like JSON.stringify. Throws on
 * non-finite numbers, functions, symbols, bigints and non-plain objects (Map, Set, Date, class instances).
 */
export function canonicalJson(value: unknown): string {
  return write(value, '$');
}

/** base64url without padding (DESIGN "Specification: network protocol and secrecy"). */
export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 of a UTF-8 string, base64url (DESIGN "Technology stack and project structure": Web Crypto). */
export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

/** SHA-256 of the canonical JSON of the state, base64url (DESIGN "Specification: network protocol and secrecy", Sync). */
export function stateHash(state: TableState): Promise<string> {
  return sha256(canonicalJson(state));
}
