import Clutter from 'gi://Clutter';
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

function streamFlag(stream, name) {
    const value = stream[name];

    if (typeof value === 'function')
        return value.call(stream);

    return Boolean(value);
}

const VolumeSliderItem = GObject.registerClass(
class VolumeSliderItem extends GObject.Object {
    _init(stream, control, options = {}) {
        super._init();

        this._stream = stream;
        this._control = control;
        this._isMaster = options.isMaster ?? false;
        this._signalIds = [];
        this._updating = false;
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

        this._percentLabel = new St.Label({
            style_class: 'fedora-audio-mixer-percent',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._percentLabel);

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
            this._stream.change_is_muted(!this._stream.get_is_muted());
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
        this._updatePercent();
    }

    _setSliderValue(value) {
        this._slider.value = value;
    }

    _updatePercent() {
        const percent = Math.round(this._stream.get_volume() / this._normalVolume * 100);
        this._percentLabel.text = `${percent}%`;
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
    _init(app) {
        super._init();

        this._item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._item.add_style_class_name('fedora-audio-mixer-item');
        this._item.add_style_class_name('fedora-audio-mixer-waiting-item');

        const row = new St.BoxLayout({
            style_class: 'fedora-audio-mixer-header',
            x_expand: true,
        });
        this._item.add_child(row);

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
            text: 'Open, waiting for audio',
            style_class: 'fedora-audio-mixer-waiting-detail',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._detailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        labelBox.add_child(this._detailLabel);

        this._statusLabel = new St.Label({
            text: 'Idle',
            style_class: 'fedora-audio-mixer-percent fedora-audio-mixer-waiting-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(this._statusLabel);
    }

    addToMenu(menu) {
        menu.addMenuItem(this._item);
    }

    destroy() {
        this._item.destroy();
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
            'stream-changed',
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
            for (const stream of streams)
                this._addTrackedItem(new VolumeSliderItem(stream, this._control));
            for (const app of waitingApps)
                this._addTrackedItem(new WaitingAppItem(app));
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
        this._control.close();
        this._control = null;
        this._appSystem = null;
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
