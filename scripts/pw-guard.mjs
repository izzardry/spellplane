// Runs Playwright under a machine-wide guard (local runs only; CI runs it directly):
//  - at most SPELLPLANE_PW_SLOTS (default 2) Playwright runs at a time across all worktrees, one per worktree
//    (lock directories in the OS temp dir), so parallel agents never stack up browsers and eat the machine's memory;
//  - a stale lock (its owner died, e.g. a killed shell) is taken over and the dead run's
//    process group is killed, so orphaned browsers do not linger;
//  - a watchdog aborts the run as soon as macOS shows an interactive prompt (SecurityAgent, e.g.
//    a keychain "allow access" dialog, or UserNotificationCenter, e.g. a privacy or local-network
//    "allow" alert): every test would hang on it and Playwright would keep relaunching browsers
//    behind the modal. No run starts while such a prompt is open. Only a prompt process with a window on
//    screen counts (the processes can linger without one);
//  - a memory watchdog aborts the run when the machine runs short of memory (kern.memorystatus_level
//    below SPELLPLANE_PW_MIN_FREE_PCT, default 25) or the run's own processes grow past
//    SPELLPLANE_PW_MAX_RSS_MB (default: a third of physical memory), instead of letting browsers
//    swap the machine to death;
//  - a load guard: no run starts while the 1-minute load average is above SPELLPLANE_PW_MAX_LOAD
//    (default 3 × CPUs; it waits instead), and a running one is aborted (exit 5) when the load stays above
//    SPELLPLANE_PW_ABORT_LOAD (default 8 × CPUs) for 30 s. Both machine crashes so far were macOS watchdog
//    panics under extreme load, and browser tests under such load only time out.
// playwright.config.ts refuses local runs that do not come through here (SPELLPLANE_PW_GUARD).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Up to SLOTS runs at once (SPELLPLANE_PW_SLOTS, default 2), one lock directory per slot. Slot 0 keeps the
// original single-lock path, so an older guard (a worktree branched before the slots) still counts against it.
const SLOTS = Math.max(1, Number(process.env.SPELLPLANE_PW_SLOTS ?? 2));
const slotDir = (i) => path.join(os.tmpdir(), i === 0 ? 'spellplane-playwright.lock' : `spellplane-playwright.lock.${i}`);
/** The slot this process holds, once acquired. */
let LOCK = null;
let OWNER = null;
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

function readOwner(dir = LOCK) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Processes that exist only while macOS shows a modal alert waiting for a click.
const PROMPT_PROCESSES = ['SecurityAgent', 'UserNotificationCenter'];

// Owners of the windows on screen, via CGWindowListCopyWindowInfo (JXA; needs no accessibility permission).
const WINDOW_OWNERS_JXA = [
  "ObjC.import('CoreGraphics');",
  'const l = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));',
  'const n = [];',
  "for (let i = 0; i < l.count; i++) n.push(ObjC.unwrap(l.objectAtIndex(i).objectForKey('kCGWindowOwnerName')));",
  'JSON.stringify(n);',
].join('\n');

/** Names of the processes owning on-screen windows, or null if that cannot be determined. */
function onScreenWindowOwners() {
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', WINDOW_OWNERS_JXA], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/**
 * The name of the prompt process macOS is showing, or null. The processes can linger without a window
 * (seen for 45 minutes after a crash), so a running process counts only while it has a window on screen;
 * if the windows cannot be listed, a running process counts.
 */
function securityPromptShowing() {
  if (process.platform !== 'darwin') return null;
  const running = PROMPT_PROCESSES.filter((name) => spawnSync('pgrep', ['-x', name]).status === 0);
  if (running.length === 0) return null;
  const owners = onScreenWindowOwners();
  if (owners === null) return running[0];
  return running.find((name) => owners.includes(name)) ?? null;
}

const MIN_FREE_PCT = Number(process.env.SPELLPLANE_PW_MIN_FREE_PCT ?? 25);
const MAX_RSS_MB = Number(process.env.SPELLPLANE_PW_MAX_RSS_MB ?? Math.round(os.totalmem() / 3 / 2 ** 20));

/** Percentage of memory macOS considers available (kern.memorystatus_level), or null elsewhere. */
function freeMemoryPct() {
  if (process.platform !== 'darwin') return null;
  const out = spawnSync('sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' }).stdout;
  const n = Number.parseInt(out ?? '', 10);
  return Number.isFinite(n) ? n : null;
}

/** Resident memory of the given processes in MiB. */
function rssMb(pids) {
  if (pids.length === 0) return 0;
  const out = spawnSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' }).stdout ?? '';
  return out
    .trim()
    .split('\n')
    .reduce((sum, l) => sum + (Number.parseInt(l, 10) || 0), 0) / 1024;
}

/** A reason to abort for lack of memory, or null. */
function memoryShortage(pgid) {
  const free = freeMemoryPct();
  if (free !== null && free < MIN_FREE_PCT) return `the machine has only ${free}% memory available`;
  const rss = rssMb(treeOf(pgid));
  if (rss > MAX_RSS_MB) return `this run uses ${Math.round(rss)} MiB (limit ${MAX_RSS_MB} MiB)`;
  return null;
}

