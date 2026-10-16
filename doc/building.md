# Building Kroki Desk

## Prerequisites

- **Rust stable** (cargo) — the only tool required for the host binary.
- **Python 3.10+** (standard library only) for `build_dist.py` and
  `pack_plugin.py`.
- **Windows**: WebView2 Runtime (preinstalled on Windows 10/11). The MSI build
  downloads WiX v3 into `%LOCALAPPDATA%\tauri` on the first run.
- **Native Linux**: the system packages listed in `scripts/Dockerfile.linux`
  (WebKitGTK 4.1, GTK 3, `xdg-utils`…).
- **Docker** (daemon running) for the distributable Linux artifacts, including
  from Windows.
- **Node.js** for tests only (ESM scripts with no npm dependency).

There is **no frontend bundler**: `ui/` is static, its dependencies are
vendored in the repository. No `npm install`.

## Two routes

| Need | Command |
| --- | --- |
| All of a version's artifacts | `python build_dist.py` |
| Develop (debug build + launch) | `cargo run-app` |
| Only the host binary | `cargo build-app` |

`build_dist.py` is the reference way to produce a release: it
chains the steps in the right order, packs the plugins the installers
need and checks what they embed. The cargo aliases
remain the development loop, and the minimal route for anyone who only wants
the executable.

## `build_dist.py`

Generates, from Windows as well as from Linux, all the artifacts in
`dist/`, in order of increasing cost (a slow or broken step does not delay
a cheap artifact):

1. the `.kdext` archives of all the plugins in `plugins/`;
2. the host's native binary (`.exe` on Windows, Linux binary on Linux);
3. the MSI installer (Windows only, skipped outright elsewhere);
4. via Docker (`kroki-linux-build` image, Debian bookworm): the AppImage, the
   bare Linux binary and the `.deb` package.

Each step is removed with its `--skip-…` (`--skip-plugins`, `--skip-native`,
`--skip-msi`, `--skip-appimage`, `--skip-binary`, `--skip-deb`) or isolated with
its `--…-only` (`--native-only`, `--plugins-only`, `--msi-only`, `--deb-only`,
mutually exclusive). Also available: `--skip-image-build`, `--compile-only`
(verification-only Linux compilation, no artifact) and `--test` (headless
runtime test under Xvfb). Without Docker: `--skip-appimage --skip-binary --skip-deb`.

The MSI and the `.deb` embed the `.kdext` archives: `--skip-plugins` makes them
reuse those already present in `dist/`, it does not remove them from the
installer.

`python build_dist.py --help` lists all the options and examples.

## Cargo aliases

Defined in `.cargo/config.toml`, they drive the `src-tauri/` crate from
the repository root:

```bash
cargo run-app         # debug build + launches the app
cargo build-app       # release build → dist/
cargo lint-app        # clippy
cargo fmt-app         # rustfmt
cargo build-msi       # MSI installer (Windows; requires the .kdext in dist/)
cargo build-appimage  # AppImage (Linux; installs tauri-cli locally if needed)
cargo build-deb       # .deb package (Linux; requires the .kdext in dist/)
```

The release profile is aggressive (LTO, `codegen-units=1`): prefer
`cargo run-app` during development.

## Artifacts in `dist/`

Each artifact is published **suffixed with the version** (single source: the
`version` field of `src-tauri/Cargo.toml`), paired with an **unversioned** file
pointing to the same content — a hardlink if the file system allows it
(no administrator rights needed, NTFS as well as ext4), a copy otherwise:

```
kroki_deskapp-3.24.0.exe          kroki_deskapp.exe
kroki_deskapp-3.24.0.msi          kroki_deskapp.msi
kroki_deskapp-3.24.0-linux-x86_64-debian12.AppImage   …
```

Linux artifacts carry the tag of the distro doing the build (read from
`/etc/os-release`: `debian12` for the container, `ubuntu24.04` for an
Ubuntu host…): a native build and a Docker build coexist in `dist/`. The
distributable is the `-debian12` one — glibc bookworm, hence broad
compatibility; a binary built on a newer distro does not run on older ones.

## Plugins bundled in the installers

The plugins that the MSI and the `.deb` embed are decided by a text
file at the repository root, one line per plugin:

```
# <id> [on]   — on: checked (MSI) / installed at first launch (.deb)
latex-doc      on
csv-tables
```

`bundled-plugins.txt` (ignored by git) takes precedence if it exists; otherwise
`bundled-plugins.default.txt`, tracked, provides the default selection. The order
of the lines is that of the MSI page. The display name and the extensions to
associate are read from the `manifest.json` of each `dist/<id>.kdext` archive,
which must therefore exist (`python build_dist.py --plugins-only`). The WiX
fragment and the `.deb` overlay derived from it are generated on each build;
`cargo run --manifest-path xtask/Cargo.toml -- bundled` produces them on their own,
for review.

The `KROKI_BUNDLED_PLUGINS` variable (path of a strategy file) forces a
specific strategy. `python build_dist.py --channel public` uses it to
build with `bundled-plugins.default.txt` even if a local `bundled-plugins.txt`
exists, and copies each produced artifact into `dist/public/<version>/`
— the folder to publish. `--channel local` (default) keeps the choice above;
`--channel all` runs both in one pass. The script stops if the
archives actually embedded in the MSI or the `.deb` differ from the
strategy.

## Linux tooling (`scripts/`)

- `Dockerfile.linux` — `kroki-linux-build` build image (Debian bookworm);
  `docker run` commands at the top of the file;
- `linux_appimage_build.sh` — wraps `cargo build-appimage` in the container;
- `linux_deb_build.sh` — same for `cargo build-deb`;
- `linux_runtime_run.sh` — headless runtime test (Xvfb).

The Windows build is only possible from Windows (no cross-compilation or
Windows container).

## Tests

The tests drive the **running** application via CDP
(`tests/cdp.mjs` and the `tests/test_*.mjs`); two suites run without the
application (`tests/test_latex_plugin.mjs`, `tests/test_hlsplit.mjs`).
Usage is documented at the top of each script.
