# Shared configuration for the mobile QA harness. SOURCE this file, never run it.
#
# Every value here exists to keep the harness off the developer's own stack. An
# autonomous UI agent eventually taps Delete, "Remove SparkyFitness data from
# Apple Health", or Clear All History — so it gets its own Postgres on its own
# port, its own database, its own server process, and a throwaway account. There
# is deliberately no code path from this harness to the real database.

# Refuse to run anywhere BASH_SOURCE is unavailable. Under zsh it expands to
# nothing, `dirname ""` is ".", and QA_DIR silently becomes the PARENT of the
# current directory — so the harness would resolve its own root to somewhere
# outside the repo and write its state there. For a tool whose whole premise is
# "never touch anything real", guessing is the one unacceptable behaviour.
if [ -z "${BASH_SOURCE[0]:-}" ]; then
  echo "!! qa-env.sh must be sourced from bash (BASH_SOURCE is unset — zsh?)." >&2
  echo "   Use:  bash -c '. qa/bin/qa-env.sh; ...'" >&2
  return 1 2>/dev/null || exit 1
fi

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$QA_DIR/docker-compose.qa.yml" ]; then
  echo "!! qa-env.sh resolved QA_DIR to '$QA_DIR', which is not the harness root." >&2
  return 1 2>/dev/null || exit 1
fi
REPO_ROOT="$(cd "$QA_DIR/.." && pwd)"
QA_RUN_DIR="$QA_DIR/run"
mkdir -p "$QA_RUN_DIR/findings"

# --- the isolated stack -----------------------------------------------------
# Ports are one above the developer's own (5432 / 3010) so both can run at once;
# that matters because the harness is most useful while you are still working.
QA_DB_CONTAINER=sparkyfitness-qa-db
QA_COMPOSE_PROJECT=sparkyfitness-qa
QA_DB_PORT=55433
QA_DB_NAME=sparkyfitness_qa
QA_DB_USER=sparky_qa
QA_DB_PASSWORD=qa_local_only
QA_APP_DB_USER=sparky_qa_app
QA_APP_DB_PASSWORD=qa_local_only
QA_SERVER_PORT=3011
QA_SERVER_URL="http://localhost:${QA_SERVER_PORT}"
# A Debug build carries no JS bundle and loads one over the network, so the
# harness needs a Metro dev server too. 8082 keeps it off the developer's own
# 8081. Note that the dev client DISCOVERS a local dev server rather than being
# told one, so with both running it is not pinned which serves a given run.
QA_METRO_PORT=8082
# The fake vision provider the food-photo scenario points the server at, so a
# photo estimate is a constant instead of a paid, non-deterministic round trip
# to a real model. See qa/bin/qa-ai-stub.mjs.
QA_AI_STUB_PORT=3012
QA_AI_STUB_URL="http://127.0.0.1:${QA_AI_STUB_PORT}/v1/chat/completions"
# Everything the stub was asked for, one JSON object per request. The
# food-photo oracle reads it for the evidence no row carries: that the
# photograph itself was uploaded, at its real dimensions.
QA_AI_STUB_REQUESTS="$QA_RUN_DIR/ai-stub-requests.jsonl"

# The account every flow runs as. `.invalid` is the reserved TLD that can never
# resolve, so a stray outbound email or a copy-paste into a real deployment
# fails loudly instead of reaching a person.
QA_ACCOUNT_EMAIL="qa-agent@sparky.invalid"
QA_ACCOUNT_PASSWORD="qa-local-only-pw-1"
QA_ACCOUNT_NAME="QA Agent"
QA_ACCOUNT_FILE="$QA_RUN_DIR/qa-account.json"

