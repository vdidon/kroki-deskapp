# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Kroki Desk is a native Windows Markdown viewer (Tauri 2 / Rust backend +
static frontend) that renders Kroki diagram blocks (`mermaid`, `plantuml`,
`graphviz`, `d2`, `bpmn`, `svgbob`…) to SVG **with no server, no Docker, no
network**: all engines are embedded in the executable. The final binary is
a single standalone file.

The `README.md` documents the user-facing features, the list of engines and
the security notes in detail — read it before touching rendering or the CSP.

## Commands

Cargo aliases (`.cargo/config.toml`) drive the `src-tauri/` crate **from the
repo root**, without `cd src-tauri`:

```bash
# Release build (standalone binary → dist/kroki_deskapp-<version>.exe
#                 + unversioned twin dist/kroki_deskapp.exe)
cargo build-app

# Debug build/run (launches the app)
cargo run-app

# Rust lint / format
cargo lint-app && cargo fmt-app

# Linux AppImage (Linux machine/container only; requires tauri-cli)
cargo build-appimage

# Windows MSI installer (Windows only; requires the .kdext files in dist/)
cargo build-msi

# Debian/Ubuntu package (Linux only; requires the .kdext files in dist/)
cargo build-deb
```

The aliases forward arguments (`cargo run-app -- --flag`) and target the crate
via `--manifest-path`: `src-tauri` remains a standalone package (release profiles and
`target/` folder unchanged). Raw equivalent if needed: add `--manifest-path
src-tauri/Cargo.toml` to the cargo command, or use the old form `cd src-tauri && cargo …`.

`build-app`, `build-appimage`, `build-msi` and `build-deb` go through the `xtask/`
crate which,
after the build, **publishes the artifact into `dist/`** (gitignored): name suffixed
with the version (`kroki_deskapp-<version>.exe`, `kroki_deskapp-<version>.msi`,
`kroki_deskapp-<version>-linux-<arch>-<distro>`,
`…-linux-<arch>-<distro>.AppImage`, `…-linux-<arch>-<distro>.deb`
— `<distro>` = tag of the building distro,
read from `/etc/os-release`: `debian12` for the container, `ubuntu24.04`… ; a
native build and a Docker build therefore never overwrite each other in `dist/`) paired
with an unversioned file pointing at the
same content — hardlink preferred (works without admin rights,
NTFS as well as ext4; a Windows symlink would require admin/developer mode), copy
as a fallback (FS without hardlinks, e.g. Docker Desktop mounts). See `publish_dist`
in `xtask/src/main.rs`. The raw `cargo build --release --manifest-path
src-tauri/Cargo.toml` remains possible but publishes nothing into `dist/`.

There is **no frontend bundler**: `tauri.conf.json` points `frontendDist` at
`../ui` (static HTML/JS/CSS, `withGlobalTauri: true`, pre-built vendors in
`ui/vendor/` and `ui/renderer/vendor/`). No `npm install`/`npm build` step.
`bundle.active: false` → `cargo build` produces the bare `.exe`; the installers
all go through a config overlay and `tauri build` (see below).

### Windows installer (MSI)

`cargo build-msi` (Windows only — WiX v3 only runs there) produces
`dist/kroki_deskapp-<version>.msi` + twin. Same pattern as the AppImage: the
xtask bootstraps `tauri-cli` if needed then delegates to `tauri build --config
src-tauri/tauri.msi.conf.json` — it is **the overlay** that enables bundling,
`tauri.conf.json` keeps `bundle.active: false`. The portable binary remains the
main deliverable; the MSI comes in addition, it does not replace it.

What the overlay carries, and why:

- **The plugin selection page and the file associations**, in
  two fragments: `src-tauri/wix/installer.wxs` (tracked: native formats, App
  Paths) and `src-tauri/wix/plugins.generated.wxs` (gitignored, **generated on every
  build** by `xtask/src/bundled.rs` from the bundling strategy, see
  below: `PLUGIN_*` properties, components of the archives and of their
  associations, `PluginDlg` page). Wired in by `wix.fragmentPaths` +
  `wix.componentGroupRefs`; **all three** ComponentGroups must be
  referenced, otherwise the components of one are attached to no feature.
  Neither `bundle.fileAssociations` nor `bundle.resources` are used, for the
  same reason: the bundler puts what they declare into components
  **that it generates itself** — the executable's component for the associations, one
  per file with a random Id on every build for the resources — and WiX
  forbids adding a condition to a component declared elsewhere. Yet the
  archives must follow the checkboxes, and the associations of a format served by
  a plugin must follow **the plugin**, not the application. Four things to
  know before touching it:
  - **The `.kdext` files are declared as `<File>`** (generated fragment), one component conditioned by
    plugin under `INSTALLDIR\bundled-plugins`. The archives are **all** in
    the MSI's cab; only the checked ones are written to disk. The source path
    goes through `$(sys.SOURCEFILEDIR)` (the .wxs's folder) and not through a path relative to the
    cwd, which Tauri does not expose. On the Rust side, **nothing to do**:
    `plugins::seed_bundled` installs what it finds in
    `resource_dir()/bundled-plugins/`. Corollary: unchecking a plugin
    **already installed** does not uninstall it — seeding adds and updates,
    it never removes. The folder itself is an unconditional `CreateFolder`
    component (`BundledPluginsFolder`): it must exist even with nothing
    checked, otherwise the exe would install its embedded `latex-doc` (see
    « Plugin system » → shipped plugins).
  - **The associations have no page**: all are laid down, only the
    *level* varies — and it is chosen for what it does, not out of
    displayed caution. `Software\Classes\<.ext>\(Default)` only takes hold on a
    **virgin** extension: as soon as a `UserChoice` exists (HKCU, hash-protected since
    Windows 8), it is ignored and the application only appears as a suggestion —
    verified on `.md`, even though no other program is declared. It therefore brings
    nothing on a shared format, while costing something there: it overwrites the
    `(Default)` in place (`htmlfile`, `txtfilelegacy`) and MSI does not restore it on
    uninstall. Hence `(Default)` + `OpenWithProgids` for `.kdws .kdext`
    **and all the plugins' extensions** (this is what makes the
    double-click work, the installer's whole purpose; installing a plugin is an
    explicit choice, shared or not — `.tex`, `.csv` included — and an existing
    `UserChoice` wins anyway), and `OpenWithProgids`
    **alone** for the shared native formats (`.md`, `.txt`, `.html`…).
  - **The plugin selection conditions their associations.** An extension
    only makes sense if the plugin that reads it is there: each `Assoc<Plugin>`
    component (ProgID `KrokiDesk.<Plugin>` + extensions read from the
    manifest) carries the condition `PLUGIN_<ID> = "1"`, the components of the
    native formats are unconditional. Their GUID is derived from the plugin's
    id (`stable_guid`): no auto-GUID under HKMU. A single family of properties to know, `PLUGIN_*`,
    all `Secure="yes"` — without that, the UI running under the user account would not
    pass them to the elevated execution server and everything would be installed
    whatever is unchecked. Being public, they also drive the silent
    installation (`msiexec /i … /qn PLUGIN_CSV_TABLES=1`).
  - **The dialog is inserted by override.** Tauri imposes `WixUI_InstallDir`,
    which has no customization page; `PluginDlg` slips in between
    `InstallDirDlg` and `VerifyReadyDlg` via `Publish` `NewDialog` entries with a higher
    `Order` (5 — WixUI_InstallDir goes up to
    4), reusing its path validation condition. Same trick as the Tauri
    template, which skips the license at `Order="2"`. The page has a fixed size:
    6 plugins at most, the xtask fails beyond that.

  The exe is designated there by `[INSTALLDIR]kroki_deskapp.exe` and **not** by the
  file reference `[#Path]`, although the latter is more robust to renaming: Tauri
  injects the `componentGroupRefs` into its `External` feature while the exe
  belongs to `MainProgram`, and MSI refuses that a registry value reference
  a file of another feature — **ICE69, a link error**, not a
  warning. Renaming the binary therefore requires editing the fragment.
- ***App Paths* key** (`AppPath` component of the same fragment,
  unconditional): makes the exe launchable by name via ShellExecute
  (`start kroki_deskapp "doc.tex#eq:x"`, `Start-Process`, Win+R) without touching
  the PATH — it is the documented way for an agent to open a document at a
  reference. Bash and CreateProcess do not read it.
