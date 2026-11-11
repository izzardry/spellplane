#!/usr/bin/env node
// pnpm e2e:gate -- M<n>   runs tests/e2e/m<n>.gate.spec.ts (tagged @gate) on Chromium and WebKit.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const milestone = (args.shift() ?? '').toUpperCase();
if (!/^M[0-5]$/.test(milestone)) {
  console.error('usage: pnpm e2e:gate -- M<n>   (n = 0..5)');
  process.exit(2);
}
const spec = `tests/e2e/${milestone.toLowerCase()}.gate.spec.ts`;
if (!fs.existsSync(spec)) {
  console.error(`gate spec ${spec} does not exist yet`);
  process.exit(1);
}
const r = spawnSync('pnpm', ['exec', 'playwright', 'test', spec, ...args], {
  stdio: 'inherit',
  env: { ...process.env, SPELLPLANE_GATE: milestone, SPELLPLANE_SHOTS: process.env.SPELLPLANE_SHOTS ?? '1' },
});
process.exit(r.status ?? 1);
