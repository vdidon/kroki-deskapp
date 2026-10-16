# Installation

Kroki Desk is distributed in four forms. The portable binary remains the
main deliverable; the installers are **added** for those who want a proper
installation (applications menu, file associations, bundled plugins, clean
uninstall, in-place update).

| Form | Platform | File |
| --- | --- | --- |
| Portable binary | Windows 10/11 | `kroki_deskapp-<version>.exe` |
| MSI installer | Windows 10/11 | `kroki_deskapp-<version>.msi` |
| AppImage | Linux x86_64 | `kroki_deskapp-<version>-linux-x86_64-debian12.AppImage` |
| Debian/Ubuntu package | Debian 12+, Ubuntu 24.04+ | `kroki_deskapp-<version>-linux-x86_64-debian12.deb` |
| Bare Linux binary | Linux x86_64 with `libwebkit2gtk-4.1` | `kroki_deskapp-<version>-linux-x86_64-debian12` |

Each user's **documents, settings and plugins** live in their
profile (`%APPDATA%\kroki-deskapp\` on Windows, `~/.config/kroki-deskapp/`
on Linux): they are shared across all forms and survive an
uninstall.

## Portable binaries

A single file, with no installation and no administrator rights: the frontend, the
JS/WASM engines and the PlantUML/ditaa jars are embedded.

- **Windows**: WebView2 Runtime required, preinstalled since Windows 10 2004.
- **AppImage**: GTK and WebKitGTK embedded, nothing to install —
  `chmod +x` then run.
- **Bare Linux binary**: lighter, but the machine must provide
  `libwebkit2gtk-4.1`.

No plugin is preinstalled: add them from the Plugins dialog
(see [plugins](../README.md#plugins)).

## Windows installer (MSI)

The installation is **per-machine** (`Program Files`), so elevation is requested.
A single customization page: the choice of bundled plugins.

### Bundled plugins

The MSI embeds the plugins of the [bundling
strategy](building.md#plugins-bundled-in-the-installers); the page
lets you check the ones to install. With the default strategy:

| Property | Plugin | Provides | Checked |
| --- | --- | --- | --- |
| `PLUGIN_LATEX_DOC` | `latex-doc` | `.tex` `.latex`, ` ```latex ` fences | yes |
| `PLUGIN_CSV_TABLES` | `csv-tables` | `.csv` | no |
| `PLUGIN_BARCHART` | `barchart` | ` ```barchart ` fences | no |
| `PLUGIN_INI_HIGHLIGHT` | `ini-highlight` | ` ```ini ` highlighting | no |

The last three are the teaching examples from the [plugin protocol
specification](plugin-protocol.md): embedded so they can be installed
offline, not to be installed by default.

Checked plugins are installed at each user's **first launch**
(the plugins folder is in their profile) and are updated along with the
application. Three rules:

- a newer version installed by hand is never replaced by an
  older one;
- a plugin removed from the Plugins dialog is not reinstalled;
- unchecking a plugin does not uninstall one that is already in place —
  removal is done from the application.

### File associations

They have no page. Only those of the formats served by a plugin
depend on the corresponding checkbox.

| Extensions | Effect | Installed if |
| --- | --- | --- |
| `.kdws` `.kdext` | double-click → Kroki Desk | always |
| `.md` `.markdown` `.mdown` `.mkd` `.txt` `.html` `.htm` | "Open with" | always |
| a plugin's extensions (`.tex` `.latex`, `.csv`…) | double-click → Kroki Desk | plugin checked |

Installing a plugin means choosing Kroki Desk for its formats: the installer
claims them as the default application. Windows still has the last word —
a format for which you have already chosen an application keeps it, Kroki
Desk only appears as a suggestion. Shared native formats (Markdown,
text, HTML) are never claimed: Kroki Desk is only added to "Open
with", without touching your default applications.

### Launching by name

The MSI registers the application in *App Paths*: `start "" kroki_deskapp …`
(cmd), `Start-Process kroki_deskapp` (PowerShell) and Win+R find it without
modifying the PATH. Bash and `CreateProcess` do not read this key.

### Silent installation

The page's choices are passed as public properties:

```
msiexec /i kroki_deskapp.msi /qn PLUGIN_CSV_TABLES=1 PLUGIN_LATEX_DOC=""
```

installs the CSV plugin — and the `.csv` association with it — without the
LaTeX plugin or its associations.

## Debian/Ubuntu package (.deb)

Install with **apt**, which resolves dependencies — `dpkg -i` does not:

```bash
sudo apt install ./kroki_deskapp-<version>-linux-x86_64-debian12.deb
sudo apt remove kroki-desk    # uninstall
```

It puts the application in `/usr/bin` (so it can be launched as `kroki_deskapp`),
registers it in the applications menu and associates the file types. Target:
Debian 12+ and Ubuntu 24.04+ — the package requires `libc6 (>= 2.36)`, which rules out
Ubuntu 22.04.

### Bundled plugins

The package embeds the same plugins as the MSI, but a `.deb` has no
interface to let you choose. Those the strategy checks are
installed at each user's first launch (with the default
strategy: `latex-doc`), the others are only **dropped alongside**.

Plugins dropped alongside are installed from the Plugins dialog (the "Add a
plugin…" button, « Ajouter un plugin… »), pointing to `/usr/lib/Kroki Desk/example-plugins/`. The
update rules are those of the MSI.

### File associations

Kroki Desk is added to "Open with" for `.md` `.markdown` `.mdown` `.mkd`
`.html` `.htm` and for the formats of installed plugins that have a
standard MIME type (`.tex` `.latex`), without displacing your default applications. For
`.kdws`, `.kdext` and the formats specific to an installed plugin, it is the only
declared candidate: double-clicking opens it directly. Nothing is forced —
on Linux, the default application is a user choice
(`~/.config/mimeapps.list`) that a package should not write.

Two differences from the MSI, by design:

- **`.txt` is not associated.** Linux has no per-extension association:
  `.txt` *is* `text/plain`, and declaring it would make Kroki Desk appear in the
  "Open with" of every text file (`.py`, `.conf`, `.log`…), which it cannot
  open. A `.txt` can still be opened by drag-and-drop or through the application's
  file picker.
- **The formats of a plugin that is not installed are not associated** (`.csv` with the
  default strategy): the plugin that reads them is not there.
