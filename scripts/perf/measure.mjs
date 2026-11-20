#!/usr/bin/env node
// pnpm perf [-- options]   frame-rate measurement of a four-player table (PLAN M7 A0). A tool, not a test.
//
// Builds the test build (dist-test/, with the debug hook) and serves it on a local port. The page it serves gets the
// recorded card data of tests/fixtures/ (no network) and a scenario script, which drives the app by itself and posts
// its numbers back to this server, so every browser runs exactly the same scenario, with or without automation:
//   a four-player table, 21 cards on each battlefield (some tapped), seven in the own hand, placeholder faces; per
//   theme: idle for 3 s, a card drag for 3 s (pointer events every animation frame), a camera pan for 3 s (two-finger
//   scroll every animation frame).
// Each phase reports fps, frame time p50 / p95 and the longest gap from the frame meter (src/util/frame-meter.ts), plus
// the canvas's render size, pixel ratio, quality level, post passes and the WebGL renderer string. The page shows the
// meter (?fps) all the while.
//
// Browsers:
//   --browsers webkit,chromium   Playwright's WebKit and Chromium (default both), run under scripts/pw-guard.mjs: at
//                                most two Playwright runs per machine, one per worktree; exit 3 = macOS prompt, 4 =
//                                memory, 5 = load. Headless WebKit is not Safari (no display, its own compositor):
//                                treat its numbers as relative, before against after.
//   --safari                     real Safari through safaridriver's W3C WebDriver API (plain fetch, no dependency).
//                                Needs Safari > Settings > Advanced > "Show features for web developers", then
//                                Develop > "Allow Remote Automation", and once `safaridriver --enable` (asks for an
//                                admin password). Without it the script says so and skips Safari.
//   --safari-open                real Safari without automation: opens the scenario URL in the running Safari
//                                (`open -a Safari`) and waits for the page to post its numbers. Safari must stay in
//                                front while it runs (a hidden or covered window is throttled); close the tab after.
//   With --safari or --safari-open and no --browsers, only Safari runs (no Playwright, no guard).
// Options:
//   --themes paper,dusk,wyrm,stonetable   (default all four)
//   --quality high|medium|low             set the quality level first (default: what the build chooses)
//   --size 2560x1440  viewport in CSS px (default: a full window on a 27" 5K display); Safari's window is set to it
//                     with --safari, and is whatever it is with --safari-open
//   --dpr 2           device pixel ratio for Playwright (default 2, a Retina Mac); Safari uses the display's own
//   --phase-ms 3000   length of each phase
//   --query 'k=v&…'   extra URL parameters (experiments), e.g. render=noadapt (src/scene/switches.ts)
//   --variants 'q1|q2' several queries, each measured in turn in every browser (e.g. 'render=noadapt|render=');
//                     rows are labelled with their query
//   --no-sync         Playwright browsers without render=sync. By default they wait for the GPU after each frame
//                     (render=sync), since a headless browser does not hold animation frames back for the GPU: its
//                     frame times say little, the draw times (GPU included) say what a frame costs. Safari never syncs.
//   --faces scryfall  real card images instead of placeholders (uses the network: Scryfall)
//   --headed          Playwright browsers with a window
//   --swiftshader     Chromium renders with SwiftShader (software GL, as on CI): a stand-in for a slow GPU, to see
//                     the adaptive resolution at work (use --no-sync: frames are slow enough to hold the loop back)
//   --no-build        reuse dist-test/ as it is
//   --dist <dir>      measure another test build (e.g. a copy of dist-test/ made before a change); implies --no-build
//   --json <file>     also write the results as JSON
//   --shots <dir>     Playwright: a screenshot of each theme after its idle phase (meter included), CSS-px scale
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT);

// --- Options -----------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const safari = has('safari');
const safariOpen = has('safari-open');
const browsers = (opt('browsers', safari || safariOpen ? '' : 'webkit,chromium') || '').split(',').filter(Boolean);
const THEMES = opt('themes', 'paper,dusk,wyrm,stonetable').split(',').filter(Boolean);
const quality = opt('quality', null);
const [W, H] = opt('size', '2560x1440').split('x').map(Number);
const DPR = Number(opt('dpr', '2'));
const PHASE_MS = Number(opt('phase-ms', '3000'));
const VARIANTS = (opt('variants', null) ?? opt('query', '')).split('|');
const SYNC = !has('no-sync');
const FACES = opt('faces', 'placeholder');
const jsonOut = opt('json', null);
for (const b of browsers) if (!['webkit', 'chromium'].includes(b)) usage(`unknown browser ${b}`);
for (const t of THEMES) if (!['paper', 'dusk', 'wyrm', 'stonetable'].includes(t)) usage(`unknown theme ${t}`);
if (!browsers.length && !safari && !safariOpen) usage('no browser chosen');
if (quality && !['high', 'medium', 'low'].includes(quality)) usage(`unknown quality ${quality}`);
if (!(W > 0 && H > 0 && DPR > 0 && PHASE_MS > 0)) usage('bad --size, --dpr or --phase-ms');

