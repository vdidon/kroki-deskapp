# ini-highlight example plugin

Implementation of example **§12.3** of `doc/plugin-protocol.md` (root of the
application repository): the `highlight:code` capability alone. The
```` ```ini ```` fences of markdown documents are colored (comments,
`[sections]`, `key = value`) via `hljs-*` classes styled by the host's hljs
theme.

An **educational** plugin: a home-grown line-by-line grammar, with no vendored
hljs — it shows the minimal contract (`highlight/render` → self-escaped HTML of
`hljs-*` spans), not exhaustive INI support.

## Contents

- `manifest.json` — claims `ini` highlighting (`highlight:code`).
- `main.js` — worker entry: line-by-line highlighting, HTML escaping done
  plugin-side (the host re-sanitizes, keeping only `hljs-*` spans).

## Packaging / installation

```bash
# → dist/ini-highlight-<version>.kdext (+ twin dist/ini-highlight.kdext)
python pack_plugin.py plugins/ini-highlight
```

Install by dropping the `.kdext` onto a Kroki Desk window, or via the "Add a
plugin…" button (« Ajouter un plugin… », in the toolbar's Plugins dialog).

Dev loop without repacking: copy this folder into
`%APPDATA%\kroki-deskapp\plugins\ini-highlight\` then restart the application.
