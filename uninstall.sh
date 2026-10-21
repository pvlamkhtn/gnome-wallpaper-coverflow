#!/bin/bash
# Remove Wallpaper Coverflow and its stored settings. Your images and your
# current wallpaper are left alone.
set -euo pipefail

UUID="wallpaper-coverflow@pvlamkhtn.github.io"

gnome-extensions disable "$UUID" 2>/dev/null || true
gnome-extensions uninstall "$UUID" 2>/dev/null || true
dconf reset -f /org/gnome/shell/extensions/wallpaper-coverflow/
echo "Removed $UUID. Log out and back in if it still shows in the Extensions app."
