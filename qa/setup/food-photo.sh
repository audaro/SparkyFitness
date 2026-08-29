#!/usr/bin/env bash
# Scenario setup for food-photo: put a photograph in the simulator's library
# and give the QA account an AI provider to send it to.
#
# Both are state the app cannot create from inside itself — there is no way to
# take a photograph on a simulator that has no camera, and AI providers are
# configured in the web frontend, not on mobile — so they are seeded the way
# qa-seed.mjs seeds the account: from outside, before the flow starts.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../bin/qa-env.sh"

[ -n "${SIM_UDID:-}" ] || { echo "!! SIM_UDID is unset — this runs from qa-run.sh." >&2; exit 1; }

# --- the photograph ---------------------------------------------------------
# The simulator is NOT a blank slate here: every iOS runtime ships six stock
# photographs, so "the only picture in the library" is not a selector. The
# seeded photo is therefore stamped with a date of its own, which is what the
# picker labels its cell with and what the flow taps.
#
# The date is in the past and fixed rather than "now" so that it is the same
# string on every run, and it is nowhere near the stock photos' own 2011 EXIF
# dates. A PNG carries no EXIF, so Photos takes the file's timestamp.
PHOTO_TOUCH_STAMP=201903140926.00
PHOTO_DATE_LABEL="March 14, 2019"
PHOTO_FILE="$QA_RUN_DIR/qa-meal-photo.png"

node -e "
  import('${QA_DIR}/fixtures/food-photo.mjs').then((m) => {
    require('fs').writeFileSync(process.argv[1], m.mealPhotoPng());
  });
" "$PHOTO_FILE"
touch -t "$PHOTO_TOUCH_STAMP" "$PHOTO_FILE"

# Every run adds another copy. They are byte-identical and share one date, so a
# selector cannot tell them apart and does not need to — which is the point.
# `simctl erase` is the way to clear the library if it ever gets tiresome.
xcrun simctl addmedia "$SIM_UDID" "$PHOTO_FILE"
echo "    seeded $PHOTO_FILE into the simulator's photo library ($PHOTO_DATE_LABEL)"

# --- the provider -----------------------------------------------------------
# Truncate the stub's request log FIRST. It outlives a run (the stub is started
# by qa-up.sh and stays up), and the oracle reads it as evidence that this
# run's photograph was uploaded — a leftover line from the previous run is
# exactly the residue the whole-database reset exists to prevent.
: >"$QA_AI_STUB_REQUESTS"

curl -fsS "http://127.0.0.1:$QA_AI_STUB_PORT/health" >/dev/null 2>&1 || {
  echo "!! the QA AI stub is not answering on :$QA_AI_STUB_PORT. Run: bash qa/bin/qa-up.sh" >&2
  exit 1
}

node "$QA_DIR/bin/qa-ai-service.mjs"
