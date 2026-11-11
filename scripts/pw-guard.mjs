// Runs Playwright under a machine-wide guard (local runs only; CI runs it directly):
//  - one Playwright run at a time across all worktrees (a lock directory in the OS temp dir),
//    so parallel agents never stack up browsers and eat the machine's memory;
//  - a stale lock (its owner died, e.g. a killed shell) is taken over and the dead run's
//    process group is killed, so orphaned browsers do not linger;
//  - a watchdog aborts the run as soon as macOS shows an interactive security prompt
//    (SecurityAgent, e.g. a keychain "allow access" dialog): every test would hang on it and
//    Playwright would keep relaunching browsers behind the modal.
// playwright.config.ts refuses local runs that do not come through here (SPELLPLANE_PW_GUARD).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK = path.join(os.tmpdir(), 'spellplane-playwright.lock');
const OWNER = path.join(LOCK, 'owner.json');
const MAX_WAIT_MS = 90 * 60_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Playwright starts its web server and the browsers in process groups of their own, so killing
// the run's group is not enough: collect the group plus every descendant (by parent pid) first,
// then signal them all.
function treeOf(pgid) {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).stdout ?? '';
  const rows = ps
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number));
  const found = new Set(rows.filter(([pid, , g]) => g === pgid && pid !== process.pid).map(([pid]) => pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (found.has(ppid) && !found.has(pid) && pid !== process.pid) {
        found.add(pid);
        grew = true;
      }
    }
  }
  return [...found];
}

function killGroup(pgid, signal) {
  for (const pid of treeOf(pgid)) {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

function readOwner() {
  try {
    return JSON.parse(fs.readFileSync(OWNER, 'utf8'));
  } catch {
    return null;
  }
}

function securityPromptShowing() {
  if (process.platform !== 'darwin') return false;
  return spawnSync('pgrep', ['-x', 'SecurityAgent']).status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  const started = Date.now();
  let lastNote = 0;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(OWNER, JSON.stringify({ pid: process.pid, cwd: process.cwd(), since: new Date().toISOString() }));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const owner = readOwner();
    if (owner && !alive(owner.pid)) {
      // The previous run's guard died: kill whatever it left behind, then take over.
      if (owner.pgid) {
        killGroup(owner.pgid, 'SIGKILL');
      }
      fs.rmSync(LOCK, { recursive: true, force: true });
      console.error(`[pw-guard] removed a stale Playwright lock (pid ${owner.pid}, ${owner.cwd})`);
      continue;
    }
    if (!owner) {
      // Lock dir without owner file: either being created right now or left half-written.
      const age = Date.now() - (fs.statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > 10_000) fs.rmSync(LOCK, { recursive: true, force: true });
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      console.error(`[pw-guard] waited ${MAX_WAIT_MS / 60_000} min for another Playwright run (${owner?.cwd}); giving up`);
      process.exit(75);
    }
    if (Date.now() - lastNote > 60_000) {
      console.error(`[pw-guard] another Playwright run is active (pid ${owner?.pid}, ${owner?.cwd}); waiting for it to finish`);
      lastNote = Date.now();
    }
    await sleep(2000);
  }
}

function release() {
  const owner = readOwner();
  if (!owner || owner.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
}

/** Runs `pnpm exec playwright <args>` under the guard and exits with its status. */
export async function runPlaywright(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, SPELLPLANE_PW_GUARD: '1' };
  if (process.env.CI) {
    const r = spawnSync('pnpm', ['exec', 'playwright', ...args], { stdio: 'inherit', env });
    process.exit(r.status ?? 1);
  }
  if (securityPromptShowing()) {
    console.error(
      '[pw-guard] macOS is showing a security prompt (SecurityAgent). Not starting Playwright until it is answered.',
    );
    process.exit(3);
  }
  await acquire();
  const child = spawn('pnpm', ['exec', 'playwright', ...args], { stdio: 'inherit', env, detached: true });
  fs.writeFileSync(OWNER, JSON.stringify({ ...readOwner(), pgid: child.pid }));

  let aborted = null;
  const stop = (why) => {
    if (aborted) return;
    aborted = why;
    const tree = treeOf(child.pid);
    killGroup(child.pid, 'SIGTERM');
    setTimeout(() => {
      for (const pid of tree) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }, 5000).unref();
  };
  const watchdog = setInterval(() => {
    if (securityPromptShowing()) {
      console.error(
        '\n[pw-guard] macOS is showing a security prompt (SecurityAgent, e.g. keychain access). ' +
          'Aborting this Playwright run so browsers do not pile up behind it. Code that structured-clones a ' +
          'CryptoKey (IndexedDB, postMessage) in WebKit triggers the keychain; store keys as JWK instead.',
      );
      stop('security prompt');
    }
  }, 3000);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      stop(sig);
      setTimeout(() => {
        release();
        process.exit(130);
      }, 5500).unref();
    });
  }
  const status = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  clearInterval(watchdog);
  killGroup(child.pid, 'SIGKILL'); // leftovers (browsers, preview server) of this run
  release();
  process.exit(aborted ? 3 : status);
}
