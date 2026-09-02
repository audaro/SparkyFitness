#!/usr/bin/env bash
# Scenario setup for workout-proposal: a catalog for the fake model to search,
# and an AI provider pointed at the stub so Sparky chat has a model at all.
#
# Chat on mobile is gated on an active provider ("No active AI provider.
# Configure one in the web app first."), and the provider is configured in the
# web frontend — the same state the food-photo scenario cannot reach from the
# app, seeded the same way. The catalog is suggested-workout's: the stub
# programs whichever chest exercises the server's search returns, and that
# catalog has exactly two.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../bin/qa-env.sh"

bash "$(dirname "${BASH_SOURCE[0]}")/suggested-workout.sh"

# The stub outlives a run, and the oracle reads its request log as the record
# of the three model turns — so start this run's log empty.
: >"$QA_AI_STUB_REQUESTS"

curl -fsS "http://127.0.0.1:$QA_AI_STUB_PORT/health" >/dev/null 2>&1 || {
  echo "!! the QA AI stub is not answering on :$QA_AI_STUB_PORT. Run: bash qa/bin/qa-up.sh" >&2
  exit 1
}

node "$QA_DIR/bin/qa-ai-service.mjs"