- **`wix.template` replaced** (`src-tauri/wix/main.wxs`): copy of the tauri-bundler
  template (tauri-cli 2.11.4) with **two** deviations, flagged in comments:
  the ProductCode taken from `TAURI_KROKI_DESK_PRODUCT_CODE` (see « A single multilingual
  MSI » below), and the Start menu shortcut no longer has
  `Icon="ProductIcon"`. That attribute makes the `.lnk` point to
  `%WINDIR%\Installer\{ProductCode}\ProductIcon`, a folder deleted on every major
  update (new ProductCode on every build); the taskbar pin, a **frozen copy**
  of the `.lnk` that MSI never rewrites, lost its icon. Without the attribute, the icon is
  read from the exe (stable path) — like the template's Desktop shortcut, which never
  had the defect. Price: the template no longer follows tauri-cli
  (`TAURI_CLI_VERSION = "^2"`, not pinned) — to be
  re-synchronized (diff against the upstream of the installed version) on an
  upgrade that touches `main.wxs`.
- **`wix.upgradeCode` pinned** (`03A2A6F1-…`): this is exactly the value that
  Tauri derives today (UUID v5 of `"Kroki Desk.exe.app.x64"`), copied
  so that a future change of `productName` does not break the update
  chain — without this GUID, each version would install *next to* the previous one.
  Never modify it.
- **`bannerPath` / `dialogImagePath`**: `src-tauri/wix/banner.bmp` (493×58,
  banner of the inner pages) and `dialog.bmp` (493×312, welcome/finish)
  replace the default WixUI logo (red CD). Sizes imposed by WixUI;
  generated from `icons/icon.png` by `uv run scripts/wix_images.py`, to be
  re-run if the icon changes.
- **A single multilingual MSI** (en-US base + de-DE, es-ES, fr-FR, it-IT,
  ja-JP, ko-KR, pt-BR, zh-CN; 3.25.0, nine languages since 3.27.0):
  `wix.language` maps each language to its `.wxl` (`src-tauri/wix/locales/`:
  our dialog and ProgID texts as `!(loc.Kd…)`, plus Tauri's `LaunchApp`…
  redefined to be translated — no `Kd…` Id may contain one of Tauri's, the
  bundler tests them by substring), so `tauri build` produces one MSI per
  language. `xtask/src/msi_lang.rs` then merges them: `torch -t language`
  computes the en-US → fr-FR transform, which goes into the base's
  `_Storages` table under its LCID (`1036`), and the summary's *Template*
  lists every language (`x64;1033,1036`). The base gets a transform too
  (`1033`, adding an inert `KrokiDeskInstallerLanguage` property — torch
  refuses two identical databases), so that every language choice names an
  existing transform. The CJK languages change the database codepage (932,
  936, 949 vs 1252): applying their transform strictly fails on
  `ChangeCodepage`, but `torch -t language` writes the suppression of that
  error into the transform itself, which is what Windows Installer obeys —
  every `.wxl` text must exist in its codepage, otherwise `light` fails.
  Windows Installer applies the transform matching the
  user's **display language** by itself (undocumented but long-standing
  behavior); `ProductLanguage=1033` / `1036` on the command line forces the
  choice. `TRANSFORMS=:1033` does **not**: the automatically chosen transform
  is applied first, those of `TRANSFORMS` on top (verified on a French
  Windows). Prerequisite,
  checked by the xtask: the per-language MSIs share their ProductCode. `light`
  resolves `Product Id="*"` once **per language**, hence two codes; so
  `build_msi` draws one per build (`stable_guid` of version + time + pid, still
  new at every build = major upgrade) and passes it as `TAURI_KROKI_DESK_PRODUCT_CODE` (the `TAURI` prefix is
  mandatory: tauri-bundler clears the environment of the WiX tools except
  `SYSTEMROOT`/`TMP`/`TEMP` and `TAURI*` variables), which
  `main.wxs` uses when defined (`*` otherwise) — the template's second
  deviation from upstream. A transform changing the ProductCode would break
  the upgrade chain. `msi.dll` is called directly (`windows`
  crate), not the SDK's `WiSubStg.vbs`. To replay only the merge on the
  per-language MSIs of the last build (seconds, no cargo nor WiX):
  `cargo run --manifest-path xtask/Cargo.toml -- msi-merge`. Adding a language = a `.wxl`, a
  `wix.language` entry and a `msi_lang::OTHERS` entry.
- **`webviewInstallMode: skip`**: WebView2 is preinstalled since Windows 10
  2004. The other modes download at install time (filtered network) or
  add 127 to 180 MB.