# --- local-only secrets -----------------------------------------------------
# Generated on first run rather than committed: the repo is public, and a
# checked-in 64-hex string reads like a leaked key even when it is not one.
QA_SECRETS_FILE="$QA_DIR/.qa-secrets"
if [ ! -f "$QA_SECRETS_FILE" ]; then
  (
    umask 077
    {
      echo "QA_API_ENCRYPTION_KEY=$(openssl rand -hex 32)"
      echo "QA_BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    } >"$QA_SECRETS_FILE"
  )
fi
# shellcheck disable=SC1090
. "$QA_SECRETS_FILE"

# --- server environment overrides -------------------------------------------
# LOAD-BEARING: `index.ts` calls `dotenv.config({path: '../.env'})`, and dotenv
# does NOT overwrite variables that are already set in the environment. So
# exporting these before launching the server is what redirects it onto the QA
# database — every key the developer's own .env also defines must be listed
# here, or the QA server silently inherits it and writes to the real database.
export SPARKY_FITNESS_DB_HOST=localhost
export SPARKY_FITNESS_DB_PORT="$QA_DB_PORT"
export SPARKY_FITNESS_DB_NAME="$QA_DB_NAME"
export SPARKY_FITNESS_DB_USER="$QA_DB_USER"
export SPARKY_FITNESS_DB_PASSWORD="$QA_DB_PASSWORD"
export SPARKY_FITNESS_APP_DB_USER="$QA_APP_DB_USER"
export SPARKY_FITNESS_APP_DB_PASSWORD="$QA_APP_DB_PASSWORD"
export SPARKY_FITNESS_SERVER_PORT="$QA_SERVER_PORT"
export SPARKY_FITNESS_FRONTEND_URL="$QA_SERVER_URL"
export SPARKY_FITNESS_API_ENCRYPTION_KEY="$QA_API_ENCRYPTION_KEY"
export BETTER_AUTH_SECRET="$QA_BETTER_AUTH_SECRET"
export BETTER_AUTH_URL="$QA_SERVER_URL"
# The real .env promotes the developer's own address to admin. On the QA
# database that address does not exist, but naming it here keeps the QA server
# from ever acting on it.
export SPARKY_FITNESS_ADMIN_EMAIL="$QA_ACCOUNT_EMAIL"
export SPARKY_FITNESS_EXTRA_TRUSTED_ORIGINS="$QA_SERVER_URL"
export SPARKY_FITNESS_LOG_LEVEL=INFO
# Not a key the developer's .env defines — this one is QA's own. The server
# refuses to send an AI request to a private address unless the operator opts
# in, and the QA stub is on loopback by design, so without this every photo
# estimate comes back PRIVATE_NETWORK_FORBIDDEN. Scoped to the QA server
# process, which can only reach the QA stack in the first place.
export ALLOW_PRIVATE_NETWORK_AI=true

# --- docker ----------------------------------------------------------------
# This machine's ~/.docker/config.json names `credsStore: desktop`, whose helper
# binary is not on PATH, so ANY image pull dies with "error getting credentials"
# even for a public image needing none. Overriding DOCKER_CONFIG to dodge it
# does not work — the CLI reads its plugins and its context from the same
# directory, so `compose` vanishes and then the desktop-linux context does too.
# The workable answer is to never pull: QA pins the image the developer's own
# stack already runs, so it is always present locally.
QA_DB_IMAGE=postgres:18.3-alpine

qa_require_db_image() {
  docker image inspect "$QA_DB_IMAGE" >/dev/null 2>&1 && return 0
  echo "!! $QA_DB_IMAGE is not present locally, and pulling is broken on this" >&2
  echo "   machine (docker-credential-desktop is not on PATH). Fix the helper," >&2
  echo "   or pull it once by hand, before running the harness." >&2
  return 1
}

# --- simulator + driver -----------------------------------------------------
QA_SIM_NAME="${QA_SIM_NAME:-iPhone 17 Pro}"
MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
# Maestro 2.x refuses to start on the JDK 8 that ships in the Java plugin dir,
# and the error names the JDK rather than the PATH, so pin it explicitly.
export JAVA_HOME="${JAVA_HOME_QA:-/opt/homebrew/opt/openjdk@21}"

# LOAD-BEARING, and the single least obvious line in this harness. Without it
# Maestro sees a SparkyFitness screen as six nodes — the app icon, the status
# bar, nothing else — and every selector fails with "not visible" against a
# screen that is plainly showing the element. The cause is a full-screen view in
# the app's window stack marked `accessibilityViewIsModal`, which makes UIKit
# hide every sibling from the accessibility snapshot; XCUITest honours that flag
# by default. Turning it off restores the real tree (66 nodes on the onboarding
# screen instead of 6). xcodebuild forwards any TEST_RUNNER_-prefixed variable
# to the XCTest runner with the prefix stripped, which is how it reaches
# Maestro's driver.
export TEST_RUNNER_snapshotKeyHonorModalViews=false

QA_APP_PATH="${QA_APP_PATH:-}"
if [ -z "$QA_APP_PATH" ]; then
  QA_APP_PATH="$(/bin/ls -dt "$HOME/Library/Developer/Xcode/DerivedData"/SparkyFitness-*/Build/Products/Debug-iphonesimulator/SparkyFitness.app 2>/dev/null | head -1 || true)"
fi

qa_app_bundle_id() {
  # Read it off the built app rather than hardcoding: the bundle id depends on
  # APP_VARIANT, and it is an account-scoped identifier that does not belong in
  # a public repo.
  [ -n "$QA_APP_PATH" ] && [ -d "$QA_APP_PATH" ] || return 1
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$QA_APP_PATH/Info.plist" 2>/dev/null
}

# The node helpers (qa-seed, the oracles) read their configuration from the
# environment rather than re-deriving it, so that there is exactly one
# definition of where the QA stack lives. Export everything they may want.
export QA_DIR REPO_ROOT QA_RUN_DIR \
  QA_DB_CONTAINER QA_COMPOSE_PROJECT QA_DB_PORT QA_DB_NAME QA_DB_USER QA_DB_PASSWORD \
  QA_APP_DB_USER QA_APP_DB_PASSWORD QA_SERVER_PORT QA_SERVER_URL QA_METRO_PORT \
  QA_AI_STUB_PORT QA_AI_STUB_URL QA_AI_STUB_REQUESTS \
  QA_ACCOUNT_EMAIL QA_ACCOUNT_PASSWORD QA_ACCOUNT_NAME QA_ACCOUNT_FILE \
  QA_SIM_NAME QA_APP_PATH

qa_sql() {
  docker exec -e PGPASSWORD="$QA_DB_PASSWORD" "$QA_DB_CONTAINER" \
    psql -U "$QA_DB_USER" -d "$QA_DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

# Same, but against the maintenance database — the only place from which the QA
# database itself can be dropped.
qa_sql_maint() {
  docker exec -e PGPASSWORD="$QA_DB_PASSWORD" "$QA_DB_CONTAINER" \
    psql -U "$QA_DB_USER" -d postgres -v ON_ERROR_STOP=1 "$@"
}
