//! Plugin registry — protocol v1, see `doc/plugin-protocol.md`.
//!
//! A plugin is a `plugins/<id>/` folder containing a `manifest.json` (schema
//! §3 of the spec) and its code (JS worker + assets). The backend **never**
//! runs plugin code: it enumerates the manifests (serde, unknown fields
//! ignored), installs/uninstalls the `.kdext` archives (zip), serves the files
//! through the custom `plugin://` protocol (webview → worker) and enforces the
//! confinement of `host/readFile`. Execution lives on the frontend side
//! (`ui/js/plugins.js`, sandboxed worker).
//!
//! The plugins folder is deliberately **outside** the Tauri identity folder
//! (which follows the bundle's `identifier`): `%APPDATA%\kroki-deskapp\plugins`
//! (Windows) / `$XDG_CONFIG_HOME/kroki-deskapp/plugins` (Linux) — spec §9.1.

use std::io::{Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::commands::save_settings;
use crate::manager;
use crate::state::SettingsState;

/// Extension of plugin archives (drag-and-drop + « Ajouter » button).
pub const ARCHIVE_EXT: &str = "kdext";

/// Optional plugin changelog, at the root of its folder (spec §3.1):
/// fixed conventional name, no manifest field.
const CHANGELOG_FILE: &str = "CHANGELOG.md";

/// Capabilities THIS host can serve (`initialize` negotiation, spec §6.1).
pub const HOST_CAPABILITIES: &[&str] = &[
    "document:markdown",
    "fence:svg",
    "fence:html",
    "fence:markdown",
    "highlight:code",
    "read:siblings",
];

/// A plugin's `manifest.json` (spec §3). Unknown fields are ignored
/// (forward compat); missing lists default to empty.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    manifest_version: u64,
    id: String,
    version: String,
    api_version: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    publisher: String,
    runtime: String,
    entry: String,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    fences: Vec<String>,
    #[serde(default)]
    highlights: Vec<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    sibling_extensions: Vec<String>,
}

/// Registry entry, serialized as is to the frontend
/// (`list_plugins`, `plugins-changed` event).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub publisher: String,
    pub api_version: String,
    pub runtime: String,
    pub entry: String,
    /// Claimed extensions, normalized: lowercase, no dot.
    pub extensions: Vec<String>,
    pub fences: Vec<String>,
    pub highlights: Vec<String>,
    pub capabilities: Vec<String>,
    pub sibling_extensions: Vec<String>,
    /// "ok" | "inert" (loadable but no servable capability) | "invalid".
    pub status: String,
    pub status_reason: String,
    pub warnings: Vec<String>,
    /// A `CHANGELOG.md` exists at the plugin root (« Nouveautés » button).
    pub has_changelog: bool,
    /// Installation order (folder mtime) — conflict tie-breaker (§8).
    installed_at: u64,
}

static REGISTRY: OnceLock<RwLock<Vec<PluginInfo>>> = OnceLock::new();

fn registry() -> &'static RwLock<Vec<PluginInfo>> {
    REGISTRY.get_or_init(|| RwLock::new(Vec::new()))
}

/// `%APPDATA%\kroki-deskapp` (Windows) / `$XDG_CONFIG_HOME/kroki-deskapp`
/// (Linux, default `~/.config`): plugins and settings.
pub fn app_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join(".config"))
                .unwrap_or_else(|| PathBuf::from("."))
        });
    base.join("kroki-deskapp")
}

pub fn plugins_dir() -> PathBuf {
    app_dir().join("plugins")
}

/// Loads the registry at startup (before the first window).
pub fn init() {
    *registry().write().unwrap() = scan();
}

/// Re-scans and notifies all windows (`plugins-changed`, payload = list).
pub fn rescan(app: &AppHandle) {
    init();
    let list = list();
    let _ = app.emit("plugins-changed", &list);
}

/// Snapshot of the registry.
pub fn list() -> Vec<PluginInfo> {
    registry().read().unwrap().clone()
}

