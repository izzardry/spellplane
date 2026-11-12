#!/usr/bin/env node
// pnpm e2e [-- playwright args]          all e2e tests except @network and @gate
// pnpm e2e:network [-- playwright args]  only @network tests
// Both run through scripts/pw-guard.mjs (at most four Playwright runs at a time on this machine, one per worktree).
import { runPlaywright } from './pw-guard.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const network = args[0] === '--network';
if (network) args.shift();
await runPlaywright(['test', ...(network ? ['--grep', '@network'] : ['--grep-invert', '@network|@gate']), ...args]);
