# Paused on 24 Nov 2026: how to resume

The project was paused by the owner after M8's gate went green. Nothing is running: no workflow, no test run, no
browser server on the Mac Studio, no keep-awake, no memory reservation.

## Where things stand

- **Branch `m8`** (on origin) holds M7 and M8 together: landing page, Ztyle-based Plain look, deck library and
  builder, distributed matchmaking, drafts, play vs computer, save / leave / rejoin / history.
  - Gate M8 is **green** on `0e98dd4` (`docs/gates/M8.md`, newest section first; details in `docs/gates/M8-gate.md`).
  - Every gate M0-M5, M7, M8 passed locally in Chromium and WebKit; `pnpm check` green; CI green twice.
- **`main` is still at M6** (`ea67bbb`). m8 has **not** been merged, so the owner can review it first.
- **Preview:** https://izzardry.github.io/spellplane/preview/ follows m8 (branch `preview`, updated by
  `../spellplane-wt/_args/push-preview.sh`).

## What to do next

1. **Owner review** of the preview, aspect by aspect (journey, look, decks, matchmaking, drafts, rejoin).
2. **Owner decision Q1:** a player recovered (Bring back) during round one is offered KEEP / MULLIGAN again for the
   recovered hand. Keep that, or hide it after a recovery? Record the answer in `docs/DECISIONS.md`.
3. **Minor findings still open** (`docs/gates/M8-gate.md`, "Round 5" and its follow-up):
   - N13: remaining text glyphs that should be kit icons: the waiting room's `← HOME`, `SETUP ✎`, `INVITE ⇪`; `✓` on
     seat cards, `READY ✓`, `COPIED ✓`; the table primary's `▸` (mock board 7 uses `chevronRight`).
   - N18: the draft room's rules panel shows "Booster draft is for 2 to 4 players; 1 is seated." in warning colour
     without the triangle, repeating the centre's wait message.
   - A hovered hand card covers its neighbours' lower edges, so they cannot be pointed at until it is let go.
4. **Merge m8 into main and deploy GitHub Pages** once the owner is happy (allowed without asking; never force-push).
5. **Follow-ups recorded in DECISIONS:** the theme switch compiles shaders on the main thread (about 1.5 s locally,
   about 5 s under CI's software GL); `renderer.compileAsync` before the swap is the fix, not cheap.
6. **Real Safari** (not just Playwright's WebKit) is still unmeasured: run `sudo safaridriver --enable` once on the
   Mac Studio, then add a Safari smoke run.
7. **CI watch items** (each failed once, then passed repeatedly): `tests/e2e/journey/solo.spec.ts:59` and
   `tests/e2e/lobby/private.spec.ts:61` on Linux WebKit. If either fails again, treat it as a failing test.
8. **Housekeeping:** old worktrees under `../spellplane-wt/` (`m6-p3` to `m6-p7`, `m8-gatefix`, `preview-snap`) and
   merged remote branches (`m8-ci`, `m8-k1`, `m8-net`, `m8-polish2`, `m8-polish3`, `m8-r4-int`, older `m*-fix-*`)
   can be removed once m8 is on main (delete remote branches only if the owner agrees).

## How to start up again

1. **This Mac:** `cd ~/Workspace/spellplane && git checkout m8 && git pull && pnpm install --frozen-lockfile`.
   Check memory with `oomph check`; reserve before heavy work (`oomph reserve … --for "spellplane …"`).
2. **Mac Studio (192.168.178.80) for WebKit:** someone must be logged in at its console (WebKit cannot launch
   without a console session). Then on this Mac, in the background:
   `ssh -tt -o BatchMode=yes -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -L 39333:127.0.0.1:39333 192.168.178.80 'zsh ~/spellplane-pw/serve.sh 39333 4096'`
   - `~/.config/spellplane/pw-remote.json` already points WebKit there; `pnpm e2e` then prints
     `[pw-guard] WebKit runs on the remote browser server …`.
   - Its state: `ssh 192.168.178.80 cat ~/spellplane-pw/status` (ready | paused | nosession | stopped), and
     `~/spellplane-pw/iosurface.log` for the per-minute WindowServer graphics-buffer count (guard pauses at 25,000).
   - Closing that SSH session stops the server and its browsers (needs the `-tt`). If anything is left, stop it on
     the Studio by pid, never by pattern.
   - If serve.sh changes, deploy it with `cat > serve.sh.new && mv serve.sh.new serve.sh` (never overwrite in place:
     zsh reads a running script as it goes). See `scripts/pw-remote/README.md`.
3. **Keep this Mac awake** during long unattended runs: `caffeinate -ims -t <seconds>` in the background.
4. **Sanity run:** `pnpm check`, then `pnpm e2e:gate -- M0` (both browsers).
5. **Agents:** the round scripts used for M8 (two fixers in worktrees, integrator, gate verifier, Opus 5.5) are in
   this repo's Claude session directory; `scripts/workflow/milestone.js` is the general milestone workflow. If Fable
   agents die on a usage limit, re-run them on Opus 5.5 xhigh; a dead review is never an approval.