- **Plugin bundling strategy** (`xtask/src/bundled.rs`): a
  text file at the root, one `<id> [on]` line per plugin (`on` = checked
  in the MSI / installed at first launch of the `.deb`), in the page's
  order. `bundled-plugins.txt` (gitignored — the workstation's selection) takes precedence
  if it exists, otherwise `bundled-plugins.default.txt` (tracked — the default
  behavior). **Sole source of the list**: the displayed name and the
  extensions come from the `manifest.json` read **inside `dist/<id>.kdext`** — not
  in `plugins/<id>/`, which may be an unresolvable junction in the
  `.deb` container. `bundled::stage` copies the retained archives to
  `src-tauri/bundled-plugins/` (gitignored, **emptied on every build**) — this is
  where the fragment's `<File>` entries read them — and fails with a pointer to
  `python build_dist.py --plugins-only` if one is missing; `build_dist.py` (which
  packs and bundles by default, see § « Linux builds ») chains the two
  steps by itself. The `bundled-plugins/` subfolder is not cosmetic:
  since `resource_dir()` is the exe's folder, a portable binary launched from
  `dist/` would otherwise install all the neighboring `.kdext`. The `.deb` goes through the
  **same** strategy (see next §). To re-read what will be generated without
  bundling: `cargo run --manifest-path xtask/Cargo.toml -- bundled`.
  **Distribution channels**: `KROKI_BUNDLED_PLUGINS` (path relative to the
  repo) imposes the strategy and bypasses the choice above — an imposed
  file that is absent is an error, never a fallback. `build_dist.py
  --channel public|local|all` sets it (`public` = `bundled-plugins.default.txt`
  even if `bundled-plugins.txt` exists; `local`, default = choice above;
  `all` = public then local in one pass — binaries once, MSI and `.deb`
  twice, `dist/` ends up on the local installers),
  passes it to the `.deb` container (`-e`), in `public` only copies
  each produced artifact into `dist/public/<version>/` (the `.kdext`: those
  of the strategy only; no folder for `local`) and after the MSI and the `.deb` compares the content of
  `src-tauri/bundled-plugins/` against the strategy — mismatch = stop. Only MSI and
  `.deb` differ from one channel to the other; `dist/` at the root remains overwritten
  by the last build, whatever its channel.

The MSI is **per-machine** (`Program Files`, UAC at install time): Tauri does not
offer a per-user MSI without entirely replacing `wix.template`.

The first build downloads WiX 3 into `%LOCALAPPDATA%\tauri`.

### Debian/Ubuntu package (.deb)

`cargo build-deb` (Linux only — the bundler sets Unix permissions there and
assembles the `ar` archive) produces `dist/kroki_deskapp-<version>-linux-<arch>-<distro>.deb`
+ twin. Same pattern as the AppImage and the MSI: the xtask bootstraps `tauri-cli`
if needed, copies the `.kdext` via `bundled::stage`, generates
`src-tauri/tauri.deb.generated.json` (the tracked `tauri.deb.conf.json` completed
with the plugins: merging Tauri configs **replaces** arrays, a partial overlay
would erase the native `fileAssociations`) then delegates to
`tauri build --config` on that file. The distributable is the one
built in the container (`bash /app/scripts/linux_deb_build.sh`, no tool
downloaded hence no cache volume): the distro tag in the name says so.

It is the Linux counterpart of the MSI, but **the two mechanisms have almost nothing in
common** — most of what follows explains how.

- **No plugin selection page, and there cannot be one.** A
  `.deb` has no interface: `debconf` only displays on the command line and
  is bypassed by graphical installers. The choice is therefore expressed by the
  **destination**: the generated `bundle.resources` places the `on` plugins
  in `bundled-plugins/` — which `plugins::seed_bundled` installs at first
  launch, exactly as under Windows — and the others in
  `example-plugins/`, **which nothing reads**. Everything is thus embedded as in the
  MSI's cab, the same ones are installed by default, and the others
  are installed from the Plugins dialog (« Ajouter un plugin… » — "Add a plugin…" — pointing at
  `/usr/lib/Kroki Desk/example-plugins/`). No Rust code changed:
  `resource_dir()` is `/usr/lib/<productName>` on Linux, and that is
  precisely where the bundler drops the resources.
- **The associations take two files, not one.** `MimeType=` in the
  `.desktop` merely declares the types the application can open; it
  says **nowhere** that a `.kdws` is of that type. Hence
  `src-tauri/linux/kroki-desk.xml`, a *shared-mime-info* package placed in
  `/usr/share/mime/packages/` (`deb.files`), which defines
  `application/x-kroki-desk-{session,plugin}` with their `<glob>`s. The xtask derives from it
  `kroki-desk.generated.xml` (gitignored, it is the one that gets installed) by
  adding a `text/x-kroki-desk-<ext>` type (`<sub-class-of>` `text/plain`)
  for each extension of an installed plugin **without a standard type**; those
  that have one (`STANDARD_MIME`: `.tex` → `text/x-tex`, `.csv` →
  `text/csv`…) keep theirs — a standard extension forgotten in the table
  would receive a type of its own that would supplant the standard one. Each is `<sub-class-of>` its real form (zip, json,
  text): this is what keeps generic handlers available, and
  above all what makes the **glob win against content detection** — a
  `.kdext` is a zip, without this lineage sniffing would classify it as
  `application/zip`.
- **Nothing is imposed as the default application, and there is nothing to
  impose.** Where Windows distinguished `(Default)` and `OpenWithProgids`, Linux
  only has `MimeType=` (= "can open"); the default is decided in the
  user's `mimeapps.list`, which a package must not write. Since the
  types specific to the application and its plugins have **only one** declared
  handler, the desktop environment assigns them to it by itself: the
  double-click works without claiming anything. Same result as the MSI, without the
  compromise.
- **A `.desktop` template is mandatory, for a single character.** The bundler's
  one writes `Exec={{exec}}` **without an argument flag**: the launcher has
  nowhere to pass the file, and a double-click would open the empty application.
  `src-tauri/linux/kroki-desk.desktop` takes the upstream template and
  adds `%F`. That is what makes all the associations operative.
- **`text/plain` is deliberately absent** from `fileAssociations` — hence
  `.txt` is not associated, the only deviation from the MSI. Linux has no per-extension
  granularity: `.txt` *is* `text/plain`, and declaring it would make Kroki
  Desk appear in the "Open with" of every text file by inheritance (`.py`,
  `.conf`, `.log`…) — which `expand_dropped_docs` **silently ignores**, hence
  a click with no effect. `text/x-tex` has the same defect on a smaller scale (it also covers
  `.sty`, `.cls`, `.ltx`): accepted, because `.tex` is a
  headline feature.
- **The `postinst`/`postrm` scripts** refresh the MIME database, the application
  index and the icon cache. Redundant with the dpkg triggers of
  `shared-mime-info` and `desktop-file-utils` — but those packages are only
  *recommended*, hence the `command -v` guards and the `|| true`: a cache not
  regenerated must not leave the package half-configured. They are **run
  by dpkg as root**: their line endings must stay LF, which
  `.gitattributes` enforces (a `#!/bin/sh\r` makes configuration fail without saying
  why).
- **`depends: ["libc6 (>= 2.36)"]`** is added by hand. Tauri already pushes
  `libwebkit2gtk-4.1-0` and `libgtk-3-0` without being asked (both
  install on Debian 12 and Ubuntu 24.04, where `libgtk-3-0t64` *provides* the
  old name), but it does **not** call `dpkg-shlibdeps`: without a declared
  glibc floor, the package would install on Ubuntu 22.04 only to crash at
  launch. `2.36` is bookworm's glibc, hence the container's — a native
  build on a more recent distro produces a package that **under-declares** its
  floor: one more reason to distribute only the `-debian12`.

The package is **per-machine** (`/usr/bin`, `/usr/lib`); plugins, settings and
sessions stay in `~/.config/kroki-deskapp` and survive
uninstallation — this is also why plugin seeding happens at the first
launch of each user, and not at install time.

### Linux builds

The Linux tooling (Dockerfile, build and test scripts) lives in
`scripts/`. `python build_dist.py` (repo root, cross-platform Windows/
Linux) generates **all of the version's artifacts** in one command
(Docker daemon started required for the Linux steps). **Everything is produced by
default**, in order of increasing cost — nothing slow must be able to
delay a cheap artifact: the `.kdext` of all the plugins in
`plugins/` (via `pack_plugin.py` — a folder = a plugin as soon as it carries a
`manifest.json`, junctions to other repos included), the host's native binary
(`cargo build-app` — exe on Windows, Linux binary on Linux), the **MSI
installer**, then the Docker steps: build of the `kroki-linux-build` image, AppImage,
bare Linux binary and **`.deb` package** → `dist/`, each versioned + unversioned
twin.

Each step is removed by its `--skip-…` (`--skip-plugins`, `--skip-native`,
`--skip-msi`, `--skip-appimage`, `--skip-binary`, `--skip-deb`) or isolated by
its `--…-only` (`--native-only`, `--plugins-only`, `--msi-only`, `--deb-only`,
mutually exclusive); added to these are `--skip-image-build`, `--compile-only`
(Linux cargo build for verification only, no artifact) and `--test` (headless
Xvfb runtime test via `scripts/linux_runtime_run.sh`, incompatible with the
`--…-only`). Two dependencies between steps: the MSI is **skipped outright outside
Windows** (WiX v3 does not run there — error only if `--msi-only` requires it),
and MSI as well as `.deb` embed the `.kdext`, so `--skip-plugins` makes them
reuse those already in `dist/` (useful to re-run an installer without
re-packing) instead of removing them from the bundle. The `.deb` goes through Docker
even on a Linux host: the distributable is the bookworm one. Since the
Linux artifacts are suffixed with the build distro tag (see § « Commands »),
native and Docker coexist in `dist/` on a Linux host; the distributable
is the `-debian12`. The Windows build is only possible from Windows (no
cross-compilation nor Windows Docker).

Three deliverable formats, on a native Linux machine or via the `kroki-linux-build`
Docker image (`docker run` commands in the header of
`scripts/Dockerfile.linux`):

- **Semi-dynamic binary** — `cargo build --release` (or `cargo build-app`).
  Crates statically linked (rustls, no openssl), but WebKitGTK/GTK3/glibc
  dynamic: the target machine must have `libwebkit2gtk-4.1` installed.
- **Standalone AppImage** — `cargo build-appimage` from the root (a single
  portable file, GTK/WebKitGTK embedded → `target/release/bundle/appimage/`).
  The alias launches the `xtask/` crate, which uses `tauri-cli` from the PATH if it is
  there, otherwise installs it one-shot in `xtask/target/tools/` (local to the
  repo, gitignored) — only cargo is required — then delegates to `tauri build
  --config src-tauri/tauri.appimage.conf.json`: it is this overlay that enables
  bundling — `bundle.active` stays `false` in `tauri.conf.json`, so Windows
  builds still only produce the `.exe`. On the other hand the Dockerfile's system packages
  are needed (including `xdg-utils`), and the first build
  downloads linuxdeploy/appimagetool from GitHub. After bundling, the
  xtask publishes the AppImage into `dist/` (versioned + unversioned twin, see
  § « Commands »). In Docker: `bash /app/scripts/linux_appimage_build.sh`
  wraps the alias (`/target` volume). The xtask also exports `NO_STRIP=1` (the strip
  embedded in linuxdeploy does not read the RELR sections of recent distros;
  no-op anyway, libs already stripped) and **softens the GTK hook** of the
  plugin cached in `~/.cache/tauri`: upstream forces `GDK_BACKEND=x11`
  (tauri#8541), patched to "x11 only if `DISPLAY` exists" so that
  the AppImage also launches under pure Wayland without XWayland. The
  **distributable** AppImage is built in the container (bookworm glibc =
  broad compatibility): built on a recent machine, it embeds its own
  glibc/libs and will not run on older systems.
- **`.deb` package** — `cargo build-deb`, see § « Debian/Ubuntu package (.deb) ».
  Same semi-dynamic binary as the first mode, but installed
  (`/usr/bin` + `/usr/lib`), with the file associations, the shipped
  plugins and a clean uninstall. `sudo apt install ./<package>.deb` —
  **not** `dpkg -i`, which resolves no dependencies.

### Tests (webview driving, requires the running app)

The tests are Node ESM scripts that drive the **running**
application — there is no `cargo test` covering the UI.

```bash
# 1. Launch the app with the CDP debug port enabled (PowerShell):
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
cd src-tauri ; cargo run

# 2a. CDP harness (tab drag, detaching, screenshots):
node tests/cdp.mjs <port> <action> [page-title-filter]
#   actions: report | where | focus | reorder | tear-cancel | invoke-detach-at x y | shot

# 2b. Engine test via the local Kroki API (POST to 127.0.0.1:8442):
node tests/test_new_engines.mjs
#   KROKI_URL=http://127.0.0.1:<port> to target another port

# 2c. Multi-document search test (standalone: creates/opens/closes
#     its own fixtures via the Tauri commands):
node tests/test_global_search.mjs <port>

# 2d. In-document search test (Ctrl+F) and of the Aa / ab / .* options
#     of both searches — same principle, standalone:
node tests/test_document_search.mjs <port>

# 2e. Loading overlay test (standalone): presence on a heavy render,
#     absence on a fast render, and animation that survives main-thread
#     blocking (sampling by CDP screencast):
node tests/test_loading.mjs <port>
```

Two suites, by contrast, run **without the application or npm** (pure modules
run against the repo's vendors) — run them after any change to LaTeX
rendering or to the source view:

```bash
node tests/test_latex_plugin.mjs [file.tex …]   # latex-doc plugin + highlighting
node tests/test_hlsplit.mjs      [file.md …]    # split of highlighted lines
node tests/test_i18n.mjs                        # language catalogs vs. code
```

`test_i18n.mjs` is to be run after any change to a displayed text (see
« Interface language » below).

### Type checking (JSDoc, no build step)

Every shipped JS file (`ui/js`, `ui/renderer`, `plugins/latex-doc`) starts
with `// @ts-check` and is type-checked in **strict** mode by the TypeScript
compiler — types live in JSDoc comments and in `.d.ts` files, the shipped JS
is unchanged (no transpilation, nothing added to the runtime). Run after any
JS change; requires a global `tsc` (TypeScript ≥ 5, no npm install in the repo):

```bash
tsc -p jsconfig.json                      # main window + render webview
tsc -p plugins/latex-doc/jsconfig.json    # latex-doc plugin (worker + Node, no DOM)
node tests/test_ipc_types.mjs             # types/ipc.d.ts vs. the Rust commands
```

- `types/` (repo root, **not** under `ui/`, hence not embedded in the binary):
  `ipc.d.ts` is the front ↔ back contract — `Commands` (command → args/return)
  and `Events` (event → payload), hand-copied from the Rust signatures and serde
  structs; `globals.d.ts` types `window.__TAURI__` on it, so `invoke`/`listen`
  check the command name, the arguments and the returned shape. **Changing a
  `#[tauri::command]`, a serialized struct or an emitted payload = updating
  `ipc.d.ts`**: `test_ipc_types.mjs` catches command names, argument names and
  `Option` mismatches, not return types. `app.d.ts` = shared window state
  (`View`, `AppState`); `plugin-protocol.d.ts` = protocol v1 messages and the
  `kd` worker global (reusable by third-party plugin authors);
  `vendor.d.ts` / `renderer.d.ts` = the **used** surface of the vendored
  globals (main window / render webview) — extend them when using a new vendor
  API rather than casting to `any`.
- `plugins/latex-doc/vendor/unified-latex.esm.d.ts` types the vendored parser
  (AST as a discriminated union on `type`); it sits next to the bundle so that
  `tsc` never parses the 245 KB file. Outside `packInclude`, hence not packed.
- Conventions: DOM elements that `index.html` guarantees are cast
  (`/** @type {HTMLInputElement} */ (document.getElementById("x"))`), never
  guarded at runtime; no `any` / `@ts-ignore` without a comment saying why.

A plugin mounted by junction from another repo carries its own
tests there.

## Versioning (to be handled proactively)

Scheme **`x.y.z`**, **single** source of truth: the `version` field of
`src-tauri/Cargo.toml`. Everything else derives from it via `env!("CARGO_PKG_VERSION")`
(window title, `kroki.rs` user-agent, `/v1/health` `server.rs`) and
`tauri.conf.json` no longer has a `version` field — **never** write the number
anywhere other than the single place in `Cargo.toml`.

| Component | Increment when the change is… |
| --- | --- |
| **`z`** | a **bug fix** |
| **`y`** | a **feature addition** |
| **`x`** | a **complete overhaul** of the program |

Incrementing a component resets those to its right to **zero** (`1.4.1` → `1.5.0`
for a feature; → `2.0.0` for an overhaul).

**Expected agent procedure** — as soon as a change meant to be
built alters the user-visible behavior, the agent takes the initiative,
in the **same commit** as the change:

1. determine the component from the nature of the change (bug → `z`,
   feature → `y`, overhaul → `x`);
2. update `version` in `src-tauri/Cargo.toml`;
3. add an entry dated today at the top of `CHANGELOG.md` (*Keep a Changelog*
   sections: "Fixed", "Added"… + the link line at the bottom; entries are
   written in English) —
   this file is **embedded in the binary** via `include_str!` (command
   `get_changelog`, the What's new dialog « Nouveautés », reachable from the
   Info dialog « Informations »): it is therefore always
   in sync with the built version, with no effect before a rebuild;
4. mark the fix/feature commit with the 🔖 emoji (see history
   `🐛🔖 fix… → 1.4.1`, `✨🔖 feat… → 1.4.0`).

Propose the chosen number and **ask for confirmation** if the category is
ambiguous (e.g. fix vs. small feature); otherwise proceed. **No
bump** for work with no effect on the shipped binary: internal refactor,
documentation, reorganization, build `chore`.

## Rendering architecture (the key point)

A diagram's rendering goes through **4 runtime environments** depending on its type.
Everything goes through the Tauri command `render_diagram` (`commands.rs`), which calls
`engine::render_local` (`engine.rs`). The dispatch:

- **Native Rust** (`NATIVE_TYPES = svgbob, pikchr`) — synchronous rendering in the
  process via the `svgbob` / `pikchr` crates.
- **JVM** (`JAVA_TYPES = plantuml, c4plantuml, ditaa`) — jars embedded via
  `include_bytes!` (`assets/plantuml-mit.jar`, `assets/ditaa-0.11.0-standalone.jar`),
  extracted to disk then run as a subprocess **only if Java is
  detected** (`java_available`). Otherwise an explicit message. ditaa has its own
  pipeline (`render_ditaa`, ditaa args + `--svg`, not PlantUML's `-pipe`):
  intercepted before the `JAVA_TYPES` guard in the dispatch.
- **TeX** (`TEX_TYPES = tikz`, 3.18.0) — **nothing embedded**: `render_tikz`
  compiles with the workstation's distribution, **only if `latex` and `dvisvgm`
  are on the PATH** (`tex_available`, probed once). Full LaTeX document
  (Kroki form) or bare `tikzpicture`, wrapped by `tikz_document`. Chain:
  `latex` → DVI with the PGF driver `pgfsys-dvisvgm.def` (passed on the command
  line, hence valid for any document), then `dvisvgm --no-fonts`, which
  converts text to paths. Four pitfalls, all handled:
  **(1)** dvisvgm only has outlines for **Type 1** fonts — with
  `\usepackage[T1]{fontenc}` alone (EC fonts, bitmap), it writes the SVG
  **without the text**, as a mere warning; hence `lmodern` preloaded before
  the class if installed, and `missing_glyph_fonts` which turns
  the warning into an error;
  **(2)** its glyph `id`s (`g20-11`) are the same in every SVG:
  inserted in the same page, two figures would steal each other's glyphs —
  `scope_svg_ids` prefixes them with a hash of the source;
  **(3)** MiKTeX opens its package installation window mid-render —
  `--disable-installer` (MiKTeX-specific option, hence `TexTools::miktex`);
  **(4)** a first call to a fresh MiKTeX rebuilds its databases (~15 s) —
  60 s timeout per step, process killed beyond that. Security: temporary
  folder, `-no-shell-escape`, `openin_any=p` (TeX Live). Real test
  (skipped without TeX): `cargo test --manifest-path src-tauri/Cargo.toml tikz_tests`.
- **JS/WASM** (`JS_TYPES`: mermaid, graphviz, d2, bpmn, excalidraw, vega/vegalite,
  dbml, erd, nomnoml, wavedrom, bytefield) — delegated to a **hidden webview** (label
  `RENDERER_LABEL = "renderer"`, see `engine::ensure_renderer`). The backend emits
  a `render-job` event; `ui/renderer/renderer.js` runs the JS engine and
  calls back `render_job_done`; `engine::complete_job` unblocks the wait. This
  webview is started **at boot** (`setup` in `main.rs`) to amortize the
  loading of the engines.

Type **aliases** (`dot`→graphviz, `c4`→c4plantuml, `vega-lite`→vegalite,
`puml`→plantuml…) are resolved by `engine::resolve_alias`, **duplicated on the
frontend side** — keep both in sync when adding an alias.

`renderer.js` maps each type to a function in the `ENGINES` object. Non-trivial
details: **d2** is a dynamic import (~8 MB) and its calls are
**serialized** (a single compile/render exchange at a time on its worker); **dbml**
and **erd** (in-house parser `ui/renderer/erd.js`) generate DOT that is then rendered by the
already-loaded graphviz WASM; **bpmn** renders in an offscreen container and
`addBpmnWatermark` adds the bpmn.io logo in a strip below the diagram — the
bpmn-js license requires it fully visible and unoverlapped, `saveSVG()` drops
it: never remove it; **vega**
uses the `expressionInterpreter` (no `eval`); **excalidraw** is a
dynamic import (~8 MB) and renders via `exportToSvg` — its handwriting fonts (14 MB) are
**not** embedded: empty `@font-face` rules are removed and the families rewritten to a
system font (`fixExcalidrawFonts`).

### Optional external server

If an external Kroki server is configured in the settings (« Réglages »), `kroki::render`
(`kroki.rs`) takes over via HTTP `reqwest` and covers **all** types. The
cache (`KrokiState.cache`) only stores successes, key = hash(mode, type,
source, options); a re-render therefore naturally retries errors.

## Backend modules (`src-tauri/src/`)

- `main.rs` — Tauri bootstrap: registers `single-instance` **first**
  (forwarding the args of a 2nd invocation), all the `State`s, the commands, and the
  `setup` that starts watcher + render webview + HTTP server + 1st window.
- `commands.rs` — all the `#[tauri::command]` commands (front↔back boundary).
- `engine.rs` — dispatch of the built-in rendering (see above).
- `manager.rs` — windows, tabs, detaching/reattaching by drag
  (Win32 `WindowFromPoint` on mouse release).
- `drop_target.rs` (Windows) — custom Win32 `IDropTarget` installed on every
  window. wry only extracts `CF_HDROP` (Explorer); we revoke its target and
  register our own to also accept paths as `CF_UNICODETEXT` /
  `text/uri-list` (drags from Cursor/VS Code). Opening is done on the Rust side;
  the overlay is driven by the `drop-overlay` event (see `filedrop.js`).
- `plugins.rs` — plugin registry (see « Plugin system » below):
  manifest scan, install/uninstall of `.kdext` (zip), custom `plugin://`
  protocol serving files to the workers, confined `plugin_read_sibling`.
- `session.rs` — `.kdws` sessions (JSON: windows → ordered files + active
  tab): parse/resolution (paths relative to the `.kdws` folder, `/` on
  write), opening **always in at least one new window** (the target
  window is reused for window 1 only if it has no tab —
  startup on a `.kdws`, the « déposer un fichier » ("drop a file") window; otherwise the session
  opens alongside without mixing with ongoing work, the following ones always
  new; focus and `session-report` go to the session's 1st window;
  invalid entries reported via the `session-report` event → toast) and saving
  (command `save_session`, relativized paths). Routing through
  `manager::open_mixed_paths`, common funnel for CLI / second instance / drops /
  open dialog. No automatic restore at startup.
- `server.rs` — local Kroki HTTP API (`tiny_http`), 127.0.0.1 only.
- `kroki.rs` — external server client + cache.
- `watcher.rs` — auto-reload on disk change (`notify`).
- `updates.rs` — update check (3.28.0), **notification only**: `check_update`
  reads the latest GitHub release (`releases/latest` of the `repository` field
  of `Cargo.toml`, single source) and compares its tag to the version. Nothing
  is downloaded by the app: two links opened in the browser, the release page
  and the asset matching the installation (`updates::Format`: the
  `bundled-plugins` folder, created by both installers, means MSI on Windows /
  `.deb` on Linux; otherwise portable `.exe`, `$APPIMAGE` → AppImage, bare
  binary), picked from the API's `assets` by name suffix — a renamed artifact
  in `publish_dist` must stay matched there — with the release page as
  fallback; only `…/releases/download/` URLs of the repo are accepted. The
  Tauri updater was ruled out: no portable exe nor `.deb`, and the MSI is
  rewritten by `msi_lang` after `tauri build`, which would invalidate its
  signature. Automatic check at each window's boot (`ui/js/updates.js`),
  but the backend lets through only the first of the process, at most once a
  day (`SettingsData::update_checked_at`, stamped **before** the request so a
  filtered network is not hit at every launch), only if
  `SettingsData::update_check`, and silently on failure; on-demand check from
  the Info dialog, errors shown. The only network request the app makes on its
  own — keep it that way (README « Security notes »).
- `journal.rs` — application log (3.29.0): last 500 diagnostic entries, in
  memory only, one log for the whole process. The release binary has no
  console, so **write diagnostics through `journal::info/warn/error(source,
  msg)`, never a bare `eprintln!`** (it still goes to stderr for `cargo
  run-app`); messages stay English like any log output. Windows add their
  plugins' entries via `plugin_log` (`host/log`, failures and breakdowns seen
  by the host, rate-limited in `plugins.js`); each entry is broadcast as
  `journal-entry`. Besides failures it records context (launch line, Java/TeX
  probes — logged where they are probed, never probed just to log —, local
  API, diagram render errors in `render_diagram`, update checks, plugin worker
  start-up and per-document `document/transform` timing); log a URL through
  `journal::redact_url`. Shown by the « Journal » dialog (`ui/js/journal.js`), opened
  from the Info dialog (everything) or a plugin card (filtered).
- `state.rs` — `AppState`, `SettingsState`, etc. (settings persisted in
  `%APPDATA%\kroki-deskapp\settings.json`, next to `plugins\` and, like it,
  outside the Tauri identity folder — `plugins::app_dir`).

## Frontend (`ui/`)

- `ui/js/` — main window: `render.js` (markdown-it + Kroki fences, calls
  `render_diagram`), `tabs.js`, `teardrag.js` (tab detaching), `filedrop.js`,
  `settings.js` (settings + access to the Plugins dialog), `theme.js` (auto/light/dark
  override), `info.js` (« Informations » dialog: version, runtimes,
  access to What's new, the log and the third-party licenses), `journal.js` (« Journal » dialog, see
  `journal.rs`), `notices.js` (« Licences tierces » dialog: `fetch` of
  `ui/third-party-notices.txt`, see « Third-party notices » below), `changelog.js` (« Nouveautés » dialog, dedicated markdown-it
  without Kroki fence + DOMPurify), `export.js` (export of the active tab's
  rendering as standalone HTML: inlined CSS, local images as data-URI via the
  `export_html` command), `findword.js` (highlighting of occurrences of the selected
  word),
  `globalsearch.js` (search panel across all tabs, `Ctrl+Shift+F`:
  searches the source re-read via `read_document`, jumps to the line via
  `scrollToLine` and highlights via the Custom Highlight API `search-occurrences`),
  `docsearch.js` (search bar in the displayed document, `Ctrl+F`, see
  below), `searchopts.js` (`Aa`/`ab`/`.*` options → RegExp, see below),
  `textmatch.js` (occurrences → `Range`, shared by the three searches),
  `icons.js` (registry of toolbar icons, see below),
  `loading.js` (loading overlay, see below),
  `main.js`, `app.js` (helpers + `invoke` re-export).
- **Interface language** (3.25.0): English (reference and fallback),
  French, and since 3.27.0 German, Spanish, Italian, Japanese, Korean,
  Brazilian Portuguese (`pt`, also served to Portugal) and Simplified Chinese
  (`zh`; a Traditional Chinese system — `zh-TW`/`HK`/`MO`/`Hant` — gets English,
  `i18n::language_code`). Plural rules exist twice: `Intl.PluralRules` on the
  front, the hand-written `plural_category` (`i18n.rs`) on the Rust side — a
  language with `few`/`many` forms (Russian, Polish…) needs a branch there. **Single source** for front and back: `src-tauri/i18n/<lang>.json`,
  flat `key → text` objects with `{param}` placeholders, a text depending on a
  number being a CLDR plural object (`{"one": …, "other": …}`, picked by
  `count`). The Rust side embeds them (`include_str!`, `i18n.rs`) and reads
  them through the `tr!("key", name = value)` macro; the frontend receives the
  current catalog, already completed with English, from `get_i18n` and reads
  it through `t("key", params)` (`ui/js/i18n.js`). Static HTML carries
  `data-i18n` / `data-i18n-html` / `data-i18n-title` / `-placeholder` /
  `-aria-label`; the text left in `index.html` is only the English fallback,
  replaced before the first paint (`data-i18n-pending` keeps the window hidden
  until then). Setting `SettingsData::language` = `auto` (default: the OS UI
  language via `sys-locale`, English when it is not shipped) or a code;
  propagated by the `locale-changed` event (same `from` protocol as
  `theme-changed`), each window reloading its catalog then re-rendering.
  Text written by JS that stays on screen must be recomputed when displayed or
  subscribed through `onLocaleChange`. The language is a **global** on the Rust
  side (errors are born deep in modules without an `AppHandle`).
  **Deliberately English whatever the setting**: the local HTTP API
  (`server.rs` wraps rendering in `i18n::in_reference_language`, a per-thread
  override) and the CLI/log output — technical interfaces read by tools; the
  messages that need Java/TeX keep the phrase "external Kroki server", which
  the shipped skill looks for. One gap: the wrapper errors written by the
  hidden render webview (`ui/renderer/i18n.js`, its own `t()` reloaded on
  `locale-changed`) follow the interface language even through the API — the
  JS engines' own messages are English anyway. Keys are literals: `tests/test_i18n.mjs` collects
  them (`t("…")`, `tr!("…")`, `data-i18n*`) and checks catalog parity,
  parameters, unknown and dead keys — a key built at runtime is declared by an
  `i18n-dynamic: <prefix>` comment. Plugins receive the interface language as
  `locale` (protocol §6.1: `initialize`, `document/transform`, `fence/render`,
  plus the `locale/changed` notification, sent from `onLocaleChange` in
  `plugins.js`) — for their *messages*; labels written into a rendering
  follow the document (latex-doc: babel/polyglossia). Adding a language = adding a catalog to
  `CATALOGS` (`i18n.rs`) with its `language.name` endonym.
- **Two zooms** (3.17.0): text zoom (`Ctrl+wheel`, `setZoom`) and
  page zoom (`Shift+wheel`, `setPageZoom`) compose into a **single** CSS
  `zoom` on `#views` (`applyZoom`, `main.js`). CSS `zoom` alone is only
  a text zoom: the logical column shrinks as much as the scale
  grows, so a figure at `max-width: 100%` keeps its on-screen size. Page
  zoom keeps the children of `.doc-view` at the width they would
  have at scale 1 (`--page-w` in `app.css`, computed from
  `--page-zoom` and the horizontal padding `--pad-x`): identical layout
  at any scale, no reflow, horizontal overflow. This is what makes
  zoom around the cursor exact: the logical coordinates of a content point
  are invariant, only the scroll is re-set. Any code that measures
  rects against `scrollTop`/`scrollLeft` must divide by the **total** scale
  (`box.height / clientHeight`, see `revealCurrent` in `docsearch.js`), and
  any rule that sizes a direct child of `.doc-view` must go through
  `--page-w`, not `100%`.
- **Loading overlay** (3.14.0): `ui/js/loading.js` covers the wait for a long
  render (~1.4 s for a 100 KB `.tex`). Three constraints, all
  counter-intuitive and all verified by `tests/test_loading.mjs`:
  **(1)** the heavy phase (markdown-it + KaTeX + DOMPurify + DOM insertion) is
  **synchronous** — a `setTimeout` therefore cannot fire during it, and the 180 ms
  anti-flash delay only covers the *asynchronous* phases (transformation
  by a plugin). Hence `beforeHeavyRender`, which decides on the markdown's **size**
  (threshold 60,000 characters) and puts the overlay up in advance;
  **(2)** putting the overlay up is not enough to display it: without yielding to the
  browser (double `requestAnimationFrame`), it would only be painted once
  the render is finished; **(3)** its animation must rely **only** on
  `transform`/`opacity`, the only properties Chromium animates on the
  compositor — any other would freeze during the blocking, exactly when
  the overlay must reassure. Only the preview triggers it (`isPreview`): the
  source and derived views merely color text (~100 ms) and
  would flicker. The overlay lives in `#content`, outside the view, with
  `pointer-events: none` — the previous content stays visible and scrollable
  during a reload on a disk modification.
- **Toolbar icons** (3.12.0): `ui/js/icons.js` is the **registry**
  of the disableable icons (button id, label, default). Two groups: the window
  bar (`#tabbar-actions`, hidden directly by `applyIcons`) and
  the view action stack (`#view-actions`, in which `updateViewActions` in
  `main.js` crosses `iconEnabled(id)` with relevance to the document). The
  setting persists in `settings.json` (`SettingsData::icons`) in
  **partial** form: only the boxes explicitly checked/unchecked appear there,
  any absent icon follows its `def` — a default changed later therefore applies
  to the workstations that never touched it. The dialog is built by
  `settings.js` by cloning the real button's `<svg>` (an icon added to
  `index.html` only needs to be declared in the registry). Global setting:
  propagated to the other windows by the `icons-changed` event (same `from`
  protocol as `theme-changed`), read at boot by the `get_icons` command. Two
  safeguards: the Settings gear is `locked` (never hideable — the only access
  to the dialog), and `enforceIconAvailability` (`main.js`) brings the views back to a
  reachable state when "Source code" (« Code source »), "Intermediate markdown"
  (« Markdown intermédiaire ») or "Full width" (« Pleine largeur ») is disabled.
- **The three searches** (3.13.0): highlighting of the selected word
  (`findword.js`), search in the document (`docsearch.js`, `Ctrl+F`) and
  multi-document search (`globalsearch.js`, `Ctrl+Shift+F`) share
  `searchopts.js` — `buildMatcher` compiles the query and the options
  (case / whole word / regex) into **one global RegExp**, the only form of pattern
  circulating afterwards (`collectMatchRanges`, `findHits`). Two pitfalls are
  handled once and for all: `\b` is ASCII-only (it would split `été` in
  two) — hence lookarounds on an extended `\w`; and a regex can match
  empty (`a*`) — hence `iterMatches`, which skips those matches instead of
  looping on `lastIndex`. An invalid pattern **throws**: each caller turns it into
  a displayed state (red field), never an exception that bubbles up.
  `docsearch.js` searches the **rendered DOM** of the active view (not the source):
  it therefore follows the display mode, and anything that replaces this DOM
  (`showActive`, `toggleSource`, `toggleDerived`) must call
  `refreshDocSearch()` — otherwise the memorized `Range`s point to detached
  nodes. Since 3.22.0, the current occurrence is memorized **per
  document** (`positions`, key = view, valid for the same query/options),
  and `collectMatchRanges` (`textmatch.js`, hence the three searches) **ignores
  folded content** — body of a closed `<details>`, `hidden` elements; structural
  test, not `checkVisibility()` which would reject `display: contents`.
  A `toggle` of `<details>` in the view re-runs Ctrl+F on the same occurrence
  (`anchor`). `#find-ruler` (outside `#views`, hence outside zoom) carries a tick
  per occurrence on the scrollbar, redrawn via a
  `ResizeObserver` on the view **and its direct children** (the view's box does not
  change when its content grows). `Ctrl+F`, `F3` and `Ctrl+G` are **intercepted** (`preventDefault`
  in `initShortcuts`) to neutralize the webview's native search bar.
  The table of contents, `#find-bar` and `#search-panel` share the same on-screen anchor:
  they are mutually exclusive (`beforeOpen` hooks).
- **Highlighting of the « Code source » view** (3.11.0): `sourcehl.js` paints the view
  produced by `renderSource` **after the fact**, without touching the line count
  or the heights — the preview ↔ source alignment (`data-line`) and the
  `scrollToLine` already done by the caller therefore remain valid, even when the
  highlighting comes from a plugin (asynchronous). `sourceHighlightFor` (`plugins.js`)
  picks the grammar: the host's hljs for markdown, otherwise the grammar of the
  plugin serving the extension, looked up by convention `<ext>-source` then
  `<ext>` (`tex-source`; see `doc/plugin-protocol.md`
  §6.4). The convention starts from the **extension**: latex-doc therefore declares
  `tex-source` and `latex-source` for the same grammar. The delicate point is `hlsplit.js`: a colorizer renders **one** HTML stream
  where a `<span>` straddles lines (fence, string, comment), which must be
  re-cut by closing/reopening the span stack. Pure module, tested outside the
  browser by `node tests/test_hlsplit.mjs` (accepts `.md` files as arguments).
  Any anomaly (split that does not cover the lines, grammar error,
  view toggled in the meantime) leaves the view as plain text: **alignment takes precedence
  over color**. Consequence for the searches: a colored line is
  split into several text nodes, hence `textmatch.js` which re-glues the nodes
  of the same `.src-line` before searching (outside the source view, each node stays
  isolated — otherwise phantom occurrences would appear between two blocks).
- **Components of document plugins**: a plugin that emits inline HTML
  (accordions, callouts) relies on the generic classes `kd-fold`
  (collapsible `<details>`) and `kd-note` (documentation callout), styled in
  `ui/css/app.css` and documented in §6.7 of the protocol — the host carries no
  plugin-specific class. A relative `doc#fragment` link emitted in an SVG
  (`xlink:href`) is clickable like a markdown link (`initLinks`,
  `main.js`), fragment memorized in `pendingAnchor` and consumed by
  `showActive`.
- **`.tex`/`.latex` files** (**standalone** LaTeX documents): served by the
  **`latex-doc` plugin** (`plugins/latex-doc/tex.js`), which generates a derived
  markdown (same anchors/`remapLine` via `anchors.js`); a ` ```latex ` fence
  in a `.md` gets the same rendering (`fence:markdown`, without a title heading) —
  ` ```tex ` is deliberately **not** claimed, it remains available to
  display LaTeX code. Principle: the plugin **renders no formula**, it
  delimits with `$…$`/`$$…$$` and lets the host's KaTeX do it. Three mechanisms
  carry the fidelity: **double parse** (the first collects the preamble's
  `\newcommand`/`\newtheorem`, the second re-parses declaring these
  signatures to the parser — without which `\hyp{h:iid}` would be read as a macro
  followed by an independent group), **expansion** of user macros before
  KaTeX, which does not know them, and opaque **reference markers** resolved at
  the end of the traversal (forward `\ref`s work in a single pass).
  In-house numbering of sections, equations (`\tag{n}`) and `amsthm`
  theorems (shared counters `[theorem]`, parents `[section]`); anchors
  `<div id="…">` before each numbered object — a (block) `<div>` avoids the stray `<p>`
  that an inline `<a>` would produce, and `initLinks` (`main.js`) resolves the
  `href="#id"`. Each numbered anchor (`eq-3`, `sec-2-1`) is **doubled** with the
  `\label{}`(s) that target it, taken **verbatim** (`#eq:sigmaU`): the only stable
  target for a link coming from another document
  (`[…](../doc/modele.tex#eq:sigmaU)`, `CSS.escape` handles the `:`), the numbered
  anchor shifting at the slightest upstream insertion. The grafting is done *onto*
  the existing anchor line — no line created, so `anchors` (preview ↔ source
  sync) stays exact; `removeLine` readjusts the anchor index just
  as it does the line index.
  ⚠ AST asymmetry in `tabular`: the cell **separator** `&` is a
  `string` node, the literal `\&` is a macro. The `unified-latex` parser
  is vendored (`vendor/unified-latex.esm.js`, ~245 KB,
  regenerable by `build_vendor.py`). `texToMarkdown` never throws. Accepted
  limits: single file (no `\input` — no `read:siblings`), no
  bibliography (see the plugin's README). A `tikzpicture` becomes a
  ` ```tikz ` fence containing a **standalone document** (`tikzPreamble`: whitelisted
  packages, `babel` excluded, preamble macros and libraries, `\newlabel`
  of the `\ref`s resolved by the `t` markers) that the host compiles (TeX engine);
  node text and source remain folded underneath, for the TeX-less workstation.
- **`.html`/`.htm` files** (static pages, including the app's HTML exports,
  3.9.0): **native** extensions (`DOC_EXTENSIONS` in `manager.rs`, mirror
  `NATIVE_DOC_EXTENSIONS` in `plugins.js` — keep both in sync), but
  **outside the markdown pipeline**: `renderActive` (`main.js`) routes to
  `renderHtmlDocument` (`render.js`) which displays the page as is in a
  sandboxed `srcdoc` iframe (`sandbox=""`: no script, no navigation;
  the app's CSP, inherited by the srcdoc document, applies in addition). The view
  carries `v.kind === "html"` and `v.markdown = null`: view action stack
  hidden (no source/table of contents/export/full width), tabs excluded from the
  global search (`globalsearch.js`). Relative resources of a third-party HTML
  are not resolved (about:srcdoc has no base) — the app's exports
  are standalone, the only known limitation: the KaTeX fonts.
- **Math formulas**: `render.js` plugs `markdown-it-texmath` (`dollars` mode:
  `$…$` inline, `$$…$$` display) into **KaTeX** (`ui/vendor/katex/`), rendered locally with no
  network or `eval`. `texmath.js` and `katex.min.js` are loaded as classic `<script>`s
  in `index.html` (globals `window.texmath` / `window.katex`); the KaTeX CSS
  loads its fonts from `vendor/katex/fonts/*.woff2` (only the woff2 is
  vendored — Chromium takes the 1st format). The KaTeX output (HTML + MathML) goes through
  DOMPurify: the `mathMl: true` profile (see `sanitizeHtml`) is required so as not to
  empty the accessibility MathML.
- **Plotly (« live » engine)**: a ` ```plotly ` block is the only **interactive**
  rendering — it **short-circuits** the backend/SVG pipeline and runs in the
  main webview (`hydrateDiagrams`, branch `type === "plotly"`). The JSON spec
  `{data, layout}` is either inline, or in a file via `src=path.json`, read by
  the backend command `read_data_file` (**confined to the doc's folder**: absolute
  paths rejected, canonicalization on both sides + `starts_with` anti-traversal/symlink,
  `.json` allowlist; same confinement as `plugin_read_sibling`).
  `vendor/plotly.min.js` (~4.8 MB, UMD → `window.Plotly`) is injected as a `<script>` at the
  first figure (`ensurePlotly`). No CSP change needed: `'unsafe-eval'` is already there
  (for d2) and the script is served from `'self'`. The `<div>` survives DOMPurify, the graph
  is injected **after** sanitization (like the Kroki SVGs). Not concerned by
  `resolve_alias` (does not go through the render backend). **Anti-duplicate**: if an
  image (`![…](x.png)`) immediately precedes a ` ```plotly src=x.json ` block with the same
  *stem*, it is its static fallback (portable outside the app / if Plotly fails); once
  the interactive render has succeeded, `hidePairedFallbackImage` hides the image to avoid
  displaying the figure twice. On failure, the PNG stays visible.
  **The vendored bundle is patched** (3.25.1, `scripts/patch_plotly.py`, marker comment at
  the top of the file): Plotly turns every 3D text label into triangles (vectorize-text),
  and clean-pslg converted every point to `bn.js` rationals and back even with no edge
  crossing, while the 8192×1024 canvas was repainted per label — 4 labelled `scatter3d`
  figures went 9.3 → 3.6 s, meshes byte-identical. **Re-run the script after updating
  `plotly.min.js`**: it is idempotent and fails if a pattern is no longer found exactly once.
- `ui/renderer/` — page of the hidden render webview and its vendored engines.
- Vendors (`ui/vendor/`, `ui/renderer/vendor/`) are pre-built bundles
  committed to the repo. `vendor/dbml.js` is an esbuild bundle of `@softwaretechnik/dbml-renderer`
  reduced to `run(src, "dot")` (viz.js excluded). `vendor/excalidraw.esm.js` is an
  esbuild bundle of `@excalidraw/excalidraw` (`exportToSvg` + `restore`, `.woff2`/CSS fonts
  excluded: `--loader:.woff2=dataurl --loader:.css=empty`). `erd.js` is **not** a
  vendor: it is our in-house erd→DOT parser.

## Plugin system (3.0.0)

The spec of protocol v1 is **`doc/plugin-protocol.md`** — re-read it before
touching the host or writing a plugin. Operational summary:

- A plugin = a folder `%APPDATA%\kroki-deskapp\plugins\<id>\` (neutral path,
  outside the Tauri identifier) with `manifest.json`; distributed as a zip archive
  `.kdext` (drop onto the window, double-click if the installer associated
  the extension, command line, or Plugins dialog → trust dialog; the
  "archive vs document" sorting is done once and for all in
  `manager::open_mixed_paths`, funnel common to all these paths;
  `pack_plugin.py` (repo root) to package). Dev loop: copy the plugin's folder
  directly into `plugins\<id>\` and relaunch the app.
- **Execution**: sandboxed worker on the frontend side (`ui/js/plugins.js`, runtime
  `ui/js/kd_runtime.js` injected as a blob that imports the entry via the `plugin://`
  protocol — hence `plugin:`/`http://plugin.localhost` in the CSP's
  `script-src`/`connect-src`). Lazy start, timeouts,
  3 consecutive failures → "en panne" (broken). The backend (`plugins.rs`) never
  runs plugin code: manifests, files, confinement.
- **Capabilities v1**: `document:markdown` (routing in `renderActive`,
  degraded mode §7.3 = banner + source as a fence), `fence:svg`/`fence:html`/
  `fence:markdown` (routing in the fence rule + `hydrateDiagrams` of
  `render.js`; native takes precedence; the markdown format is re-rendered by
  markdown-it + DOMPurify then hydrated recursively, depth bounded to 2,
  derived `data-source-line` removed), `highlight:code` (post-pass
  `hydratePluginHighlights`, sanitized `hljs-*` spans), `read:siblings`
  (`host/readFile` → `plugin_read_sibling`, `siblingExtensions` allowlist). `document:html`/`*:webview`/`runtime:
  "process"` are **reserved, not implemented**.
- **Effective extensions** = `DOC_EXTENSIONS` (native) ∪ active plugins:
  open dialog, drops (`drop_target.rs`/`filedrop.js`), `open_link`.
  `plotly` stays native (fence intercepted before the plugins).
- **Intermediate markdown** (« Markdown intermédiaire »): a `{…}` button (view action stack) displays
  the markdown generated by the plugin of a transformed document — raw, accent-colored
  thin border, position realigned via the anchors. Available in release since
  3.12.0, but **disabled by default**: it is enabled in Settings →
  « Icônes affichées » ("Displayed icons"; see « Toolbar icons » above) and
  only appears on a document that was actually transformed (`v.lineMap`).
- A first-party plugin lives in the repo (`plugins/`, externalizable):
  **`latex-doc`** (`.tex`/`.latex` + `latex` fence + `tex-source`/`latex-source`
  highlighting). Others can be mounted there by junction
  from their own repo (locally excluded, `.git/info/exclude`).
  Any change to these renderings is made there and tested by
  copying the folder into `plugins\<id>\`, **without rebuilding the app** — unless
  the host itself changes (`ui/js/*` stays embedded in the binary); since `plugins/`
  is not embedded in the binary, a change limited to it **does not
  justify an app version bump** (the plugin has its own).
  `plugins/` also contains the **three pedagogical examples** of §12 of the
  spec (`csv-tables`, `barchart`, `ini-highlight`) — one per extension point,
  to be kept in sync with the inline code of `doc/plugin-protocol.md`.
- **Plugins shipped with the installer** (3.16.0, spec §9.5): the MSI embeds the
  `.kdext` of the plugins of the bundling strategy (see § « Windows installer
  (MSI) ») and lets the user check those to install (default: `latex-doc`
  checked, the three examples unchecked). The `.deb` embeds the same and retains
  the checked ones, being unable to ask the question (see § « Debian/Ubuntu
  package (.deb) »).
  The checked ones land in `resource_dir()/bundled-plugins/`, whence
  `plugins::seed_bundled` installs and updates them at
  startup, **before** `plugins::init()` so that the first scan sees the final
  state. Only installation path without a trust dialog — same installer
  as the exe, hence same chain of trust. Three rules, all necessary:
  never a version regression (a newer `.kdext` placed by hand is
  kept); a plugin deleted from the Plugins dialog is memorized in
  `SettingsData::removed_plugins` and **not** reinstalled — otherwise "Supprimer" ("Delete")
  would be undone at the next launch; reinstalling it by hand clears that
  memory. Since the plugins folder is per-user and both installers are
  per-machine,
  the installation cannot be done by the installer: it happens at the
  first launch of each user session. **Folder absent = no installer**
  (portable, AppImage, debug): seeding then falls back on the **embedded
  `latex-doc`** — `src-tauri/build.rs` packs `plugins/latex-doc/` into
  `OUT_DIR` on every build path (same `packInclude` selection as
  `pack_plugin.py`, mandatory there — the build fails without it), and
  `plugins.rs` includes it with `include_bytes!`, same three rules. Hence both
  installers create the folder **even empty** (MSI `CreateFolder`, `.deb`
  `postinst`): an installer that retained nothing must not get it anyway.
  A `latex-doc` change thus reaches the binary at the next build
  (`rerun-if-changed` on the folder) — still no app bump for it alone.
  Unchecking a plugin **does not uninstall** one already present:
  seeding adds and updates, never removes — the choice is made at
  install time, removal from the Plugins dialog. The list lives
  in **one** place only, the bundling strategy: the WiX fragment and the `.deb` overlay
  are generated from it. **Test without
  installer**: drop the `.kdext` into
  `src-tauri/target/debug/bundled-plugins/` —
  `resource_dir()` is the executable's folder, debug included (the folder's
  presence then also disables the embedded `latex-doc`).
- **Install queue**: the paths that add a `.kdext` (Windows drop,
  double-click, command line, native picker) **queue** the archive on the
  Rust side (`plugins::request_install`) and emit `plugin-install-request` only
  as a signal; the frontend retrieves the payload via
  `take_pending_plugin_installs`. This detour is necessary: an archive passed
  at launch is handled in `setup`, hence **before** the webview has
  registered its listener — an event carrying the path would be lost, and the
  double-click would do nothing unless the application is already open.
  `drainPendingInstalls` (`plugins_ui.js`) empties the queue after the `listen` and
  chains the trust dialogs in sequence.

## Third-party notices (3.30.0)

`ui/third-party-notices.txt` (tracked, **generated**, ~1.3 MB) carries the
license notices and texts of everything shipped without being written here:
Rust crates (normal-dependency closure for Windows + Linux, from `cargo
metadata`), JS vendors **with their whole npm dependency tree** (the vendored
files are bundles), jars and code compiled into a bundle (Graphviz, Go
runtime, ClojureScript). It lives in `ui/` so Tauri embeds it compressed;
`notices.js` reads it by `fetch`. Regenerate with
`uv run scripts/third_party_notices.py` (cargo + npm + network) **after any
change to `Cargo.lock`, a vendor, a jar or the `latex-doc` bundle** — and when
updating a vendor, bump its pinned version in the script's `NPM` list (the
vendors carry no version record of their own; the script is it). A new
embedded thing that npm and cargo cannot see goes into `EXTRAS`. The esbuild
bundles strip legal comments (`--legal-comments=none`): this file is what
satisfies the notice requirements, not the bundles.

## Security / CSP (do not break)

- The documents' inline HTML goes through **DOMPurify**. The engines' SVGs are
  inserted **as is** (DOMPurify would empty mermaid's `<foreignObject>`s); the
  CSP (no `'unsafe-inline'` for scripts) neutralizes any injected `<script>`.
- The CSP allows `'unsafe-eval'` + `blob:` workers **only** because the
  WASM runtime of **d2** uses `new Function` in a module worker. Do not
  add an `eval` sink fed by document content.

## Platform constraints

- **Windows = main target** (WebView2, Win32 API, `windows_subsystem =
  "windows"`). Linux is supported in degraded mode (WebKitGTK, `#[cfg(not(windows))]`
  fallbacks, no inter-window drag) — builds via
  `scripts/Dockerfile.linux` (see « Linux builds »).
- Aggressive release profile (`lto`, `codegen-units=1`, `panic=abort`, `opt-level=s`,
  `strip`) → slow release builds; prefer `cargo run` (debug) during development.
