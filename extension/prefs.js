// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const toHex = ({red, green, blue}) =>
    '#' + [red, green, blue].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

export default class WallpaperCoverflowPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const _ = this.gettext.bind(this);
        const page = new Adw.PreferencesPage();

        page.add(this._buildFolderGroup(window, settings, _));
        page.add(this._buildShortcutGroup(window, settings, _));
        page.add(this._buildAppearanceGroup(settings, _));

        window.add(page);
    }

    _buildFolderGroup(window, settings, _) {
        const group = new Adw.PreferencesGroup({
            title: _('Wallpapers'),
            description: _('The picker lists the images (jpg, png, gif, bmp, webp) directly inside this folder.'),
        });

        const row = new Adw.ActionRow({title: _('Wallpaper folder')});
        const update = () => {
            const configured = settings.get_string('wallpaper-directory');
            row.subtitle = configured || _('Default: Pictures/Wallpapers');
        };
        update();
        settings.connect('changed::wallpaper-directory', update);

        const choose = new Gtk.Button({label: _('Choose…'), valign: Gtk.Align.CENTER});
        choose.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _('Wallpaper folder')});
            const current = settings.get_string('wallpaper-directory');
            if (current && GLib.file_test(current, GLib.FileTest.IS_DIR))
                dialog.initial_folder = Gio.File.new_for_path(current);
            dialog.select_folder(window, null, (_dialog, result) => {
                try {
                    const folder = dialog.select_folder_finish(result);
                    settings.set_string('wallpaper-directory', folder.get_path());
                } catch (e) {
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED) &&
                        !e.matches(Gtk.DialogError, Gtk.DialogError.CANCELLED))
                        console.error(e.message);
                }
            });
        });

        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: _('Use the default folder'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.reset('wallpaper-directory'));

        row.add_suffix(choose);
        row.add_suffix(reset);
        group.add(row);
        return group;
    }

    _buildShortcutGroup(window, settings, _) {
        const group = new Adw.PreferencesGroup({title: _('Shortcuts')});
        group.add(this._shortcutRow(window, settings, _, 'show-picker', _('Open the picker')));
        group.add(this._shortcutRow(window, settings, _, 'next-wallpaper', _('Next wallpaper')));
        return group;
    }

    _buildAppearanceGroup(settings, _) {
        const group = new Adw.PreferencesGroup({title: _('Appearance')});
        const row = new Adw.ActionRow({
            title: _('Highlight color'),
            subtitle: _('Border around the focused wallpaper'),
        });

        const rgba = new Gdk.RGBA();
        if (!rgba.parse(settings.get_string('accent-color')))
            rgba.parse(settings.get_default_value('accent-color').get_string()[0]);
        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba,
            valign: Gtk.Align.CENTER,
        });
        button.connect('notify::rgba', () => settings.set_string('accent-color', toHex(button.rgba)));
        row.add_suffix(button);
        group.add(row);
        return group;
    }

    _shortcutRow(window, settings, _, key, title) {
        const row = new Adw.ActionRow({title});
        const label = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        const update = () => {
            label.accelerator = settings.get_strv(key)[0] ?? '';
        };
        update();
        settings.connect(`changed::${key}`, update);

        const set = new Gtk.Button({label: _('Set…'), valign: Gtk.Align.CENTER});
        set.connect('clicked', () => this._captureShortcut(window, _, accelerator => {
            settings.set_strv(key, accelerator ? [accelerator] : []);
        }));

        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Disable this shortcut'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clear.connect('clicked', () => settings.set_strv(key, []));

        row.add_suffix(label);
        row.add_suffix(set);
        row.add_suffix(clear);
        return row;
    }

    // Small modal that waits for a key combination. Esc cancels, Backspace
    // clears; a combination needs at least one modifier.
    _captureShortcut(parent, _, onChosen) {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: parent,
            default_width: 360,
            default_height: 160,
            title: _('Set shortcut'),
        });
        dialog.set_content(new Adw.StatusPage({
            title: _('Press the new shortcut'),
            description: _('Esc cancels, Backspace disables'),
        }));

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            if (!mask && keyval === Gdk.KEY_Escape) {
                dialog.close();
            } else if (!mask && keyval === Gdk.KEY_BackSpace) {
                onChosen(null);
                dialog.close();
            } else if (mask && Gtk.accelerator_valid(keyval, mask)) {
                onChosen(Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mask));
                dialog.close();
            }
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
