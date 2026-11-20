#!/bin/zsh
# Playwright WebKit server for Spellplane's e2e, run on the second Mac (the "browser Mac") over SSH from the dev Mac:
#   ssh -L 39333:127.0.0.1:39333 <browser-mac> 'zsh ~/spellplane-pw/serve.sh 39333 4096'
# It keeps that Mac awake while it runs, listens on 127.0.0.1 only (reached through the SSH tunnel), and kills any
# Playwright WebKit process whose physical footprint passes LIMIT_MB (WebKit's GPU helper has grown to 9 GB), or all
# of them when oomph says memory is critical. Closing the SSH session stops everything it started.
# Setup on the browser Mac: mkdir ~/spellplane-pw && cd ~/spellplane-pw && npm init -y && npm i playwright@<the
# version in the dev Mac's lockfile> && npx playwright install webkit; copy this file there.
PORT=${1:-39333}
LIMIT_MB=${2:-4096}
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd "$(dirname "$0")"
caffeinate -dimsu -w $$ &
./node_modules/.bin/playwright run-server --port "$PORT" --host 127.0.0.1 &
SRV=$!
webkit_pids() { pgrep -f 'ms-playwright/webkit-' ; }
cleanup() { kill $SRV 2>/dev/null; for p in $(webkit_pids); do kill -9 $p 2>/dev/null; done; }
trap cleanup EXIT INT TERM HUP
echo "[browser-mac] Playwright $(./node_modules/.bin/playwright --version) server on 127.0.0.1:$PORT (pid $SRV), limit ${LIMIT_MB} MB per process"
while kill -0 $SRV 2>/dev/null; do
  for p in $(webkit_pids); do
    mb=$(footprint --noCategories -p $p 2>/dev/null | awk '/Footprint:/{v=$2; if($3=="GB")v*=1024; if($3=="KB")v/=1024; print int(v); exit}')
    if [ -n "$mb" ] && [ "$mb" -gt "$LIMIT_MB" ]; then
      echo "[browser-mac] $(date +%H:%M:%S) killed $(ps -o comm= -p $p | xargs basename) [$p] at ${mb} MB (limit ${LIMIT_MB})"
      kill -9 $p 2>/dev/null
    fi
  done
  oomph check >/dev/null 2>&1
  if [ $? -ge 2 ]; then
    echo "[browser-mac] $(date +%H:%M:%S) oomph says memory is critical: killing all Playwright WebKit processes"
    for p in $(webkit_pids); do kill -9 $p 2>/dev/null; done
  fi
  sleep 5
done
