# Kroki Desk plugin protocol — specification v1

> **Status: implemented since Kroki Desk 3.0.0**, except what is marked
> *reserved* (`document:html`, `*:webview`, `runtime: "process"` — § 4, § 10).
> The contract was frozen *before* the first line of code, so that plugins
> written against v1 remain compatible with the future extensions (webview,
> native processes) already reserved here.

## 1. Objectives and principles

A **plugin** adds to Kroki Desk support for:

- a **file type** (extension, e.g. `.tex`) — transformed into markdown
  rendered by the host;
- and/or a **fence language** (e.g. ` ```plotly `) in any markdown document —
  native or derived from another plugin.

Non-negotiable principles:

1. **A protocol, not an API.** The plugin links no library of the
   application: host and plugin exchange **JSON messages** across an
   isolation boundary. Fields and methods can be added without breaking
   existing plugins; capabilities are negotiated, never assumed.
2. **Sandboxed by default.** A v1 plugin runs in a **Web Worker**: no access
   to the application's DOM, no access to `invoke` (Tauri commands), no
   network (CSP), no disk. Every external need goes through a host service,
   granted capability by capability.
3. **A plugin's output is content, never code.** In v1, a plugin produces
   markdown, SVG or HTML — which go back through the existing trust pipeline
   (markdown-it, DOMPurify, CSP). The modes in which the plugin supplies
   executable code (`*:webview`, `process` runtime) are **reserved** and not
   implemented.
4. **Native always wins.** A plugin cannot claim an extension or a fence
   already handled natively (`.md`, `mermaid`, `plotly`…): the claim is
   ignored with a warning (§ 8).
5. **Never break rendering.** A plugin MUST degrade (banner + source in a
   fence) rather than throw on invalid content. A *protocol* error (crash,
   timeout) is handled by the host: error banner + raw source displayed
   (§ 7.3).

## 2. Distribution format: `.kdext` archive

A plugin is a zip file with the extension `.kdext`:

```
mon-plugin-1.2.0.kdext
├── manifest.json        # required, at the root
├── main.js              # entry point (ES module run in the worker)
├── CHANGELOG.md         # optional: changelog (§ 3.1)
└── …                    # free assets: .wasm, data, loaded by main.js
```

The entry JS can be trivial: the logic can live in a WASM module embedded in
the archive (Rust, Go, C… compiled to WASM) — this is **the** official path
for compiled languages, and no additional protocol support is required.
`main.js` loads the `.wasm` through a URL relative to the archive, resolved by
the host.

The packaging tool (`pack_plugin.py` at the repository root) recognizes an
optional **`packInclude`** field in the manifest: the explicit list of files
to embed in the archive (POSIX relative paths, e.g.
`"vendor/highlight.esm.js"`) — `manifest.json` and the `entry` are always
included automatically, a path that cannot be found is an error, and an absent
field means the whole plugin folder. This is a **packaging-only** field: the
host ignores it (unknown-fields rule, § 3); it is not part of the protocol.

## 3. Manifest (`manifest.json`)

```json
{
  "manifestVersion": 1,
  "id": "spec-doc",
  "version": "3.1.0",
  "apiVersion": "1",
  "name": "Spec documents",
  "description": "Rendering of .spec files",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "extensions": [".spec"],
  "fences": ["spec"],
  "highlights": ["spec-source"],
  "capabilities": ["document:markdown", "fence:markdown", "read:siblings", "highlight:code"],
  "siblingExtensions": [".spec", ".json"]
}
```

| Field | Req. | Role |
| --- | --- | --- |
| `manifestVersion` | ✔ | Version of the **manifest schema** (integer). The host rejects an unknown major. |
| `id` | ✔ | Stable identifier `[a-z0-9-]+`, unique: it is the install/update key. |
| `version` | ✔ | Version **of the plugin** (semver). Displayed; "replaces" the installed one on install. |
| `apiVersion` | ✔ | Major of the **protocol** required (`"1"`). The host rejects the plugin if it does not support it. |
| `name`, `description`, `publisher` | ✔ | Display (install dialog, plugin list). |
| `runtime` | ✔ | `"worker"` (the only v1 value). `"process"` is **reserved** (§ 10.2). |
| `entry` | ✔ | Path of the entry module inside the archive. |
| `extensions` |  | File extensions claimed (with the dot, case-insensitive). Requires a `document:*` capability. |
| `fences` |  | Fence languages claimed (lowercase). Requires a `fence:*` capability. |
| `highlights` |  | Highlighting languages claimed. Requires `highlight:code`. The name `<ext>-source` (or `<ext>`) is the one the host requests for the "source code" view of a document served by this plugin (§6.4). |
| `capabilities` | ✔ | List of strings, see § 4. A capability unknown to the host is **ignored** (forward compatibility); a capability that is known but not implemented makes the plugin inert, with the message « requiert une version plus récente de Kroki Desk » ("requires a newer version of Kroki Desk"). |
| `siblingExtensions` |  | Allowlist of extensions for `host/readFile` (default: none). Shown in the trust dialog. |

Compatibility rule: **every unknown manifest field is ignored** — a manifest
written for a newer host remains loadable by an older host as long as
`manifestVersion` and `apiVersion` are satisfied.

### 3.1 Optional conventional file: `CHANGELOG.md`

A plugin MAY embed a **changelog**: a markdown file named exactly
`CHANGELOG.md`, at the root of the archive. This is a **naming convention**,
not a manifest field — a host that does not know it simply ignores the file,
so no compatibility is at stake.

- If present, the plugin's card in the management dialog (§ 9.4) gains a
  **"What's new" (« Nouveautés »)** button that displays it in the host's
  changelog dialog.
- Rendering is done **by the host** (markdown-it + DOMPurify, external links
  redirected to the system browser): the plugin's code does not run, and
  diagram fences are **not** hydrated there — it is prose.
- Recommended format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
  from the most recent version to the oldest. A leading `# …` title is
  stripped at display time (redundant with the dialog header), as are
  reference-link definitions pointing to internal anchors
  (`[1.2.0]: #120--…`).

| Capability | v1 status | Description |
| --- | --- | --- |
| `document:markdown` | **implemented** | Transforms a whole document into derived markdown + anchors (§ 6.2). The downstream pipeline (Kroki engines, table of contents, source view, theme, search) comes for free. |
| `fence:svg` | **implemented** | Renders a fence block as static SVG, inserted as is (the CSP — `script-src 'self'`, no inline — neutralizes any script, same policy as the SVGs of the native engines, see `render.js`). |
| `fence:html` | **implemented** | Renders a fence block as static HTML, **sanitized by DOMPurify** before insertion (`sanitizeHtml` profile, `render.js` — `<foreignObject>` elements do not survive: produce pure SVG if needed). |
| `fence:markdown` | **implemented** | Renders a fence block as **derived markdown**, run back through the host's full pipeline (markdown-it + DOMPurify) and then hydrated recursively: the native Kroki fences and plugin highlightings it contains are rendered. Nesting depth is bounded (2); the `data-source-line` attributes of the derived content are removed (no remapping for a fence). |
| `highlight:code` | **implemented** | Highlights the code of a fence declared in `highlights`: the plugin returns `<span class="hljs-…">` HTML, sanitized, styled by the host's hljs theme. Replaces direct registration of an hljs grammar (impossible without running plugin code in the main webview). |
| `read:siblings` | **implemented** | `host/readFile` service: reading of files **relative to the document's folder**, same confinement as `read_data_file` (`commands.rs`) — absolute paths rejected, canonicalization + `starts_with` anti-traversal/symlink check, `siblingExtensions` allowlist. |
| `document:html` | *reserved* | Whole document → sanitized static HTML (free layout, no JS). |
| `document:webview` | *reserved* | Whole document → HTML/CSS/JS view in a sandboxed iframe (`allow-scripts`, without `allow-same-origin`), `postMessage` communication. VS Code "custom editor" model. |
| `fence:webview` | *reserved* | Interactive block in a sandboxed iframe (Plotly case: live JS runtime in the page). |

A plugin MAY freely combine capabilities (e.g. `document:markdown` +
`fence:svg` + `highlight:code`).

**The Plotly case (motivation for `fence:webview`)**: the `plotly` branch of
`hydrateDiagrams` (`ui/js/render.js`) is the native prototype of an
interactive fence handler — interception before the backend, lazily loaded
runtime, `src=` read through `read_data_file`, fallback image hidden on
success. Plotly **remains native**; the protocol simply reserves the slot so
that a future migration (or another interactive runtime) requires no breaking
change. The day the native branch is removed, a `plotly` plugin takes over
without any protocol change (§ 8).

## 5. Message envelope

v1 transport: `postMessage` between the host (main webview) and the plugin's
worker. Each message is a JSON object:

```jsonc
// request (in both directions)
{ "kd": 1, "id": 42, "method": "document/transform", "params": { … } }
// response — exactly one of the two fields
{ "kd": 1, "id": 42, "result": { … } }
{ "kd": 1, "id": 42, "error": { "code": "internal", "message": "…" } }
// notification (no response expected)
{ "kd": 1, "method": "host/log", "params": { "level": "warn", "message": "…" } }
```

- `kd: 1` = envelope version; `id` correlates request and response, each side
  has its own id space.
- **Unknown fields are ignored** in `params` and `result` — this is the main
  lever for evolution without breaking changes. An unknown *method* receives
  `error.code = "method-not-found"`.
- `error.code` (string): `internal`, `method-not-found`, `not-supported`,
  `timeout`, `denied`, `not-found` — extensible.

## 6. Lifecycle and methods

### 6.1 Initialization (host → plugin)

The worker is started **lazily**: on the first document/fence the plugin is
responsible for (not at boot — same amortization logic as the renderer
webview, but inverted: you only pay if you use it).

```jsonc
// host → plugin
{ "method": "initialize", "params": {
    "apiVersion": "1",
    "hostVersion": "2.9.1",              // CARGO_PKG_VERSION
    "capabilities": ["document:markdown", "fence:svg", "fence:html",
                      "fence:markdown", "highlight:code", "read:siblings"],   // what THIS host can serve
    "theme": "dark",                      // current effective theme: "light" | "dark"
    "locale": "fr"                        // interface language (since 3.25.0): "en" | "fr" | …
} }
// plugin → host
{ "result": { "ok": true } }
```

`locale` is the language of the application's **interface** — a short code
(`"en"`, `"fr"`), the host choosing among the languages it ships. A plugin
MAY use it for the texts it addresses to the user: `warnings`, degraded-mode
banner, error messages. It is not the language of the document being
rendered: words written into the rendering itself (a "Proof" label, a table
caption) should follow the document when it declares one. Hosts older than
3.25.0 do not send it — treat its absence as English. The same field travels
with every `document/transform` and `fence/render` (§ 6.2, § 6.3), so a
plugin that has no cache can ignore `locale/changed` (§ 6.6).

The intersection `manifest.capabilities ∩ params.capabilities` defines what is
active. A plugin none of whose capabilities can be served is marked "inert"
(« inerte ») in the plugin list, with the reason.

`shutdown` (host → plugin, notification) precedes the termination of the
worker; the host MAY also kill the worker without notice (crash, timeout,
uninstallation) — a plugin MUST NOT hold any valuable state (§ 7.2).

### 6.2 `document/transform` — capability `document:markdown`

Transforms a whole document into markdown, then rendered by the host like a
`.md` (integration: `renderActive`, `ui/js/main.js`).

```jsonc
// host → plugin
{ "method": "document/transform", "params": {
    "text": "…full source…",
    "path": "D:\\docs\\pricing.spec",  // absolute path (cross-file deep links)
    "dir":  "D:\\docs",                // folder (base for host/readFile)
    "title": "pricing",                // file name without extension
    "theme": "dark",
    "locale": "en"                     // interface language (§ 6.1)
} }
// plugin → host
{ "result": {
    "markdown": "# pricing\n\n```graphviz\n…",
    "anchors": [[0, 0], [12, 4], …],   // [markdownLine, sourceLine], sorted,
                                        // semantics of remapLine (ui/js/anchors.js):
                                        // the source line of the anchor whose markdown
                                        // line is the greatest one ≤ the requested line
    "warnings": ["import 'x.spec' not found"]   // optional, shown in a banner
} }
```

Robustness contract: invalid **content** never produces `error` — the plugin
returns degraded markdown (banner + source in a fence). `error` is reserved
for internal failures; the host then displays its own banner and the raw
source in a fence (§ 7.3).

Reloading by the watcher simply re-emits `document/transform` — one call per
render, with no session state on the protocol side.

### 6.3 `fence/render` — capabilities `fence:svg` / `fence:html` / `fence:markdown`

Called by `hydrateDiagrams` for each claimed fence, in parallel with the native
renders.

```jsonc
// host → plugin
{ "method": "fence/render", "params": {
    "lang": "musicxml",
    "source": "…block content (may be empty if options.src)…",
    "options": { "src": "partition.xml" },  // key=value pairs of the info string,
                                             // syntax of parseDiagramOptions (render.js)
    "dir": "D:\\docs",
    "theme": "dark",
    "locale": "en"
} }
// plugin → host
{ "result": { "format": "svg", "content": "<svg …>…</svg>" } }
// or { "format": "html", "content": "<table …>…" }   // sanitized by DOMPurify
// or { "format": "markdown", "content": "## …" }     // full pipeline
```

`format: "markdown"` (capability `fence:markdown`): the content is rendered by
the host's markdown-it (+ DOMPurify) and then **hydrated recursively** — native
Kroki fences and `highlight:code` highlightings included. Host safeguards: the
nesting depth is bounded to 2 (a plugin whose derived markdown contains a
`fence:markdown` fence does not loop — beyond that, the standard error block)
and the `data-source-line` attributes of the derived content are removed (they
would point into the generated markdown, not into the open document; no
anchors/remapping for a fence, unlike `document/transform`).

Services provided by the host, with no action required from the plugin:

- a placeholder « Rendu {lang}… » ("Rendering {lang}…") during the call, the
  standard error block (`diagramError`) if `error`;
- **twin fallback image**: if `options.src` is present and the render
  succeeds, the host applies the `hidePairedFallbackImage` logic
  (`render.js`) — an image immediately preceding the block with the same
  *stem* is hidden. A generalization of the Plotly behavior, free for any
  fence handler.

### 6.4 `highlight/render` — capability `highlight:code`

```jsonc
{ "method": "highlight/render", "params": { "lang": "spec-source", "code": "count = …" } }
{ "result": { "html": "<span class=\"hljs-keyword\">…</span>…" } }
```

The host sanitizes (`span` tags/classes only) and injects the result into the
`<code>` of the fence; the `hljs-*` classes inherit the active hljs theme
(project reminder: palette by **business concept**, not by technical family).
On `error`, the fence stays uncolored — never blocking.

**"Source code" view.** The host also requests this method to color the raw
source of a transformed document, when the plugin claims the grammar of the
**whole file** — convention `<ext>-source` (`tex-source` for `.tex`), with
`<ext>` as fallback. The convention is based on the **extension**, not on the
language name: a plugin serving several extensions declares as many names for
the same grammar (latex-doc claims `tex-source` **and** `latex-source`). Two
consequences on the plugin side:

- the `code` received is then the **complete document**, declarations
  included, not a fence fragment — hence a grammar that may differ from the
  one used for fences;
- the response MUST stay within the 5 s budget (§7.1) even on a large file;
  beyond that, the host simply leaves the view as plain text.

Highlighting is applied **line by line** (one `div` per source line, for
alignment with the preview): the host re-splits the returned HTML at each `\n`,
rebalancing the `span` elements that straddle lines, and silently gives up if
the split does not exactly cover the source lines. A plugin therefore has
nothing special to do for multi-line constructs.

### 6.5 Host services (plugin → host)

| Method | Capability | Contract |
| --- | --- | --- |
| `host/readFile` | `read:siblings` | `params: { rel }` → `result: { text }`. Path **relative** to the `dir` of the document being processed, `read_data_file` confinement + `siblingExtensions` allowlist. `error.code = "denied"` (outside confinement/allowlist) or `"not-found"`. Valid only while a host request is being processed. |
| `host/log` | — (always) | Notification `{ level: "debug"|"info"|"warn"|"error", message }`. Log visible in the runtimes info dialog. |

### 6.6 Host → plugin notifications

| Method | Contract |
| --- | --- |
| `theme/changed` | `{ theme: "light" \| "dark" }` — effective theme after a switch (`theme.js`). Documents/fences already rendered are re-rendered by the host anyway; this notification is for the plugin's internal caches. |
| `locale/changed` | `{ locale: "en" \| "fr" \| … }` — interface language after a switch in the settings (since 3.25.0). Same contract as `theme/changed`: everything is re-rendered by the host, with the new `locale` in each request. |

### 6.7 Style classes provided by the host

A plugin provides no CSS: its markdown is rendered under the host's
stylesheet. For the components that a document plugin emits as inline HTML,
the host exposes a small vocabulary of classes, styled in both themes
(`ui/css/app.css`):

| Class | Element | Rendering |
| --- | --- | --- |
| `kd-fold` | `<details>` | Framed collapsible block, `<summary>` as a clickable banner; when nested, it is slightly indented. |
| `kd-note` | `<div>` | Indented documentation callout, left border, muted text. |

These classes survive DOMPurify (`class` attribute kept). Any other class is
allowed but remains unstyled.

## 7. Execution, errors, performance

### 7.1 Timeouts

`initialize`: 10 s. `document/transform`, `fence/render`: 30 s.
`highlight/render`: 5 s. Beyond that: `timeout`, worker killed, degraded
rendering (§ 7.3). The worker is restarted lazily on the next request (3
consecutive failures ⇒ plugin marked "broken" (« en panne ») until the app is
restarted or the plugin is reinstalled).

### 7.2 State

The protocol is **stateless** between requests: each `document/transform`
receives the full text. A plugin MAY maintain internal caches (compiled
grammar, instantiated WASM module) but MUST survive a fresh worker at any
time.

### 7.3 Host-side degradation

If a required plugin is broken, inert or missing (a `.csv` file opened without
the `csv-tables` plugin): the host displays the document as **raw source in a
fence** under an explanatory banner — the file remains readable, never an
empty tab. A fence with no handler follows the default markdown rendering (code
block), current behavior unchanged.

## 8. Conflict resolution

1. **Native first**: an extension of `DOC_EXTENSIONS` (`manager.rs`) or a
   native fence (`KROKI_TYPES`/`KROKI_ALIASES`/`plotly`, `render.js`) cannot
   be claimed. The claim is ignored; warning in the plugin list. If a native
   is ever removed (e.g. Plotly migration), the installed plugins that
   claimed it take over at the next restart, without any protocol change.
2. **Between plugins**: last installed wins (extension and fence alike), with
   a warning listing the loser. Uninstalling the winner hands control back to
   the previous one. This rule applies **per claim type** (extension, fence,
   highlighting) — two claims of different types on the same name are not a
   registration conflict.
3. **Fence > highlighting** (cross-type precedence, follows from the
   pipeline): if a plugin claims the *fence* of a language and another (or the
   same) one claims its *highlighting*, every ` ```<language> ` block becomes
   a diagram rendered by the fence handler — it is never emitted as a code
   block, so the highlighting is **never consulted** for that language.
   Highlighting applies only to blocks rendered as code, that is: (a) when no
   fence handler is installed for that language — it then acts as a natural
   fallback after the fence handler is uninstalled — or (b) for languages
   that nobody renders as a diagram. Nuance: an **error** from the fence
   handler displays the standard error block, it does NOT fall back to the
   highlighting (a failed render is not a code block). Corollary: a plugin
   that claims fence **and** highlighting of the same name makes its own
   highlighting inert in previews — it remains useful only as a fallback if
   its fence capability stops being served.

