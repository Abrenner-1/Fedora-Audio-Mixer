#!/usr/bin/env bash
set -euo pipefail

APP_ID="dev.local.FedoraAudioMixer"
EXT_UUID="fedora-audio-mixer@local"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_HOME/fedora-audio-mixer"
APPLICATIONS_DIR="$DATA_HOME/applications"
ICON_THEME_DIR="$DATA_HOME/icons/hicolor"
ICON_PATH="$ICON_THEME_DIR/scalable/apps/$APP_ID.svg"
BIN_PATH="$HOME/.local/bin/fedora-audio-mixer"
DESKTOP_FILE="$APPLICATIONS_DIR/$APP_ID.desktop"
EXTENSION_DIR="$DATA_HOME/gnome-shell/extensions/$EXT_UUID"

gnome-extensions disable "$EXT_UUID" >/dev/null 2>&1 || true

python3 - "$EXT_UUID" <<'PY'
import ast
import subprocess
import sys

uuid = sys.argv[1]
raw = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
    text=True,
).strip()

if raw == "@as []":
    enabled = []
else:
    enabled = ast.literal_eval(raw)

updated = [item for item in enabled if item != uuid]
if updated != enabled:
    subprocess.run(
        ["gsettings", "set", "org.gnome.shell", "enabled-extensions", repr(updated)],
        check=True,
    )
PY

rm -f "$BIN_PATH" "$DESKTOP_FILE" "$ICON_PATH"
rm -rf "$APP_DIR" "$EXTENSION_DIR"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICON_THEME_DIR" >/dev/null 2>&1 || true
fi

echo "Fedora Audio Mixer removed."
