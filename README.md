# Fedora Audio Mixer

Fedora Audio Mixer is a small Linux audio mixer for Fedora GNOME desktops. It gives you a full desktop mixer window and a GNOME Quick Settings tile from one installer.

It is built for Fedora systems using PipeWire through PulseAudio compatibility.

## Features

- Master output volume and mute
- Active program volume and mute
- GNOME Quick Settings **Mixer** tile
- Full GTK mixer app for a larger view
- One install script for both interfaces
- One uninstall script to remove everything it installs

Programs appear when they have an active audio stream. That is how GNOME, PipeWire, and PulseAudio expose per-program volume.

## Screenshots

![Fedora Audio Mixer desktop app](screenshots/desktop-app.webp)

![Fedora Audio Mixer Quick Settings tile](screenshots/quick-settings.webp)

## Requirements

- Fedora GNOME
- GNOME Shell 50
- PipeWire with PulseAudio compatibility
- `pactl`
- Python 3 with GTK 4 and PyGObject
- `gnome-extensions`

These are present on the Fedora system this project was built on.

## Install

```bash
./install.sh
```

The installer adds:

- A **Fedora Audio Mixer** launcher to the app grid and dock search
- A `fedora-audio-mixer` command in `~/.local/bin`
- A `fedora-audio-mixer@local` GNOME Shell extension
- A **Mixer** tile in GNOME Quick Settings

On Wayland, log out and back in once if the Quick Settings tile does not appear immediately.

## Use

Open **Fedora Audio Mixer** from the app grid, or open GNOME Quick Settings and use the **Mixer** tile.

You can also run the app directly from this folder:

```bash
./run-app.sh
```

## Package

Create a single zip download:

```bash
./make-download.sh
```

The output is `fedora-audio-mixer.zip` next to this folder.

Regenerate the README screenshots:

```bash
python3 tools/render_screenshots.py
```

## Uninstall

```bash
./uninstall.sh
```

This removes the app launcher, command, icon, installed app files, and GNOME Shell extension.

## Project Layout

```text
app/          GTK desktop mixer
extension/    GNOME Shell Quick Settings tile
install.sh    Installs both interfaces
uninstall.sh  Removes both interfaces
run-app.sh    Runs the desktop app from source
```

## Notes

The desktop app and shell extension are bundled together as one project, but GNOME installs them through different mechanisms. The installer handles both so users only need one download.

No license has been selected yet.
