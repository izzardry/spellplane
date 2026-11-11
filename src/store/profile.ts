import { flags } from '../util/flags';

/** IndexedDB database name, namespaced by the ?profile= flag: `spellplane` or `spellplane-<profile>`. */
export function dbName(base = 'spellplane', profile: string | null = flags().profile): string {
  return profile ? `${base}-${profile}` : base;
}

/** Cache API name, namespaced the same way. */
export function cacheName(base: string, profile: string | null = flags().profile): string {
  return profile ? `${base}-${profile}` : base;
}
