# README media

Sources and scripts that produce the images of `doc/media/` (README).
Everything is captured from the **running application** through the Chrome
DevTools Protocol — no global mouse or keyboard input.

1. Launch a built binary with an isolated profile and a CDP port (PowerShell):

   ```powershell
   $env:APPDATA = "$env:TEMP\kd_readme\appdata"   # clean profile, latex-doc seeded
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
   $d = "$PWD\scripts\readme_media"
   & .\dist\kroki_deskapp.exe "$d\hero.md" "$d\gallery.md" "$d\paper.tex" "$d\plotly.md"
   ```

   Put `{"language":"en","theme":"light","update_check":false}` (plus the
   other `SettingsData` fields) in `$env:APPDATA\kroki-deskapp\settings.json`
   first, so the captures are in English whatever the system language.

2. From `scripts/readme_media/`:

   ```bash
   node shots.mjs hero        # raw/raw-hero-{light,dark}.png
   node shots.mjs gallery     # raw/raw-tile-*.png, one per diagram of gallery.md
   uv run --with pillow --with numpy python compose.py hero      # framed hero-*.png
   uv run --with pillow --with numpy python compose.py gallery   # engines.png grid
   node gifs.mjs latex|search|live|plotly|zoom                   # *.gif (needs ffmpeg)
   ```

`KD_CDP_PORT` overrides the port (9333 by default).
