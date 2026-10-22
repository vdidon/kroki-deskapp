//! Tâches de build du dépôt, pilotées par les alias .cargo/config.toml :
//!
//!   cargo build-app      → `xtask build`    : build release du crate src-tauri
//!                          puis publication dans dist/ (Windows et Linux).
//!   cargo build-appimage → `xtask appimage` : AppImage Linux via tauri-cli
//!                          (utilisé depuis le PATH s'il y est, sinon installé
//!                          en one-shot dans xtask/target/tools/, local au
//!                          dépôt et gitignoré), puis publication dans dist/.
//!   cargo build-msi      → `xtask msi`      : installeur MSI Windows (WiX v3)
//!                          via le même tauri-cli, puis publication dans dist/.
//!   cargo build-deb      → `xtask deb`      : paquet Debian/Ubuntu (.deb) via
//!                          le même tauri-cli, puis publication dans dist/.
//!   (sans alias)         → `xtask bundled`  : génère seuls les fichiers dérivés
//!                          de la stratégie d'embarquement des plugins (bundled.rs).
//!
//! Publication (`publish_dist`) : l'artefact est copié dans dist/ sous un nom
//! postfixé de la version (source de vérité : src-tauri/Cargo.toml), doublé
//! d'un fichier non versionné pointant sur lui — hardlink de préférence
//! (aucun droit administrateur requis, sur NTFS comme sur ext4 ; un symlink
//! Windows exigerait admin ou mode développeur), copie en repli (systèmes de
//! fichiers sans hardlink, ex. montages Docker Desktop).
//!
//! Le bundling est activé par des overlays de configuration
//! (src-tauri/tauri.appimage.conf.json, src-tauri/tauri.msi.conf.json,
//! src-tauri/tauri.deb.conf.json) :
//! tauri.conf.json garde bundle.active=false, donc `cargo build --release` ne
//! produit toujours que le binaire nu. Les arguments supplémentaires des alias
//! sont transmis à la commande sous-jacente (`cargo build` / `tauri build`).

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

/// `cargo run --manifest-path xtask/Cargo.toml -- bundled` : génère seuls les
/// fichiers dérivés de la stratégie d'embarquement des plugins (fragment WiX,
/// overlay et paquet MIME .deb), sans rien bundler — pour les relire.
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

/// `cargo build-app` : build release de src-tauri puis publication dans dist/.
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
        // sccache (RUSTC_WRAPPER, souvent posé globalement sur le poste) ne sait
        // pas relayer la ligne de commande de web-sys — des centaines de
        // --check-cfg qui dépassent la limite Windows des 32 Ko d'un CreateProcess :
        // « failed to spawn … os error 206 », build en échec. Cargo, lui, sait
        // basculer sur un fichier @argfile. La chaîne vide neutralise le wrapper,
        // env ET config confondus (contrairement à env_remove, qui laisserait un
        // build.rustc-wrapper d'un config.toml reprendre la main). Le cache est
        // perdu pour ce build ; c'est le prix d'un build qui aboutit. Pas de
        // problème sur Linux (limite d'argv ~2 Mo) : on n'y touche pas.
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

/// `cargo build-appimage` : AppImage Linux via tauri-cli, puis publication dans dist/.
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
            // linuxdeploy/appimagetool (téléchargés par le bundler) sont eux-mêmes
            // des AppImages : sans FUSE (conteneur), leur runtime doit s'extraire
            // au lieu de se monter. Sans effet quand FUSE est présent.
            .env("APPIMAGE_EXTRACT_AND_RUN", "1")
            // Le strip embarqué dans linuxdeploy (vieux binutils) ne connaît pas
            // les sections .relr.dyn des libs des distros récentes (Ubuntu 24.04+,
            // Arch…) et fait échouer tout le bundling. Sauter le strip ne coûte
            // rien : les .so des distros sont déjà strippés, et notre binaire
            // l'est par le profil release (strip = true).
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

/// `cargo build-msi` : installeur MSI Windows (WiX v3) via tauri-cli, puis
/// publication dans dist/. L'overlay src-tauri/tauri.msi.conf.json active le
/// bundling et branche les fragments WiX — le suivi (formats natifs) et celui
/// que génère `bundled::write_wix_fragment` (plugins embarqués, selon la
/// stratégie de bundled.rs) ; tauri.conf.json garde bundle.active=false.
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

    // ProductCode neuf à chaque build (mise à jour majeure, comme `Id="*"`),
    // mais commun aux MSI de chaque langue : `light`, qui résout `*`, tourne
    // une fois par langue — cf. src-tauri/wix/main.wxs et msi_lang.rs. Préfixe
    // TAURI obligatoire : tauri-bundler lance WiX avec un environnement vidé,
    // hors SYSTEMROOT/TMP/TEMP et les variables TAURI* (`clear_env_for_wix`).
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
            // Même neutralisation de sccache que build_app : tauri build lance
            // un cargo build --release, qui bute sinon sur web-sys.
            .env("RUSTC_WRAPPER", ""),
        "build-msi: bundling failed",
    );

    merge_msi();
}