function usage(msg) {
  console.error(
    `perf: ${msg}\nusage: pnpm perf -- [--browsers webkit,chromium] [--safari | --safari-open] [--themes …] [--quality high|medium|low] [--size 2560x1440] [--dpr 2] [--phase-ms 3000] [--query k=v] [--faces scryfall] [--headed] [--swiftshader] [--no-sync] [--variants 'q1|q2'] [--no-build | --dist dir] [--json file]`,
  );
  process.exit(2);
}

// Playwright browsers only under the machine-wide guard: re-run this script through it.
if (browsers.length && !process.env.SPELLPLANE_PW_GUARD) {
  const { runGuarded } = await import('../pw-guard.mjs');
  await runGuarded(process.execPath, [fileURLToPath(import.meta.url), ...argv]);
}

// --- Build -------------------------------------------------------------------------------------------------------------
const DIST = path.resolve(opt('dist', 'dist-test'));
if (!opt('dist', null) && (!has('no-build') || !fs.existsSync('dist-test/index.html'))) {
  console.log('[perf] building the test build (dist-test/)…');
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--mode', 'test', '--logLevel', 'error'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) usage(`${DIST} holds no build`);

// --- The scenario, run by the page itself --------------------------------------------------------------------------------

/**
 * Runs in the page (serialised into a script tag). Waits for the app's debug hook, builds the table, then measures each
 * theme's three phases and posts every row to `${report}`; posts `{done: true}` at the end, `{error}` on failure.
 */
function perfScenario(cfg) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const post = (body) => fetch(cfg.report, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  const sp = () => window.__spellplane;
  const canvas = () => document.querySelector('canvas[data-scene="table"]');

  async function setup() {
    for (let i = 0; i < 600 && !(sp()?.session?.hash && sp().tableView && sp().theme && sp().fps && canvas()); i++) await wait(50);
    if (!sp()?.fps) throw new Error('no frame meter on the debug hook (is this a test build with the meter?)');
    const h = sp();
    let cid = 0;
    const d = (a, by = 's0') => {
      try {
        h.dispatch({ by, cid: `perf-${Date.now().toString(36)}-${++cid}`, ...a });
      } catch (e) {
        console.warn('perf setup', a.type, e);
      }
    };
    // The solo table starts in the match stage: back to the lobby through a "New draft?" round (it passes at once with
    // one seated player), four chairs, three more players, and the match again.
    if (h.state().stage !== 'lobby') {
      d({ type: 'ask', round: 'perf-r', label: 'New draft?' });
      d({ type: 'stageSet', stage: 'lobby', round: 'perf-r' });
    }
    d({ type: 'formatSet', format: 'ffa4', life: 20 });
    ['Ben', 'Cleo', 'Dan'].forEach((name, i) => d({ type: 'seatTake', seat: `s${i + 1}`, name, colour: i + 1 }, `s${i + 1}`));
    d({ type: 'stageSet', stage: 'match' });
    await wait(300);
    await h.session.importDecklist(cfg.deck).catch((e) => console.warn('perf deck', e));
    await h.session.draw(7).catch((e) => console.warn('perf draw', e));
    const sids = [...new Set(Object.values(h.state().cards).map((c) => c.identity?.sid).filter(Boolean))];
    await wait(300);
    const tv = h.tableView();
    let n = 0;
    for (const seat of tv.seats) {
      const a = (seat.angle * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 7; col++) {
          const lx = -420 + col * 92;
          const ly = 150 - row * 105;
          const id = `perf-${seat.seat}-${row}-${col}`;
          const sid = sids.length ? sids[n++ % sids.length] : undefined;
          d({ type: 'createToken', card: id, zone: `battlefield:${seat.seat}`, pose: { x: seat.territory.x + lx * c + ly * s, y: seat.territory.y - lx * s + ly * c, rot: seat.angle }, ...(sid ? { ref: { sid } } : { label: id }), controller: seat.seat });
          if ((row + col) % 5 === 0) d({ type: 'tap', card: id, tapped: true }, seat.seat);
        }
      }
    }
    await wait(500);
    const gl = canvas()?.getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'no webgl2', seats: Object.keys(h.state().seats).length, cards: h.cards().length, viewport: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, ua: navigator.userAgent };
  }

  /** A hidden tab gets no animation frames: say so and wait until it is shown again. */
  async function visible() {
    if (document.visibilityState !== 'hidden') return;
    await post({ warn: 'the tab is hidden (another tab or window in front): waiting until it is shown' });
    await new Promise((r) => document.addEventListener('visibilitychange', () => document.visibilityState !== 'hidden' && r(), { once: false }));
    await wait(1000);
  }

  async function measure(ms, each) {
    await visible();
    sp().fps.begin();
    const t0 = performance.now();
    for (;;) {
      const now = await frame();
      if (now - t0 >= ms) break;
      each?.((now - t0) / 1000);
    }
    return sp().fps.end();
  }

  /** Pointer events as a mouse sends them; the scene's pointer capture is skipped for these synthetic ones. */
  function pointer(type, x, y, buttons) {
    canvas().dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons, bubbles: true, cancelable: true, composed: true }));
  }

  async function drag(ms) {
    const own = sp()
      .cards()
      .filter((c) => c.visible && c.id.startsWith('perf-s0-0-'));
    const card = own[3] ?? own[0];
    if (!card) return null;
    const x0 = card.screen.x + card.screen.width / 2;
    const y0 = card.screen.y + card.screen.height / 2;
    const el = canvas();
    const capture = el.setPointerCapture;
    const release = el.releasePointerCapture;
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    try {
      pointer('pointermove', x0, y0, 0);
      await frame();
      pointer('pointerdown', x0, y0, 1);
      await frame();
      const m = await measure(ms, (t) => {
        const a = t * Math.PI;
        pointer('pointermove', x0 + 110 * Math.sin(a), y0 - 66 * (1 - Math.cos(a)), 1);
      });
      pointer('pointermove', x0, y0, 1);
      await frame();
      pointer('pointerup', x0, y0, 0);
      return m;
    } finally {
      el.setPointerCapture = capture;
      el.releasePointerCapture = release;
    }
  }

  function pan(ms) {
    const el = canvas();
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 3;
    return measure(ms, (t) => {
      const a = t * Math.PI;
      el.dispatchEvent(new WheelEvent('wheel', { deltaX: 9 * Math.cos(a) + 0.5, deltaY: 9 * Math.sin(a) + 0.25, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    });
  }

  (async () => {
    try {
      const info = await setup();
      await post({ info });
      for (const theme of cfg.themes) {
        await sp().theme.set(theme);
        if (cfg.quality) sp().render.setQuality(cfg.quality);
        // Let the theme settle: faces uploaded, the camera at rest.
        await wait(2500);
        await post({ row: { theme, phase: 'idle', m: await measure(cfg.phaseMs) } });
        const m = await drag(cfg.phaseMs);
        if (m) await post({ row: { theme, phase: 'drag', m } });
        else await post({ warn: `${theme}: no card to drag` });
        await wait(800);
        await post({ row: { theme, phase: 'pan', m: await pan(cfg.phaseMs) } });
      }
      await post({ done: true });
    } catch (e) {
      await post({ error: String(e?.stack ?? e) });
    }
  })();
}

// --- Serve -------------------------------------------------------------------------------------------------------------
const fixtures = ['m19.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')));
const decklist = fs.readFileSync(path.join('tests', 'fixtures', 'decklists', 'gw-m19-60.txt'), 'utf8');
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
// The recorded card data goes into the page before the app's module runs (debug/fixture-cards.ts reads it).
const fixtureTag = `<script>window.__spellplaneFixtures = ${safeJson({ cards: fixtures })};</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json', '.ico': 'image/x-icon' };

/** Runs by id: what the page posted. */
const runs = new Map();

function newRun(browser, query) {
  const id = `${browser}-${Math.random().toString(36).slice(2, 8)}`;
  let finish;
  const run = { id, browser, query, info: null, rows: [], done: new Promise((r) => (finish = r)), finish: (v) => finish(v) };
  runs.set(id, run);
  return run;
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__perf/report' && req.method === 'POST') {
      let body = '';
      req.on('data', (b) => (body += b));
      req.on('end', () => {
        res.writeHead(204).end();
        const run = runs.get(url.searchParams.get('run') ?? '');
        if (!run) return;
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          return;
        }
        if (msg.info) {
          run.info = msg.info;
          console.log(`[perf] ${run.browser}${run.query ? ` [${run.query}]` : ''}: ${msg.info.seats} seats, ${msg.info.cards} cards, ${msg.info.viewport} CSS px at dpr ${msg.info.dpr}, renderer ${msg.info.renderer}`);
        }
        if (msg.row) {
          report(run, msg.row);
          run.onRow?.(msg.row);
        }
        if (msg.warn) console.warn(`[perf] ${run.browser}: ${msg.warn}`);
        if (msg.error) run.finish(new Error(msg.error));
        if (msg.done) run.finish(null);
      });
      return;
    }
    let rel = decodeURIComponent(url.pathname.replace(/^\/spellplane\/?/, ''));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    let body = fs.readFileSync(file);
    if (rel === 'index.html') {
      const run = runs.get(url.searchParams.get('perfrun') ?? '');
      const cfg = run && { report: `/__perf/report?run=${run.id}`, themes: THEMES, quality, phaseMs: PHASE_MS, deck: decklist };
      const scenario = cfg ? `<script>(${perfScenario})(${safeJson(cfg)});</script>` : '';
      body = Buffer.from(body.toString('utf8').replace('<head>', `<head>${fixtureTag}${scenario}`));
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --- Results -----------------------------------------------------------------------------------------------------------
const results = [];

function report(run, { theme, phase, m }) {
  const r = { browser: run.browser, query: run.query, theme, phase, fps: +m.fps.toFixed(1), p50: +m.p50.toFixed(1), p95: +m.p95.toFixed(1), max: +m.max.toFixed(1), drawP50: +m.drawP50.toFixed(1), drawP95: +m.drawP95.toFixed(1), frames: m.frames, callbacks: +m.callbacks.toFixed(1), idle: m.idle, render: m.render, renderer: run.info?.renderer ?? null };
  results.push(r);
  const x = m.render;
  const rs = x ? `${x.width}x${x.height}@${+x.pixelRatio.toFixed(3)}${x.renderScale !== 1 ? ` (scale ${+x.renderScale.toFixed(2)})` : ''} ${x.quality}${x.post.length ? ' post' : ''}${x.shadows ? ' shadows' : ''}` : '';
  console.log(`[perf] ${run.browser.padEnd(8)} ${VARIANTS.length > 1 ? `${(run.query || '-').padEnd(28)} ` : ''}${theme.padEnd(10)} ${phase.padEnd(4)} ${String(r.fps).padStart(5)} fps  p50 ${String(r.p50).padStart(5)}  p95 ${String(r.p95).padStart(5)}  max ${String(r.max).padStart(6)} ms  ${m.render?.sync ? 'gpu ' : 'draw'} ${String(r.drawP50).padStart(5)} / ${String(r.drawP95).padStart(5)} ms  ${m.idle ? 'idle ' : ''}${rs}`);
}

/** The page's URL; `sync` adds render=sync to the renderer switches. */
function scenarioUrl(base, run, sync = false) {
  const q = new URLSearchParams(run.query);
  if (sync) q.set('render', [...(q.get('render') ?? '').split(',').filter(Boolean), 'sync'].join(','));
  const extra = q.toString();
  return `${base}?faces=${FACES}&fps&profile=perf${run.id.replace(/[^a-z0-9]/gi, '')}&perfrun=${run.id}${extra ? `&${extra}` : ''}#/`;
}
const timeoutMs = () => 60_000 + THEMES.length * (3 * PHASE_MS + 6000) * 3;

