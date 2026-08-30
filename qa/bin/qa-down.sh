#!/usr/bin/env bash
# Tear the QA stack down. Pass --wipe to also destroy the database volume.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/qa-env.sh"

if [ -f "$QA_RUN_DIR/server.pid" ]; then
  pid="$(cat "$QA_RUN_DIR/server.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "==> stopping QA server (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$QA_RUN_DIR/server.pid"
fi

if [ -f "$QA_RUN_DIR/ai-stub.pid" ]; then
  pid="$(cat "$QA_RUN_DIR/ai-stub.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "==> stopping QA AI stub (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$QA_RUN_DIR/ai-stub.pid"
fi

# Metro is only stopped if this harness was the one that started it — no pid
# file means the developer's own dev server, which is not ours to kill.
#
# The recorded pid is the package manager and the Expo CLI is its child, so both
# are signalled. Deliberately NOT by process group: a background job in a
# non-interactive script shares the process group of whatever invoked the
# script, so killing that group can take the user's shell down with it.
if [ -f "$QA_RUN_DIR/metro.pid" ]; then
  pid="$(cat "$QA_RUN_DIR/metro.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "==> stopping QA Metro (pid $pid)"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$QA_RUN_DIR/metro.pid"
  if lsof -nP -iTCP:"$QA_METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "    note: something is still listening on :$QA_METRO_PORT"
  fi
fi

cd "$QA_DIR"
if [ "${1:-}" = "--wipe" ]; then
  echo "==> stopping QA postgres and destroying its volume"
  docker compose -f docker-compose.qa.yml down -v
  rm -f "$QA_ACCOUNT_FILE"
else
  echo "==> stopping QA postgres (volume kept; --wipe to destroy)"
  docker compose -f docker-compose.qa.yml down
fi