/// Fusion des MSI par langue du dernier `tauri build` en un MSI multilingue,
/// puis publication dans dist/. Fin de `build_msi` ; seule, `cargo run
/// --manifest-path xtask/Cargo.toml -- msi-merge` rejoue la fusion sans
/// recompiler ni relancer WiX (mise au point de msi_lang.rs).
fn merge_msi() {
    if !cfg!(windows) {
        die("msi-merge: msi.dll and torch only exist on Windows");
    }
    let repo = repo_root();
    // Un MSI par langue (tauri.msi.conf.json, `wix.language`), fusionnés en un
    // seul qui suit la langue de l'interface Windows (cf. msi_lang.rs).
    let version = read_version(&repo);
    let bundle_dir = target_dir(&repo).join("release/bundle/msi");
    #[cfg(windows)]
    let built = msi_lang::merge(&bundle_dir, &version, |suffix| {
        find_bundle(&bundle_dir, &version, suffix)
    });
    // Inatteignable (sortie en tête hors Windows) : seulement pour compiler.
    #[cfg(not(windows))]
    let built = find_bundle(&bundle_dir, &version, ".msi");
    publish_dist(
        &repo,
        &built,
        &format!("{BIN_NAME}-{version}.msi"),
        &format!("{BIN_NAME}.msi"),
    );
}

/// `cargo build-deb` : paquet Debian/Ubuntu via tauri-cli, puis publication dans
/// dist/. L'overlay src-tauri/tauri.deb.conf.json active le bundling, déclare les
/// types MIME et le modèle de fichier .desktop ; `bundled::write_deb_overlay` le
/// complète des plugins embarqués (selon la stratégie de bundled.rs) dans une
/// copie générée, seule passée à tauri build. tauri.conf.json garde
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
    // Suffixé du tag distro comme les autres artefacts Linux : les dépendances
    // déclarées sont portables, mais le plancher glibc du binaire est celui de la
    // machine qui compile — le distribuable reste le -debian12.
    publish_dist(
        &repo,
        &built,
        &format!("{BIN_NAME}-{version}-linux-{arch}-{tag}.deb"),
        &format!("{BIN_NAME}-linux-{arch}-{tag}.deb"),
    );
}

/// Tag de la distro qui compile (`debian12`, `ubuntu24.04`, `arch`…), depuis
/// /etc/os-release. Deux builds Linux n'ont pas la même base glibc selon
/// qu'ils sortent du conteneur bookworm ou d'une machine native : le nom de
/// l'artefact doit le dire, sinon ils s'écrasent mutuellement dans dist/.
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

/// Copie l'artefact dans dist/ sous son nom versionné, puis crée à côté le
/// fichier non versionné (hardlink, copie en repli). Les fichiers existants
/// sont supprimés d'abord — jamais d'écriture à travers un ancien hardlink.
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

/// L'artefact de la version courante dans un dossier bundle. Le nommage Tauri
/// dérive du productName et contient la version (« Kroki Desk_x.y.z_amd64.AppImage »,
/// « Kroki Desk_x.y.z_x64_fr-FR.msi ») : on filtre là-dessus plutôt que de le
/// reconstruire, et d'anciennes versions peuvent traîner dans un target/
/// persistant (volume Docker, builds successifs).
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

/// Version de l'app — source de vérité unique : src-tauri/Cargo.toml.
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

/// Dossier target du crate src-tauri, en honorant CARGO_TARGET_DIR (volume
/// /target des builds Docker).
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

/// Le hook AppRun généré par linuxdeploy-plugin-gtk force `GDK_BACKEND=x11`
/// sans condition (tauri#8541) : sur une session Wayland pure sans XWayland
/// joignable (DISPLAY vide), gtk_init échoue et l'AppImage crash au lancement.
/// On patche le script plugin mis en cache par le bundler (source du hook,
/// heredoc quoté `<<\EOF` donc copié verbatim) pour ne forcer X11 que si un
/// DISPLAY existe — sinon GDK choisit lui-même (Wayland). Idempotent ; si le
/// script est absent on le télécharge d'abord (même URL que le bundler), et en
/// cas d'échec on continue : le build produira juste le hook upstream.
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

/// Retourne le binaire cargo-tauri à utiliser : local au dépôt, sinon PATH,
/// sinon installation locale (chemin fixe, volontairement indépendant de
/// CARGO_TARGET_DIR pour survivre aux redirections type Docker).
fn ensure_tauri_cli(repo: &Path) -> PathBuf {
    // `.exe` sous Windows, sinon le binaire déjà installé n'est jamais retrouvé
    // et l'installation one-shot se rejoue à chaque build.
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
