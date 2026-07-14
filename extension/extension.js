import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

const APP_DESKTOP_ID = 'dev.local.FedoraAudioMixer.desktop';
const MAX_AMPLIFIED_FALLBACK = 1.5;
const MAX_PERCENT = 150;
const PRESET_DIR = `${GLib.get_user_config_dir()}/fedora-audio-mixer`;
const PRESET_PATH = `${PRESET_DIR}/volume-presets.json`;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function disconnectSignals(object, ids) {
    for (const id of ids) {
        try {
            object.disconnect(id);
        } catch (_error) {
        }
    }
}

function streamName(stream) {
    const appInfo = appInfoForStream(stream);
    const description = stream.get_description?.();
    const name = stream.get_name?.();
    const appId = stream.get_application_id?.();

    if (appInfo)
        return appInfo.get_name();

    if (description)
        return description;

    if (name)
        return name;

    if (appId)
        return appId.split('.').at(-1);

    return `Stream ${stream.get_id?.() ?? ''}`.trim();
}

function streamIconName(stream) {
    return stream.get_icon_name?.() || 'audio-volume-high-symbolic';
}

function appInfoForStream(stream) {
    const appId = stream.get_application_id?.();
    if (!appId)
        return null;

    const appSystem = Shell.AppSystem.get_default();
    return appSystem.lookup_app(appId) ??
        appSystem.lookup_app(`${appId}.desktop`);
}

function normalizeProgramKey(value) {
    if (!value)
        return null;

    let text = String(value).trim().toLowerCase();
    if (!text)
        return null;

    text = text.split('/').at(-1);
    if (text.endsWith('.desktop'))
        text = text.slice(0, -'.desktop'.length);

    text = text.replace(/[^a-z0-9]+/g, '');
    return text || null;
}

function addProgramKeys(keys, value) {
    if (!value)
        return;

    const normalized = normalizeProgramKey(value);
    if (normalized)
        keys.add(normalized);

    for (const part of String(value).split(/[.\-_\s/]+/)) {
        const partKey = normalizeProgramKey(part);
        if (partKey && partKey.length > 2)
            keys.add(partKey);
    }
}

function appKeys(app) {
    const keys = new Set();
    addProgramKeys(keys, app.get_id?.());
    addProgramKeys(keys, app.get_name?.());
    addProgramKeys(keys, app.get_app_info?.()?.get_executable?.());
    return keys;
}

function streamKeys(stream) {
    const keys = new Set();
    const app = appInfoForStream(stream);
    if (app) {
        for (const key of appKeys(app))
            keys.add(key);
    }

    addProgramKeys(keys, stream.get_application_id?.());
    addProgramKeys(keys, stream.get_name?.());
    addProgramKeys(keys, stream.get_description?.());
    return keys;
}

function appPresetKey(app) {
    return normalizeProgramKey(app?.get_name?.()) ??
        normalizeProgramKey(app?.get_id?.());
}

function streamPresetKey(stream) {
    const app = appInfoForStream(stream);
    if (app)
        return appPresetKey(app);

    return [...streamKeys(stream)][0] ?? null;
}

function streamFlag(stream, name) {
    const value = stream[name];

    if (typeof value === 'function')
        return value.call(stream);

    return Boolean(value);
}

class VolumePresetStore {
    constructor() {
        this._presets = {};
        this._saveId = 0;
        this.reload();
    }

    reload() {
        this.flush();

        if (!GLib.file_test(PRESET_PATH, GLib.FileTest.EXISTS)) {
            this._presets = {};
            return;
        }

        try {
            const [ok, contents] = GLib.file_get_contents(PRESET_PATH);
            if (!ok)
                return;

            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return;

            const presets = {};
            for (const [key, value] of Object.entries(parsed)) {
                const volume = Number(value?.volume);
                if (!key || !Number.isFinite(volume))
                    continue;
                presets[key] = {
                    volume: clamp(volume, 0, MAX_PERCENT),
                    muted: Boolean(value?.muted),
                };
            }
            this._presets = presets;
        } catch (error) {
            console.error(`Failed to read Fedora Audio Mixer presets: ${error}`);
        }
    }

    get(key) {
        const preset = key ? this._presets[key] : null;
        return preset
            ? {...preset}
            : {volume: 100, muted: false};
    }

    find(keys) {
        for (const key of keys) {
            if (this._presets[key])
                return {key, preset: this.get(key)};
        }
        return null;
    }

