#!/bin/bash
# Try the extension from this checkout in a GNOME Shell nested in a window, so
# code changes are visible without logging out. The nested shell has its own
# home, session bus and settings: your session, apps and wallpaper are not
# touched, and choosing a wallpaper there changes only the preview.
#
#   ./preview.sh [MONITORS]   # MONITORS: 1 (default) or 2, side by side
#
# Close the window (or press Ctrl+C here) to stop. Run it again after editing.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="wallpaper-coverflow@pvlamkhtn.github.io"
MONITORS="${1:-1}"
# Your session already uses Ctrl+Super+W for the installed copy and catches it
# first, so the preview listens on another shortcut.
SHORTCUT="<Control><Alt>w"

HOST_WAYLAND="${XDG_RUNTIME_DIR:?}/${WAYLAND_DISPLAY:?run this from a Wayland session}"
PICTURES="$(xdg-user-dir PICTURES 2>/dev/null || echo "$HOME/Pictures")"
WALLPAPERS="$PICTURES/Wallpapers"
CURRENT=$(gsettings get org.gnome.desktop.background picture-uri)

# Short path: the Wayland socket path must stay under 108 bytes.
SANDBOX=$(mktemp -d /tmp/wcf-preview.XXXXXX)
cleanup() {
  # The nested session leaves helpers (ibus-daemon, ...) running after it
  # exits; stop everything that was started with the sandbox home.
  for pid in $(pgrep -u "$(id -u)"); do
    if { tr '\0' '\n' <"/proc/$pid/environ"; } 2>/dev/null | grep -qx "HOME=$SANDBOX/home"; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$SANDBOX"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

EXT_DIR="$SANDBOX/home/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR" "$SANDBOX/run" "$SANDBOX/home/Desktop"
chmod 700 "$SANDBOX/run"
cp -r "$PROJECT_DIR/extension/." "$EXT_DIR/"
glib-compile-schemas "$EXT_DIR/schemas"

echo "Preview window opening. Shortcut inside it: Ctrl+Alt+W. Images: $WALLPAPERS"
# The nested backend draws its window through your session's X server (DISPLAY).
env -u DBUS_SESSION_BUS_ADDRESS \
  HOME="$SANDBOX/home" \
  XDG_CONFIG_HOME="$SANDBOX/home/.config" \
  XDG_DATA_HOME="$SANDBOX/home/.local/share" \
  XDG_CACHE_HOME="$SANDBOX/home/.cache" \
  XDG_RUNTIME_DIR="$SANDBOX/run" \
  WAYLAND_DISPLAY="$HOST_WAYLAND" \
  MUTTER_DEBUG_DUMMY_MODE_SPECS=1920x1080 \
  MUTTER_DEBUG_NUM_DUMMY_MONITORS="$MONITORS" \
  dbus-run-session -- bash -c '
    schema=org.gnome.shell.extensions.wallpaper-coverflow
    gsettings set org.gnome.shell enabled-extensions "[\"$0\"]"
    gsettings --schemadir "$1/schemas" set $schema show-picker "[\"$2\"]"
    gsettings --schemadir "$1/schemas" set $schema wallpaper-directory "$3"
    gsettings set org.gnome.desktop.background picture-uri "$4"
    gsettings set org.gnome.desktop.background picture-uri-dark "$4"
    exec gnome-shell --nested --wayland --no-x11
  ' "$UUID" "$EXT_DIR" "$SHORTCUT" "$WALLPAPERS" "$CURRENT" 2>&1 \
  | grep --line-buffered -iE "wallpaper-coverflow|JS ERROR|Gjs-CRITICAL|Failed to setup|Unable to open" || true
