#!/usr/bin/env bash
# Bring up the isolated QA stack: Postgres, then the server pointed at it.
#
# The server bootstraps its own schema — it creates the application role, runs
# every migration and reapplies RLS at boot — so an empty volume is a valid
# starting state and no schema dump is needed here.
#
#   qa-up.sh [--fresh-db]
#
# --fresh-db drops and recreates the database before the server starts, which
# is how qa-run.sh resets between scenarios. It is deliberately the whole
# database rather than the QA account: deleting the account leaves behind every
# row whose foreign key to `user` does not cascade — `foods` is one — so a
# "reset" run could still find a previous run's records and pass on them.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/qa-env.sh"

FRESH_DB=0
[ "${1:-}" = "--fresh-db" ] && FRESH_DB=1

cd "$QA_DIR"

qa_require_db_image

echo "==> starting QA Postgres on :$QA_DB_PORT"
QA_DB_CONTAINER="$QA_DB_CONTAINER" QA_DB_NAME="$QA_DB_NAME" \
QA_DB_USER="$QA_DB_USER" QA_DB_PASSWORD="$QA_DB_PASSWORD" QA_DB_PORT="$QA_DB_PORT" \
  docker compose -f docker-compose.qa.yml up -d

printf '    waiting for postgres'
for _ in $(seq 1 60); do
  if docker inspect -f '{{.State.Health.Status}}' "$QA_DB_CONTAINER" 2>/dev/null | grep -q healthy; then
    echo " ok"
    break
  fi
  printf '.'
  sleep 1
done
docker inspect -f '{{.State.Health.Status}}' "$QA_DB_CONTAINER" 2>/dev/null | grep -q healthy || {
  echo
  echo "!! QA postgres never became healthy" >&2
  exit 1
}

# A server left over from a previous run holds the port and, worse, may be
# pointed somewhere else entirely — never reuse one.
if [ -f "$QA_RUN_DIR/server.pid" ] && kill -0 "$(cat "$QA_RUN_DIR/server.pid")" 2>/dev/null; then
  echo "==> stopping previous QA server (pid $(cat "$QA_RUN_DIR/server.pid"))"
  kill "$(cat "$QA_RUN_DIR/server.pid")" 2>/dev/null || true
  sleep 2
fi

if [ "$FRESH_DB" -eq 1 ]; then
  echo "==> recreating $QA_DB_NAME from empty"
  qa_sql_maint -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$QA_DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
  qa_sql_maint -q -c "DROP DATABASE IF EXISTS \"$QA_DB_NAME\"" >/dev/null
  qa_sql_maint -q -c "CREATE DATABASE \"$QA_DB_NAME\" OWNER \"$QA_DB_USER\"" >/dev/null
fi

# --- metro ------------------------------------------------------------------
# The Debug build has no embedded JS bundle, so without a dev server the app
# launches to a red screen and every flow fails with selectors that look wrong.
# An existing healthy Metro is reused rather than restarted: it holds the
# transform cache, and rebuilding it costs more than the whole rest of a run.
if curl -fsS "http://localhost:$QA_METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running'; then
  echo "==> Metro already serving on :$QA_METRO_PORT"
else
  echo "==> starting Metro on :$QA_METRO_PORT (log: qa/run/metro.log)"
  : >"$QA_RUN_DIR/metro.log"
  # `exec` so the recorded pid is the package manager's own and not a wrapper
  # shell's. It still spawns the Expo CLI as a child, so killing this pid can
  # leave that child holding the port — which the reuse check above absorbs.
  ( cd "$REPO_ROOT/SparkyFitnessMobile" && exec pnpm start --port "$QA_METRO_PORT" ) \
    >>"$QA_RUN_DIR/metro.log" 2>&1 &
  echo $! >"$QA_RUN_DIR/metro.pid"

  printf '    waiting for metro'
  for _ in $(seq 1 120); do
    if curl -fsS "http://localhost:$QA_METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running'; then
      echo " ok"
      break
    fi
    printf '.'
    sleep 1
  done
  curl -fsS "http://localhost:$QA_METRO_PORT/status" 2>/dev/null | grep -q 'packager-status:running' || {
    echo
    echo "!! Metro never answered on :$QA_METRO_PORT; last 40 lines:" >&2
    tail -40 "$QA_RUN_DIR/metro.log" >&2
    exit 1
  }
fi

# --- fake vision provider ---------------------------------------------------
# Always up, even for the scenarios that never call it: it is one idle node
# process, and a stub that is only started for the scenario that needs it is a
# stub that is down the first time someone runs that scenario by hand. Nothing
# reaches it unless a run has explicitly pointed an AI service row at it, which
# only qa/setup/food-photo.sh does.
if [ -f "$QA_RUN_DIR/ai-stub.pid" ] && kill -0 "$(cat "$QA_RUN_DIR/ai-stub.pid")" 2>/dev/null; then
  echo "==> stopping previous QA AI stub (pid $(cat "$QA_RUN_DIR/ai-stub.pid"))"
  kill "$(cat "$QA_RUN_DIR/ai-stub.pid")" 2>/dev/null || true
  sleep 1
fi
echo "==> starting QA AI stub on :$QA_AI_STUB_PORT (log: qa/run/ai-stub.log)"
: >"$QA_RUN_DIR/ai-stub.log"
node "$QA_DIR/bin/qa-ai-stub.mjs" >>"$QA_RUN_DIR/ai-stub.log" 2>&1 &
echo $! >"$QA_RUN_DIR/ai-stub.pid"

printf '    waiting for the AI stub'
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$QA_AI_STUB_PORT/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  printf '.'
  sleep 1
done
curl -fsS "http://127.0.0.1:$QA_AI_STUB_PORT/health" >/dev/null 2>&1 || {
  echo
  echo "!! QA AI stub never answered on :$QA_AI_STUB_PORT; last 20 lines:" >&2
  tail -20 "$QA_RUN_DIR/ai-stub.log" >&2
  exit 1
}

echo "==> starting QA server on :$QA_SERVER_PORT (log: qa/run/server.log)"
cd "$REPO_ROOT/SparkyFitnessServer"
: >"$QA_RUN_DIR/server.log"
pnpm exec tsx index.ts >>"$QA_RUN_DIR/server.log" 2>&1 &
echo $! >"$QA_RUN_DIR/server.pid"

printf '    waiting for /api/health'
for _ in $(seq 1 90); do
  if curl -fsS "$QA_SERVER_URL/api/health" >/dev/null 2>&1; then
    echo " ok"
    echo "==> QA stack up: $QA_SERVER_URL (db :$QA_DB_PORT)"
    exit 0
  fi
  if ! kill -0 "$(cat "$QA_RUN_DIR/server.pid")" 2>/dev/null; then
    echo
    echo "!! QA server exited during startup; last 40 lines:" >&2
    tail -40 "$QA_RUN_DIR/server.log" >&2
    exit 1
  fi
  printf '.'
  sleep 1
done

echo
echo "!! QA server never answered /api/health; last 40 lines:" >&2
tail -40 "$QA_RUN_DIR/server.log" >&2
exit 1
