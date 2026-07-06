#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_ID="dev.local.FedoraAudioMixer"
APP_NAME="Fedora Audio Mixer"
EXT_UUID="fedora-audio-mixer@local"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_INSTALL_DIR="$DATA_HOME/fedora-audio-mixer/app"
APPLICATIONS_DIR="$DATA_HOME/applications"
ICON_THEME_DIR="$DATA_HOME/icons/hicolor"
ICON_DIR="$ICON_THEME_DIR/scalable/apps"
BIN_DIR="$HOME/.local/bin"
BIN_PATH="$BIN_DIR/fedora-audio-mixer"
DESKTOP_FILE="$APPLICATIONS_DIR/$APP_ID.desktop"
BUILD_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

mkdir -p "$APP_INSTALL_DIR" "$APPLICATIONS_DIR" "$ICON_DIR" "$BIN_DIR"

install -m 755 "$SCRIPT_DIR/app/fedora_audio_mixer.py" "$APP_INSTALL_DIR/fedora_audio_mixer.py"
install -m 644 "$SCRIPT_DIR/app/$APP_ID.svg" "$ICON_DIR/$APP_ID.svg"
install -m 644 "$SCRIPT_DIR/README.md" "$DATA_HOME/fedora-audio-mixer/README.md"

cat > "$BIN_PATH" <<EOF
#!/usr/bin/env bash
exec python3 "$APP_INSTALL_DIR/fedora_audio_mixer.py" "\$@"
EOF
chmod 755 "$BIN_PATH"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Master and per-program audio mixer for Fedora GNOME
Exec=$BIN_PATH
Icon=$APP_ID
Terminal=false
Categories=AudioVideo;Audio;Mixer;GTK;
Keywords=audio;sound;volume;mixer;pipewire;pulse;
StartupNotify=true
StartupWMClass=$APP_ID
EOF
chmod 644 "$DESKTOP_FILE"

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP_FILE"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICON_THEME_DIR" >/dev/null 2>&1 || true
fi

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions pack "$SCRIPT_DIR/extension" -f -o "$BUILD_DIR" >/dev/null
  gnome-extensions install -f "$BUILD_DIR/$EXT_UUID.shell-extension.zip" >/dev/null
else
  mkdir -p "$DATA_HOME/gnome-shell/extensions/$EXT_UUID"
  install -m 644 "$SCRIPT_DIR/extension/metadata.json" "$DATA_HOME/gnome-shell/extensions/$EXT_UUID/metadata.json"
  install -m 644 "$SCRIPT_DIR/extension/extension.js" "$DATA_HOME/gnome-shell/extensions/$EXT_UUID/extension.js"
  install -m 644 "$SCRIPT_DIR/extension/stylesheet.css" "$DATA_HOME/gnome-shell/extensions/$EXT_UUID/stylesheet.css"
fi

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

if uuid not in enabled:
    enabled.append(uuid)
    subprocess.run(
        ["gsettings", "set", "org.gnome.shell", "enabled-extensions", repr(enabled)],
        check=True,
    )
PY

gnome-extensions enable "$EXT_UUID" >/dev/null 2>&1 || true

echo "$APP_NAME installed as one bundled app."
echo "Launch the app from the dock/app grid, or use the Mixer tile in Quick Settings."
echo "On Wayland, log out and back in once if the Quick Settings tile does not appear immediately."
