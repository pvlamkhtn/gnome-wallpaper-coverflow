// SPDX-License-Identifier: GPL-2.0-or-later
// Full-screen wallpaper carousel, drawn with St/Clutter inside the shell.
//
// Wallpapers are slanted 16:9 cards (parallelograms) in a row over the dimmed
// current wallpaper. The focused card sits in the middle at full size and
// brightness; two cards on each side shrink and darken with their distance
// from it (shaded, not translucent, so a busy wallpaper does not show through),
// the outer ones half past the screen edges, and the rest wait off stage,
// invisible, to slide in. Each card's frame is
// sheared and clips its image, while the image is sheared back, so the outline
// is slanted but the picture is not distorted. Images are decoded off the main
// loop and only for cards near the screen, so large folders stay responsive.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

const CARD_ASPECT = 16 / 9;
const MAX_HEIGHT_RATIO = 0.42;
const SKEW = 0.25;
const BORDER = 4;
const GAP = 22;
// Scale and black shade opacity by distance from the focused card; beyond the
// last entry cards are hidden.
const SCALES = [1, 0.82, 0.68];
const SHADES = [0, 105, 145];
const VISIBLE_SIDE = SCALES.length - 1;
const MOVE_DURATION = 240;
const FADE_DURATION = 150;
const POINTER_THRESHOLD = 3;

