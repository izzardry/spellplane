# Remote WebKit (a second Mac runs the browsers)

WebKit's GPU helper has grown to 9 GB in e2e runs (20 Nov 2026), so WebKit can run on another Mac (the
"browser Mac"; here a Mac Studio with 128 GB) while the test runner, the test server and Chromium stay on the dev Mac.

- **Browser Mac, once:** SSH key login from the dev Mac; `mkdir ~/spellplane-pw && cd ~/spellplane-pw && npm init -y &&
  npm i playwright@<exact version from the dev Mac's lockfile> && npx playwright install webkit`; copy `serve.sh` there.
  A user must be logged in at the console. For real Safari (`pnpm perf -- --safari`) also: Safari ▸ Develop ▸ Allow
  Remote Automation, and `sudo safaridriver --enable` once.
- **Dev Mac, per session:** `ssh -L 39333:127.0.0.1:39333 <browser-mac> 'zsh ~/spellplane-pw/serve.sh 39333 4096'`
  (keeps the browser Mac awake, listens on its 127.0.0.1 only, kills a WebKit process over 4096 MB or all of them
  when oomph there says critical), and `~/.config/spellplane/pw-remote.json`:
  `{"webkitWs": "ws://127.0.0.1:39333/", "sshHost": "<browser-mac>"}`.
- **What happens:** `scripts/pw-guard.mjs` sees the file, waits until the server answers, opens a reverse SSH tunnel
  for the run's e2e port (so the remote page still loads `http://localhost:<port>`, a secure context) and sets
  `SPELLPLANE_PW_WEBKIT_WS`; `playwright.config.ts` then connects the `webkit` project to the server, and
  `scripts/perf/measure.mjs` its WebKit run. A configured but unreachable server makes runs wait, never fall back to a
  local WebKit. `SPELLPLANE_PW_LOCAL_WEBKIT=1` ignores the file. Delete the file to go back to local WebKit.
