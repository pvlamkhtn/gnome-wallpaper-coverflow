// SPDX-License-Identifier: GPL-2.0-or-later
// Wallpaper Coverflow — Omarchy-style wallpaper coverflow for GNOME Shell.
//
// A keybinding opens a full-screen picker (picker.js) listing the images of
// the configured folder; the choice is written to org.gnome.desktop.background
// like any other wallpaper change. A second, optional keybinding cycles to the
// next image without opening the picker.
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WallpaperPicker} from './picker.js';
import {
    applyWallpaper, currentWallpaperPath, listWallpapers, wallpaperDirectory,
} from './wallpapers.js';

export default class WallpaperCoverflowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._picker = null;
        this._busy = false;

        Main.wm.addKeybinding('show-picker', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._togglePicker());
        Main.wm.addKeybinding('next-wallpaper', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._applyNext());
    }

    disable() {
        Main.wm.removeKeybinding('show-picker');
        Main.wm.removeKeybinding('next-wallpaper');

        this._cancellable.cancel();
        this._cancellable = null;
        this._picker?.destroy();
        this._picker = null;
        this._settings = null;
    }

    async _scan() {
        const directory = wallpaperDirectory(this._settings);
        const cancellable = this._cancellable;
        const paths = await listWallpapers(directory, cancellable);
        // disable() may have run while the folder was being read; stop here
        // rather than open a picker for a disabled extension.
        cancellable.set_error_if_cancelled();
        if (paths.length === 0) {
            Main.notify(this.metadata.name,
                this.gettext('No images found in %s').format(directory));
        }
        return paths;
    }

    async _run(action) {
        if (this._busy)
            return;
        this._busy = true;
        try {
            await action();
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`${this.metadata.uuid}: ${e.message}`);
        } finally {
            this._busy = false;
        }
    }

    _togglePicker() {
        if (this._picker) {
            this._picker.close();
            return;
        }
        this._run(async () => {
            const paths = await this._scan();
            if (paths.length === 0)
                return;

            const picker = new WallpaperPicker(
                paths, currentWallpaperPath(), this._settings.get_string('accent-color'));
            if (picker.isEmpty) {
                picker.destroy();
                Main.notifyError(this.metadata.name, this.gettext('None of the images could be read'));
                return;
            }
            picker.connect('selected', (_picker, path) => applyWallpaper(path));
            picker.connect('closed', () => {
                if (this._picker === picker)
                    this._picker = null;
            });
            this._picker = picker;
            if (!picker.open())
                this._picker = null;
        });
    }

    _applyNext() {
        this._run(async () => {
            const paths = await this._scan();
            if (paths.length === 0)
                return;
            const index = paths.indexOf(currentWallpaperPath());
            applyWallpaper(paths[(index + 1) % paths.length]);
        });
    }
}
