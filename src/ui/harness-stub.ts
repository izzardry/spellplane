/**
 * A stub harness page (docs/design/m8/contracts.md Part C "Harness pages"): one per package, so its acceptance never
 * needs another package's code. M8-C registers every name in ui/harnesses.ts with a mount like this one; the owner
 * replaces its `src/ui/<area>/harness.ts`. Added by M8-C.
 */

/** Mount a placeholder that names the harness and the package that writes it. */
export function stubHarness(target: HTMLElement, name: string, owner: string): void {
  target.textContent = '';
  const main = document.createElement('main');
  main.dataset.testid = `harness-${name}`;
  main.dataset.harness = name;
  const h = document.createElement('h1');
  h.textContent = `Harness: ${name}`;
  const p = document.createElement('p');
  p.textContent = `Not in this build yet (${owner} writes it).`;
  main.append(h, p);
  target.append(main);
}
