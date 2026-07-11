#!/usr/bin/env python3
"""Render current README previews for Fedora Audio Mixer."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "screenshots"
CHROME_ICON = Path("/usr/share/icons/hicolor/64x64/apps/google-chrome.png")
CHATGPT_ICON = Path.home() / ".local/share/icons/hicolor/512x512/apps/codex-desktop.png"


def icon_uri(path: Path) -> str:
    return path.as_uri() if path.exists() else ""


BASE_CSS = """
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Cantarell, "Noto Sans", system-ui, sans-serif;
  font-synthesis: none;
  -webkit-font-smoothing: antialiased;
}
.speaker {
  position: relative;
  display: block;
  width: 20px;
  height: 18px;
  color: currentColor;
}
.speaker::before {
  content: "";
  position: absolute;
  left: 1px;
  top: 6px;
  width: 6px;
  height: 7px;
  border-radius: 1px;
  background: currentColor;
}
.speaker::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 3px;
  width: 10px;
  height: 13px;
  background: currentColor;
  clip-path: polygon(0 36%, 70% 0, 70% 100%, 0 64%);
}
.wave {
  position: absolute;
  right: 0;
  top: 5px;
  width: 6px;
  height: 9px;
  border: 2px solid currentColor;
  border-left: 0;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-radius: 0 10px 10px 0;
}
.track {
  position: relative;
  height: 5px;
  border-radius: 5px;
  background: #d7d8d6;
}
.fill {
  height: 100%;
  border-radius: inherit;
  background: #3584e4;
}
.thumb {
  position: absolute;
  top: 50%;
  width: 20px;
  height: 20px;
  border: 1px solid rgba(0, 0, 0, .12);
  border-radius: 50%;
  background: #f8f8f8;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
  transform: translate(-50%, -50%);
}
"""


APP_HTML = f"""
<!doctype html>
<meta charset="utf-8">
<style>
{BASE_CSS}
body {{
  width: 1200px;
  height: 900px;
  display: grid;
  place-items: center;
  color: #202124;
  background: #dfe4e8;
}}
.window {{
  width: 720px;
  height: 836px;
  overflow: hidden;
  border: 1px solid #bfc3c0;
  border-radius: 12px;
  background: #f5f6f2;
  box-shadow: 0 24px 64px rgba(31, 37, 42, .22);
}}
.titlebar {{
  position: relative;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #d4d5d2;
  background: #f1f1f1;
}}
.titlebar h1 {{
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #777a77;
}}
.refresh {{
  position: absolute;
  right: 122px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid #d5d5d3;
  border-radius: 7px;
  color: #737873;
  background: #fafafa;
  font-size: 22px;
}}
.window-buttons {{
  position: absolute;
  right: 18px;
  display: flex;
  gap: 28px;
  color: #747874;
  font-weight: 700;
}}
.content {{ padding: 22px 24px 18px; }}
.section-title {{
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 700;
}}
.dropdown {{
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  margin-bottom: 16px;
  border: 1px solid #d0d2ce;
  border-radius: 7px;
  color: #747a76;
  background: #f9f9f8;
  font-size: 15px;
}}
.dropdown span:last-child {{ margin-left: auto; }}
.volume-row {{
  padding: 13px 14px 12px;
  margin-bottom: 9px;
  border: 1px solid #d5d7d3;
  border-radius: 8px;
  background: #ffffff;
}}
.row-head {{ display: flex; align-items: flex-start; gap: 12px; }}
.label-box {{ min-width: 0; flex: 1; }}
.name {{ font-size: 15px; font-weight: 700; }}
.detail {{ margin-top: 2px; color: #676d68; font-size: 12px; }}
.percent {{
  min-width: 50px;
  text-align: right;
  color: #424744;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}}
.controls {{
  display: grid;
  grid-template-columns: 38px 1fr;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
}}
.mute {{
  width: 38px;
  height: 35px;
  display: grid;
  place-items: center;
  border: 1px solid #d7d8d5;
  border-radius: 7px;
  color: #858a86;
  background: #f8f8f7;
}}
.mute .speaker {{ transform: scale(.76); }}
.idle {{ color: #808581; }}
.idle .mute, .idle .track {{ opacity: .42; }}
.programs-title {{ margin-top: 16px; }}
.status {{ margin-top: 12px; color: #676d68; font-size: 12px; }}
</style>
<main class="window">
  <header class="titlebar">
    <h1>Fedora Audio Mixer</h1>
    <div class="refresh">&#x21bb;</div>
    <div class="window-buttons"><span>&minus;</span><span>&#x25a1;</span><span>&times;</span></div>
  </header>
  <section class="content">
    <h2 class="section-title">Output</h2>
    <div class="dropdown"><span>Ryzen HD Audio Controller Analog Stereo (default)</span><span>&#x2304;</span></div>

    <h2 class="section-title">Master</h2>
    <article class="volume-row">
      <div class="row-head">
        <div class="label-box"><div class="name">Ryzen HD Audio Controller Analog Stereo</div><div class="detail">Running</div></div>
        <div class="percent">72%</div>
      </div>
      <div class="controls"><div class="mute"><span class="speaker"><span class="wave"></span></span></div><div class="track"><div class="fill" style="width:48%"></div><div class="thumb" style="left:48%"></div></div></div>
    </article>

    <h2 class="section-title programs-title">Programs</h2>
    <article class="volume-row">
      <div class="row-head">
        <div class="label-box"><div class="name">Google Chrome</div><div class="detail">Google Chrome / Playback</div></div>
        <div class="percent">102%</div>
      </div>
      <div class="controls"><div class="mute"><span class="speaker"><span class="wave"></span></span></div><div class="track"><div class="fill" style="width:68%"></div><div class="thumb" style="left:68%"></div></div></div>
    </article>
    <article class="volume-row idle">
      <div class="row-head"><div class="label-box"><div class="name">ChatGPT</div><div class="detail">Open, waiting for audio</div></div><div class="percent">Idle</div></div>
      <div class="controls"><div class="mute"><span class="speaker"><span class="wave"></span></span></div><div class="track"><div class="thumb" style="left:0"></div></div></div>
    </article>
    <article class="volume-row idle">
      <div class="row-head"><div class="label-box"><div class="name">Discord</div><div class="detail">Open, waiting for audio</div></div><div class="percent">Idle</div></div>
      <div class="controls"><div class="mute"><span class="speaker"><span class="wave"></span></span></div><div class="track"><div class="thumb" style="left:0"></div></div></div>
    </article>
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
  width: 900px;
  height: 720px;
  display: grid;
  place-items: center;
  color: #f4f4f5;
  background: #17181b;
}}
.panel {{
  width: 480px;
  padding: 18px 20px 16px;
  border: 1px solid #47484d;
  border-radius: 27px;
  background: #3b3b40;
  box-shadow: 0 22px 58px rgba(0, 0, 0, .48);
}}
.header {{ display: flex; align-items: center; gap: 13px; margin-bottom: 18px; }}
.header-icon {{
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  background: #696a6f;
}}
.header-icon .speaker {{ transform: scale(1.12); }}
.header h1 {{ margin: 0; font-size: 22px; line-height: 1.05; font-weight: 700; }}
.header p {{ margin: 4px 0 0; color: #f0f0f1; font-size: 12px; font-weight: 600; }}
.master-head {{ display: flex; align-items: center; gap: 9px; min-height: 38px; }}
.master-head > .speaker {{ transform: scale(.72); }}
.master-title {{ flex: 1; font-size: 16px; }}
.entry {{
  width: 58px;
  padding: 4px 5px;
  border: 1px solid transparent;
  border-radius: 5px;
  text-align: right;
  color: #dbdbdd;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}}
.mute {{
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #b8b9bb;
  background: #4a4a4f;
}}
.mute .speaker {{ transform: scale(.72); }}
.master-slider {{ margin: 9px 12px 20px 0; }}
.panel .track {{ height: 4px; background: #606166; }}
.panel .thumb {{ width: 18px; height: 18px; border: 0; box-shadow: none; }}
.separator {{ height: 1px; margin: 0 0 6px; background: #55565a; }}
.app-row {{ display: flex; align-items: center; min-height: 58px; gap: 10px; }}
.app-icon {{
  width: 19px;
  height: 19px;
  object-fit: contain;
  border-radius: 4px;
}}
.app-copy {{ min-width: 0; flex: 1; }}
.app-name {{ color: #c6c6c9; font-size: 16px; }}
.app-detail {{ margin-top: 2px; color: #929398; font-size: 12px; }}
.idle-label {{ color: #b0b0b4; font-size: 15px; }}
.footer {{
  margin-top: 3px;
  padding: 16px 0 2px;
  border-top: 1px solid #55565a;
  font-size: 15px;
}}
</style>
<main class="panel">
  <header class="header">
    <div class="header-icon"><span class="speaker"><span class="wave"></span></span></div>
    <div><h1>Audio Mixer</h1><p>Master and programs</p></div>
  </header>

  <div class="master-head">
    <span class="speaker"><span class="wave"></span></span>
    <div class="master-title">Master</div>
    <div class="entry">72%</div>
    <div class="mute"><span class="speaker"><span class="wave"></span></span></div>
  </div>
  <div class="track master-slider"><div class="fill" style="width:48%"></div><div class="thumb" style="left:48%"></div></div>

  <div class="separator"></div>
  <div class="app-row">
    <img class="app-icon" src="{icon_uri(CHATGPT_ICON)}" alt="">
    <div class="app-copy"><div class="app-name">ChatGPT</div><div class="app-detail">Open, waiting for audio</div></div>
    <div class="idle-label">Idle</div>
  </div>
  <div class="app-row">
    <img class="app-icon" src="{icon_uri(CHROME_ICON)}" alt="">
    <div class="app-copy"><div class="app-name">Google Chrome</div><div class="app-detail">Open, waiting for audio</div></div>
    <div class="idle-label">Idle</div>
  </div>
  <div class="footer">Open full mixer</div>
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


def render_webp(name: str, max_width: int) -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow is required to write WebP screenshots") from exc

    with Image.open(OUT / f"{name}.png") as image:
        image = image.convert("RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.Resampling.LANCZOS)
        image.save(OUT / f"{name}.webp", "WEBP", quality=92, method=6)


def main() -> None:
    render_html("desktop-app", APP_HTML, (1200, 900))
    render_html("quick-settings", QUICK_SETTINGS_HTML, (900, 720))
    render_webp("desktop-app", 1100)
    render_webp("quick-settings", 900)
    print(f"Rendered screenshots in {OUT}")


if __name__ == "__main__":
    main()
