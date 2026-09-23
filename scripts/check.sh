#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "[check] node --check src/content.js"
node --check "$ROOT_DIR/src/content.js"
node --check "$ROOT_DIR/src/background.js"
node --check "$ROOT_DIR/src/native-renderer.js"

echo "[check] jq . manifest.json"
jq . "$ROOT_DIR/manifest.json" >/dev/null

echo "[check] userscript syntax and cache regression"
node "$ROOT_DIR/scripts/build-userscript.cjs" --check
node "$ROOT_DIR/scripts/check-userscript.cjs"
node --check "$ROOT_DIR/userscript/linuxdo-sidepeek.user.js"
node "$ROOT_DIR/scripts/check-cache.cjs"
node "$ROOT_DIR/scripts/check-preview.cjs"
node "$ROOT_DIR/scripts/check-status.cjs"
node "$ROOT_DIR/scripts/check-bookmarks.cjs"
node "$ROOT_DIR/scripts/check-gist.cjs"

echo "[check] ok"