/// Does an active plugin claim this extension (lowercase, no dot)?
pub fn claims_extension(ext: &str) -> bool {
    registry()
        .read()
        .unwrap()
        .iter()
        .any(|p| p.status == "ok" && p.extensions.iter().any(|e| e == ext))
}

/// Effective document extensions: native ∪ active plugins (spec §9.3).
pub fn effective_doc_extensions() -> Vec<String> {
    let mut out: Vec<String> = manager::DOC_EXTENSIONS
        .iter()
        .map(|e| e.to_string())
        .collect();
    for p in registry().read().unwrap().iter() {
        if p.status != "ok" {
            continue;
        }
        for e in &p.extensions {
            if !out.contains(e) {
                out.push(e.clone());
            }
        }
    }
    out
}

/// Is the path a `.kdext` plugin archive?
pub fn is_plugin_archive(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(ARCHIVE_EXT))
}

/// Archives waiting for the trust dialog (§9.2). A queue, rather than a
/// plain event carrying the path: an archive can arrive **before** the
/// window has registered its listener — this is the double-click case when
/// the application is not already running, the opening happening in `setup`
/// while the webview loads its JS afterwards. The
/// `plugin-install-request` event is therefore only a signal; the payload is
/// retrieved through `take_pending_plugin_installs`, which the frontend also
/// calls once its listener is in place.
static PENDING_INSTALLS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn pending_installs() -> &'static Mutex<Vec<String>> {
    PENDING_INSTALLS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Queues an archive for installation and signals the target window.
pub fn request_install(app: &AppHandle, label: &str, path: &Path) {
    pending_installs()
        .lock()
        .unwrap()
        .push(path.to_string_lossy().into_owned());
    let _ = app.emit_to(label, "plugin-install-request", ());
}

/// Takes and empties the queue of pending archives.
#[tauri::command]
pub fn take_pending_plugin_installs() -> Vec<String> {
    std::mem::take(&mut *pending_installs().lock().unwrap())
}

// --------------------------------------------------------------------------- //
// Scan of the plugins folder
// --------------------------------------------------------------------------- //

fn scan() -> Vec<PluginInfo> {
    let dir = plugins_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut list: Vec<PluginInfo> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            !name.starts_with('.') && !name.ends_with(".bak")
        })
        .map(|p| load_plugin(&p))
        .collect();
    // Installation order ≈ folder mtime (extraction creates a fresh folder):
    // tie-breaker, « last installed wins » (§8.2).
    list.sort_by_key(|p| p.installed_at);
    resolve_conflicts(&mut list);
    list
}

