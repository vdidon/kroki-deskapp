//! Repository build tasks, driven by the .cargo/config.toml aliases:
//!
//!   cargo build-app      → `xtask build`    : release build of the src-tauri crate
//!                          then publication into dist/ (Windows and Linux).
//!   cargo build-appimage → `xtask appimage` : Linux AppImage via tauri-cli
//!                          (taken from the PATH if present, otherwise installed
//!                          one-shot into xtask/target/tools/, local to the
//!                          repo and gitignored), then publication into dist/.
//!   cargo build-msi      → `xtask msi`      : Windows MSI installer (WiX v3)
//!                          via the same tauri-cli, then publication into dist/.
//!   cargo build-deb      → `xtask deb`      : Debian/Ubuntu package (.deb) via
//!                          the same tauri-cli, then publication into dist/.
//!   (no alias)           → `xtask bundled`  : generates only the files derived
//!                          from the plugin bundling strategy (bundled.rs).
//!
//! Publication (`publish_dist`): the artifact is copied into dist/ under a
//! version-suffixed name (source of truth: src-tauri/Cargo.toml), paired with
//! an unversioned file pointing at it — hardlink preferred (no administrator
//! rights needed, on NTFS as well as ext4; a Windows symlink would require
//! admin or developer mode), copy as a fallback (filesystems without
//! hardlinks, e.g. Docker Desktop mounts).
//!
//! Bundling is enabled by configuration overlays
//! (src-tauri/tauri.appimage.conf.json, src-tauri/tauri.msi.conf.json,
//! src-tauri/tauri.deb.conf.json):
//! tauri.conf.json keeps bundle.active=false, so `cargo build --release` still
//! only produces the bare binary. Extra arguments to the aliases are forwarded
//! to the underlying command (`cargo build` / `tauri build`).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};

mod bundled;
#[cfg(windows)]
mod msi_lang;

const TAURI_CLI_VERSION: &str = "^2";
const BIN_NAME: &str = "kroki_deskapp";

fn main() {
    let mut args = env::args().skip(1);
    let cmd = args.next().unwrap_or_default();
    let extra: Vec<String> = args.collect();
    match cmd.as_str() {
        "build" => build_app(&extra),
        "appimage" => build_appimage(&extra),
        "msi" => build_msi(&extra),
        "msi-merge" => merge_msi(),
        "deb" => build_deb(&extra),
        "bundled" => gen_bundled(),
        other => {
            eprintln!(
                "xtask: unknown subcommand \"{other}\" \
                 (expected: build | appimage | msi | msi-merge | deb | bundled)"
            );
            exit(2);
        }
    }
}

/// `cargo run --manifest-path xtask/Cargo.toml -- bundled`: generates only the
/// files derived from the plugin bundling strategy (WiX fragment, .deb overlay
/// and MIME package), without bundling anything — to re-read them.
fn gen_bundled() {
    let repo = repo_root();
    let plugins = bundled::load(&repo, "bundled");
    bundled::write_wix_fragment(&repo, &plugins, "bundled");
    let overlay = bundled::write_deb_overlay(&repo, &plugins, "bundled");
    eprintln!(
        "bundled: src-tauri/wix/plugins.generated.wxs + {}",
        overlay.display()
    );
}

