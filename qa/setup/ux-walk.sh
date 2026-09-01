#!/usr/bin/env bash
# ux-walk borrows suggested-workout's start state: a 17-muscle catalog and one
# inactive gym profile, so a workout can be generated offline.
set -euo pipefail
bash "$(dirname "${BASH_SOURCE[0]}")/suggested-workout.sh"
