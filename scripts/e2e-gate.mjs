#!/usr/bin/env node
// pnpm e2e:gate -- M<n>   runs tests/e2e/m<n>.gate.spec.ts (tagged @gate) on Chromium and WebKit.
import fs from 'node:fs';
import { runPlaywright } from './pw-guard.mjs';

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
// From M3 on a gate test drives five pages at once: keep the gate to one worker unless the caller says otherwise.
const workers = process.env.SPELLPLANE_PW_WORKERS ?? (Number(milestone.slice(1)) >= 3 ? '1' : undefined);
await runPlaywright(['test', spec, ...args], { SPELLPLANE_GATE: milestone, SPELLPLANE_SHOTS: process.env.SPELLPLANE_SHOTS ?? '1', ...(workers ? { SPELLPLANE_PW_WORKERS: workers } : {}) });
