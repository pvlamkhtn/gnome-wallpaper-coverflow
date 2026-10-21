# Wallpaper Coverflow

![The wallpaper picker: slanted cards, the focused one in the middle](docs/images/hero.png)

A GNOME Shell extension that changes your wallpaper from an Omarchy-style,
full-screen carousel of slanted cards. Press a shortcut, browse the images in
your wallpaper folder, click one to apply it.

Supports **GNOME Shell 46–51**; tested on GNOME Shell 46 (Ubuntu 24.04, Wayland).

_Tiếng Việt: [README.vi.md](README.vi.md)_

## Usage

| Action | Input |
|---|---|
| Open the picker | `Ctrl+Super+W` (configurable) |
| Browse | move the mouse, `←` / `→` (or `h` / `l`), scroll wheel, `Home` / `End` |
| Apply and close | click a wallpaper, or `Enter` |
| Cancel | `Esc`, or click outside the strip |

![Opening the picker, browsing three wallpapers and applying one](docs/images/demo.gif)

Five wallpapers show at a time as slanted 16:9 cards: the focused one in the
middle at full size with a highlighted border, two on each side smaller and
darker the farther they are, the outer ones peeking in from the screen edges.
Pointing at a side card brings it to the middle. The picker opens on the monitor
that has the pointer, over a dimmed copy of the current wallpaper. Images are
decoded in the background and only for cards near the screen, so large folders
stay responsive.

An optional second shortcut (**Next wallpaper**, unset by default) applies the
next image in the folder without opening the picker.

The choice is written to `org.gnome.desktop.background` (`picture-uri` and
`picture-uri-dark`), so it works like any wallpaper set from GNOME Settings. The
current picture mode (zoom, fill, ...) is left as you configured it.

## Install

From [extensions.gnome.org](https://extensions.gnome.org) (once published), or
from source:

```bash
git clone https://github.com/pvlamkhtn/gnome-wallpaper-coverflow
cd gnome-wallpaper-coverflow
./install.sh
```

`install.sh` builds the package with `gnome-extensions pack`, installs it for
your user and enables it. On Wayland, **log out and back in once** after the first
install.

Then put images (`jpg`, `jpeg`, `png`, `gif`, `bmp`, `webp`) in
`~/Pictures/Wallpapers`, or choose another folder in the settings.

## Configure

Open the *Extensions* app → *Wallpaper Coverflow* → ⚙️, or run
`gnome-extensions prefs wallpaper-coverflow@pvlamkhtn.github.io`.

| Setting | Default |
|---|---|
| Wallpaper folder (only images directly inside it are listed) | `Pictures/Wallpapers` |
| Open the picker | `Ctrl+Super+W` |
| Next wallpaper | disabled |
| Highlight color | `#5AD1E6` |

The same keys are available through `gsettings` under the schema
`org.gnome.shell.extensions.wallpaper-coverflow` (use `--schemadir` pointing at the
extension's `schemas/` directory).

## Uninstall

```bash
./uninstall.sh
```

Removes the extension and its settings; your images and current wallpaper stay.

## Development

```bash
./preview.sh     # try the checkout in a nested GNOME Shell window (no logout)
./preview.sh 2   # same, with two monitors side by side
./pack.sh        # build release/<uuid>.shell-extension.zip (what gets uploaded)
```

On Wayland the running shell keeps the code it loaded at login, so testing an
edit with `install.sh` means logging out. `preview.sh` instead starts a separate
GNOME Shell in a window, with its own settings, that loads the extension from
this checkout; open the picker there with `Ctrl+Alt+W`. Your session and
wallpaper are not touched. Close the window and run it again after each edit.

Publishing steps for extensions.gnome.org (Vietnamese):
[docs/publish-extensions-gnome-org.vi.md](docs/publish-extensions-gnome-org.vi.md).

## License

GPL-2.0-or-later, see [LICENSE](LICENSE).
