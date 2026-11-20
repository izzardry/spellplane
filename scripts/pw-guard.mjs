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
//  - a browser watchdog: every Playwright browser process (paths under its ms-playwright cache) is measured by its
//    physical footprint (macOS `footprint`), not its resident size, because WebKit's GPU, WebContent and Networking
//    helpers are XPC services started by launchd, outside the run's process group, and keep their GPU buffers out of
//    `ps`. One over SPELLPLANE_PW_MAX_BROWSER_MB (default 4096), or all of them together over the run limit above,
//    aborts the run (exit 4) and the offenders are killed, whichever run they belong to (launchd's XPC helpers
//    cannot be traced to a run; one that size is the leak). On 19 Nov 2026 WebKit GPU helpers grew to 40–60 GB each
//    during two full e2e runs and swapped the machine to a standstill (oomph incident 20261119-035310);
//  - strays: when no other run holds a slot, Playwright browser processes left from earlier runs are killed before a
//    run starts and after it ends;
//  - oomph (if installed, https://github.com/kleinzeug/oomph): the run reserves SPELLPLANE_PW_RESERVE (default 3G) in
//    the machine-wide queue Claude sessions share, waits for its turn, and releases it at the end;
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
  'for (let i = 0; i < l.count; i++) {',
  '  const w = l.objectAtIndex(i);',
  "  const b = ObjC.deepUnwrap(w.objectForKey('kCGWindowBounds')) || {};",
  // A prompt is a real dialog; UserNotificationCenter can leave a 4x4 px window on screen with nothing in it.
  '  if ((b.Width || 0) < 50 || (b.Height || 0) < 50) continue;',
  "  n.push(ObjC.unwrap(w.objectForKey('kCGWindowOwnerName')));",
  '}',
  'JSON.stringify(n);',
].join('\n');

/** Names of the processes owning on-screen windows of at least 50x50 px, or null if that cannot be determined. */
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

const MAX_BROWSER_MB = Number(process.env.SPELLPLANE_PW_MAX_BROWSER_MB ?? 4096);

/** Playwright's browser processes on this machine (any run): their executables live in its ms-playwright cache. */
function browserProcesses() {
  const out = spawnSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).stdout ?? '';
  const procs = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && m[2].includes('/ms-playwright/') && Number(m[1]) !== process.pid) procs.push({ pid: Number(m[1]), name: path.basename(m[2]) });
  }
  return procs;
}

const UNIT_MB = { KB: 1 / 1024, MB: 1, GB: 1024 };

