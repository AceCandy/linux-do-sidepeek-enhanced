#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "[check] node --check src/content.js"
node --check "$ROOT_DIR/src/content.js"

echo "[check] jq . manifest.json"
jq . "$ROOT_DIR/manifest.json" >/dev/null

echo "[check] userscript syntax and cache regression"
node --check "$ROOT_DIR/userscript/linuxdo-sidepeek.user.js"
node "$ROOT_DIR/scripts/check-cache.cjs"

echo "[check] ok"