async function awaitRun(run) {
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error(`no result after ${Math.round(timeoutMs() / 1000)} s`)), timeoutMs()).unref());
  const err = await Promise.race([run.done, timer]);
  if (err) throw err;
}

// --- Playwright --------------------------------------------------------------------------------------------------------
async function runPlaywright(name, base) {
  const pw = await import('@playwright/test');
  const args = name === 'chromium' ? ['--use-gl=angle', has('swiftshader') ? '--use-angle=swiftshader' : '--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [];
  // WebKit on the remote browser server (scripts/pw-remote/, set up by pw-guard) when one is configured.
  const remoteWs = name === 'webkit' ? process.env.SPELLPLANE_PW_WEBKIT_WS : undefined;
  const browser = remoteWs
    ? await pw.webkit.connect(remoteWs, { exposeNetwork: '<loopback>' })
    : await pw[name].launch({ headless: !has('headed'), args });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn(`[perf] ${name} page error: ${e.message}`));
    await page.mouse.move(W - 40, 60);
    const shots = opt('shots', null);
    for (const query of VARIANTS) {
      const run = newRun(name, query);
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        const tag = (query || 'default').replace(/[^a-z0-9=,.-]+/gi, '_');
        run.onRow = (row) => {
          if (row.phase === 'idle') void page.screenshot({ path: path.join(shots, `${name}-${row.theme}-${tag}.png`), scale: 'css' }).catch(() => {});
        };
      }
      await page.goto(scenarioUrl(base, run, SYNC));
      await awaitRun(run);
    }
  } finally {
    await browser.close();
  }
}