/** A process's physical footprint in MiB (GPU buffers included); its resident size where `footprint` cannot tell. */
function footprintMb(pid) {
  if (process.platform === 'darwin') {
    const out = spawnSync('footprint', ['--noCategories', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
    const m = out.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/);
    if (m) return Number(m[1]) * UNIT_MB[m[2]];
  }
  return rssMb([pid]);
}

/** Browser processes that are too big ({procs, why}), or null. */
function browserBloat() {
  const procs = browserProcesses().map((p) => ({ ...p, mb: footprintMb(p.pid) }));
  const total = procs.reduce((sum, p) => sum + p.mb, 0);
  const over = procs.filter((p) => p.mb > MAX_BROWSER_MB);
  const list = (ps) => ps.map((p) => `${p.name} [${p.pid}] ${Math.round(p.mb)} MiB`).join(', ');
  if (over.length) return { procs: over, why: `a browser process grew past ${MAX_BROWSER_MB} MiB: ${list(over)}` };
  if (total > MAX_RSS_MB) return { procs, why: `Playwright's browsers use ${Math.round(total)} MiB together (limit ${MAX_RSS_MB} MiB): ${list(procs)}` };
  return null;
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Kills Playwright browser processes left from earlier runs, but only while no other run holds a slot. */
function sweepStrays(when) {
  for (let i = 0; i < SLOTS; i++) {
    const dir = slotDir(i);
    if (dir === LOCK) continue;
    const o = readOwner(dir);
    if (o && alive(o.pid)) return;
  }
  const strays = browserProcesses();
  if (strays.length === 0) return;
  killPids(strays.map((p) => p.pid));
  console.error(`[pw-guard] killed ${strays.length} stray Playwright browser process(es) ${when}: ${[...new Set(strays.map((p) => p.name))].join(', ')}`);
}

// --- oomph: the machine-wide memory queue shared with other Claude sessions (optional) ------------------------------
const RESERVE = process.env.SPELLPLANE_PW_RESERVE ?? '3G';
const oomphBin = () => {
  if (process.platform !== 'darwin' || process.env.SPELLPLANE_PW_NO_OOMPH) return null;
  const r = spawnSync('sh', ['-c', 'command -v oomph'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** Waits for an oomph grant (returns its id), or null without oomph; exits 75 when it never comes. */
/**
 * Graphics memory of killed WebKit GPU helpers is not freed at once: on 20 Nov 2026 it stayed
 * "unowned" (held by no process) for about an hour, 37 GB after six aborted runs. Starting more
 * browsers meanwhile stacks it up, so wait until oomph sees it given back.
 */
const MAX_UNOWNED_GB = Number(process.env.SPELLPLANE_PW_MAX_UNOWNED_GB ?? 6);
async function waitForReclaim() {
  const bin = oomphBin();
  if (!bin) return;
  const started = Date.now();
  let lastNote = 0;
  for (;;) {
    const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8' });
    let unowned = 0;
    try { unowned = Number(JSON.parse(r.stdout).unowned_gb) || 0; } catch { return; }
    if (unowned <= MAX_UNOWNED_GB) return;
    if (Date.now() - started > MAX_WAIT_MS) {
      release();
      console.error(`[pw-guard] ${unowned} GB of graphics memory still not given back after ${MAX_WAIT_MS / 60_000} min; giving up (exit 4)`);
      process.exit(4);
    }
    if (Date.now() - lastNote > 60_000) {
      console.error(`[pw-guard] waiting: ${unowned} GB of memory is held by no process (graphics memory of killed browsers); starting only when it is under ${MAX_UNOWNED_GB} GB`);
      lastNote = Date.now();
    }
    await sleep(30_000);
  }
}

async function oomphReserve() {
  const bin = oomphBin();
  if (!bin) return null;
  const started = Date.now();
  let ticket = null;
  let lastNote = 0;
  for (;;) {
    const args = ['reserve', RESERVE, '--for', `spellplane playwright (${path.basename(process.cwd())})`, '--wait', '2m', '--ttl', '120m'];
    if (ticket) args.push('--ticket', ticket);
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    ticket = text.match(/\b(r\d+)\b/)?.[1] ?? ticket;
    if (r.status === 0) return ticket;
    if (/refused/i.test(text) || r.status === null || (r.status !== 75 && r.status !== 0)) {
      console.error(`[pw-guard] oomph did not grant ${RESERVE} (${text.trim().split('\n')[0]}); going on without a reservation`);
      return null;
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      release();
      console.error(`[pw-guard] waited ${MAX_WAIT_MS / 60_000} min for oomph to grant ${RESERVE}; giving up`);
      process.exit(75);
    }
    if (Date.now() - lastNote > 60_000) {
      console.error(`[pw-guard] waiting for memory in oomph's queue: ${text.trim().split('\n')[0]}`);
      lastNote = Date.now();
    }
  }
}

function oomphRelease(id) {
  const bin = id ? oomphBin() : null;
  if (bin) spawnSync(bin, ['release', id], { encoding: 'utf8' });
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
  await runGuarded('pnpm', ['exec', 'playwright', ...args], extraEnv);
}

/**
 * Runs `command <args>` under the guard (a slot, the prompt, memory and load watchdogs) and exits with its status: for
 * a script that drives browsers through Playwright's library API itself (scripts/perf/measure.mjs).
 */
export async function runGuarded(command, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, SPELLPLANE_PW_GUARD: '1' };
  if (process.env.CI) {
    const r = spawnSync(command, args, { stdio: 'inherit', env });
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
  sweepStrays('before this run');
  await waitForReclaim();
  const lease = await oomphReserve();
  const child = spawn(command, args, { stdio: 'inherit', env, detached: true });
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
  let tick = 0;
  const watchdog = setInterval(() => {
    if (aborted) return;
    if (++tick % 5 === 0) {
      const bloat = browserBloat();
      if (bloat) {
        console.error(`\n[pw-guard] ${bloat.why}. Aborting this Playwright run and killing those processes before the machine runs out of memory.`);
        killPids(bloat.procs.map((p) => p.pid));
        exitCode = 4;
        stop('browser memory');
        return;
      }
    }
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
        oomphRelease(lease);
        release();
        process.exit(130);
      }, 5500).unref();
    });
  }
  const status = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  clearInterval(watchdog);
  killGroup(child.pid, 'SIGKILL'); // leftovers (browsers, preview server) of this run
  sweepStrays('after this run');
  oomphRelease(lease);
  release();
  process.exit(aborted ? exitCode : status);
}
