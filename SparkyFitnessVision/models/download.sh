#!/usr/bin/env bash
# Fetch the model weights the sidecar needs. Safe to re-run; skips what is
# already present. See models.py for why these are not in git.
set -euo pipefail

DIR="${VISION_MODEL_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.models}"
mkdir -p "$DIR"

fetch() {
  local name="$1" url="$2"
  if [ -s "$DIR/$name" ]; then
    echo "have $name"
    return
  fi
  echo "fetching $name"
  curl -sSL --fail -o "$DIR/$name.part" "$url"
  mv "$DIR/$name.part" "$DIR/$name"
}

fetch pose_landmarker_heavy.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"

echo "models ready in $DIR"
