/**
 * Transaction helper: run several writes in one IndexedDB transaction and make sure that a failure in any of them
 * (thrown synchronously, e.g. DataCloneError or DataError, or failing asynchronously) aborts the whole transaction,
 * so none of the writes land (DESIGN "Specification: network protocol and secrecy", Local persistence).
 */
import type { IDBPTransaction, StoreNames } from 'idb';
import type { SpellplaneDB } from './types';

type WriteTx<N extends StoreNames<SpellplaneDB>[]> = IDBPTransaction<SpellplaneDB, N, 'readwrite'>;

/**
 * Queue writes through `body` and wait until the transaction commits. `body` must issue its requests synchronously
 * (no awaits), and returns the request promises. If `body` throws, the transaction is aborted and the error rethrown.
 */
export async function atomicWrite<N extends StoreNames<SpellplaneDB>[]>(
  tx: WriteTx<N>,
  body: (tx: WriteTx<N>, track: (p: Promise<unknown>) => void) => void,
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const track = (p: Promise<unknown>): void => {
    pending.push(p);
  };
  try {
    body(tx, track);
  } catch (err) {
    // A synchronous throw leaves the requests issued so far queued in an active transaction: abort it, or they commit.
    for (const p of pending) p.catch(() => undefined);
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // already finished
    }
    throw err;
  }
  // Promise.all subscribes to every promise, so the AbortError of the others never surfaces as unhandled.
  await Promise.all([...pending, tx.done]);
}
