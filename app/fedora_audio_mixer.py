#!/usr/bin/env python3
"""A small GTK audio mixer for Fedora PipeWire/PulseAudio systems."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from typing import Callable

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, Gio, GLib, Gtk, Pango  # noqa: E402


MAX_VOLUME = 150
APP_ID = "dev.local.FedoraAudioMixer"
APP_NAME = "Fedora Audio Mixer"


CSS = """
window {
  background: #f5f6f2;
  color: #202124;
}

.app-root {
  padding: 18px;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
}

.volume-row {
  background: #ffffff;
  border: 1px solid #d8d9d5;
  border-radius: 8px;
  padding: 12px;
}

.row-title {
  font-weight: 700;
}

.subtle {
  color: #626863;
  font-size: 12px;
}

.percent-label {
  color: #404642;
  font-feature-settings: "tnum";
}

.empty-state {
  color: #626863;
  padding: 18px;
}
"""


@dataclass(frozen=True)
class Sink:
    index: int
    name: str
    description: str
    volume: float
    muted: bool
    state: str


@dataclass(frozen=True)
class Stream:
    index: int
    name: str
    detail: str
    volume: float
    muted: bool
    sink: int | None


@dataclass(frozen=True)
class AudioState:
    default_sink_name: str
    sinks: list[Sink]
    streams: list[Stream]


class PulseAudio:
    def __init__(self) -> None:
        self.pactl = shutil.which("pactl")
        if not self.pactl:
            raise RuntimeError("pactl was not found")

    def _run(self, *args: str) -> str:
        command = [self.pactl, *args]
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(message or f"pactl exited with {completed.returncode}")
        return completed.stdout

    def _json_list(self, item_type: str) -> list[dict]:
        output = self._run("--format=json", "list", item_type).strip()
        if not output:
            return []
        return json.loads(output)

    def get_default_sink_name(self) -> str:
        try:
            return self._run("get-default-sink").strip()
        except RuntimeError:
            info = self._run("info")
            for line in info.splitlines():
                if line.startswith("Default Sink:"):
                    return line.split(":", 1)[1].strip()
            return ""

    def load_state(self) -> AudioState:
        default_sink_name = self.get_default_sink_name()
        raw_sinks = self._json_list("sinks")
        raw_streams = self._json_list("sink-inputs")

        sinks = [
            Sink(
                index=int(item.get("index", -1)),
                name=str(item.get("name", "")),
                description=str(item.get("description") or item.get("name") or "Output"),
                volume=volume_percent(item),
                muted=bool(item.get("mute", False)),
                state=str(item.get("state", "")),
            )
            for item in raw_sinks
        ]

        streams = [
            Stream(
                index=int(item.get("index", -1)),
                name=stream_name(item),
                detail=stream_detail(item),
                volume=volume_percent(item),
                muted=bool(item.get("mute", False)),
                sink=stream_sink(item),
            )
            for item in raw_streams
        ]
        streams.sort(key=lambda stream: (stream.name.lower(), stream.index))

        return AudioState(
            default_sink_name=default_sink_name,
            sinks=sinks,
            streams=streams,
        )

    def set_default_sink(self, sink_name: str) -> None:
        self._run("set-default-sink", sink_name)

    def move_stream_to_sink(self, stream_index: int, sink_name: str) -> None:
        self._run("move-sink-input", str(stream_index), sink_name)

    def set_sink_volume(self, sink_name: str, percent: float) -> None:
        self._run("set-sink-volume", sink_name, percent_arg(percent))

    def set_sink_mute(self, sink_name: str, muted: bool) -> None:
        self._run("set-sink-mute", sink_name, "1" if muted else "0")

    def set_stream_volume(self, stream_index: int, percent: float) -> None:
        self._run("set-sink-input-volume", str(stream_index), percent_arg(percent))

    def set_stream_mute(self, stream_index: int, muted: bool) -> None:
        self._run("set-sink-input-mute", str(stream_index), "1" if muted else "0")


def percent_arg(value: float) -> str:
    bounded = max(0, min(MAX_VOLUME, int(round(value))))
    return f"{bounded}%"


def volume_percent(item: dict) -> float:
    channels = item.get("volume") or {}
    values: list[float] = []
    for channel in channels.values():
        raw = str(channel.get("value_percent", "")).strip()
        if raw.endswith("%"):
            raw = raw[:-1]
        try:
            values.append(float(raw))
        except ValueError:
            continue
    if values:
        return sum(values) / len(values)
    return 0.0


def stream_sink(item: dict) -> int | None:
    try:
        return int(item["sink"])
    except (KeyError, TypeError, ValueError):
        return None


def stream_name(item: dict) -> str:
    props = item.get("properties") or {}
    binary = props.get("application.process.binary")
    app_name = props.get("application.name")
    portal_id = props.get("pipewire.access.portal.app_id")

    if binary:
        return str(binary)
    if portal_id:
        return str(portal_id).split(".")[-1]
    if app_name:
        return str(app_name)
    return f"Stream {item.get('index', '')}".strip()


def stream_detail(item: dict) -> str:
    props = item.get("properties") or {}
    parts: list[str] = []
    for key in ("application.name", "media.name", "node.name"):
        value = props.get(key)
        if value and str(value) not in parts:
            parts.append(str(value))
    return " / ".join(parts[:2])


class VolumeRow(Gtk.Box):
    def __init__(
        self,
        title: str,
        detail: str,
        volume: float,
        muted: bool,
        on_volume: Callable[[float], None],
        on_mute: Callable[[bool], None],
    ) -> None:
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.add_css_class("volume-row")
        self.on_volume = on_volume
        self.on_mute = on_mute
        self._updating = False
        self._volume_source: int | None = None

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.append(header)

        label_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        label_box.set_hexpand(True)
        header.append(label_box)

        self.title_label = Gtk.Label(xalign=0)
        self.title_label.add_css_class("row-title")
        self.title_label.set_ellipsize(Pango.EllipsizeMode.END)
        label_box.append(self.title_label)

        self.detail_label = Gtk.Label(xalign=0)
        self.detail_label.add_css_class("subtle")
        self.detail_label.set_ellipsize(Pango.EllipsizeMode.END)
        label_box.append(self.detail_label)

        self.percent_label = Gtk.Label(xalign=1)
        self.percent_label.add_css_class("percent-label")
        self.percent_label.set_width_chars(5)
        header.append(self.percent_label)

        controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.append(controls)

        self.mute_button = Gtk.ToggleButton()
        self.mute_button.set_tooltip_text("Mute")
        controls.append(self.mute_button)

        self.scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, MAX_VOLUME, 1)
        self.scale.set_draw_value(False)
        self.scale.set_hexpand(True)
        self.scale.set_digits(0)
        controls.append(self.scale)

        self._mute_handler = self.mute_button.connect("toggled", self._mute_toggled)
        self._volume_handler = self.scale.connect("value-changed", self._volume_changed)
        self.update(title, detail, volume, muted)

    def update(self, title: str, detail: str, volume: float, muted: bool) -> None:
        self._updating = True
        try:
            self.title_label.set_label(title)
            self.detail_label.set_label(detail)
            self.detail_label.set_visible(bool(detail))
            self.scale.set_value(max(0, min(MAX_VOLUME, volume)))
            self.mute_button.set_active(muted)
            self._set_mute_icon(muted)
            self._set_percent(volume)
        finally:
            self._updating = False

    def _set_percent(self, volume: float) -> None:
        self.percent_label.set_label(f"{int(round(volume)):>3}%")

    def _set_mute_icon(self, muted: bool) -> None:
        icon = "audio-volume-muted-symbolic" if muted else "audio-volume-high-symbolic"
        self.mute_button.set_icon_name(icon)

    def _volume_changed(self, _scale: Gtk.Scale) -> None:
        volume = self.scale.get_value()
        self._set_percent(volume)
        if self._updating:
            return
        if self._volume_source is not None:
            GLib.source_remove(self._volume_source)
        self._volume_source = GLib.timeout_add(120, self._commit_volume)

    def _commit_volume(self) -> bool:
        self._volume_source = None
        self.on_volume(self.scale.get_value())
        return False

    def _mute_toggled(self, button: Gtk.ToggleButton) -> None:
        muted = button.get_active()
        self._set_mute_icon(muted)
        if not self._updating:
            self.on_mute(muted)


class MixerWindow(Gtk.ApplicationWindow):
    def __init__(self, app: Gtk.Application) -> None:
        super().__init__(application=app)
        self.audio = PulseAudio()
        self.last_state: AudioState | None = None
        self.refreshing = False
        self.master_row: VolumeRow | None = None
        self.stream_rows: dict[int, VolumeRow] = {}
        self.sink_names: list[str] = []

        self.set_title(APP_NAME)
        self.set_icon_name(APP_ID)
        self.set_default_size(520, 680)

        header = Gtk.HeaderBar()
        self.set_titlebar(header)

        refresh_button = Gtk.Button.new_from_icon_name("view-refresh-symbolic")
        refresh_button.set_tooltip_text("Refresh")
        refresh_button.connect("clicked", lambda _button: self.refresh())
        header.pack_end(refresh_button)

        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        root.add_css_class("app-root")
        self.set_child(root)

        output_title = Gtk.Label(label="Output", xalign=0)
        output_title.add_css_class("section-title")
        root.append(output_title)

        output_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        root.append(output_box)

        self.device_dropdown = Gtk.DropDown()
        self.device_dropdown.set_hexpand(True)
        output_box.append(self.device_dropdown)
        self._device_handler = self.device_dropdown.connect(
            "notify::selected", self._default_sink_changed
        )

        master_title = Gtk.Label(label="Master", xalign=0)
        master_title.add_css_class("section-title")
        root.append(master_title)

        self.master_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        root.append(self.master_box)

        apps_title = Gtk.Label(label="Programs", xalign=0)
        apps_title.add_css_class("section-title")
        root.append(apps_title)

        scroll = Gtk.ScrolledWindow()
        scroll.set_vexpand(True)
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        root.append(scroll)

        self.streams_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        scroll.set_child(self.streams_box)

        self.empty_label = Gtk.Label(label="No active program audio")
        self.empty_label.add_css_class("empty-state")
        self.streams_box.append(self.empty_label)

        self.status_label = Gtk.Label(xalign=0)
        self.status_label.add_css_class("subtle")
        root.append(self.status_label)

        self.refresh()
        GLib.timeout_add_seconds(2, self._refresh_tick)

    def _refresh_tick(self) -> bool:
        self.refresh()
        return True

    def refresh(self) -> None:
        if self.refreshing:
            return
        self.refreshing = True
        self.status_label.set_label("Refreshing audio streams...")
        thread = threading.Thread(target=self._load_state_thread, daemon=True)
        thread.start()

    def _load_state_thread(self) -> None:
        try:
            state = self.audio.load_state()
        except Exception as exc:  # pragma: no cover - displayed in UI
            GLib.idle_add(self._show_error, str(exc))
        else:
            GLib.idle_add(self._apply_state, state)

    def _show_error(self, message: str) -> bool:
        self.refreshing = False
        self.status_label.set_label(message)
        return False

    def _apply_state(self, state: AudioState) -> bool:
        self.refreshing = False
        self.last_state = state
        self._sync_outputs(state)
        self._sync_master(state)
        self._sync_streams(state)
        self.status_label.set_label("Connected to PipeWire")
        return False

    def _sync_outputs(self, state: AudioState) -> None:
        self.sink_names = [sink.name for sink in state.sinks]
        labels = []
        selected = 0
        for index, sink in enumerate(state.sinks):
            label = sink.description
            if sink.name == state.default_sink_name:
                selected = index
                label = f"{label} (default)"
            labels.append(label)

        self.device_dropdown.handler_block(self._device_handler)
        try:
            self.device_dropdown.set_model(Gtk.StringList.new(labels))
            if labels:
                self.device_dropdown.set_selected(selected)
                self.device_dropdown.set_sensitive(True)
            else:
                self.device_dropdown.set_selected(Gtk.INVALID_LIST_POSITION)
                self.device_dropdown.set_sensitive(False)
        finally:
            self.device_dropdown.handler_unblock(self._device_handler)

    def _sync_master(self, state: AudioState) -> None:
        sink = next(
            (item for item in state.sinks if item.name == state.default_sink_name),
            state.sinks[0] if state.sinks else None,
        )
        if sink is None:
            return

        if self.master_row is None:
            self.master_row = VolumeRow(
                sink.description,
                sink.state.title(),
                sink.volume,
                sink.muted,
                self._set_master_volume,
                self._set_master_mute,
            )
            self.master_box.append(self.master_row)
        else:
            self.master_row.update(sink.description, sink.state.title(), sink.volume, sink.muted)

    def _sync_streams(self, state: AudioState) -> None:
        active_indexes = {stream.index for stream in state.streams}
        for index in list(self.stream_rows):
            if index not in active_indexes:
                self.streams_box.remove(self.stream_rows[index])
                del self.stream_rows[index]

        self.empty_label.set_visible(not state.streams)

        for stream in state.streams:
            row = self.stream_rows.get(stream.index)
            if row is None:
                row = VolumeRow(
                    stream.name,
                    stream.detail,
                    stream.volume,
                    stream.muted,
                    lambda volume, stream_index=stream.index: self._set_stream_volume(
                        stream_index, volume
                    ),
                    lambda muted, stream_index=stream.index: self._set_stream_mute(
                        stream_index, muted
                    ),
                )
                self.stream_rows[stream.index] = row
                self.streams_box.append(row)
            else:
                row.update(stream.name, stream.detail, stream.volume, stream.muted)

    def _run_audio_command(
        self,
        command: Callable[[], None],
        *,
        refresh_after: bool = False,
    ) -> None:
        def worker() -> None:
            try:
                command()
            except Exception as exc:  # pragma: no cover - displayed in UI
                GLib.idle_add(self._show_error, str(exc))
            else:
                if refresh_after:
                    GLib.timeout_add(250, self._refresh_after_command)

        threading.Thread(target=worker, daemon=True).start()

    def _refresh_after_command(self) -> bool:
        self.refresh()
        return False

    def _default_sink_changed(self, dropdown: Gtk.DropDown, _param: object) -> None:
        selected = dropdown.get_selected()
        if selected == Gtk.INVALID_LIST_POSITION or selected >= len(self.sink_names):
            return
        sink_name = self.sink_names[selected]
        if self.last_state and sink_name == self.last_state.default_sink_name:
            return

        current_streams = list(self.last_state.streams) if self.last_state else []

        def command() -> None:
            self.audio.set_default_sink(sink_name)
            for stream in current_streams:
                self.audio.move_stream_to_sink(stream.index, sink_name)

        self._run_audio_command(command, refresh_after=True)

    def _set_master_volume(self, volume: float) -> None:
        target = self.last_state.default_sink_name if self.last_state else "@DEFAULT_SINK@"
        self._run_audio_command(lambda: self.audio.set_sink_volume(target, volume))

    def _set_master_mute(self, muted: bool) -> None:
        target = self.last_state.default_sink_name if self.last_state else "@DEFAULT_SINK@"
        self._run_audio_command(
            lambda: self.audio.set_sink_mute(target, muted),
            refresh_after=True,
        )

    def _set_stream_volume(self, stream_index: int, volume: float) -> None:
        self._run_audio_command(lambda: self.audio.set_stream_volume(stream_index, volume))

    def _set_stream_mute(self, stream_index: int, muted: bool) -> None:
        self._run_audio_command(
            lambda: self.audio.set_stream_mute(stream_index, muted),
            refresh_after=True,
        )


class AudioMixerApp(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS.encode("utf-8"))
        display = Gdk.Display.get_default()
        if display:
            Gtk.StyleContext.add_provider_for_display(
                display,
                provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
            )

    def do_activate(self) -> None:
        try:
            window = MixerWindow(self)
        except Exception as exc:
            show_startup_error(self, str(exc))
            return
        window.present()


def show_startup_error(app: Gtk.Application, message: str) -> None:
    window = Gtk.ApplicationWindow(application=app)
    window.set_title(APP_NAME)
    window.set_icon_name(APP_ID)
    window.set_default_size(420, 160)

    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
    box.add_css_class("app-root")
    window.set_child(box)

    title = Gtk.Label(label="Audio Mixer could not start", xalign=0)
    title.add_css_class("section-title")
    box.append(title)

    detail = Gtk.Label(label=message, xalign=0, wrap=True)
    detail.add_css_class("subtle")
    box.append(detail)

    window.present()


def print_check() -> int:
    audio = PulseAudio()
    state = audio.load_state()
    default_sink = next(
        (sink for sink in state.sinks if sink.name == state.default_sink_name),
        None,
    )
    output_name = default_sink.description if default_sink else state.default_sink_name
    print(f"Default output: {output_name}")
    print(f"Outputs: {len(state.sinks)}")
    print(f"Active program streams: {len(state.streams)}")
    for stream in state.streams:
        muted = " muted" if stream.muted else ""
        print(f"- {stream.name}: {int(round(stream.volume))}%{muted}")
    return 0


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return print_check()
    GLib.set_application_name(APP_NAME)
    GLib.set_prgname(APP_ID)
    app = AudioMixerApp()
    return app.run(argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
