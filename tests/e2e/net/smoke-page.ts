/**
 * Browser entry for the @network smoke test (tests/e2e/network.smoke.spec.ts): the net harness page (./page.ts) plus
 * the real Trystero transport. Kept apart from ./page.ts so the bundles of the regular e2e specs never contain
 * Trystero and cannot reach a relay.
 */
import { TrysteroTransport } from '../../../src/net/trystero';
import type { Transport } from '../../../src/net/transport';

(window as unknown as { __trysteroTransport: () => Transport }).__trysteroTransport = () => new TrysteroTransport();
await import('./page');
