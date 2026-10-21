// SPDX-License-Identifier: GPL-2.0-or-later
// Wallpaper folder scanning and applying the choice through GSettings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

const IMAGE_SUFFIXES = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

export function wallpaperDirectory(settings) {
    const configured = settings.get_string('wallpaper-directory').trim();
    if (configured === '~')
        return GLib.get_home_dir();
    if (configured.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), configured.slice(2)]);
    if (configured)
        return configured;

    const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
    return GLib.build_filenamev([pictures, 'Wallpapers']);
}

// Image paths directly inside `directory`, sorted by name. A missing or
// unreadable folder yields an empty list.
export async function listWallpapers(directory, cancellable) {
    const folder = Gio.File.new_for_path(directory);
    const names = [];
    try {
        const enumerator = await folder.enumerate_children_async(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable);
        let infos;
        while ((infos = await enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable)).length > 0) {
            for (const info of infos) {
                const type = info.get_file_type();
                const name = info.get_name();
                const isImage = IMAGE_SUFFIXES.some(suffix => name.toLowerCase().endsWith(suffix));
                if (isImage && (type === Gio.FileType.REGULAR || type === Gio.FileType.SYMBOLIC_LINK))
                    names.push(name);
            }
        }
        enumerator.close(null);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        return [];
    }

    names.sort((a, b) => a.localeCompare(b));
    return names.map(name => GLib.build_filenamev([directory, name]));
}

// Path of the wallpaper GNOME is showing right now, honoring the dark style.
export function currentWallpaperPath() {
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    const dark = interfaceSettings.get_string('color-scheme') === 'prefer-dark';
    const uri = background.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
    return uri ? Gio.File.new_for_uri(uri).get_path() : null;
}

export function applyWallpaper(path) {
    const uri = Gio.File.new_for_path(path).get_uri();
    const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    background.set_string('picture-uri', uri);
    background.set_string('picture-uri-dark', uri);
}