## 9. Installation, update, discovery

### 9.1 Location

- Windows: `%APPDATA%\kroki-deskapp\plugins\<id>\` — a path **deliberately
  outside** the Tauri identity folder, which follows the bundle's
  `identifier`: the plugins path (and `settings.json`, placed next to it) does
  not depend on it.
- Linux: `$XDG_CONFIG_HOME/kroki-deskapp/plugins/<id>/` (default
  `~/.config/…`).

Contents: the unpacked archive + `manifest.json` at the root. The previous
version is kept as `<id>.bak/` (manual rollback possible).

### 9.2 User-initiated installation

A `.kdext` archive designated by the user — dropped on a window, passed as a
command-line argument, or opened by double-click when the installer has
associated the extension — converges on the same flow: sorting is done once
and for all by `manager::open_mixed_paths`, which routes `.kdext` files to
installation instead of opening them in a tab. This flow triggers:

1. reading of the manifest **without running the plugin**; clean rejection if
   `manifestVersion`/`apiVersion` are unsupported or the archive is invalid;
2. **trust dialog** — mandatory, including on update: name, publisher, version
   (`old → new` where applicable), extensions and fences claimed, capabilities
   requested in plain language (e.g. "can read the `.json` files of the folder
   of open documents" — « peut lire les fichiers `.json` du dossier des
   documents ouverts ») and the standing warning: *a plugin runs (sandboxed)
   code supplied by a third party*;
3. extraction to the § 9.1 folder (the existing one becomes `.bak`);
4. hot reload of the registry: the old version's worker is killed, and open
   tabs of the affected types are re-rendered.

A `version` lower than the installed one is a **downgrade**: allowed, but
flagged as such in the dialog.

Only one installation path skips the trust dialog, and it is described in
§ 9.5: plugins shipped with the application itself.

### 9.3 Discovery at boot & backend integration

At startup, the **Rust backend** enumerates `plugins/*/manifest.json` (serde
parsing, no JS execution) and derives from it the dynamic list of document
extensions: filters of the open dialog (`commands.rs`), drag & drop acceptance
(`drop_target.rs`/`filedrop.js`), command-line arguments and `single-instance`
forwarding. `DOC_EXTENSIONS` remains the *native* list; the effective list =
natives ∪ active plugins. The manual `manager.rs`/`filedrop.js`
synchronization currently required for every new format disappears for plugin
formats.

The frontend receives the registry (command `list_plugins`) and routes
`showView`/`hydrateDiagrams` accordingly. Viewing and management go through
the dedicated dialog of § 9.4.

### 9.4 Plugin management interface

A dedicated "Plugins" (« Plugins ») dialog, reachable from the toolbar (at the
same level as the existing Settings (« Réglages »), Info (« Informations »)
and What's new (« Nouveautés ») dialogs). Contents:

- **List of installed plugins**, one card per plugin, showing at least:
  **name**, **description**, **version** — completed with the publisher
  (`publisher`), the state (active / inert with reason / broken § 7.1 /
  conflict § 8 with the warning in plain language) and the claims served
  (extensions, fences, highlights). Empty list → a message explaining the two
  ways to add one.
- **"What's new" (« Nouveautés ») button** on every card whose plugin embeds a
  `CHANGELOG.md` (§ 3.1): opens the host's changelog dialog on the plugin's
  changelog, rendered sanitized, without running the plugin.
- **"Delete" (« Supprimer ») button** on every card: explicit confirmation,
  then deletion of the `plugins/<id>/` folder (including the `.bak`), worker
  stopped, affected open tabs re-rendered (they fall back to the degraded
  rendering § 7.3 — or to the losing plugin of a conflict § 8, which takes
  over). No recycle bin: the user reinstalls from their `.kdext` if they made
  a mistake.
- **"Add a plugin…" (« Ajouter un plugin… ») button** at the bottom of the
  dialog, full width: opens a native file picker filtered on `.kdext`, then
  runs **exactly the § 9.2 flow** (manifest validation, trust dialog,
  extraction, hot reload). Dragging and dropping a `.kdext` onto the main
  window (§ 9.2) keeps working in parallel — both paths converge on the same
  flow once the archive path is obtained.

Deliberately out of v1: enabling/disabling without uninstalling, automatic
update from a remote source, sorting/search. The `host/log` journal remains
viewable in the runtimes info dialog (`info.js`), not here — management and
diagnostics are two distinct uses. Only the plugins shipped with the
application update themselves, and only when the application itself is updated
(§ 9.5).

### 9.5 Plugins shipped with the application

The installers embed the `.kdext` archives of the plugins retained by the
repository's embedding strategy (`bundled-plugins.default.txt`, see README);
the Windows one lets the user tick those to install; the ones retained are
placed in `<resource_dir>/bundled-plugins/`, the executable's folder. At
startup, **before** the discovery of § 9.3, the host installs and updates them
**without a trust dialog** (`plugins::seed_bundled`).

The host does not know this selection and does not need to: it installs what
it finds in the folder. An unticked plugin is simply absent. Both installers
create the folder **even when nothing is ticked**: its presence means "an
installer chose", which the host must respect even if the choice was nothing.

This is the only exception to § 9.2, and it rests on a single argument: these
archives come from the **same installer as the executable**. Asking the user
to grant trust to a plugin they have just installed together with the
application would add no information — they have already granted that trust to
the binary that displays it. Any archive coming from elsewhere (mail, share,
download) goes through § 9.2 without exception.

Three rules bound the mechanism:

1. **no regression** — a plugin installed in a version greater than or equal
   to the shipped one is left untouched; a hand-placed version stays in place;
2. **deletion is final** — a plugin removed from the § 9.4 dialog is recorded
   in `settings.json` (`removed_plugins`) and is no longer reinstalled,
   otherwise the "Delete" (« Supprimer ») button would be undone at the next
   startup;
3. **reinstalling puts it back in the loop** — installing the plugin by hand
   (§ 9.2) clears this record: it becomes eligible for updates again.

Since the plugins folder is per-user (§ 9.1) while the installer is
per-machine, the installation cannot be done by the installer itself: it takes
place at the first launch that follows, for each user session.

Without an installer (portable executable, AppImage, development build), the
folder is absent and the host falls back on the one archive compiled into the
executable — the LaTeX document plugin, packed from the repository by the
build. The same rules apply to it, and the same argument: it comes from the
binary itself. It is what makes a single downloaded executable open `.tex`
files.

## 10. Reservations (named in v1, not implemented)

These elements exist in the protocol **only** so that their future addition
breaks no v1 plugin and no v1 host.

### 10.1 `document:webview`, `fence:webview`, `document:html`

A view supplied by the plugin in a **sandboxed iframe**
(`sandbox="allow-scripts"`, without `allow-same-origin`), served by a Tauri
custom protocol, `postMessage` communication only. The host will push: source,
theme (CSS tokens), watcher notifications; the plugin will report back:
navigation (`doc#fragment` deep links), outline for the table of contents,
height. To be designed in detail at implementation time; the capability
identifiers and the `runtime` field are enough for compatibility. A v1 host
facing a purely webview plugin declares it inert with the dedicated message
(§ 3).

Accepted cost (design decision): a webview view does **not** inherit the
markdown integration (table of contents, remapped source view, search,
printing) — each point becomes an optional protocol message again. The first
zone is about freedom, the second about integration.

### 10.2 `runtime: "process"`

Plugin as a **native process** (LSP model: JSON over stdio, same methods), for
runtimes impossible in WASM (JVM…). Change of nature accepted: no more
sandbox (full user rights), per-platform binaries, signing/antivirus — the
trust dialog will have to say so bluntly. Not planned: the official path for
compiled languages is WASM behind a worker (§ 2), which notably covers all the
project's C/Go/Rust engines (graphviz, d2, svgbob, pikchr would fit without a
new protocol).

## 11. Reference roadmap

1. **Cold extraction** (no dynamic plugin): refactor a format compiled into
   the binary behind the exact interface of § 6 (internal `registerFileType`
   registry). Validates the contract on a real format before freezing it
   publicly.
2. **Host v1**: worker + manifest + install by drop + backend registry. This
   format becomes the first external plugin — original goal: follow a format's
   evolutions **without recompiling the application** (the frontend being
   embedded in the binary, any `ui/` change requires a `cargo build`).
3. **`fence:svg`/`fence:html`** if not included in 2.
4. **Webview / process**: only on demonstrated real need, never "to look
   good".

## 12. Minimal complete examples

One example per extension point. Common convention: the host provides in the
worker a global `kd` — `kd.onRequest(method, handler)` (the handler returns the
`result`, throws to produce an `error`), `kd.request(method, params)` (call to
a host service, returns a promise) and `kd.notify(method, params)`.

### 12.1 `document:markdown` — `.csv` files as tables

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "csv-tables",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "CSV as tables",
  "description": "Displays .csv files as markdown tables",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "extensions": [".csv"],
  "capabilities": ["document:markdown"]
}
```

`main.js`:

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("document/transform", ({ text, title }) => {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(","));
  const md = [
    `# ${title}`,
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    // one anchor per data row: markdown line → line of the source .csv
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  const anchors = [[0, 0], ...rows.slice(1).map((_, i) => [4 + i, 1 + i])];
  return { markdown: md.join("\n"), anchors };
});
```

Opening `ventes.csv` displays the derived document; the source view shows the
raw CSV; clicking in the table of contents/preview lands on the right line of
the file through the anchors.

### 12.2 `fence:svg` — a `barchart` fence language

Renders in **any markdown document** (or one derived from another plugin):

````markdown
```barchart max=120
CAL-26;98
Q3-26;61
M+1;24
```
````

or, with external data (the "twin fallback image" service, § 6.3, then kicks
in automatically):

````markdown
![fallback](ventes.png)
```barchart src=ventes.csv max=120
```
````

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "barchart",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "Bar chart",
  "description": "```barchart fences: horizontal SVG bars",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "fences": ["barchart"],
  "capabilities": ["fence:svg", "read:siblings"],
  "siblingExtensions": [".csv"]
}
```

`main.js`:

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("fence/render", async ({ source, options, theme }) => {
  // empty block + src=: data read through the host (read:siblings confinement)
  let text = source.trim();
  if (!text && options.src) text = (await kd.request("host/readFile", { rel: options.src })).text;
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(";"));
  const max = Number(options.max) || Math.max(...rows.map(([, v]) => Number(v)));
  const fg = theme === "dark" ? "#e6e6e6" : "#1f1f1f";
  const bars = rows.map(([label, v], i) =>
    `<text x="0" y="${i * 24 + 15}" fill="${fg}" font-size="12">${esc(label)}</text>` +
    `<rect x="90" y="${i * 24 + 4}" width="${(300 * Number(v)) / max}" height="14" fill="#4c8dd6"/>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${rows.length * 24}">${bars.join("")}</svg>`;
  return { format: "svg", content: svg };
});
const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
```

The `theme` received is the app's **effective** theme (the auto/light/dark
setting already resolved) — a plugin never consults `prefers-color-scheme`
itself, otherwise it would ignore the setting's override.

### 12.3 `highlight:code` — highlighting of ` ```ini ` fences

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "ini-highlight",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "INI highlight",
  "description": "Highlighting of ```ini fences",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "highlights": ["ini"],
  "capabilities": ["highlight:code"]
}
```

`main.js`:

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("highlight/render", ({ code }) => {
  const html = code
    .split(/\r?\n/)
    .map((line) => {
      const e = esc(line);
      if (/^\s*[;#]/.test(line)) return `<span class="hljs-comment">${e}</span>`;
      if (/^\s*\[.*\]\s*$/.test(line)) return `<span class="hljs-section">${e}</span>`;
      const m = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.*)$/);
      if (!m) return e;
      return `${m[1]}<span class="hljs-attr">${esc(m[2])}</span>${esc(m[3])}` +
             `<span class="hljs-string">${esc(m[4])}</span>`;
    })
    .join("\n");
  return { html };
});
const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
```

Two rules illustrated here: the plugin **escapes the code itself** (its output
is HTML; the host then sanitizes it, allowing only `<span class="hljs-…">`,
any other tag or attribute is removed) and emits only existing `hljs-*`
classes — the colors come from the host's hljs theme, a plugin brings no CSS.
Project reminder: choose scopes by the **business concept** of the colored
language, not by technical hljs family.