/// `cargo build-app`: release build of src-tauri then publication into dist/.
fn build_app(extra: &[String]) {
    let repo = repo_root();
    let mut cargo = Command::new("cargo");
    cargo
        .args([
            "build",
            "--release",
            "--manifest-path",
            "src-tauri/Cargo.toml",
        ])
        .args(extra)
        .current_dir(&repo);
    if cfg!(windows) {
        // sccache (RUSTC_WRAPPER, often set globally on the workstation) cannot
        // relay web-sys's command line — hundreds of --check-cfg that exceed
        // the 32 KB Windows CreateProcess limit: "failed to spawn … os error
        // 206", build fails. Cargo itself can fall back to an @argfile. The
        // empty string neutralizes the wrapper, env AND config alike (unlike
        // env_remove, which would let a config.toml build.rustc-wrapper take
        // over again). The cache is lost for this build; that is the price of
        // a build that succeeds. No problem on Linux (argv limit ~2 MB): left
        // alone there.
        cargo.env("RUSTC_WRAPPER", "");
    }
    run_or_die(&mut cargo, "build-app: release build failed");

    let version = read_version(&repo);
    let arch = env::consts::ARCH;
    let (built_name, versioned, unversioned) = if cfg!(windows) {
        (
            format!("{BIN_NAME}.exe"),
            format!("{BIN_NAME}-{version}.exe"),
            format!("{BIN_NAME}.exe"),
        )
    } else {
        let tag = linux_tag();
        (
            BIN_NAME.to_string(),
            format!("{BIN_NAME}-{version}-linux-{arch}-{tag}"),
            format!("{BIN_NAME}-linux-{arch}-{tag}"),
        )
    };
    let built = target_dir(&repo).join("release").join(built_name);
    publish_dist(&repo, &built, &versioned, &unversioned);
}

/// `cargo build-appimage`: Linux AppImage via tauri-cli, then publication into dist/.
fn build_appimage(extra: &[String]) {
    if !cfg!(target_os = "linux") {
        eprintln!(
            "build-appimage: the AppImage is a Linux format — run on a Linux machine/container \
             (see CLAUDE.md § \"Linux builds\"). On Windows: cargo build-app."
        );
        exit(1);
    }

    let repo = repo_root();
    let cli = ensure_tauri_cli(&repo);
    soften_gtk_plugin();

    run_or_die(
        Command::new(&cli)
            .args([
                "tauri",
                "build",
                "--config",
                "src-tauri/tauri.appimage.conf.json",
            ])
            .args(extra)
            .current_dir(&repo)
            // linuxdeploy/appimagetool (downloaded by the bundler) are themselves
            // AppImages: without FUSE (container), their runtime must extract
            // itself instead of mounting. No effect when FUSE is present.
            .env("APPIMAGE_EXTRACT_AND_RUN", "1")
            // The strip embedded in linuxdeploy (old binutils) does not know the
            // .relr.dyn sections of recent distros' libs (Ubuntu 24.04+, Arch…)
            // and makes the whole bundling fail. Skipping strip costs nothing:
            // the distros' .so files are already stripped, and our binary is by
            // the release profile (strip = true).
            .env("NO_STRIP", "1"),
        "build-appimage: bundling failed",
    );

    let version = read_version(&repo);
    let arch = env::consts::ARCH;
    let tag = linux_tag();
    let bundle_dir = target_dir(&repo).join("release/bundle/appimage");
    let built = find_bundle(&bundle_dir, &version, ".AppImage");
    publish_dist(
        &repo,
        &built,
        &format!("{BIN_NAME}-{version}-linux-{arch}-{tag}.AppImage"),
        &format!("{BIN_NAME}-linux-{arch}-{tag}.AppImage"),
    );
}

/// `cargo build-msi`: Windows MSI installer (WiX v3) via tauri-cli, then
/// publication into dist/. The src-tauri/tauri.msi.conf.json overlay enables
/// bundling and wires in the WiX fragments — the tracked one (native formats)
/// and the one generated by `bundled::write_wix_fragment` (bundled plugins,
/// per the bundled.rs strategy); tauri.conf.json keeps bundle.active=false.
fn build_msi(extra: &[String]) {
    if !cfg!(windows) {
        eprintln!(
            "build-msi: the MSI can only be built on Windows (WiX v3 only runs \
             there). On Linux: cargo build-app or cargo build-appimage."
        );
        exit(1);
    }

    let repo = repo_root();
    let plugins = bundled::load(&repo, "build-msi");
    bundled::stage(&repo, &plugins, "build-msi");
    bundled::write_wix_fragment(&repo, &plugins, "build-msi");

    // Fresh ProductCode on every build (major upgrade, like `Id="*"`), but
    // shared by the MSIs of every language: `light`, which resolves `*`, runs
    // once per language — see src-tauri/wix/main.wxs and msi_lang.rs. TAURI
    // prefix mandatory: tauri-bundler launches WiX with a cleared environment,
    // except SYSTEMROOT/TMP/TEMP and the TAURI* variables (`clear_env_for_wix`).
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let product_code = bundled::stable_guid(&format!(
        "kroki-desk/product/{}/{nonce}/{}",
        read_version(&repo),
        std::process::id()
    ));

    let cli = ensure_tauri_cli(&repo);
    run_or_die(
        Command::new(&cli)
            .args([
                "tauri",
                "build",
                "--config",
                "src-tauri/tauri.msi.conf.json",
            ])
            .args(extra)
            .current_dir(&repo)
            .env("TAURI_KROKI_DESK_PRODUCT_CODE", &product_code)
            // Same sccache neutralization as build_app: tauri build runs a
            // cargo build --release, which would otherwise choke on web-sys.
            .env("RUSTC_WRAPPER", ""),
        "build-msi: bundling failed",
    );

    merge_msi();
}