    set(key, volume, muted) {
        if (!key)
            return;

        this._presets[key] = {
            volume: clamp(Number(volume) || 0, 0, MAX_PERCENT),
            muted: Boolean(muted),
        };

        if (this._saveId)
            return;

        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._saveId = 0;
            this._save();
            return GLib.SOURCE_REMOVE;
        });
    }

    flush() {
        if (!this._saveId)
            return;

        GLib.source_remove(this._saveId);
        this._saveId = 0;
        this._save();
    }

    _save() {
        try {
            GLib.mkdir_with_parents(PRESET_DIR, 0o700);
            GLib.file_set_contents(PRESET_PATH, JSON.stringify(this._presets, null, 2));
        } catch (error) {
            console.error(`Failed to save Fedora Audio Mixer presets: ${error}`);
        }
    }

    destroy() {
        this.flush();
        this._presets = {};
    }
}

const VolumeSliderItem = GObject.registerClass(
class VolumeSliderItem extends GObject.Object {
    _init(stream, control, options = {}) {
        super._init();

        this._stream = stream;
        this._control = control;
        this._isMaster = options.isMaster ?? false;
        this._presetStore = options.presetStore ?? null;
        this._presetKey = options.presetKey ?? null;
        this._signalIds = [];
        this._updating = false;
        this._editingPercent = false;
        this._normalVolume = Math.max(this._control.get_vol_max_norm?.() || 65536, 1);
        this._maxVolume = Math.max(
            this._control.get_vol_max_amplified?.() || 0,
            Math.round(this._normalVolume * MAX_AMPLIFIED_FALLBACK),
            this._stream.get_volume?.() || 0,
            this._normalVolume
        );

        this._headerItem = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
        });
        this._headerItem.add_style_class_name('fedora-audio-mixer-item');

        const header = new St.BoxLayout({
            style_class: 'fedora-audio-mixer-header',
            x_expand: true,
        });
        this._headerItem.add_child(header);

        this._icon = new St.Icon({
            icon_name: options.iconName || streamIconName(stream),
            style_class: 'popup-menu-icon',
        });
        header.add_child(this._icon);

        this._titleLabel = new St.Label({
            text: options.title || streamName(stream),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(this._titleLabel);

        this._percentEntry = new St.Entry({
            style_class: 'fedora-audio-mixer-percent-entry',
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._percentEntry.clutter_text.set_single_line_mode(true);
        this._percentEntry.clutter_text.connect('key-focus-in', () => {
            this._editingPercent = true;
            this._percentEntry.clutter_text.set_selection(0, -1);
        });
        this._percentEntry.clutter_text.connect('button-release-event', () => {
            this._percentEntry.clutter_text.set_selection(0, -1);
            return Clutter.EVENT_PROPAGATE;
        });
        this._percentEntry.clutter_text.connect('activate', () => {
            this._commitPercent();
            global.stage.set_key_focus(null);
        });
        this._percentEntry.clutter_text.connect('key-focus-out', () => {
            this._commitPercent();
        });
        this._percentEntry.clutter_text.connect('key-press-event', (_text, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;

            this._editingPercent = false;
            this._updatePercent();
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        });
        header.add_child(this._percentEntry);

        this._muteIcon = new St.Icon({
            icon_name: 'audio-volume-high-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._muteButton = new St.Button({
            child: this._muteIcon,
            can_focus: true,
            reactive: true,
            track_hover: true,
            style_class: 'button fedora-audio-mixer-mute-button',
        });
        header.add_child(this._muteButton);

        this._muteButton.connect('clicked', () => {
            const muted = !this._stream.get_is_muted();
            this._stream.change_is_muted(muted);
            this._savePreset(this._stream.get_volume(), muted);
        });

        this._sliderItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._sliderItem.add_style_class_name('fedora-audio-mixer-slider-item');

        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        this._slider.connect('notify::value', () => {
            this._sliderChanged(this._slider.value);
        });

        const sliderBin = new St.Bin({
            style_class: 'slider-bin',
            child: this._slider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._sliderItem.add_child(sliderBin);

        const sliderAccessible = this._slider.get_accessible();
        sliderAccessible.set_parent(sliderBin.get_parent().get_accessible());
        sliderBin.set_accessible(sliderAccessible);
        sliderBin.connect('event', (_bin, event) => this._slider.event(event, false));

        for (const signal of ['notify::volume', 'notify::is-muted'])
            this._signalIds.push(this._stream.connect(signal, () => this.sync()));

        this.sync();
    }

    addToMenu(menu) {
        menu.addMenuItem(this._headerItem);
        menu.addMenuItem(this._sliderItem);
    }

    sync() {
        this._updating = true;
        try {
            const volume = this._stream.get_volume();
            const muted = this._stream.get_is_muted();
            this._maxVolume = Math.max(this._maxVolume, volume, this._normalVolume);
            this._setSliderValue(clamp(volume / this._maxVolume, 0, 1));
            this._muteIcon.icon_name = muted
                ? 'audio-volume-muted-symbolic'
                : streamIconName(this._stream);
            this._updatePercent();
        } finally {
            this._updating = false;
        }
    }

    _sliderChanged(value) {
        if (this._updating)
            return;

        const volume = Math.round(value * this._maxVolume);
        this._stream.set_volume(volume);
        this._stream.push_volume();
        this._savePreset(volume, this._stream.get_is_muted());
        this._updatePercent();
    }

    _setSliderValue(value) {
        this._slider.value = value;
    }

    _commitPercent() {
        if (!this._editingPercent)
            return;

        const text = this._percentEntry.get_text().trim().replaceAll('%', '');
        const requestedPercent = Number(text);
        this._editingPercent = false;

        if (!Number.isFinite(requestedPercent)) {
            this._updatePercent();
            return;
        }

        const maxPercent = this._maxVolume / this._normalVolume * 100;
        const percent = clamp(requestedPercent, 0, maxPercent);
        const volume = Math.round(percent / 100 * this._normalVolume);
        this._stream.set_volume(volume);
        this._stream.push_volume();
        this._savePreset(volume, this._stream.get_is_muted());
        this._updatePercent();
    }

    _savePreset(volume, muted) {
        if (!this._presetStore || !this._presetKey)
            return;

        const percent = volume / this._normalVolume * 100;
        this._presetStore.set(this._presetKey, percent, muted);
    }

    _updatePercent() {
        if (this._editingPercent)
            return;

        const percent = Math.round(this._stream.get_volume() / this._normalVolume * 100);
        this._percentEntry.set_text(`${percent}%`);
    }

    destroy() {
        disconnectSignals(this._stream, this._signalIds);
        this._signalIds = [];
        this._headerItem.destroy();
        this._sliderItem.destroy();
    }
});

const WaitingAppItem = GObject.registerClass(
class WaitingAppItem extends GObject.Object {
    _init(app, presetStore) {
        super._init();

        this._presetStore = presetStore;
        this._presetKey = appPresetKey(app);
        const preset = this._presetStore.get(this._presetKey);
        this._volume = preset.volume;
        this._muted = preset.muted;
        this._updating = false;
        this._editingPercent = false;

        this._headerItem = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
        });
        this._headerItem.add_style_class_name('fedora-audio-mixer-item');
        this._headerItem.add_style_class_name('fedora-audio-mixer-waiting-item');

        const row = new St.BoxLayout({
            style_class: 'fedora-audio-mixer-header',
            x_expand: true,
        });
        this._headerItem.add_child(row);

        let icon = null;
        if (typeof app.create_icon_texture === 'function')
            icon = app.create_icon_texture(16);
        if (!icon) {
            icon = new St.Icon({
                icon_name: 'application-x-executable-symbolic',
                style_class: 'popup-menu-icon',
            });
        }
        icon.add_style_class_name?.('popup-menu-icon');
        row.add_child(icon);

        const labelBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        row.add_child(labelBox);

        this._titleLabel = new St.Label({
            text: app.get_name?.() || 'Open program',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        labelBox.add_child(this._titleLabel);

        this._detailLabel = new St.Label({
            text: 'Open, applies when audio starts',
            style_class: 'fedora-audio-mixer-waiting-detail',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._detailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        labelBox.add_child(this._detailLabel);

        this._percentEntry = new St.Entry({
            style_class: 'fedora-audio-mixer-percent-entry',
            can_focus: true,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._percentEntry.clutter_text.set_single_line_mode(true);
        this._percentEntry.clutter_text.connect('key-focus-in', () => {
            this._editingPercent = true;
            this._percentEntry.clutter_text.set_selection(0, -1);
        });
        this._percentEntry.clutter_text.connect('button-release-event', () => {
            this._percentEntry.clutter_text.set_selection(0, -1);
            return Clutter.EVENT_PROPAGATE;
        });
        this._percentEntry.clutter_text.connect('activate', () => {
            this._commitPercent();
            global.stage.set_key_focus(null);
        });
        this._percentEntry.clutter_text.connect('key-focus-out', () => {
            this._commitPercent();
        });
        this._percentEntry.clutter_text.connect('key-press-event', (_text, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;

            this._editingPercent = false;
            this._updatePercent();
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        });
        row.add_child(this._percentEntry);

        this._muteIcon = new St.Icon({
            icon_name: 'audio-volume-high-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._muteButton = new St.Button({
            child: this._muteIcon,
            can_focus: true,
            reactive: true,
            track_hover: true,
            style_class: 'button fedora-audio-mixer-mute-button',
        });
        this._muteButton.connect('clicked', () => {
            this._muted = !this._muted;
            this._savePreset();
            this._syncMuteIcon();
        });
        row.add_child(this._muteButton);

        this._sliderItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._sliderItem.add_style_class_name('fedora-audio-mixer-slider-item');

        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        this._slider.connect('notify::value', () => {
            if (this._updating)
                return;

            this._volume = this._slider.value * MAX_PERCENT;
            this._savePreset();
            this._updatePercent();
        });

        const sliderBin = new St.Bin({
            style_class: 'slider-bin',
            child: this._slider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._sliderItem.add_child(sliderBin);

        const sliderAccessible = this._slider.get_accessible();
        sliderAccessible.set_parent(sliderBin.get_parent().get_accessible());
        sliderBin.set_accessible(sliderAccessible);
        sliderBin.connect('event', (_bin, event) => this._slider.event(event, false));

        this._sync();
    }

    addToMenu(menu) {
        menu.addMenuItem(this._headerItem);
        menu.addMenuItem(this._sliderItem);
    }

    _sync() {
        this._updating = true;
        try {
            this._slider.value = clamp(this._volume / MAX_PERCENT, 0, 1);
            this._syncMuteIcon();
            this._updatePercent();
        } finally {
            this._updating = false;
        }
    }

    _commitPercent() {
        if (!this._editingPercent)
            return;

        const text = this._percentEntry.get_text().trim().replaceAll('%', '');
        const requestedPercent = Number(text);
        this._editingPercent = false;

        if (!Number.isFinite(requestedPercent)) {
            this._updatePercent();
            return;
        }

        this._volume = clamp(requestedPercent, 0, MAX_PERCENT);
        this._savePreset();
        this._sync();
    }

    _savePreset() {
        this._presetStore.set(this._presetKey, this._volume, this._muted);
    }

    _syncMuteIcon() {
        this._muteIcon.icon_name = this._muted
            ? 'audio-volume-muted-symbolic'
            : 'audio-volume-high-symbolic';
    }

    _updatePercent() {
        if (this._editingPercent)
            return;

        this._percentEntry.set_text(`${Math.round(this._volume)}%`);
    }

    destroy() {
        this._headerItem.destroy();
        this._sliderItem.destroy();
    }
});

const MixerMenuToggle = GObject.registerClass(
class MixerMenuToggle extends QuickSettings.QuickMenuToggle {
    _init() {
        super._init({
            title: 'Mixer',
            iconName: 'audio-volume-high-symbolic',
            toggleMode: false,
        });

        this._control = new Gvc.MixerControl({name: 'Fedora Audio Mixer'});
        this._appSystem = Shell.AppSystem.get_default();
        this._presetStore = new VolumePresetStore();
        this._presetAppliedStreamIds = new Set();
        this._controlSignals = [];
        this._appSystemSignals = [];
        this._menuSignals = [];
        this._items = [];
        this._ready = false;

        this.menu.setHeader('audio-volume-high-symbolic', 'Audio Mixer', 'Master and programs');

        for (const signal of [
            'state-changed',
            'stream-added',
            'stream-removed',
            'default-sink-changed',
        ]) {
            this._controlSignals.push(this._control.connect(signal, () => this.refresh()));
        }

        try {
            this._appSystemSignals.push(this._appSystem.connect('app-state-changed', () => {
                this.refresh();
            }));
        } catch (_error) {
        }

        try {
            this._menuSignals.push(this.menu.connect('open-state-changed', (_menu, open) => {
                if (open)
                    this.refresh();
            }));
        } catch (_error) {
        }

        this._control.open();
        this.refresh();
    }

    refresh() {
        this._presetStore.reload();
        const state = this._control.get_state();
        this._ready = state === Gvc.MixerControlState.READY;

        this._clearMenu();

        if (!this._ready) {
            this.subtitle = 'Connecting...';
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Connecting to audio...', {
                reactive: false,
            }));
            return;
        }

        const sink = this._control.get_default_sink();
        if (sink) {
            this._addTrackedItem(new VolumeSliderItem(sink, this._control, {
                title: 'Master',
                iconName: 'audio-volume-high-symbolic',
                isMaster: true,
            }));
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        const streams = this._getProgramStreams();
        this._applyPresetsToNewStreams(streams);
        const waitingApps = this._getWaitingApps(streams);
        const programCount = streams.length + waitingApps.length;

        this.subtitle = programCount === 1
            ? '1 program'
            : `${programCount} programs`;

        if (programCount === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('No open programs', {
                reactive: false,
            }));
        } else {
            for (const stream of streams) {
                const match = this._presetStore.find(streamKeys(stream));
                this._addTrackedItem(new VolumeSliderItem(stream, this._control, {
                    presetStore: this._presetStore,
                    presetKey: match?.key ?? streamPresetKey(stream),
                }));
            }
            for (const app of waitingApps)
                this._addTrackedItem(new WaitingAppItem(app, this._presetStore));
        }

        this._addFullMixerShortcut();
    }

    _getProgramStreams() {
        return (this._control.get_sink_inputs() ?? [])
            .filter(stream => !streamFlag(stream, 'is_event_stream'))
            .filter(stream => !streamFlag(stream, 'is_virtual'))
            .sort((a, b) => streamName(a).localeCompare(streamName(b)));
    }

    _getWaitingApps(streams) {
        const activeKeys = new Set();
        for (const stream of streams) {
            for (const key of streamKeys(stream))
                activeKeys.add(key);
        }

        const runningApps = this._appSystem.get_running?.() ?? [];
        return runningApps
            .filter(app => app.get_id?.() !== APP_DESKTOP_ID)
            .filter(app => {
                for (const key of appKeys(app)) {
                    if (activeKeys.has(key))
                        return false;
                }
                return true;
            })
            .sort((a, b) => (a.get_name?.() || '').localeCompare(b.get_name?.() || ''));
    }

    _applyPresetsToNewStreams(streams) {
        const currentIds = new Set(streams.map(stream => stream.get_id()));
        for (const id of this._presetAppliedStreamIds) {
            if (!currentIds.has(id))
                this._presetAppliedStreamIds.delete(id);
        }

        const normalVolume = Math.max(this._control.get_vol_max_norm?.() || 65536, 1);
        const maxVolume = Math.max(
            this._control.get_vol_max_amplified?.() || 0,
            Math.round(normalVolume * MAX_AMPLIFIED_FALLBACK),
            normalVolume
        );
        const maxPercent = maxVolume / normalVolume * 100;

        for (const stream of streams) {
            const id = stream.get_id();
            if (this._presetAppliedStreamIds.has(id))
                continue;

            const match = this._presetStore.find(streamKeys(stream));
            if (match) {
                const percent = clamp(match.preset.volume, 0, maxPercent);
                stream.set_volume(Math.round(percent / 100 * normalVolume));
                stream.change_is_muted(match.preset.muted);
                stream.push_volume();
            }
            this._presetAppliedStreamIds.add(id);
        }
    }

    _addTrackedItem(item) {
        this._items.push(item);
        item.addToMenu(this.menu);
    }

    _addFullMixerShortcut() {
        const desktopInfo = GioUnix.DesktopAppInfo.new(APP_DESKTOP_ID);
        if (!desktopInfo)
            return;

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const item = new PopupMenu.PopupMenuItem('Open full mixer');
        item.connect('activate', () => {
            desktopInfo.launch([], null);
        });
        this.menu.addMenuItem(item);
    }

    _clearMenu() {
        for (const item of this._items)
            item.destroy();
        this._items = [];
        this.menu.removeAll();
        this.menu.setHeader('audio-volume-high-symbolic', 'Audio Mixer', 'Master and programs');
    }

    destroy() {
        disconnectSignals(this._control, this._controlSignals);
        disconnectSignals(this._appSystem, this._appSystemSignals);
        disconnectSignals(this.menu, this._menuSignals);
        this._controlSignals = [];
        this._appSystemSignals = [];
        this._menuSignals = [];
        this._clearMenu();
        this._presetStore.destroy();
        this._presetAppliedStreamIds.clear();
        this._control.close();
        this._control = null;
        this._appSystem = null;
        this._presetStore = null;
        super.destroy();
    }
});

const MixerIndicator = GObject.registerClass(
class MixerIndicator extends QuickSettings.SystemIndicator {
    _init() {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'audio-volume-high-symbolic';
        this._indicator.visible = true;

        this.quickSettingsItems.push(new MixerMenuToggle());
    }

    destroy() {
        for (const item of this.quickSettingsItems)
            item.destroy();
        this.quickSettingsItems = [];

        super.destroy();
    }
});

export default class FedoraAudioMixerExtension extends Extension {
    enable() {
        this._indicator = new MixerIndicator();

        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings.addExternalIndicator) {
            quickSettings.addExternalIndicator(this._indicator);
        } else {
            quickSettings._indicators.add_child(this._indicator);
            quickSettings._addItems(this._indicator.quickSettingsItems);
        }
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
