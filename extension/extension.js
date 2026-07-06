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

function streamFlag(stream, name) {
    const value = stream[name];

    if (typeof value === 'function')
        return value.call(stream);

    return Boolean(value);
}

const VolumeSliderItem = GObject.registerClass(
class VolumeSliderItem extends PopupMenu.PopupBaseMenuItem {
    _init(stream, control, options = {}) {
        super._init({
            activate: false,
            can_focus: false,
        });

        this._stream = stream;
        this._control = control;
        this._isMaster = options.isMaster ?? false;
        this._signalIds = [];
        this._updating = false;
        this._sliderDragging = false;
        this._stageDragSignalId = 0;
        this._normalVolume = Math.max(this._control.get_vol_max_norm?.() || 65536, 1);
        this._maxVolume = Math.max(
            this._control.get_vol_max_amplified?.() || 0,
            Math.round(this._normalVolume * MAX_AMPLIFIED_FALLBACK),
            this._stream.get_volume?.() || 0,
            this._normalVolume
        );

        this.add_style_class_name('fedora-audio-mixer-item');

        const row = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this.add_child(row);

        const header = new St.BoxLayout({
            style_class: 'fedora-audio-mixer-header',
            x_expand: true,
        });
        row.add_child(header);

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

        const controls = new St.BoxLayout({
            style_class: 'fedora-audio-mixer-controls',
            x_expand: true,
        });
        row.add_child(controls);

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
        controls.add_child(this._muteButton);

        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        controls.add_child(this._slider);

        this._muteButton.connect('clicked', () => {
            this._stream.change_is_muted(!this._stream.get_is_muted());
        });

        this._slider.connect('notify::value', () => {
            if (this._updating)
                return;

            const volume = Math.round(this._slider.value * this._maxVolume);
            this._stream.set_volume(volume);
            this._stream.push_volume();
            this._updatePercent();
        });

        this._slider.connect('button-press-event', (_actor, event) =>
            this._startSliderDrag(event));
        this._slider.connect('touch-event', (_actor, event) =>
            this._handleSliderTouchEvent(event));

        for (const signal of ['notify::volume', 'notify::is-muted'])
            this._signalIds.push(this._stream.connect(signal, () => this.sync()));

        this.sync();
    }

    sync() {
        if (this._sliderDragging)
            return;

        this._updating = true;
        try {
            const volume = this._stream.get_volume();
            const muted = this._stream.get_is_muted();
            this._maxVolume = Math.max(this._maxVolume, volume, this._normalVolume);
            this._slider.value = clamp(volume / this._maxVolume, 0, 1);
            this._muteIcon.icon_name = muted
                ? 'audio-volume-muted-symbolic'
                : streamIconName(this._stream);
            this._updatePercent();
        } finally {
            this._updating = false;
        }
    }

    _updatePercent() {
        const percent = Math.round(this._stream.get_volume() / this._normalVolume * 100);
        this._percentLabel.text = `${percent}%`;
    }

    _startSliderDrag(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        this._sliderDragging = true;
        this._connectStageDrag();
        this._setSliderFromEvent(event);
        return Clutter.EVENT_STOP;
    }

    _handleSliderTouchEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.TOUCH_BEGIN:
            this._sliderDragging = true;
            this._connectStageDrag();
            this._setSliderFromEvent(event);
            return Clutter.EVENT_STOP;

        default:
            return this._handleStageDragEvent(event);
        }
    }

    _connectStageDrag() {
        if (this._stageDragSignalId)
            return;

        this._stageDragSignalId = global.stage.connect('captured-event', (_stage, event) =>
            this._handleStageDragEvent(event));
    }

    _handleStageDragEvent(event) {
        if (!this._sliderDragging)
            return Clutter.EVENT_PROPAGATE;

        switch (event.type()) {
        case Clutter.EventType.MOTION:
        case Clutter.EventType.TOUCH_UPDATE:
            this._setSliderFromEvent(event);
            return Clutter.EVENT_STOP;

        case Clutter.EventType.BUTTON_RELEASE:
            this._setSliderFromEvent(event);
            this._stopSliderDrag();
            return Clutter.EVENT_STOP;

        case Clutter.EventType.TOUCH_END:
        case Clutter.EventType.TOUCH_CANCEL:
            this._setSliderFromEvent(event);
            this._stopSliderDrag();
            return Clutter.EVENT_STOP;

        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _setSliderFromEvent(event) {
        const [stageX, stageY] = event.get_coords();
        const [success, sliderX] = this._slider.transform_stage_point(stageX, stageY);

        if (!success || this._slider.width <= 0)
            return;

        let value = clamp(sliderX / this._slider.width, 0, 1);
        if (this._slider.get_text_direction() === Clutter.TextDirection.RTL)
            value = 1 - value;

        this._slider.value = value;
    }

    _stopSliderDrag(sync = true) {
        const wasDragging = this._sliderDragging;
        this._sliderDragging = false;

        if (this._stageDragSignalId) {
            global.stage.disconnect(this._stageDragSignalId);
            this._stageDragSignalId = 0;
        }

        if (wasDragging && sync)
            this.sync();
    }

    destroy() {
        this._stopSliderDrag(false);
        disconnectSignals(this._stream, this._signalIds);
        this._signalIds = [];
        super.destroy();
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
        this._controlSignals = [];
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
        this.subtitle = streams.length === 1
            ? '1 program'
            : `${streams.length} programs`;

        if (streams.length === 0) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('No active program audio', {
                reactive: false,
            }));
        } else {
            for (const stream of streams)
                this._addTrackedItem(new VolumeSliderItem(stream, this._control));
        }

        this._addFullMixerShortcut();
    }

    _getProgramStreams() {
        return (this._control.get_sink_inputs() ?? [])
            .filter(stream => !streamFlag(stream, 'is_event_stream'))
            .filter(stream => !streamFlag(stream, 'is_virtual'))
            .sort((a, b) => streamName(a).localeCompare(streamName(b)));
    }

    _addTrackedItem(item) {
        this._items.push(item);
        this.menu.addMenuItem(item);
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
        this._items = [];
        this.menu.removeAll();
        this.menu.setHeader('audio-volume-high-symbolic', 'Audio Mixer', 'Master and programs');
    }

    destroy() {
        disconnectSignals(this._control, this._controlSignals);
        this._controlSignals = [];
        this._clearMenu();
        this._control.close();
        this._control = null;
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
