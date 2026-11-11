#!/usr/bin/env node
// pnpm shots -- M<n>   captures the gate screenshot matrix into artifacts/shots/M<n>/.
// The gate spec writes screenshots through tests/e2e/helpers/app.ts#shot when SPELLPLANE_SHOTS=1.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const milestone = (args[0] ?? '').toUpperCase();
if (!/^M[0-5]$/.test(milestone)) {
  console.error('usage: pnpm shots -- M<n>');
  process.exit(2);
}
fs.rmSync(`artifacts/shots/${milestone}`, { recursive: true, force: true });
const r = spawnSync('node', ['scripts/e2e-gate.mjs', milestone, ...args.slice(1)], {
  stdio: 'inherit',
  env: { ...process.env, SPELLPLANE_SHOTS: '1' },
});
const dir = `artifacts/shots/${milestone}`;
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
console.log(`\n${files.length} screenshots in ${dir}`);
process.exit(r.status ?? 1);