fn dir_mtime(dir: &Path) -> u64 {
    std::fs::metadata(dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Lowercase, no leading dot — canonical form of extensions/fences.
fn norm_ext(e: &str) -> String {
    e.trim().trim_start_matches('.').to_ascii_lowercase()
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// **Hard** manifest errors: refused at install time, `invalid` status at
/// scan. The « soft » cases (unknown runtime, no servable capability) make
/// the plugin inert, not invalid (spec §3).
fn validate_hard(m: &Manifest) -> Result<(), String> {
    if !valid_id(&m.id) {
        return Err(tr!("pluginpkg.manifest_id_invalid", id = m.id));
    }
    if m.manifest_version != 1 {
        return Err(tr!(
            "pluginpkg.manifest_version",
            version = m.manifest_version
        ));
    }
    if m.api_version != "1" && !m.api_version.starts_with("1.") {
        return Err(tr!("pluginpkg.api_version", version = m.api_version));
    }
    let entry = Path::new(&m.entry);
    if m.entry.is_empty()
        || entry.is_absolute()
        || entry
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(tr!("pluginpkg.entry_invalid", entry = m.entry));
    }
    Ok(())
}

fn load_plugin(dir: &Path) -> PluginInfo {
    let dirname = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let installed_at = dir_mtime(dir);
    let has_changelog = dir.join(CHANGELOG_FILE).is_file();
    let invalid = |reason: String| PluginInfo {
        id: dirname.clone(),
        name: dirname.clone(),
        description: String::new(),
        version: String::new(),
        publisher: String::new(),
        api_version: String::new(),
        runtime: String::new(),
        entry: String::new(),
        extensions: Vec::new(),
        fences: Vec::new(),
        highlights: Vec::new(),
        capabilities: Vec::new(),
        sibling_extensions: Vec::new(),
        status: "invalid".into(),
        status_reason: reason,
        warnings: Vec::new(),
        has_changelog,
        installed_at,
    };

    let manifest_path = dir.join("manifest.json");
    let bytes = match std::fs::read(&manifest_path) {
        Ok(b) => b,
        Err(e) => return invalid(tr!("pluginpkg.manifest_unreadable", error = e)),
    };
    let m: Manifest = match serde_json::from_slice(&bytes) {
        Ok(m) => m,
        Err(e) => return invalid(tr!("pluginpkg.manifest_invalid", error = e)),
    };
    if let Err(e) = validate_hard(&m) {
        return invalid(e);
    }
    if m.id != dirname {
        return invalid(tr!("pluginpkg.id_mismatch", id = m.id, dir = dirname));
    }
    if !dir.join(&m.entry).is_file() {
        return invalid(tr!("pluginpkg.entry_not_found", entry = m.entry));
    }

    // Status: inert if the runtime is unknown or if no producing capability
    // can be served by this host.
    let (status, status_reason) = if m.runtime != "worker" {
        (
            "inert",
            tr!("pluginpkg.runtime_unsupported", runtime = m.runtime),
        )
    } else if !m
        .capabilities
        .iter()
        .any(|c| HOST_CAPABILITIES.contains(&c.as_str()) && c != "read:siblings")
    {
        ("inert", tr!("pluginpkg.no_capability"))
    } else {
        ("ok", String::new())
    };

    PluginInfo {
        id: m.id,
        name: m.name,
        description: m.description,
        version: m.version,
        publisher: m.publisher,
        api_version: m.api_version,
        runtime: m.runtime,
        entry: m.entry,
        extensions: m.extensions.iter().map(|e| norm_ext(e)).collect(),
        fences: m.fences.iter().map(|f| f.trim().to_lowercase()).collect(),
        highlights: m
            .highlights
            .iter()
            .map(|h| h.trim().to_lowercase())
            .collect(),
        capabilities: m.capabilities,
        sibling_extensions: m.sibling_extensions.iter().map(|e| norm_ext(e)).collect(),
        status: status.into(),
        status_reason,
        warnings: Vec::new(),
        has_changelog,
        installed_at,
    }
}

/// Warnings of a claim conflict, loser side then winner side. `kind`:
/// 0 = extension, 1 = fence, 2 = highlighting. One key per whole sentence:
/// the claim type's name is not glued in.
fn conflict_messages(kind: usize, name: &str, winner: &str, loser: &str) -> (String, String) {
    match kind {
        0 => (
            tr!(
                "pluginpkg.conflict.extension.lost",
                name = name,
                winner = winner
            ),
            tr!(
                "pluginpkg.conflict.extension.won",
                name = name,
                loser = loser
            ),
        ),
        1 => (
            tr!(
                "pluginpkg.conflict.fence.lost",
                name = name,
                winner = winner
            ),
            tr!("pluginpkg.conflict.fence.won", name = name, loser = loser),
        ),
        _ => (
            tr!(
                "pluginpkg.conflict.highlight.lost",
                name = name,
                winner = winner
            ),
            tr!(
                "pluginpkg.conflict.highlight.won",
                name = name,
                loser = loser
            ),
        ),
    }
}

/// Conflict rules (§8): native always wins (extensions — native fences
/// are arbitrated on the frontend, which knows `KROKI_TYPES`), then between
/// plugins the last installed wins, with a warning on both sides.
fn resolve_conflicts(list: &mut [PluginInfo]) {
    // Native first: a native extension is removed from the claim.
    for p in list.iter_mut() {
        if p.status != "ok" {
            continue;
        }
        let (native, kept): (Vec<String>, Vec<String>) = p
            .extensions
            .drain(..)
            .partition(|e| manager::DOC_EXTENSIONS.contains(&e.as_str()));
        for e in native {
            p.warnings.push(tr!("pluginpkg.native_extension", name = e));
        }
        p.extensions = kept;
    }
    // Between plugins: for each claim, the last installed (end of list)
    // wins. `list` is sorted by ascending installed_at.
    for kind in 0..3usize {
        let claims = |p: &PluginInfo| -> Vec<String> {
            match kind {
                0 => p.extensions.clone(),
                1 => p.fences.clone(),
                _ => p.highlights.clone(),
            }
        };
        for i in 0..list.len() {
            if list[i].status != "ok" {
                continue;
            }
            for c in claims(&list[i]) {
                if let Some(j) = (i + 1..list.len())
                    .find(|&j| list[j].status == "ok" && claims(&list[j]).contains(&c))
                {
                    let winner = list[j].id.clone();
                    let loser = list[i].id.clone();
                    let (lost, won) = conflict_messages(kind, &c, &winner, &loser);
                    list[i].warnings.push(lost);
                    list[j].warnings.push(won);
                }
            }
        }
    }
}

// --------------------------------------------------------------------------- //
// Custom `plugin://` protocol — serves the plugins' files to the worker
// --------------------------------------------------------------------------- //

fn http_response(status: u16, ctype: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", ctype)
        // The worker (blob, app origin) imports the plugin's modules
        // cross-origin: module scripts require CORS.
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("js") | Some("mjs") => "text/javascript",
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        Some("css") => "text/css",
        _ => "application/octet-stream",
    }
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                b'A'..=b'F' => Some(b - b'A' + 10),
                _ => None,
            };
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Protocol handler: `plugin://localhost/<id>/<path>` (Windows:
/// `http://plugin.localhost/<id>/<path>`). Read-only, confined to the plugin's
/// folder (canonicalization + `starts_with`, like `read_data_file`).
pub fn serve(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    // Technical HTTP response, read by the worker (never displayed): fixed English.
    let not_found = || http_response(404, "text/plain", b"not found".to_vec());
    let path = percent_decode(request.uri().path());
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let (Some(id), Some(rel)) = (parts.next(), parts.next()) else {
        return not_found();
    };
    if !valid_id(id) || rel.is_empty() || rel.contains("..") || rel.contains('\0') {
        return not_found();
    }
    let Ok(base) = dunce::canonicalize(plugins_dir().join(id)) else {
        return not_found();
    };
    let Ok(file) = dunce::canonicalize(base.join(rel)) else {
        return not_found();
    };
    if !file.starts_with(&base) || !file.is_file() {
        return not_found();
    }
    match std::fs::read(&file) {
        Ok(bytes) => http_response(200, content_type(&file), bytes),
        Err(_) => not_found(),
    }
}

// --------------------------------------------------------------------------- //
// Install / uninstall (.kdext archives)
// --------------------------------------------------------------------------- //

fn open_archive(path: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file =
        std::fs::File::open(path).map_err(|e| tr!("pluginpkg.archive_unreadable", error = e))?;
    zip::ZipArchive::new(file).map_err(|e| tr!("pluginpkg.archive_invalid", error = e))
}

fn archive_manifest(path: &Path) -> Result<Manifest, String> {
    zip_manifest(&mut open_archive(path)?)
}

fn zip_manifest<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Result<Manifest, String> {
    let mut entry = zip.by_name("manifest.json").map_err(|e| match e {
        zip::result::ZipError::FileNotFound => tr!("pluginpkg.manifest_missing"),
        // E.g. unsupported compression method (PPMd): show the cause.
        e => tr!("pluginpkg.manifest_unreadable", error = e),
    })?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| tr!("pluginpkg.manifest_unreadable", error = e))?;
    let m: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| tr!("pluginpkg.manifest_invalid", error = e))?;
    validate_hard(&m)?;
    Ok(m)
}