const CPUS = os.cpus().length;
const MAX_LOAD = Number(process.env.SPELLPLANE_PW_MAX_LOAD ?? 3 * CPUS);
const ABORT_LOAD = Number(process.env.SPELLPLANE_PW_ABORT_LOAD ?? 8 * CPUS);
const load1 = () => os.loadavg()[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Frees `dir` if its owner died (killing what the dead run left behind) or it was left half-written. */
function clearIfStale(dir) {
  const owner = readOwner(dir);
  if (owner && !alive(owner.pid)) {
    if (owner.pgid) killGroup(owner.pgid, 'SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
    console.error(`[pw-guard] removed a stale Playwright lock (pid ${owner.pid}, ${owner.cwd})`);
    return;
  }
  if (!owner) {
    const age = Date.now() - (fs.statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (age > 10_000) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function acquire() {
  const started = Date.now();
  let lastNote = 0;
  for (;;) {
    const owners = [];
    for (let i = 0; i < SLOTS; i++) {
      clearIfStale(slotDir(i));
      const o = readOwner(slotDir(i));
      if (o) owners.push(o);
    }
    // One run per worktree: its build directory and e2e port are shared.
    const sameTree = owners.find((o) => o.cwd === process.cwd());
    const overloaded = load1() > MAX_LOAD;
    if (!sameTree && !overloaded) {
      for (let i = 0; i < SLOTS; i++) {
        try {
          fs.mkdirSync(slotDir(i));
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          continue;
        }
        LOCK = slotDir(i);
        OWNER = path.join(LOCK, 'owner.json');
        fs.writeFileSync(OWNER, JSON.stringify({ pid: process.pid, cwd: process.cwd(), slot: i, since: new Date().toISOString() }));
        return;
      }
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      console.error(
        `[pw-guard] waited ${MAX_WAIT_MS / 60_000} min for a free Playwright slot` +
          (overloaded ? ` (load average ${load1().toFixed(0)}, limit ${MAX_LOAD})` : '') +
          '; giving up',
      );
      process.exit(75);
    }
    if (Date.now() - lastNote > 60_000) {
      console.error(
        sameTree
          ? `[pw-guard] another Playwright run in this worktree is active (pid ${sameTree.pid}); waiting for it to finish`
          : overloaded
            ? `[pw-guard] the machine's load average is ${load1().toFixed(0)} (limit ${MAX_LOAD}); waiting for it to drop`
            : `[pw-guard] all ${SLOTS} Playwright slots are busy (${owners.map((o) => o.cwd).join(', ')}); waiting`,
      );
      lastNote = Date.now();
    }
    await sleep(2000);
  }
}

function release() {
  if (!LOCK) return;
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
  const prompt = securityPromptShowing();
  if (prompt) {
    console.error(`[pw-guard] macOS is showing a prompt (${prompt}). Not starting Playwright until it is answered.`);
    process.exit(3);
  }
  const free = freeMemoryPct();
  if (free !== null && free < MIN_FREE_PCT) {
    console.error(`[pw-guard] the machine has only ${free}% memory available. Not starting Playwright.`);
    process.exit(4);
  }
  await acquire();
  // A prompt may have opened while this run waited for the lock.
  const promptAfterWait = securityPromptShowing();
  if (promptAfterWait) {
    release();
    console.error(`[pw-guard] macOS is showing a prompt (${promptAfterWait}). Not starting Playwright until it is answered.`);
    process.exit(3);
  }
  const child = spawn('pnpm', ['exec', 'playwright', ...args], { stdio: 'inherit', env, detached: true });
  fs.writeFileSync(OWNER, JSON.stringify({ ...readOwner(), pgid: child.pid }));

  let aborted = null;
  let exitCode = 3;
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
  let overloadSince = null;
  const watchdog = setInterval(() => {
    if (aborted) return;
    if (load1() > ABORT_LOAD) {
      overloadSince ??= Date.now();
      if (Date.now() - overloadSince > 30_000) {
        console.error(
          `\n[pw-guard] the machine's load average is ${load1().toFixed(0)} (abort limit ${ABORT_LOAD}). ` +
            'Aborting this Playwright run: results under such load are timeouts, and the machine is at risk.',
        );
        exitCode = 5;
        stop('load');
        return;
      }
    } else overloadSince = null;
    const prompt = securityPromptShowing();
    if (prompt) {
      console.error(
        `\n[pw-guard] macOS is showing a prompt (${prompt}, e.g. keychain access or a privacy alert). ` +
          'Aborting this Playwright run so browsers do not pile up behind it. Code that structured-clones a ' +
          'CryptoKey (IndexedDB, postMessage) in WebKit triggers the keychain; store keys as JWK instead.',
      );
      exitCode = 3;
      stop('prompt');
      return;
    }
    const short = memoryShortage(child.pid);
    if (short) {
      console.error(`\n[pw-guard] ${short}. Aborting this Playwright run before the machine runs out of memory.`);
      exitCode = 4;
      stop('memory');
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
  process.exit(aborted ? exitCode : status);
}
