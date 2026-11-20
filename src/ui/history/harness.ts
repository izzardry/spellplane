/** History module test page (`?harness=history`, dev and test builds only): the home harness opened at `#/history` (contracts.md Part C). M8-P2. */
import { mount as mountHome } from '../home/harness';

export function mount(target: HTMLElement): void {
  mountHome(target, 'history');
}