/// `x.y.z` version comparison (numeric components, lexicographic).
pub(crate) fn version_less(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split(['.', '-', '+'])
            .map(|c| c.parse().unwrap_or(0))
            .collect()
    };
    parse(a) < parse(b)
}

/// Preview of an archive for the trust dialog (spec §9.2) — read without
/// running any plugin code.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPreview {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub publisher: String,
    pub extensions: Vec<String>,
    pub fences: Vec<String>,
    pub highlights: Vec<String>,
    pub capabilities: Vec<String>,
    pub sibling_extensions: Vec<String>,
    pub installed_version: Option<String>,
    pub downgrade: bool,
}

#[tauri::command]
pub fn plugin_manifest_preview(path: String) -> Result<ManifestPreview, String> {
    let m = archive_manifest(Path::new(&path))?;
    let installed_version = registry()
        .read()
        .unwrap()
        .iter()
        .find(|p| p.id == m.id)
        .map(|p| p.version.clone());
    let downgrade = installed_version
        .as_deref()
        .is_some_and(|cur| version_less(&m.version, cur));
    Ok(ManifestPreview {
        id: m.id,
        name: m.name,
        description: m.description,
        version: m.version,
        publisher: m.publisher,
        extensions: m.extensions.iter().map(|e| norm_ext(e)).collect(),
        fences: m.fences.clone(),
        highlights: m.highlights.clone(),
        capabilities: m.capabilities.clone(),
        sibling_extensions: m.sibling_extensions.iter().map(|e| norm_ext(e)).collect(),
        installed_version,
        downgrade,
    })
}