/// Merges the per-language MSIs of the last `tauri build` into one multilingual
/// MSI, then publishes it into dist/. End of `build_msi`; on its own, `cargo run
/// --manifest-path xtask/Cargo.toml -- msi-merge` replays the merge without
/// recompiling or relaunching WiX (for tuning msi_lang.rs).
fn merge_msi() {
    if !cfg!(windows) {
        die("msi-merge: msi.dll and torch only exist on Windows");
    }
    let repo = repo_root();
    // One MSI per language (tauri.msi.conf.json, `wix.language`), merged into a
    // single one that follows the Windows display language (see msi_lang.rs).
    let version = read_version(&repo);
    let bundle_dir = target_dir(&repo).join("release/bundle/msi");
    #[cfg(windows)]
    let built = msi_lang::merge(&bundle_dir, &version, |suffix| {
        find_bundle(&bundle_dir, &version, suffix)
    });
    // Unreachable (early exit off Windows): only there to compile.
    #[cfg(not(windows))]
    let built = find_bundle(&bundle_dir, &version, ".msi");
    publish_dist(
        &repo,
        &built,
        &format!("{BIN_NAME}-{version}.msi"),
        &format!("{BIN_NAME}.msi"),
    );
}

/// `cargo build-deb`: Debian/Ubuntu package via tauri-cli, then publication into
/// dist/. The src-tauri/tauri.deb.conf.json overlay enables bundling, declares
/// the MIME types and the .desktop file template; `bundled::write_deb_overlay`
/// completes it with the bundled plugins (per the bundled.rs strategy) in a
/// generated copy, the only one passed to tauri build. tauri.conf.json keeps
/// bundle.active=false.
fn build_deb(extra: &[String]) {
    if !cfg!(target_os = "linux") {
        eprintln!(
            "build-deb: the .deb package can only be built on Linux (the bundler \
             sets Unix permissions there and assembles the ar archive) — run on a \
             Linux machine/container (see CLAUDE.md § \"Linux builds\"). From \
             Windows: python build_dist.py --deb-only, which goes through Docker."
        );
        exit(1);
    }

    let repo = repo_root();
    let plugins = bundled::load(&repo, "build-deb");
    bundled::stage(&repo, &plugins, "build-deb");
    let overlay = bundled::write_deb_overlay(&repo, &plugins, "build-deb");

    let cli = ensure_tauri_cli(&repo);
    run_or_die(
        Command::new(&cli)
            .args(["tauri", "build", "--config"])
            .arg(&overlay)
            .args(extra)
            .current_dir(&repo),
        "build-deb: bundling failed",
    );

    let version = read_version(&repo);
    let arch = env::consts::ARCH;
    let tag = linux_tag();
    let bundle_dir = target_dir(&repo).join("release/bundle/deb");
    let built = find_bundle(&bundle_dir, &version, ".deb");
    // Suffixed with the distro tag like the other Linux artifacts: the declared
    // dependencies are portable, but the binary's glibc floor is that of the
    // building machine — the distributable remains the -debian12.
    publish_dist(
        &repo,
        &built,
        &format!("{BIN_NAME}-{version}-linux-{arch}-{tag}.deb"),
        &format!("{BIN_NAME}-linux-{arch}-{tag}.deb"),
    );
}

