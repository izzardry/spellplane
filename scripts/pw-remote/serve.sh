#!/bin/zsh
# Playwright WebKit server for Spellplane's e2e, run on the second Mac (the "browser Mac") over SSH from the dev Mac:
#   ssh -tt -L 39333:127.0.0.1:39333 <browser-mac> 'zsh ~/spellplane-pw/serve.sh 39333 4096'
# (-tt matters: without a terminal, closing the session sends no hangup and the server keeps running there).
# It keeps that Mac awake while it runs, listens on 127.0.0.1 only (reached through the SSH tunnel), and kills any
# Playwright WebKit process whose physical footprint passes LIMIT_MB (WebKit's GPU helper has grown to 9 GB), or all
# of them when oomph says memory is critical. Closing the SSH session stops everything it started.
#
# WindowServer guard: on 21 Nov 2026 the browser Mac's WindowServer aborted twice (13:12, 17:59) while holding about
# 49,000 IOSurfaces (graphics buffers, ~330 GB of address space); a WindowServer abort logs the console user out, and
# WebKit cannot launch without a console session. So the server pauses (stops its browsers and the Playwright server)
# when the system-wide IOSurface count passes IOS_PAUSE, and starts again once it is below IOS_RESUME. If the count
# does not come down, only logging out and in at the console resets WindowServer; the status file says so.
# It also pauses while nobody is logged in at the console. The state is written to ~/spellplane-pw/status
# (first word: ready | paused | nosession), which the dev Mac's scripts/pw-guard.mjs reads over SSH and waits on.
# A once-a-minute line goes to ~/spellplane-pw/iosurface.log.
#
# Setup on the browser Mac: mkdir ~/spellplane-pw && cd ~/spellplane-pw && npm init -y && npm i playwright@<the
# version in the dev Mac's lockfile> && npx playwright install webkit; copy this file there.
PORT=${1:-39333}
LIMIT_MB=${2:-4096}
IOS_PAUSE=${IOS_PAUSE:-25000}
IOS_RESUME=${IOS_RESUME:-12000}
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd "$(dirname "$0")"
STATUS="$PWD/status"
caffeinate -dimsu -w $$ &

SRV=
webkit_pids() { pgrep -f 'ms-playwright/webkit-' ; }
ios_count() { ioclasscount IOSurface 2>/dev/null | sed -E 's/.*= ([0-9]+).*/\1/' ; }
console_ok() { ioreg -n Root -d1 -a 2>/dev/null | grep -A1 kCGSessionLoginDoneKey | grep -q '<true/>' ; }
say() { echo "[browser-mac] $(date +%H:%M:%S) $*" 2>/dev/null ; }
set_status() { print -r -- "$*" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS" ; }
# Ask WebKit processes to quit first; SIGKILL only what is still there 3 s later (a SIGKILLed GPU helper's graphics
# memory has stayed held by no process for up to an hour).
stop_webkit() {
  local pids=($(webkit_pids))
  [ ${#pids} -eq 0 ] && return
  kill -TERM $pids 2>/dev/null
  sleep 3
  for p in $(webkit_pids); do kill -9 $p 2>/dev/null; done
}
start_server() {
  ./node_modules/.bin/playwright run-server --port "$PORT" --host 127.0.0.1 &
  SRV=$!
}
stop_server() {
  [ -n "$SRV" ] && kill $SRV 2>/dev/null
  SRV=
  stop_webkit
}
cleanup() { stop_server; set_status "stopped: serve.sh is not running"; }
# PIPE too: after the SSH session closes, a write to its output kills the script without running cleanup.
trap cleanup EXIT
trap 'cleanup; exit' INT TERM HUP PIPE

start_server
say "Playwright $(./node_modules/.bin/playwright --version) server on 127.0.0.1:$PORT (pid $SRV), limit ${LIMIT_MB} MB per process, pause at ${IOS_PAUSE} IOSurfaces (resume below ${IOS_RESUME})"
STATE=ready
set_status "ready: $(ios_count) IOSurfaces"
tick=0
paused_since=0
over=()
while true; do
  n=$(ios_count)
  # Server died by itself (not paused by us): end, as before, so the SSH session shows it.
  if [ "$STATE" = ready ] && ! kill -0 $SRV 2>/dev/null; then say "the Playwright server exited"; break; fi

  if ! console_ok; then
    if [ "$STATE" != nosession ]; then
      say "nobody is logged in at the console (WebKit cannot launch): pausing"
      stop_server; STATE=nosession
      set_status "nosession: nobody is logged in at the browser Mac's console; log in there (WebKit needs a console session)"
    fi
  elif [ -n "$n" ] && [ "$n" -gt "$IOS_PAUSE" ]; then
    if [ "$STATE" = ready ]; then
      say "$n IOSurfaces (pause at $IOS_PAUSE): stopping the browsers and pausing so WindowServer does not abort"
      stop_server; STATE=paused; paused_since=$SECONDS
    fi
    if [ "$STATE" = paused ]; then
      mins=$(( (SECONDS - paused_since) / 60 ))
      hint=""
      [ $mins -ge 5 ] && hint="; still high after ${mins} min with no browser running, so WindowServer holds them: log out and in at the browser Mac's console to reset it"
      set_status "paused: $n IOSurfaces on the browser Mac (pause at $IOS_PAUSE, resume below $IOS_RESUME)$hint"
    fi
  elif [ "$STATE" != ready ]; then
    if [ "$STATE" = nosession ] || [ -z "$n" ] || [ "$n" -lt "$IOS_RESUME" ]; then
      start_server; STATE=ready
      say "resuming: ${n:-?} IOSurfaces, console session present (server pid $SRV)"
      set_status "ready: ${n:-?} IOSurfaces"
    fi
  fi

  if [ "$STATE" = ready ]; then
    for p in $(webkit_pids); do
      mb=$(footprint --noCategories -p $p 2>/dev/null | awk '/Footprint:/{v=$2; if($3=="GB")v*=1024; if($3=="KB")v/=1024; print int(v); exit}')
      if [ -n "$mb" ] && [ "$mb" -gt "$LIMIT_MB" ]; then
        if (( ${over[(Ie)$p]} )); then
          say "killed $(ps -o comm= -p $p | xargs basename) [$p] at ${mb} MB (limit ${LIMIT_MB}), it did not quit"
          kill -9 $p 2>/dev/null
        else
          say "asked $(ps -o comm= -p $p | xargs basename) [$p] to quit at ${mb} MB (limit ${LIMIT_MB})"
          kill -TERM $p 2>/dev/null; over+=($p)
        fi
      fi
    done
    oomph check >/dev/null 2>&1
    if [ $? -ge 2 ]; then
      say "oomph says memory is critical: stopping all Playwright WebKit processes"
      stop_webkit
    fi
  fi

  if (( tick % 12 == 0 )); then
    echo "$(date +%F\ %T) iosurfaces=${n:-?} webkit_procs=$(webkit_pids | wc -l | tr -d ' ') state=$STATE" >> iosurface.log
    [ "$STATE" = ready ] && set_status "ready: ${n:-?} IOSurfaces"
  fi
  tick=$((tick + 1))
  sleep 5
done