// --- Safari ------------------------------------------------------------------------------------------------------------
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** Real Safari through safaridriver (W3C WebDriver over HTTP). */
async function runSafariDriver(base) {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/safaridriver')) {
    console.log('[perf] Safari: safaridriver not found (macOS only); skipping Safari.');
    return;
  }
  const port = await freePort();
  const driver = spawn('/usr/bin/safaridriver', ['-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let driverOut = '';
  driver.stdout.on('data', (b) => (driverOut += b));
  driver.stderr.on('data', (b) => (driverOut += b));
  const wd = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${p}: ${json.value?.error ?? res.status} ${json.value?.message ?? ''}`.trim());
    return json.value;
  };
  let session = null;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await wd('GET', '/status');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try {
      session = (await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
    } catch (e) {
      console.log(
        `[perf] Safari: could not start an automation session (${e.message}${driverOut ? `; safaridriver: ${driverOut.trim()}` : ''}).\n` +
          '       To allow it once: Safari > Settings > Advanced > "Show features for web developers"; then Develop > "Allow Remote Automation";\n' +
          '       then run `safaridriver --enable` in a terminal (asks for an admin password). Skipping Safari.\n' +
          '       Without automation: pnpm perf -- --safari-open (opens the scenario in your Safari).',
      );
      return;
    }
    await wd('POST', `/session/${session}/window/rect`, { x: 0, y: 0, width: W, height: H + 80 }).catch(() => {});
    for (const query of VARIANTS) {
      const run = newRun('safari', query);
      await wd('POST', `/session/${session}/url`, { url: scenarioUrl(base, run) });
      await awaitRun(run);
    }
  } finally {
    if (session) await wd('DELETE', `/session/${session}`).catch(() => {});
    driver.kill();
  }
}

/** Real Safari without automation: the scenario URL in the running Safari; the page posts its numbers. */
async function runSafariOpen(base) {
  if (process.platform !== 'darwin') {
    console.log('[perf] Safari: macOS only; skipping Safari.');
    return;
  }
  const run = newRun('safari', VARIANTS[0]);
  const url = scenarioUrl(base, run);
  console.log(`[perf] Safari: opening ${url}\n       keep Safari in front until it finishes (about ${Math.round((THEMES.length * (3 * PHASE_MS + 4000) + 5000) / 1000)} s).`);
  const r = spawnSync('open', ['-a', 'Safari', url]);
  if (r.status !== 0) {
    console.log('[perf] Safari: could not open Safari; skipping.');
    return;
  }
  await awaitRun(run);
}

// --- Main --------------------------------------------------------------------------------------------------------------
const server = await serve();
const base = `http://localhost:${server.address().port}/spellplane/`;
let status = 0;
try {
  for (const b of browsers) {
    try {
      await runPlaywright(b, base);
    } catch (e) {
      console.error(`[perf] ${b} failed: ${e.message ?? e}`);
      status = 1;
    }
  }
  for (const [on, fn] of [
    [safari, runSafariDriver],
    [safariOpen, runSafariOpen],
  ]) {
    if (!on) continue;
    try {
      await fn(base);
    } catch (e) {
      console.error(`[perf] safari failed: ${e.message ?? e}`);
      status = 1;
    }
  }
} finally {
  server.close();
}
if (browsers.includes('webkit')) console.log('[perf] note: headless WebKit is not Safari (no display, its own compositor): compare its numbers relatively, before against after.');
if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), size: `${W}x${H}`, dpr: DPR, quality, variants: VARIANTS, sync: SYNC, faces: FACES, results }, null, 2));
  console.log(`[perf] results written to ${jsonOut}`);
}
process.exit(status);
