#!/usr/bin/env bash
# Scenario setup for suggested-workout: give the QA account exercises to build
# a workout out of, and a gym to build it for.
#
# A fresh QA database has neither exercises nor gym profiles. The server bundles
# no catalog and a real account gets one by importing a dataset, so without this
# the generator would have nothing to prescribe — and it does not fail in that
# case, it fetches from free-exercise-db over the network, which would make the
# run online and non-deterministic. qa/fixtures/exercise-catalog.mjs explains
# the catalog's shape and why it is invented rather than copied;
# qa/fixtures/gym-profile.mjs covers the gym.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../bin/qa-env.sh"

node "$QA_DIR/bin/qa-exercise-catalog.mjs"

# One gym equipment profile, inactive. Without it the gym chip on Up Next has
# nothing to offer but "Any equipment", so the third of the three regenerate
# paths cannot be reached by any flow at all. It is seeded inactive on purpose —
# an active profile would be picked up by the first generate and the switch
# would assert nothing. qa/bin/qa-gym-profile.mjs has the rest.
node "$QA_DIR/bin/qa-gym-profile.mjs"

# --- where this run's server log starts -------------------------------------
# The oracle's strongest evidence that the network fallback never fired is that
# the server never said it did. server.log is truncated by qa-up.sh and then
# outlives every scenario after it, so the offset is recorded here and the
# oracle reads only what this run appended — otherwise one genuine import would
# fail every later run of anything until the stack was restarted.
wc -c <"$QA_RUN_DIR/server.log" | tr -d ' ' >"$QA_RUN_DIR/server-log-offset"
echo "    server.log offset for this run: $(cat "$QA_RUN_DIR/server-log-offset")"
