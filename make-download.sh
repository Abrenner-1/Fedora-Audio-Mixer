#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
PACKAGE_NAME="$(basename "$SCRIPT_DIR")"
OUT="$PARENT_DIR/$PACKAGE_NAME.zip"

cd "$PARENT_DIR"
rm -f "$OUT"
zip -qr "$OUT" "$PACKAGE_NAME" \
  -x "$PACKAGE_NAME/.git/*" \
  -x "$PACKAGE_NAME/__pycache__/*" \
  -x "$PACKAGE_NAME/app/__pycache__/*"

echo "$OUT"