/// Installs (or updates) a `.kdext` archive: extraction to a temporary
/// folder, atomic swap, previous version kept as `<id>.bak` (spec §9.2).
///
/// Touches neither the registry nor the settings: the caller decides. Shared by
/// the `install_plugin` command (trust dialog upstream) and by `seed_bundled`
/// (plugins shipped with the application).
fn install_archive(src: &Path) -> Result<Manifest, String> {
    install_zip(open_archive(src)?)
}

fn install_zip<R: Read + Seek>(mut zip: zip::ZipArchive<R>) -> Result<Manifest, String> {
    let m = zip_manifest(&mut zip)?;
    let dir = plugins_dir();
    std::fs::create_dir_all(&dir).map_err(|e| tr!("pluginpkg.dir_error", error = e))?;

    let tmp = dir.join(format!(".tmp-{}", m.id));
    let _ = std::fs::remove_dir_all(&tmp);
    zip.extract(&tmp).map_err(|e| {
        let _ = std::fs::remove_dir_all(&tmp);
        tr!("pluginpkg.extract_failed", error = e)
    })?;

    let dest = dir.join(&m.id);
    let bak = dir.join(format!("{}.bak", m.id));
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&bak);
        std::fs::rename(&dest, &bak).map_err(|e| tr!("pluginpkg.backup_failed", error = e))?;
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        // Restore the old version if the swap fails.
        if bak.exists() {
            let _ = std::fs::rename(&bak, &dest);
        }
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(tr!("pluginpkg.install_failed", error = e));
    }
    Ok(m)
}

#[tauri::command]
pub fn install_plugin(app: AppHandle, path: String) -> Result<(), String> {
    let m = install_archive(Path::new(&path))?;
    // Installing by hand lifts an earlier refusal: the plugin becomes
    // eligible again for the installer's silent updates.
    set_removed(&app, &m.id, false);
    rescan(&app);
    Ok(())
}

/// Deletes a plugin (folder + `.bak`). No recycle bin: the user
/// reinstalls from their archive if they made a mistake (spec §9.4).
#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(tr!("pluginpkg.id_invalid"));
    }
    let dir = plugins_dir();
    let dest = dir.join(&id);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| tr!("pluginpkg.remove_failed", error = e))?;
    }
    let _ = std::fs::remove_dir_all(dir.join(format!("{id}.bak")));
    // Remember the refusal, otherwise a plugin shipped with the installer would
    // come back at the next startup (see `seed_bundled`).
    set_removed(&app, &id, true);
    crate::journal::forget_plugin(&id);
    rescan(&app);
    Ok(())
}

// --------------------------------------------------------------------------- //
// Plugins shipped with the installer
// --------------------------------------------------------------------------- //

