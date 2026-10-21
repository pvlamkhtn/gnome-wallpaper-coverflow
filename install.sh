#!/bin/bash
# Install Wallpaper Coverflow from this checkout into your user extensions
# directory and enable it. Only this extension is touched; safe to re-run, it
# also updates the installed copy after you edit the source.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="wallpaper-coverflow@pvlamkhtn.github.io"

"$PROJECT_DIR/pack.sh" >/dev/null
echo "==> Installing $UUID..."
gnome-extensions install --force "$PROJECT_DIR/release/$UUID.shell-extension.zip"

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
  # Shell already knows it. Disable/enable restarts the extension, but GNOME
  # Shell caches the JS modules it already loaded, so edited code only takes
  # effect after the next login.
  gnome-extensions disable "$UUID" || true
  gnome-extensions enable "$UUID"
  echo "Done. Log out and back in to load the updated code (a full reboot is not needed)."
else
  # Fresh install on Wayland: the shell only scans for new extensions at
  # login, so `gnome-extensions enable` cannot see it yet. Mark it enabled in
  # the list the shell reads at the next login.
  current=$(gsettings get org.gnome.shell enabled-extensions)
  if [[ "$current" != *"'$UUID'"* ]]; then
    if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
      gsettings set org.gnome.shell enabled-extensions "['$UUID']"
    else
      gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']"
    fi
  fi
  echo "Done. Log out and back in ONCE so GNOME Shell loads the new extension."
fi
echo "Open the picker with Ctrl+Super+W. Settings: gnome-extensions prefs $UUID"
echo "Put images in ~/Pictures/Wallpapers (or pick another folder in the settings)."
