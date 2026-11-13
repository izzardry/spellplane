/**
 * The audit panel's one piece of logic outside its markup (ui/audit/AuditPanel.svelte; M5-P2): whether a change of the
 * finished games opens the panel by itself.
 */

/**
 * `seen` finished games were known before; `count` are known now. The panel opens when a game ended that it has not
 * seen. The count can also shrink (another table joined, another history adopted): then the next game that ends still
 * opens it.
 */
export function gamesSeen(seen: number, count: number): { seen: number; opens: boolean } {
  const known = Math.min(seen, count);
  return count > known ? { seen: count, opens: true } : { seen: known, opens: false };
}
