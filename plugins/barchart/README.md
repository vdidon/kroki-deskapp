# barchart example plugin

Implementation of example **§12.2** of `doc/plugin-protocol.md` (root of the
application repository): the `fence:svg` + `read:siblings` capabilities. In any
markdown document (or one derived from another plugin):

````markdown
```barchart max=120
CAL-26;98
Q3-26;61
M+1;24
```
````

or, with external data — the twin fallback image (§6.3) then plays
automatically:

````markdown
![fallback](ventes.png)
```barchart src=ventes.csv max=120
```
````

An **educational** plugin: it illustrates the fence extension point + the
`host/readFile` service, not a charting library.

## Contents

- `manifest.json` — claims the `barchart` fence (`fence:svg`) and reading of
  neighboring `.csv` files (`read:siblings`).
- `main.js` — worker entry: parses `label;value`, escapes labels, colors the
  text according to the effective theme provided by the host.

## Packaging / installation

```bash
# → dist/barchart-<version>.kdext (+ twin dist/barchart.kdext)
python pack_plugin.py plugins/barchart
```

Install by dropping the `.kdext` onto a Kroki Desk window, or via the "Add a
plugin…" button (« Ajouter un plugin… », in the toolbar's Plugins dialog).

Dev loop without repacking: copy this folder into
`%APPDATA%\kroki-deskapp\plugins\barchart\` then restart the application.
