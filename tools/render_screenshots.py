#!/usr/bin/env python3
"""Render polished README screenshots for Fedora Audio Mixer.

The screenshots are static product previews generated from local HTML/CSS.
They avoid depending on live GNOME Shell capture, which is restricted on
Wayland sessions.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "screenshots"


BASE_CSS = """
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Cantarell, "Noto Sans", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.icon {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #3584e4, #2ec27e);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28);
}
.icon::before,
.icon::after {
  content: "";
  position: absolute;
  left: 11px;
  right: 11px;
  height: 4px;
  border-radius: 999px;
  background: white;
}
.icon::before { top: 15px; }
.icon::after { top: 28px; }
.knob {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
}
.k1 { left: 24px; top: 12px; }
.k2 { left: 14px; top: 25px; }
.speaker-icon {
  position: relative;
  display: block;
  width: 18px;
  height: 16px;
  color: currentColor;
}
.speaker-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  top: 5px;
  width: 5px;
  height: 6px;
  border-radius: 1px;
  background: currentColor;
}
.speaker-icon::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 10px;
  height: 12px;
  background: currentColor;
  clip-path: polygon(0 36%, 72% 0, 72% 100%, 0 64%);
}
.speaker-icon span {
  position: absolute;
  right: 0;
  top: 4px;
  width: 6px;
  height: 8px;
  border: 2px solid currentColor;
  border-left: 0;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-radius: 0 12px 12px 0;
}
"""


APP_HTML = f"""
<!doctype html>
<meta charset="utf-8">
<style>
{BASE_CSS}
body {{
  width: 1440px;
  height: 940px;
  background:
    radial-gradient(circle at 15% 10%, rgba(53,132,228,.14), transparent 28%),
    linear-gradient(135deg, #f4f6f8, #e3e7eb);
  color: #202124;
  display: grid;
  place-items: center;
}}
.window {{
  width: 1120px;
  height: 830px;
  border: 1px solid #bfc6cc;
  border-radius: 20px;
  background: #fafafa;
  box-shadow: 0 26px 60px rgba(24, 28, 33, .18);
  overflow: hidden;
}}
.titlebar {{
  height: 74px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 30px;
  background: #eceff1;
  border-bottom: 1px solid #d9dde1;
}}
.titlebar h1 {{
  margin: 0;
  font-size: 23px;
  font-weight: 800;
  letter-spacing: 0;
}}
.refresh {{
  margin-left: auto;
  color: #5f666d;
  font-size: 15px;
}}
.content {{
  padding: 30px 44px;
}}
.section-title {{
  font-size: 18px;
  font-weight: 800;
  margin: 0 0 12px;
}}
.select {{
  height: 56px;
  border: 1px solid #d2d6d9;
  border-radius: 10px;
  background: white;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 17px;
  margin-bottom: 26px;
}}
.select span:last-child {{
  margin-left: auto;
  color: #6c7177;
}}
.row {{
  background: white;
  border: 1px solid #d6dade;
  border-radius: 10px;
  padding: 16px 20px 14px;
  margin-bottom: 12px;
  box-shadow: 0 1px 0 rgba(255,255,255,.7);
}}
.row-head {{
  display: flex;
  align-items: baseline;
  gap: 12px;
}}
.name {{
  font-size: 18px;
  font-weight: 800;
}}
.detail {{
  color: #687078;
  font-size: 14px;
  margin-top: 4px;
}}
.percent {{
  margin-left: auto;
  color: #384048;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}}
.controls {{
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
}}
.mute {{
  width: 36px;
  height: 32px;
  border: 1px solid #d8dcdf;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #5f666d;
  background: #f4f5f5;
  color: #5f666d;
}}
.slider {{
  position: relative;
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #d3d7dc;
}}
.fill {{
  height: 6px;
  border-radius: 999px;
  background: #3584e4;
}}
.thumb {{
  position: absolute;
  top: -8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f4f5f6;
  box-shadow: 0 1px 5px rgba(0,0,0,.18);
}}
.status {{
  margin-top: 18px;
  color: #687078;
  font-size: 14px;
}}
</style>
<main class="window">
  <header class="titlebar">
    <span class="icon"><span class="knob k1"></span><span class="knob k2"></span></span>
    <h1>Fedora Audio Mixer</h1>
    <div class="refresh">Refresh</div>
  </header>
  <section class="content">
    <h2 class="section-title">Output</h2>
    <div class="select"><span>Ryzen HD Audio Controller Analog Stereo (default)</span><span>⌄</span></div>

    <h2 class="section-title">Master</h2>
    <div class="row">
      <div class="row-head"><div><div class="name">Ryzen HD Audio Controller Analog Stereo</div><div class="detail">Running</div></div><div class="percent">51%</div></div>
      <div class="controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="slider"><div class="fill" style="width: 51%"></div><div class="thumb" style="left: calc(51% - 11px)"></div></div></div>
    </div>

    <h2 class="section-title" style="margin-top: 28px">Programs</h2>
    <div class="row">
      <div class="row-head"><div><div class="name">Discord</div><div class="detail">WEBRTC VoiceEngine / playStream</div></div><div class="percent">100%</div></div>
      <div class="controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="slider"><div class="fill" style="width: 100%"></div><div class="thumb" style="left: calc(100% - 11px)"></div></div></div>
    </div>
    <div class="row">
      <div class="row-head"><div><div class="name">Chrome</div><div class="detail">Media playback</div></div><div class="percent">82%</div></div>
      <div class="controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="slider"><div class="fill" style="width: 82%"></div><div class="thumb" style="left: calc(82% - 11px)"></div></div></div>
    </div>
    <div class="status">Connected to PipeWire</div>
  </section>
</main>
"""


QUICK_SETTINGS_HTML = f"""
<!doctype html>
<meta charset="utf-8">
<style>
{BASE_CSS}
body {{
  width: 1080px;
  height: 900px;
  background: linear-gradient(135deg, #101114, #1c1e24);
  color: #f8f8fb;
  display: grid;
  place-items: center;
}}
.panel {{
  width: 610px;
  border-radius: 42px;
  background: #34343b;
  box-shadow: 0 28px 80px rgba(0,0,0,.45);
  padding: 42px 42px 36px;
}}
.top {{
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}}
.top h1 {{
  font-size: 22px;
  margin: 0;
}}
.system-row {{
  display: grid;
  grid-template-columns: 90px 1fr 22px;
  align-items: center;
  gap: 16px;
  margin: 20px 0;
}}
.label {{
  font-size: 16px;
  color: #f4f4f6;
}}
.track {{
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: #676972;
}}
.track .fill {{
  height: 6px;
  border-radius: 999px;
  background: #3584e4;
}}
.track .thumb {{
  position: absolute;
  top: -9px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f3f3f5;
}}
.chev {{
  font-size: 24px;
  color: #e7e7ea;
}}
.tiles {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 32px;
}}
.tile {{
  min-height: 74px;
  border-radius: 26px;
  background: #57575f;
  padding: 16px 18px;
  display: grid;
  grid-template-columns: 24px 1fr 20px;
  align-items: center;
  gap: 10px;
}}
.tile.active {{
  background: #3584e4;
}}
.dot {{
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
}}
.tile-title {{
  font-size: 17px;
  font-weight: 800;
}}
.tile-sub {{
  margin-top: 2px;
  color: #dbeafe;
  color: #f4f4f6;
}}
.mixer {{
  margin-top: 18px;
  border-radius: 20px;
  background: #3f3f47;
  padding: 24px 26px 26px;
}}
.mixer-head {{
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
}}
.mixer-title {{
  font-size: 19px;
  font-weight: 800;
}}
.open {{
  margin-left: auto;
  color: #9bc9ff;
  font-size: 14px;
}}
.subtitle {{
  color: #c7c8ce;
  font-size: 14px;
  margin-bottom: 20px;
}}
.mix-row {{
  margin-top: 18px;
}}
.mix-row-head {{
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}}
.mix-name {{
  font-size: 16px;
  font-weight: 700;
}}
.mix-percent {{
  margin-left: auto;
  color: #d7d8dd;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}}
.mix-controls {{
  display: flex;
  align-items: center;
  gap: 14px;
}}
.mix-controls .track {{
  flex: 1;
}}
.mute {{
  width: 34px;
  height: 32px;
  border-radius: 9px;
  background: #55565f;
  display: grid;
  place-items: center;
  color: #f4f4f6;
  font-size: 13px;
}}
</style>
<main class="panel">
  <div class="top">
    <span class="icon"><span class="knob k1"></span><span class="knob k2"></span></span>
    <h1>Quick Settings</h1>
  </div>

  <div class="system-row"><div class="label">Speaker</div><div class="track"><div class="fill" style="width: 51%"></div><div class="thumb" style="left: calc(51% - 12px)"></div></div><div class="chev">›</div></div>
  <div class="system-row"><div class="label">Microphone</div><div class="track"><div class="fill" style="width: 86%"></div><div class="thumb" style="left: calc(86% - 12px)"></div></div><div class="chev">›</div></div>

  <section class="tiles">
    <div class="tile active"><div class="dot"></div><div><div class="tile-title">Wi-Fi</div><div class="tile-sub">Connected</div></div><div class="chev">›</div></div>
    <div class="tile active"><div class="dot"></div><div><div class="tile-title">Bluetooth</div></div><div class="chev">›</div></div>
    <div class="tile active"><div class="dot"></div><div><div class="tile-title">Mixer</div><div class="tile-sub">3 programs</div></div><div class="chev">›</div></div>
    <div class="tile"><div class="dot"></div><div><div class="tile-title">Night Light</div></div><div class="chev">›</div></div>
  </section>

  <section class="mixer">
    <div class="mixer-head"><div class="mixer-title">Audio Mixer</div><div class="open">Open full mixer</div></div>
    <div class="subtitle">Master and active programs</div>
    <div class="mix-row">
      <div class="mix-row-head"><div class="mix-name">Master</div><div class="mix-percent">51%</div></div>
      <div class="mix-controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="track"><div class="fill" style="width: 51%"></div><div class="thumb" style="left: calc(51% - 12px)"></div></div></div>
    </div>
    <div class="mix-row">
      <div class="mix-row-head"><div class="mix-name">Discord</div><div class="mix-percent">100%</div></div>
      <div class="mix-controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="track"><div class="fill" style="width: 100%"></div><div class="thumb" style="left: calc(100% - 12px)"></div></div></div>
    </div>
    <div class="mix-row">
      <div class="mix-row-head"><div class="mix-name">Chrome</div><div class="mix-percent">82%</div></div>
      <div class="mix-controls"><div class="mute"><span class="speaker-icon"><span></span></span></div><div class="track"><div class="fill" style="width: 82%"></div><div class="thumb" style="left: calc(82% - 12px)"></div></div></div>
    </div>
  </section>
</main>
"""


def chrome_binary() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    raise SystemExit("Chrome or Chromium is required to render screenshots")


def render_html(name: str, html: str, size: tuple[int, int]) -> None:
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        html_path = tmpdir / f"{name}.html"
        html_path.write_text(html, encoding="utf-8")
        out_path = OUT / f"{name}.png"
        width, height = size
        subprocess.run(
            [
                chrome_binary(),
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--no-sandbox",
                f"--user-data-dir={tmpdir / 'profile'}",
                f"--window-size={width},{height}",
                f"--screenshot={out_path}",
                html_path.as_uri(),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    render_html("desktop-app", APP_HTML, (1440, 940))
    render_html("quick-settings", QUICK_SETTINGS_HTML, (1080, 900))
    print(f"Rendered screenshots in {OUT}")


if __name__ == "__main__":
    main()
