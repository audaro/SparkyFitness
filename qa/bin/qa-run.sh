#!/usr/bin/env bash
# One QA scenario, end to end: reset -> drive -> assert.
#
#   bash qa/bin/qa-run.sh custom-food-log
#
# The order is the whole point. State is reset first so a run cannot pass on
# residue from the previous one; the UI flow drives the app exactly as a person
# would; and then the oracles decide the verdict from the database and the app's
# own log, never from what the screen appeared to say.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/qa-env.sh"

SCENARIO="${1:-}"
if [ -z "$SCENARIO" ]; then
  echo "usage: qa-run.sh <scenario>    (available: $(cd "$QA_DIR/flows" && ls *.yaml 2>/dev/null | sed 's/\.yaml$//' | tr '\n' ' '))" >&2
  exit 2
fi
FLOW="$QA_DIR/flows/$SCENARIO.yaml"
[ -f "$FLOW" ] || { echo "!! no such flow: $FLOW" >&2; exit 2; }

# --- preconditions ----------------------------------------------------------
curl -fsS "$QA_SERVER_URL/api/health" >/dev/null 2>&1 || {
  echo "!! QA server is not up. Run: bash qa/bin/qa-up.sh" >&2
  exit 1
}
[ -n "$QA_APP_PATH" ] && [ -d "$QA_APP_PATH" ] || {
  echo "!! no simulator build found. Build it with:" >&2
  echo "   (cd SparkyFitnessMobile && xcodebuild -workspace ios/SparkyFitness.xcworkspace \\" >&2
  echo "      -scheme SparkyFitness -configuration Debug \\" >&2
  echo "      -destination 'generic/platform=iOS Simulator' build)" >&2
  exit 1
}
QA_APP_BUNDLE_ID="$(qa_app_bundle_id)"
export QA_APP_BUNDLE_ID
echo "==> app: $QA_APP_BUNDLE_ID"
echo "    from $QA_APP_PATH"

# The build MUST be Debug. A Release build has __DEV__ false, which turns off
# the dev-only invariant throws the harness relies on AND makes serverUrl.ts
# reject the plain-HTTP localhost the QA server listens on — the app would
# simply refuse to connect, with a message about HTTPS that has nothing to do
# with whatever was being tested.
if [ -f "$QA_APP_PATH/main.jsbundle" ]; then
  echo "!! this app has an embedded JS bundle, so it is a Release build." >&2
  echo "   Rebuild with -configuration Debug; __DEV__ must be true." >&2
  exit 1
fi

# --- simulator --------------------------------------------------------------
SIM_UDID="$(xcrun simctl list devices available -j \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);for(const rt of Object.keys(j.devices)){for(const d of j.devices[rt]){if(d.name===process.argv[1]){console.log(d.udid);process.exit(0)}}}process.exit(1)})" "$QA_SIM_NAME")"
echo "==> simulator: $QA_SIM_NAME ($SIM_UDID)"
if ! xcrun simctl list devices booted | grep -q "$SIM_UDID"; then
  xcrun simctl boot "$SIM_UDID"
fi
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true
open -ga Simulator || true

# Uninstall before installing. This is a SAFETY requirement, not hygiene:
# `simctl install` over an existing install keeps the app's data, so a simulator
# that was previously pointed at a real server stays pointed at it, and the
# harness would happily drive an autonomous agent against production data.
# Doing it here rather than with Maestro's `clearState` matters, because the
# preferences written below have to survive into the first launch.
xcrun simctl uninstall "$SIM_UDID" "$QA_APP_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$SIM_UDID" "$QA_APP_PATH"

# Take expo-dev-menu out of the picture entirely. Left alone it opens itself
# over the app on every launch (ShowsAtLaunch defaults to true), parks a
# floating button in its own window over the app's top-right corner, and offers
# a shake, a three-finger long press and a ⌘-key command as further ways in —
# all of which an exploratory agent will eventually trigger by accident. Its
# one-time onboarding sheet also comes back after every reinstall.
#
# Getting this wrong is worse than it sounds, because the dev menu is a modal
# and qa-env.sh deliberately stops the driver from honouring modals: the app's
# own controls stay "visible" to a selector while every tap lands on the menu
# in front of them. The flow then passes its assertions and quietly drives the
# dev menu instead — which is how a run ends up back at the launcher having
# pressed "Go home". All of it is preferences, so none of it needs a UI step.
for pref in \
  "EXDevMenuShowsAtLaunch false" \
  "EXDevMenuShowFloatingActionButton false" \
  "EXDevMenuTouchGestureEnabled false" \
  "EXDevMenuMotionGestureEnabled false" \
  "EXDevMenuKeyCommandsEnabled false" \
  "EXDevMenuIsOnboardingFinished true"; do
  set -- $pref
  xcrun simctl spawn "$SIM_UDID" defaults write "$QA_APP_BUNDLE_ID" "$1" -bool "$2"
done

# --- reset ------------------------------------------------------------------
# The whole database goes, not just the account. Deleting the QA user leaves
# behind every row whose foreign key to `user` does not cascade — `foods` among
# them — and a scenario that searches for a food by name will happily find the
# previous run's copy and pass. The server rebuilds the schema at boot, so an
# empty database is a valid start state and this costs one server restart.
#
# Re-seeding then hands back a brand-new user id, so a stale id in a previous
# run's account file can never satisfy an assertion either.
echo "==> resetting the QA database"
bash "$QA_DIR/bin/qa-up.sh" --fresh-db >/dev/null
node "$QA_DIR/bin/qa-seed.mjs" >/dev/null
QA_USER_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).userId)" "$QA_ACCOUNT_FILE")"
export QA_USER_ID
echo "    user $QA_USER_ID"

# --- drive ------------------------------------------------------------------
mkdir -p "$QA_RUN_DIR/findings" "$QA_RUN_DIR/artifacts"
rm -f "$QA_RUN_DIR/findings"/*.json
echo "==> running flow: $SCENARIO"
set +e
"$MAESTRO_BIN" --device "$SIM_UDID" test \
  --env APP_ID="$QA_APP_BUNDLE_ID" \
  --env SERVER_URL="$QA_SERVER_URL" \
  --env QA_EMAIL="$QA_ACCOUNT_EMAIL" \
  --env QA_PASSWORD="$QA_ACCOUNT_PASSWORD" \
  --format junit --output "$QA_RUN_DIR/artifacts/$SCENARIO.xml" \
  "$FLOW" 2>&1 | tee "$QA_RUN_DIR/artifacts/$SCENARIO.log"
FLOW_STATUS=${PIPESTATUS[0]}
set -e
echo "    flow exit: $FLOW_STATUS"

# --- assert -----------------------------------------------------------------
# Oracles run even when the flow failed: a flow that could not finish still
# leaves evidence, and "the tap never landed" and "the tap landed but wrote the
# wrong row" are different bugs that must not be collapsed.
echo "==> oracles"
ORACLE_STATUS=0
for oracle in "$QA_DIR/oracles/$SCENARIO.mjs" "$QA_DIR/oracles/app-logs.mjs"; do
  [ -f "$oracle" ] || continue
  echo "  -- $(basename "$oracle")"
  node "$oracle" || ORACLE_STATUS=1
done

echo
if [ "$FLOW_STATUS" -eq 0 ] && [ "$ORACLE_STATUS" -eq 0 ]; then
  echo "==> PASS: $SCENARIO"
  exit 0
fi
echo "==> FAIL: $SCENARIO (flow=$FLOW_STATUS oracles=$ORACLE_STATUS)"
echo "    findings: qa/run/findings/   artifacts: qa/run/artifacts/"
exit 1
