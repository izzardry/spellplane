# Remote WebKit (a second Mac runs the browsers)

WebKit's GPU helper has grown to 9 GB in e2e runs (20 Nov 2026), so WebKit can run on another Mac (the
"browser Mac"; here a Mac Studio with 128 GB) while the test runner, the test server and Chromium stay on the dev Mac.

- **Browser Mac, once:** SSH key login from the dev Mac; `mkdir ~/spellplane-pw && cd ~/spellplane-pw && npm init -y &&
  npm i playwright@<exact version from the dev Mac's lockfile> && npx playwright install webkit`; copy `serve.sh` there
  by writing a temporary file and renaming it over the old one (`cat > serve.sh.new && mv serve.sh.new serve.sh`):
  zsh reads a running script as it goes, so overwriting it in place makes a running copy execute the new text.
  A user must be logged in at the console. For real Safari (`pnpm perf -- --safari`) also: Safari ▸ Develop ▸ Allow
  Remote Automation, and `sudo safaridriver --enable` once.
- **Dev Mac, per session:** `ssh -tt -L 39333:127.0.0.1:39333 <browser-mac> 'zsh ~/spellplane-pw/serve.sh 39333 4096'` (`-tt` gives the session a terminal, so closing it hangs up the server and its browsers on the browser Mac; without it they keep running there)
  (keeps the browser Mac awake, listens on its 127.0.0.1 only, kills a WebKit process over 4096 MB or all of them
  when oomph there says critical), and `~/.config/spellplane/pw-remote.json`:
  `{"webkitWs": "ws://127.0.0.1:39333/", "sshHost": "<browser-mac>"}`.
- **WindowServer guard:** on 21 Nov 2026 the browser Mac's WindowServer aborted twice while holding about 49,000
  IOSurfaces (graphics buffers), which logs the console user out and leaves WebKit unable to launch. `serve.sh` reads
  the system-wide IOSurface count every 5 s; above `IOS_PAUSE` (25,000) it stops its browsers and the Playwright
  server, and it starts them again below `IOS_RESUME` (12,000). If the count stays high with no browser running,
  WindowServer holds the buffers and only logging out and in at the console resets it. It also pauses while nobody is
  logged in at the console. It asks WebKit processes to quit (SIGTERM) before killing them, since graphics memory of
  SIGKILLed GPU helpers has stayed unreleased. Its state goes to `~/spellplane-pw/status` (`ready …`, `paused …`,
  `nosession …`, `stopped …`) and a line per minute to `~/spellplane-pw/iosurface.log`. Measured on 22 Nov: a gate M8
  run in WebKit peaks at about +400 IOSurfaces and leaves none behind (930 → 1,329 → 990).
- **What happens:** `scripts/pw-guard.mjs` sees the file, waits until the server answers and (with `sshHost`) its status
  file says `ready` (the local end of the SSH tunnel answers even when nothing runs behind it), printing the reason
  while it waits, opens a reverse SSH tunnel
  for the run's e2e port (so the remote page still loads `http://localhost:<port>`, a secure context) and sets
  `SPELLPLANE_PW_WEBKIT_WS`; `playwright.config.ts` then connects the `webkit` project to the server, and
  `scripts/perf/measure.mjs` its WebKit run. A configured but unreachable server makes runs wait, never fall back to a
  local WebKit. `SPELLPLANE_PW_LOCAL_WEBKIT=1` ignores the file. Delete the file to go back to local WebKit.