/// Marks (or unmarks) a plugin as removed by the user, and persists.
fn set_removed(app: &AppHandle, id: &str, removed: bool) {
    {
        let st = app.state::<SettingsState>();
        let mut s = st.0.lock().unwrap();
        let present = s.removed_plugins.iter().any(|x| x == id);
        match (removed, present) {
            (true, false) => s.removed_plugins.push(id.to_string()),
            (false, true) => s.removed_plugins.retain(|x| x != id),
            // Already in the desired state: no rewrite of settings.json.
            _ => return,
        }
    }
    save_settings(app);
}

/// `latex-doc` plugin archive, packed by `build.rs` from
/// `plugins/latex-doc/`: what `seed_bundled` installs when there is no
/// installer.
const EMBEDDED_PLUGIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/latex-doc.kdext"));

/// Folder of the plugins shipped with the application — the installer drops
/// the `.kdext` **checked at install time** there (conditional components of
/// the generated WiX fragment, resources of the `.deb` overlay). Nothing to
/// filter here: seeding installs what it finds, an unchecked plugin is simply
/// absent from the folder.
///
/// Both installers create this folder **even when empty** (MSI `CreateFolder`
/// component, `.deb` `postinst`): its presence means « an installer made a
/// choice », its absence « no installer » (portable, AppImage, debug) — the
/// only case where the plugin embedded in the binary is installed.
///
/// The subfolder is essential, and not just for tidiness: `resource_dir()`
/// is the executable's folder, and the portable binary is published in `dist/`
/// — next to all the archives produced by `build_dist.py`. Without
/// this level, launching it from there would install any neighboring `.kdext`.
pub(crate) fn bundled_plugins_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("bundled-plugins"))
}

/// Installed version of a plugin, read straight from disk: the registry
/// is not loaded yet when seeding runs (before `init`).
fn installed_version(id: &str) -> Option<String> {
    let bytes = std::fs::read(plugins_dir().join(id).join("manifest.json")).ok()?;
    serde_json::from_slice::<Manifest>(&bytes)
        .ok()
        .map(|m| m.version)
}

/// Installs and updates the plugins shipped with the application, **without a
/// trust dialog**: they come from the executable or its installer, hence from
/// the same chain of trust (exemption from spec §9.2, the only installation
/// path that skips it — drop and the Plugins dialog keep it).
/// Source: the `bundled-plugins/` folder if it exists, otherwise the plugin
/// embedded in the binary (see `bundled_plugins_dir`).
///
/// To be called before `init()`: the first scan then sees the final state, and
/// no worker has loaded the previous version.
///
/// Two safeguards: never a version regression (a newer `.kdext` placed by hand
/// is kept), and a plugin removed by the user is not reinstalled
/// (`SettingsData::removed_plugins`).
pub fn seed_bundled(app: &AppHandle) {
    let removed = app
        .state::<SettingsState>()
        .0
        .lock()
        .unwrap()
        .removed_plugins
        .clone();
    let Some(entries) = bundled_plugins_dir(app).and_then(|d| std::fs::read_dir(d).ok()) else {
        let zip = zip::ZipArchive::new(Cursor::new(EMBEDDED_PLUGIN))
            .map_err(|e| tr!("pluginpkg.archive_invalid", error = e));
        seed_archive(zip, "embedded in the binary", &removed);
        return;
    };
    let archives = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_plugin_archive(p));
    for path in archives {
        seed_archive(open_archive(&path), &path.display().to_string(), &removed);
    }
}

fn seed_archive<R: Read + Seek>(
    zip: Result<zip::ZipArchive<R>, String>,
    origin: &str,
    removed: &[String],
) {
    let manifest = zip.and_then(|mut zip| zip_manifest(&mut zip).map(|m| (zip, m)));
    let (zip, m) = match manifest {
        Ok(found) => found,
        Err(e) => {
            crate::journal::warn(
                "plugins",
                format!("bundled archive ignored ({origin}): {e}"),
            );
            return;
        }
    };
    if removed.contains(&m.id) {
        return;
    }
    // Installed at an equal or higher version: do nothing.
    if installed_version(&m.id).is_some_and(|cur| !version_less(&cur, &m.version)) {
        return;
    }
    match install_zip(zip) {
        Ok(_) => crate::journal::info(
            "plugins",
            format!(
                "{} {} installed (bundled with the app, {origin})",
                m.id, m.version
            ),
        ),
        Err(e) => crate::journal::error("plugins", format!("cannot install {}: {e}", m.id)),
    }
}

