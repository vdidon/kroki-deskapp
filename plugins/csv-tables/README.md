# csv-tables example plugin

Implementation of example **§12.1** of `doc/plugin-protocol.md` (root of the
application repository): the `document:markdown` capability alone. A `.csv` file
(`;` separator, first row = headers) is displayed as a markdown table; the
source view shows the raw CSV, and a click between table of contents and preview
lands on the right line of the file via the anchors.

An **educational** plugin: it illustrates the minimal extension point, not
serious CSV support (no RFC 4180 quoting, no choice of separator).

## Contents

- `manifest.json` — claims `.csv` with the `document:markdown` capability
  only.
- `main.js` — worker entry: CSV → table + anchors transform, graceful
  degradation (banner + fence) on an empty file.

## Packaging / installation

```bash
# → dist/csv-tables-<version>.kdext (+ twin dist/csv-tables.kdext)
python pack_plugin.py plugins/csv-tables
```

Install by dropping the `.kdext` onto a Kroki Desk window, or via the "Add a
plugin…" button (« Ajouter un plugin… », in the toolbar's Plugins dialog).

Dev loop without repacking: copy this folder into
`%APPDATA%\kroki-deskapp\plugins\csv-tables\` then restart the application.