// Clutter.Image is gone in GNOME 48; St.ImageContent replaces it and, from 48 on,
// takes the Cogl context as its first set_data() argument.
const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split('.')[0]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Horizontal shear around the actor's center: the top leans right, the bottom
// left. A negative amount undoes it.
function shearTransform(width, height, amount) {
    const toCenter = new Graphene.Matrix().init_translate(
        new Graphene.Point3D({x: -width / 2, y: -height / 2, z: 0}));
    const shear = new Graphene.Matrix().init_from_float(
        [1, 0, 0, 0, -amount, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const back = new Graphene.Matrix().init_translate(
        new Graphene.Point3D({x: width / 2, y: height / 2, z: 0}));
    return toCenter.multiply(shear).multiply(back);
}

export const WallpaperPicker = GObject.registerClass({
    Signals: {
        'selected': {param_types: [GObject.TYPE_STRING]},
        'closed': {},
    },
}, class WallpaperPicker extends St.Widget {
    _init(paths, currentPath, accentColor) {
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        super._init({
            style_class: 'wallpaper-coverflow-overlay',
            reactive: true,
            can_focus: true,
            clip_to_allocation: true,
            opacity: 0,
        });
        // modalDialogGroup is a BinLayout that sizes itself to its widest child
        // and ignores fixed x, so a fixed geometry on a monitor not at x = 0 is
        // allocated zero width and fully clipped. The constraint overrides that.
        this.add_constraint(new Layout.MonitorConstraint({index: monitor.index}));

        this._monitor = monitor;
        this._accentColor = accentColor;
        this._cancellable = new Gio.Cancellable();
        this._cards = [];

        // Cards are as large as fits with the outer cards centered on the
        // monitor edges, so they peek in at half width.
        const [, side1, side2] = SCALES;
        const rowUnits = 1 + 2 * side1 + side2;
        const fitWidth = (monitor.width - 2 * VISIBLE_SIDE * GAP) / rowUnits;
        this._cardWidth = Math.round(Math.min(fitWidth, monitor.height * MAX_HEIGHT_RATIO * CARD_ASPECT));
        this._cardHeight = Math.round(this._cardWidth / CARD_ASPECT);
        this._cardY = Math.round((monitor.height - this._cardHeight) / 2);

        this._background = new Clutter.Actor({
            width: monitor.width,
            height: monitor.height,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        });
        this.add_child(this._background);
        this.add_child(new St.Widget({
            style_class: 'wallpaper-coverflow-dim',
            width: monitor.width,
            height: monitor.height,
        }));
        if (currentPath)
            this._loadBackground(currentPath);

        for (const path of paths) {
            const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
            if (width > 0 && height > 0)
                this._cards.push(this._createCard(path, width, height));
        }
        this._focusIndex = Math.max(0, this._cards.findIndex(card => card.path === currentPath));

        const [pointerX, pointerY] = global.get_pointer();
        this._pointer = {x: pointerX, y: pointerY};
        this._hoverIndex = -1;
        this._grab = null;

        this.connect('destroy', () => this._onDestroy());
    }

    get isEmpty() {
        return this._cards.length === 0;
    }

    open() {
        Main.layoutManager.modalDialogGroup.add_child(this);
        this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab) {
            this.destroy();
            return false;
        }
        this.grab_key_focus();
        this._updateLayout(false);
        this._hoverIndex = this._indexAt(this._pointer.x, this._pointer.y);
        this.ease({opacity: 255, duration: FADE_DURATION, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        return true;
    }

    close() {
        if (this._closing)
            return;
        this._closing = true;
        this._release();
        this.ease({
            opacity: 0,
            duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.destroy(),
        });
    }

    _release() {
        if (!this._grab)
            return;
        Main.popModal(this._grab);
        this._grab = null;
    }

    _onDestroy() {
        this._release();
        this._cancellable.cancel();
        this._cards = [];
        this.emit('closed');
    }

    _select(card) {
        this.emit('selected', card.path);
        this.close();
    }

    // slot (position, scale, opacity) > frame (sheared, border color)
    // > window (clips to the slanted inner area) > image (sheared back, covers
    // it) and shade (darkens it).
    _createCard(path, imageWidth, imageHeight) {
        const width = this._cardWidth;
        const height = this._cardHeight;
        const innerWidth = width - 2 * BORDER;
        const innerHeight = height - 2 * BORDER;

        // Unsheared, the slanted window spans SKEW * innerHeight more than its width.
        const aspect = imageWidth / imageHeight;
        const coverWidth = Math.ceil(Math.max(innerWidth + SKEW * innerHeight, innerHeight * aspect));
        const coverHeight = Math.ceil(coverWidth / aspect);
        const image = new Clutter.Actor({
            x: Math.round((innerWidth - coverWidth) / 2),
            y: Math.round((innerHeight - coverHeight) / 2),
            width: coverWidth,
            height: coverHeight,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        });
        image.set_transform(shearTransform(coverWidth, coverHeight, -SKEW));

        const window = new St.Widget({
            style_class: 'wallpaper-coverflow-window',
            x: BORDER,
            y: BORDER,
            width: innerWidth,
            height: innerHeight,
            clip_to_allocation: true,
        });
        window.add_child(image);
        const shade = new St.Widget({
            style_class: 'wallpaper-coverflow-shade',
            width: innerWidth,
            height: innerHeight,
            opacity: 0,
        });
        window.add_child(shade);

        const frame = new St.Widget({
            style_class: 'wallpaper-coverflow-card',
            width,
            height,
        });
        frame.set_transform(shearTransform(width, height, SKEW));
        frame.add_child(window);

        const slot = new Clutter.Actor({
            width,
            height,
            y: this._cardY,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            opacity: 0,
        });
        slot.add_child(frame);
        this.add_child(slot);
        return {path, slot, frame, image, shade, coverHeight, loaded: false};
    }

    // Center x, scale, opacity and shade of every card for the current focus. Gaps
    // between neighbors stay GAP wide however their scales differ.
    _layout() {
        const count = this._cards.length;
        const scaleAt = offset => SCALES[Math.min(Math.abs(offset), VISIBLE_SIDE)];
        const centers = new Array(count).fill(0);
        centers[this._focusIndex] = this._monitor.width / 2;
        for (let i = this._focusIndex + 1; i < count; i++) {
            centers[i] = centers[i - 1] + GAP + this._cardWidth *
                (scaleAt(i - 1 - this._focusIndex) + scaleAt(i - this._focusIndex)) / 2;
        }
        for (let i = this._focusIndex - 1; i >= 0; i--) {
            centers[i] = centers[i + 1] - GAP - this._cardWidth *
                (scaleAt(i + 1 - this._focusIndex) + scaleAt(i - this._focusIndex)) / 2;
        }
        return this._cards.map((_card, i) => {
            const offset = i - this._focusIndex;
            const visible = Math.abs(offset) <= VISIBLE_SIDE;
            return {
                offset,
                center: centers[i],
                scale: scaleAt(offset),
                opacity: visible ? 255 : 0,
                shade: SHADES[Math.min(Math.abs(offset), VISIBLE_SIDE)],
                visible,
            };
        });
    }

    _updateLayout(animate) {
        const layout = this._layout();
        this._cards.forEach((card, i) => {
            const {offset, center, scale, opacity, shade} = layout[i];
            card.frame.style = `background-color: ${offset === 0 ? this._accentColor : 'transparent'};`;
            if (!card.loaded && Math.abs(offset) <= VISIBLE_SIDE + 1)
                this._loadImage(card);

            const target = {
                x: Math.round(center - this._cardWidth / 2),
                scale_x: scale,
                scale_y: scale,
                opacity,
            };
            card.slot.remove_all_transitions();
            card.shade.remove_all_transitions();
            if (animate) {
                const params = {duration: MOVE_DURATION, mode: Clutter.AnimationMode.EASE_OUT_CUBIC};
                card.slot.ease({...target, ...params});
                card.shade.ease({opacity: shade, ...params});
            } else {
                card.slot.set(target);
                card.shade.opacity = shade;
            }
        });

        // Farthest cards first so nearer ones overlap them.
        const byDistance = this._cards.map((_card, i) => i)
            .sort((a, b) => Math.abs(b - this._focusIndex) - Math.abs(a - this._focusIndex));
        for (const i of byDistance)
            this.set_child_above_sibling(this._cards[i].slot, null);
    }

    // Decode off the main loop; width/height of -1 keep the aspect ratio.
    async _decode(path, width, height, preserveAspect) {
        const stream = await new Promise((resolve, reject) => {
            Gio.File.new_for_path(path).read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
                try {
                    resolve(file.read_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        try {
            return await new Promise((resolve, reject) => {
                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                    stream, width, height, preserveAspect, this._cancellable, (_source, res) => {
                        try {
                            resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
            });
        } finally {
            stream.close(null);
        }
    }

    _contentFor(pixbuf) {
        const content = St.ImageContent.new_with_preferred_size(pixbuf.get_width(), pixbuf.get_height());
        const args = [
            pixbuf.get_pixels(),
            pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_rowstride(),
        ];
        if (SHELL_MAJOR >= 48)
            content.set_data(global.stage.context.get_backend().get_cogl_context(), ...args);
        else
            content.set_data(...args);
        return content;
    }

    _reportLoadError(path, e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.error(`wallpaper-coverflow: cannot load ${path}: ${e.message}`);
    }

    async _loadImage(card) {
        card.loaded = true;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        try {
            const pixbuf = await this._decode(card.path, -1, Math.round(card.coverHeight * scale), true);
            card.image.set_content(this._contentFor(pixbuf));
        } catch (e) {
            this._reportLoadError(card.path, e);
        }
    }

    // The current wallpaper, scaled to cover the monitor like "zoom" mode.
    async _loadBackground(path) {
        const [, imageWidth, imageHeight] = GdkPixbuf.Pixbuf.get_file_info(path);
        if (!(imageWidth > 0 && imageHeight > 0))
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.round(this._monitor.width * scale);
        const height = Math.round(this._monitor.height * scale);
        const factor = Math.max(width / imageWidth, height / imageHeight);
        const coverWidth = Math.max(width, Math.ceil(imageWidth * factor));
        const coverHeight = Math.max(height, Math.ceil(imageHeight * factor));
        try {
            const pixbuf = await this._decode(path, coverWidth, coverHeight, false);
            const cropped = pixbuf.new_subpixbuf(
                Math.floor((coverWidth - width) / 2), Math.floor((coverHeight - height) / 2), width, height);
            this._background.set_content(this._contentFor(cropped));
        } catch (e) {
            this._reportLoadError(path, e);
        }
    }

    _setFocus(index) {
        index = clamp(index, 0, this._cards.length - 1);
        if (index === this._focusIndex)
            return;
        this._focusIndex = index;
        this._updateLayout(true);
    }

    // Visible card under a stage point, using the layout that is drawn; -1 off
    // the cards.
    _indexAt(stageX, stageY) {
        const x = stageX - this._monitor.x;
        const y = stageY - this._monitor.y - this._monitor.height / 2;
        return this._layout().findIndex(({center, scale, visible}) =>
            visible && Math.abs(y) <= this._cardHeight * scale / 2 &&
            Math.abs(x - center) <= this._cardWidth * scale / 2 + GAP / 2);
    }

    // Pointing at a side card focuses it once; the pointer must move to another
    // slot before it moves the row again, so the row does not run away under it.
    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        if (Math.hypot(x - this._pointer.x, y - this._pointer.y) < POINTER_THRESHOLD)
            return Clutter.EVENT_STOP;
        this._pointer = {x, y};
        let index = this._indexAt(x, y);
        if (index === this._hoverIndex)
            return Clutter.EVENT_STOP;
        if (index >= 0) {
            this._setFocus(index);
            // The row has moved: remember the card that lands under the pointer.
            index = this._indexAt(x, y);
        }
        this._hoverIndex = index;
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const index = this._indexAt(...event.get_coords());
        if (index < 0) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        this._select(this._cards[index]);
        return Clutter.EVENT_STOP;
    }

    vfunc_scroll_event(event) {
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            this._setFocus(this._focusIndex - 1);
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            this._setFocus(this._focusIndex + 1);
            break;
        }
        return Clutter.EVENT_STOP;
    }

    vfunc_key_press_event(event) {
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Escape:
            this.close();
            break;
        case Clutter.KEY_Left:
        case Clutter.KEY_h:
            this._setFocus(this._focusIndex - 1);
            break;
        case Clutter.KEY_Right:
        case Clutter.KEY_l:
            this._setFocus(this._focusIndex + 1);
            break;
        case Clutter.KEY_Home:
            this._setFocus(0);
            break;
        case Clutter.KEY_End:
            this._setFocus(this._cards.length - 1);
            break;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            this._select(this._cards[this._focusIndex]);
            break;
        }
        return Clutter.EVENT_STOP;
    }
});