#[tauri::command]
pub fn list_plugins() -> Vec<PluginInfo> {
    list()
}

/// Opens the plugins folder in the platform's file manager
/// (Explorer / xdg-open). The folder does not exist until something has been
/// installed: it is created first so the button always works.
#[tauri::command]
pub fn open_plugins_dir(app: AppHandle) -> Result<(), String> {
    let dir = plugins_dir();
    std::fs::create_dir_all(&dir).map_err(|e| tr!("pluginpkg.mkdir_failed", error = e))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<String>)
        .map_err(|e| tr!("pluginpkg.open_failed", error = e))
}

/// Native `.kdext` archive picker (« Ajouter un plugin… » button): the
/// chosen path goes back to the frontend through the same queue as drop and
/// double-click, all paths converge on the trust dialog (§9.4).
#[tauri::command]
pub fn pick_plugin_archive(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    app.dialog()
        .file()
        .add_filter(tr!("dialog.filter.plugin"), &[ARCHIVE_EXT])
        .pick_file(move |file| {
            let Some(file) = file else { return };
            let Ok(path) = file.into_path() else { return };
            request_install(window.app_handle(), label.as_str(), &path);
        });
}

/// Content of an installed plugin's `CHANGELOG.md` (« Nouveautés » button of
/// the Plugins dialog, spec §3.1). **Fixed** file name joined to the plugin's
/// folder — no caller-supplied path, no traversal possible.
#[tauri::command]
pub fn plugin_changelog(id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err(tr!("pluginpkg.id_invalid"));
    }
    std::fs::read_to_string(plugins_dir().join(&id).join(CHANGELOG_FILE))
        .map_err(|e| tr!("pluginpkg.changelog_unreadable", error = e))
}

/// `host/readFile` service (`read:siblings` capability, spec §6.5): read
/// confined to the current document's folder, allowlist = the manifest's
/// `siblingExtensions`. Same anti-traversal guard as `read_data_file`.
///
/// The error carries the protocol code (`not-found` | `denied`) alongside the
/// translated message: the worker must not guess it from text that changes
/// with the interface language.
#[tauri::command]
pub fn plugin_read_sibling(
    plugin_id: String,
    base_dir: String,
    rel: String,
) -> Result<String, SiblingError> {
    read_sibling(&plugin_id, &base_dir, &rel)
}

/// Error of `plugin_read_sibling`, as relayed to the plugin (spec §6.5).
#[derive(Serialize)]
pub struct SiblingError {
    code: &'static str,
    message: String,
}

/// `not-found` only for a file missing **inside** the folder, once the plugin
/// and the extension are admitted: otherwise `denied`, without consulting the
/// disk — a plugin must not be able to probe for files outside its
/// confinement (see `read_confined`).
fn read_sibling(plugin_id: &str, base_dir: &str, rel: &str) -> Result<String, SiblingError> {
    let denied = |message| SiblingError {
        code: "denied",
        message,
    };
    let allowed: Vec<String> = registry()
        .read()
        .unwrap()
        .iter()
        .find(|p| p.id == plugin_id && p.status == "ok")
        .map(|p| p.sibling_extensions.clone())
        .ok_or_else(|| denied(tr!("pluginpkg.unknown_plugin")))?;
    let ext = Path::new(&rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !allowed.contains(&ext) {
        return Err(denied(tr!("pluginpkg.extension_not_allowed", ext = ext)));
    }
    crate::commands::read_confined(base_dir, rel).map_err(|e| SiblingError {
        code: if e.not_found { "not-found" } else { "denied" },
        message: e.message,
    })
}