/// Tag of the building distro (`debian12`, `ubuntu24.04`, `arch`…), from
/// /etc/os-release. Two Linux builds do not share the same glibc baseline
/// depending on whether they come out of the bookworm container or a native
/// machine: the artifact name must say so, otherwise they overwrite each other
/// in dist/.
fn linux_tag() -> String {
    let content = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let field = |key: &str| {
        content
            .lines()
            .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
            .map(|v| v.trim_matches('"').to_ascii_lowercase())
            .unwrap_or_default()
    };
    let tag: String = format!("{}{}", field("ID"), field("VERSION_ID"))
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
        .collect();
    if tag.is_empty() {
        "unknown".to_string()
    } else {
        tag
    }
}

/// Copies the artifact into dist/ under its versioned name, then creates the
/// unversioned file next to it (hardlink, copy as a fallback). Existing files
/// are removed first — never write through an old hardlink.
fn publish_dist(repo: &Path, built: &Path, versioned: &str, unversioned: &str) {
    if !built.is_file() {
        eprintln!("xtask: artifact not found: {}", built.display());
        exit(1);
    }
    let dist = repo.join("dist");
    fs::create_dir_all(&dist).unwrap_or_else(|e| die(&format!("xtask: cannot create dist/: {e}")));

    let vpath = dist.join(versioned);
    let upath = dist.join(unversioned);
    let _ = fs::remove_file(&vpath);
    fs::copy(built, &vpath)
        .unwrap_or_else(|e| die(&format!("xtask: cannot copy to {}: {e}", vpath.display())));
    let _ = fs::remove_file(&upath);
    let hard = fs::hard_link(&vpath, &upath).is_ok();
    if !hard {
        fs::copy(&vpath, &upath)
            .unwrap_or_else(|e| die(&format!("xtask: cannot copy to {}: {e}", upath.display())));
    }
    make_executable(&vpath);
    make_executable(&upath);
    eprintln!(
        "xtask: dist/{versioned} + dist/{unversioned} ({})",
        if hard { "hardlink" } else { "copy" }
    );
}

/// The current version's artifact in a bundle folder. Tauri's naming derives
/// from the productName and contains the version ("Kroki Desk_x.y.z_amd64.AppImage",
/// "Kroki Desk_x.y.z_x64_fr-FR.msi"): we filter on that rather than rebuild it,
/// and older versions may linger in a persistent target/ (Docker volume,
/// successive builds).
fn find_bundle(bundle_dir: &Path, version: &str, ext: &str) -> PathBuf {
    fs::read_dir(bundle_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(ext) && n.contains(version))
        })
        .unwrap_or_else(|| {
            die(&format!(
                "xtask: no {ext} artifact for version {version} in {}",
                bundle_dir.display()
            ))
        })
}

/// App version — single source of truth: src-tauri/Cargo.toml.
fn read_version(repo: &Path) -> String {
    let manifest = repo.join("src-tauri/Cargo.toml");
    let content = fs::read_to_string(&manifest)
        .unwrap_or_else(|e| die(&format!("xtask: cannot read {}: {e}", manifest.display())));
    content
        .lines()
        .find_map(|l| {
            l.trim()
                .strip_prefix("version")?
                .trim_start()
                .strip_prefix('=')?
                .trim()
                .strip_prefix('"')?
                .split('"')
                .next()
                .map(str::to_string)
        })
        .unwrap_or_else(|| die("xtask: version field not found in src-tauri/Cargo.toml"))
}

/// Target folder of the src-tauri crate, honoring CARGO_TARGET_DIR (the
/// /target volume of Docker builds).
fn target_dir(repo: &Path) -> PathBuf {
    match env::var_os("CARGO_TARGET_DIR") {
        Some(d) => {
            let p = PathBuf::from(d);
            if p.is_absolute() {
                p
            } else {
                repo.join(p)
            }
        }
        None => repo.join("src-tauri/target"),
    }
}

