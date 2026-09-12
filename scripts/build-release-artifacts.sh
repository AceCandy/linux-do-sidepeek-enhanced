#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VERSION_TAG=${1:-v0.0.0-dev}
OUTPUT_DIR=${2:-"$ROOT_DIR/dist"}

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(cd "$OUTPUT_DIR" && pwd)

CHROME_ZIP_NAME="linux-do-sidepeek-${VERSION_TAG#v}-chrome.zip"
FIREFOX_XPI_NAME="linux-do-sidepeek-${VERSION_TAG#v}-firefox-unsigned.xpi"

echo "[build] $OUTPUT_DIR/$CHROME_ZIP_NAME"
(
  cd "$ROOT_DIR"
  zip -r "$OUTPUT_DIR/$CHROME_ZIP_NAME" manifest.json src >/dev/null
)

echo "[build] $OUTPUT_DIR/$FIREFOX_XPI_NAME"
# Firefox 使用后台脚本，Chrome 使用 service worker；其余源码保持一致。
FIREFOX_STAGE=$(mktemp -d)
trap 'rm -rf "$FIREFOX_STAGE"' EXIT
cp -R "$ROOT_DIR/src" "$FIREFOX_STAGE/src"
jq '.background = {scripts: [.background.service_worker]}' "$ROOT_DIR/manifest.json" > "$FIREFOX_STAGE/manifest.json"
(
  cd "$FIREFOX_STAGE"
  zip -r "$OUTPUT_DIR/$FIREFOX_XPI_NAME" manifest.json src >/dev/null
)

echo "CHROME_ZIP_PATH=$OUTPUT_DIR/$CHROME_ZIP_NAME"
echo "FIREFOX_XPI_PATH=$OUTPUT_DIR/$FIREFOX_XPI_NAME"
