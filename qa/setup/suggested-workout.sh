#!/usr/bin/env bash
# Scenario setup for suggested-workout: give the QA account exercises to build
# a workout out of.
#
# A fresh QA database has no exercises at all — the server bundles no catalog,
# and a real account gets one by importing a dataset — so without this the
# generator would have nothing to prescribe. It does not fail in that case; it
# fetches from free-exercise-db over the network, which would make the run
# online and non-deterministic. qa/fixtures/exercise-catalog.mjs explains the
# shape and why it is invented rather than copied.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../bin/qa-env.sh"

node "$QA_DIR/bin/qa-exercise-catalog.mjs"

# --- where this run's server log starts -------------------------------------
# The oracle's strongest evidence that the network fallback never fired is that
# the server never said it did. server.log is truncated by qa-up.sh and then
# outlives every scenario after it, so the offset is recorded here and the
# oracle reads only what this run appended — otherwise one genuine import would
# fail every later run of anything until the stack was restarted.
wc -c <"$QA_RUN_DIR/server.log" | tr -d ' ' >"$QA_RUN_DIR/server-log-offset"
echo "    server.log offset for this run: $(cat "$QA_RUN_DIR/server-log-offset")"
