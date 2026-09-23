#!/usr/bin/env bash
# Scenario setup for sequential-plan: an exercise catalog to build sessions out
# of, and the three-session sequential plan itself.
#
# Neither can be produced by the mobile app. A fresh QA database has no
# exercises (see qa/fixtures/exercise-catalog.mjs for why that matters and why
# the catalog is invented), and a workout PLAN is authored on the web frontend —
# mobile can start a plan's session and render its banner, but it cannot create
# the plan. qa/bin/qa-sequential-plan.mjs builds both through the real API, in
# the only order the server accepts.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../bin/qa-env.sh"

node "$QA_DIR/bin/qa-exercise-catalog.mjs"
node "$QA_DIR/bin/qa-sequential-plan.mjs"
