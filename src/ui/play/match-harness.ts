/**
 * The `?harness=match` page (docs/design/m8/contracts.md Part C "Harness pages": the queue chip and the match-found card
 * over a fake status). Stub by M8-C; M8-P7 writes it.
 */
import { stubHarness } from '../harness-stub';

export function mount(target: HTMLElement): void {
  stubHarness(target, 'match', 'M8-P7');
}
