import { test } from '@playwright/test';

// The real Trystero transport smoke test is tagged @network: excluded from gates and CI,
// because public relays are not deterministic. Milestone 1 implements it (docs/PLAN.md M1).
test.skip('two pages connect over Trystero on public relays @network', async () => {});