fn run_or_die(cmd: &mut Command, context: &str) {
    let status = cmd
        .status()
        .unwrap_or_else(|e| die(&format!("{context}: cannot launch: {e}")));
    if !status.success() {
        exit(status.code().unwrap_or(1));
    }
}

fn die(msg: &str) -> ! {
    eprintln!("{msg}");
    exit(1);
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask/ must be at the repository root")
        .to_path_buf()
}

/// The AppRun hook generated by linuxdeploy-plugin-gtk forces `GDK_BACKEND=x11`
/// unconditionally (tauri#8541): on a pure Wayland session without a reachable
/// XWayland (empty DISPLAY), gtk_init fails and the AppImage crashes at launch.
/// We patch the plugin script cached by the bundler (the hook's source, quoted
/// heredoc `<<\EOF` hence copied verbatim) so that X11 is forced only if a
/// DISPLAY exists — otherwise GDK chooses itself (Wayland). Idempotent; if the
/// script is absent we download it first (same URL as the bundler), and on
/// failure we carry on: the build will just produce the upstream hook.
fn soften_gtk_plugin() {
    const URL: &str =
        "https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh";
    const FORCED: &str = "\nexport GDK_BACKEND=x11";
    const SOFTENED: &str = "\nif [ -n \"${DISPLAY:-}\" ]; then export GDK_BACKEND=x11; fi";

    let cache = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")));
    let Some(script) = cache.map(|c| c.join("tauri/linuxdeploy-plugin-gtk.sh")) else {
        return;
    };

    if !script.is_file() {
        let _ = std::fs::create_dir_all(script.parent().unwrap());
        let ok = Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&script)
            .arg(URL)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
            || Command::new("wget")
                .args(["-q", "-O"])
                .arg(&script)
                .arg(URL)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
        if !ok {
            eprintln!(
                "build-appimage: cannot download linuxdeploy-plugin-gtk.sh — \
                 the bundler will, but its hook will force GDK_BACKEND=x11 (no pure Wayland)."
            );
            let _ = std::fs::remove_file(&script);
            return;
        }
        make_executable(&script);
    }

    let Ok(content) = std::fs::read_to_string(&script) else {
        return;
    };
    if content.contains(SOFTENED) {
        return;
    }
    if content.contains(FORCED) {
        let patched = content.replace(FORCED, SOFTENED);
        if std::fs::write(&script, patched).is_ok() {
            make_executable(&script);
            eprintln!(
                "build-appimage: GTK hook softened (GDK_BACKEND=x11 only if DISPLAY is set)."
            );
        }
    }
}

#[cfg(unix)]
fn make_executable(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
}
#[cfg(not(unix))]
fn make_executable(_: &Path) {}

/// Returns the cargo-tauri binary to use: repo-local, else PATH, else a local
/// install (fixed path, deliberately independent of CARGO_TARGET_DIR so it
/// survives Docker-style redirections).
fn ensure_tauri_cli(repo: &Path) -> PathBuf {
    // `.exe` on Windows, otherwise the already installed binary is never found
    // and the one-shot install is replayed on every build.
    let exe = if cfg!(windows) {
        "cargo-tauri.exe"
    } else {
        "cargo-tauri"
    };
    let local = repo.join("xtask/target/tools/bin").join(exe);
    if local.is_file() {
        return local;
    }

    let on_path = Command::new("cargo-tauri")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if on_path {
        return PathBuf::from("cargo-tauri");
    }

    eprintln!(
        "xtask: tauri-cli missing → one-shot install into \
         xtask/target/tools/ (~10 min build, first time only)…"
    );
    let status = Command::new("cargo")
        .args([
            "install",
            "tauri-cli",
            "--version",
            TAURI_CLI_VERSION,
            "--locked",
            "--root",
        ])
        .arg(repo.join("xtask/target/tools"))
        .status()
        .expect("xtask: cannot launch cargo install");
    if !status.success() {
        eprintln!("xtask: tauri-cli installation failed");
        exit(1);
    }
    local
}
