use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine;
use crate::i18n;
use crate::kroki::{self, KrokiState};
use crate::manager;
use crate::server;
use crate::state::{AppState, SettingsData, SettingsState, TabsPayload};

#[derive(Serialize)]
pub struct DocPayload {
    pub id: u64,
    pub title: String,
    pub path: String,
    pub dir: String,
    pub markdown: String,
}

#[tauri::command]
pub fn get_window_state(window: WebviewWindow, state: State<AppState>) -> TabsPayload {
    let st = state.0.lock().unwrap();
    st.tabs_payload(window.label())
}

#[tauri::command]
pub fn read_document(state: State<AppState>, doc_id: u64) -> Result<DocPayload, String> {
    let (path, title) = {
        let st = state.0.lock().unwrap();
        let doc = st
            .docs
            .get(&doc_id)
            .ok_or_else(|| tr!("error.document.unknown"))?;
        (doc.path.clone(), doc.title.clone())
    };
    let bytes = std::fs::read(&path)
        .map_err(|e| tr!("error.file.read", path = path.display(), error = e))?;
    let markdown = String::from_utf8_lossy(&bytes).into_owned();
    Ok(DocPayload {
        id: doc_id,
        title,
        dir: path
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        markdown,
    })
}

/// Renders a diagram: built-in engines by default, external Kroki server if configured.
#[tauri::command]
pub async fn render_diagram(
    app: AppHandle,
    kroki: State<'_, KrokiState>,
    settings: State<'_, SettingsState>,
    diagram_type: String,
    source: String,
    options: Option<BTreeMap<String, String>>,
) -> Result<String, String> {
    let opts = options.unwrap_or_default();
    let dtype = engine::resolve_alias(diagram_type.to_lowercase().as_str()).to_string();
    let external = settings.0.lock().unwrap().external_url.clone();
    let mode = if external.is_empty() {
        "embedded"
    } else {
        external.as_str()
    };
    let key = kroki::cache_key(mode, &dtype, &source, &opts);
    if let Some(svg) = kroki.cache.lock().unwrap().get(&key) {
        return Ok(svg.clone());
    }

    let result = if external.is_empty() {
        let app2 = app.clone();
        let (d, s) = (dtype.clone(), source.clone());
        let json_opts: serde_json::Map<String, serde_json::Value> = opts
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        tauri::async_runtime::spawn_blocking(move || {
            engine::render_local(&app2, &d, &s, &json_opts)
        })
        .await
        .map_err(|e| tr!("engine.render_interrupted", error = e))
        .and_then(|r| r)
    } else {
        kroki::render(&kroki, &external, &dtype, &source, opts).await
    };

    match result {
        Ok(svg) => {
            kroki.cache.lock().unwrap().insert(key, svg.clone());
            Ok(svg)
        }
        Err(e) => {
            // Shown in the document; logged for diagnostics (the cache
            // only keeps successes: every new attempt is traced).
            let via = if external.is_empty() {
                "built-in".to_string()
            } else {
                crate::journal::redact_url(&external)
            };
            crate::journal::warn("render", format!("{dtype} ({via}): {e}"));
            Err(e)
        }
    }
}

/// Called by the render webview when its engines are loaded.
#[tauri::command]
pub fn renderer_ready(app: AppHandle, window: WebviewWindow) {
    if window.label() == engine::RENDERER_LABEL {
        engine::set_renderer_ready(&app, true);
    }
}

/// Response to a render job from the dedicated webview.
#[tauri::command]
pub fn render_job_done(
    app: AppHandle,
    window: WebviewWindow,
    id: u64,
    svg: Option<String>,
    error: Option<String>,
) {
    if window.label() != engine::RENDERER_LABEL {
        return;
    }
    let result = match (svg, error) {
        (Some(s), _) => Ok(s),
        (None, Some(e)) => Err(e),
        // Empty error: `engine::render_js` translates it on the waiting thread.
        (None, None) => Err(String::new()),
    };
    engine::complete_job(&app, id, result);
}

#[tauri::command]
pub fn open_paths(app: AppHandle, window: WebviewWindow, paths: Vec<String>) {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolved = manager::collect_file_args(paths, &cwd);
    manager::open_file_args(&app, window.label(), &resolved);
}

/// References (`doc.tex#eq:x`, `doc.md#L42`) passed on the command line and
/// intended for this window (see `manager::open_file_args`).
#[tauri::command]
pub fn take_pending_anchors(window: WebviewWindow) -> Vec<manager::PendingAnchor> {
    manager::take_pending_anchors(window.label())
}

#[tauri::command]
pub fn open_file_dialog(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    // Effective extensions = native ∪ active plugins (see plugins.rs §9.3).
    let exts = crate::plugins::effective_doc_extensions();
    let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .add_filter(tr!("dialog.filter.documents"), &ext_refs)
        .add_filter(tr!("dialog.filter.session"), &[crate::session::SESSION_EXT])
        .add_filter(tr!("dialog.filter.all_files"), &["*"])
        .pick_files(move |files| {
            let Some(files) = files else { return };
            let paths: Vec<PathBuf> = files
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .filter_map(|p| dunce::canonicalize(&p).ok())
                .filter(|p| p.is_file())
                .collect();
            // `pick_files` provides no handle: get it through the window.
            manager::open_mixed_paths(window.app_handle(), &label, &paths);
        });
}

#[tauri::command]
pub fn activate_tab(app: AppHandle, window: WebviewWindow, state: State<AppState>, doc_id: u64) {
    let label = window.label().to_string();
    {
        let mut st = state.0.lock().unwrap();
        if st.tabs.get(&label).is_some_and(|ids| ids.contains(&doc_id)) {
            st.active.insert(label.clone(), doc_id);
        }
    }
    manager::sync_window(&app, &label);
}

#[tauri::command]
pub fn close_tab(app: AppHandle, window: WebviewWindow, doc_id: u64) {
    manager::close_tab(&app, window.label(), doc_id);
}

/// Tab context menu: `side` = `left` | `right` | `others`.
#[tauri::command]
pub fn close_tabs_around(app: AppHandle, window: WebviewWindow, doc_id: u64, side: String) {
    manager::close_tabs_around(&app, window.label(), doc_id, &side);
}

/// Tab context menu: detaches the tab into a new window.
/// Async, like `finish_tab_drag`: creating a window from a synchronous
/// command would block on the main thread (WebView2).
#[tauri::command]
pub async fn detach_tab(app: AppHandle, window: WebviewWindow, doc_id: u64) {
    manager::detach_tab(&app, &window, doc_id);
}

/// Tab context menu: reopens the document in a new window,
/// the tab staying in place. Async for the same reason as `detach_tab`.
#[tauri::command]
pub async fn duplicate_tab(app: AppHandle, window: WebviewWindow, doc_id: u64) {
    manager::duplicate_tab(&app, &window, doc_id);
}

/// Tab context menu: opens the document's folder in the file manager,
/// file selected. The path is re-read from the state, not supplied by the
/// frontend. Async: the shell call does not block the main thread.
#[tauri::command]
pub async fn reveal_tab_file(app: AppHandle, doc_id: u64) -> Result<(), String> {
    let path = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.docs.get(&doc_id).map(|d| d.path.clone())
    }
    .ok_or_else(|| tr!("error.document.not_found"))?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| tr!("error.reveal_failed", error = e))
}

#[tauri::command]
pub fn reorder_tab(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    doc_id: u64,
    index: usize,
) {
    let label = window.label().to_string();
    {
        let mut st = state.0.lock().unwrap();
        if let Some(ids) = st.tabs.get_mut(&label) {
            if let Some(cur) = ids.iter().position(|id| *id == doc_id) {
                ids.remove(cur);
                let target = index.min(ids.len());
                ids.insert(target, doc_id);
            }
        }
    }
    manager::sync_window(&app, &label);
}

// Commands that create windows are async: on Windows, a synchronous command
// runs on the main thread and blocks the WebView2 initialization of the new
// window (the webview would stay on about:blank).
#[tauri::command]
pub async fn new_window(app: AppHandle) -> Result<String, String> {
    manager::create_window(&app, None, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_window(window: WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn set_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

#[tauri::command]
pub fn focus_window(app: AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub async fn finish_tab_drag(app: AppHandle, window: WebviewWindow, doc_id: u64) {
    manager::finish_tab_drag(&app, &window, doc_id);
}

/// Test variant (debug builds only): release position supplied
/// instead of being read from the real cursor. Inert in release.
#[tauri::command]
#[allow(unused_variables)]
pub async fn debug_finish_tab_drag_at(
    app: AppHandle,
    window: WebviewWindow,
    doc_id: u64,
    x: f64,
    y: f64,
) {
    #[cfg(debug_assertions)]
    manager::finish_tab_drag_at(&app, &window, doc_id, tauri::PhysicalPosition::new(x, y));
}

#[derive(Serialize)]
pub struct SettingsInfo {
    #[serde(flatten)]
    pub data: SettingsData,
    pub supported: String,
    pub java_available: bool,
    pub tex_available: bool,
}

#[tauri::command]
pub fn get_settings(app: AppHandle, settings: State<SettingsState>) -> SettingsInfo {
    SettingsInfo {
        data: settings.0.lock().unwrap().clone(),
        supported: engine::supported_summary(),
        java_available: engine::java_available(&app),
        tex_available: engine::tex_available(&app),
    }
}

/// Runtime/engine status for the info window (see the « i » button).
#[tauri::command]
pub fn get_runtimes(app: AppHandle) -> Vec<engine::RuntimeGroup> {
    engine::runtime_report(&app)
}

/// `CHANGELOG.md` embedded at compile time (« Nouveautés » dialog): single
/// source at the repo root, always in sync with the built version.
#[tauri::command]
pub fn get_changelog() -> &'static str {
    include_str!("../../CHANGELOG.md")
}

/// Theme alone (`"auto"|"light"|"dark"`), read at each window's boot to apply
/// any override before the first render — without the cost of `get_settings`.
#[tauri::command]
pub fn get_theme(settings: State<SettingsState>) -> String {
    settings.0.lock().unwrap().theme.clone()
}

/// Interface language for the frontend: the resolved code (`auto` → system
/// language), the raw setting, the shipped languages (`{code, name}`) and the full
/// catalog of the current language, already completed with English. Read at each
/// window's boot and after a setting change (see `ui/js/i18n.js`).
#[tauri::command]
pub fn get_i18n(settings: State<SettingsState>) -> serde_json::Value {
    json!({
        "locale": i18n::current(),
        "setting": settings.0.lock().unwrap().language,
        "languages": i18n::language_list(),
        "messages": i18n::messages(),
    })
}

/// Icon visibility, alone (see `SettingsData::icons`): read at each window's
/// boot to hide disabled icons before the first paint — same motivation as
/// `get_theme`, without the cost of `get_settings`.
#[tauri::command]
pub fn get_icons(settings: State<SettingsState>) -> BTreeMap<String, bool> {
    settings.0.lock().unwrap().icons.clone()
}

// IPC boundary: the flat argument list is the natural shape of a Tauri
// command (grouping them would only add a transport struct).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    window: WebviewWindow,
    settings: State<SettingsState>,
    external_url: String,
    server_enabled: bool,
    server_port: u16,
    theme: String,
    language: String,
    icons: BTreeMap<String, bool>,
    update_check: bool,
) -> Result<(), String> {
    let url = external_url.trim().trim_end_matches('/').to_string();
    if !url.is_empty() && !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(tr!("error.settings.url_scheme"));
    }
    if server_port < 1024 {
        return Err(tr!("error.settings.port_min", min = 1024));
    }
    // Unknown value → fall back to « auto » (lenient rather than a blocking error).
    let theme = match theme.as_str() {
        "light" | "dark" => theme,
        _ => "auto".to_string(),
    };
    // Unknown code → « auto », same leniency as the theme.
    let language = if i18n::languages().contains(&language.as_str()) {
        language
    } else {
        "auto".to_string()
    };
    let previous_locale = i18n::current();
    let locale = i18n::set_language(&language);
    {
        let mut s = settings.0.lock().unwrap();
        // Not exposed in the Settings (« Réglages ») dialog: preserved as is (fed by
        // plugins::install_plugin / uninstall_plugin and updates::check_update).
        let removed_plugins = std::mem::take(&mut s.removed_plugins);
        let update_checked_at = s.update_checked_at;
        *s = SettingsData {
            external_url: url,
            server_enabled,
            server_port,
            theme: theme.clone(),
            language,
            icons: icons.clone(),
            removed_plugins,
            update_check,
            update_checked_at,
        };
    }
    save_settings(&app);
    server::apply_settings(&app, server_enabled, server_port);
    // Global settings: propagate theme and icons to ALL windows. `from`
    // lets the initiating window (already updated locally) ignore its
    // own echo.
    let _ = app.emit(
        "theme-changed",
        json!({ "mode": theme, "from": window.label() }),
    );
    // Language: only if it actually changes (« auto » → « fr » on a French
    // workstation changes nothing in the display).
    if locale != previous_locale {
        // Plugin statuses and warnings are composed at scan time, in the language
        // of the moment: a new scan recomposes them (and notifies the dialog).
        crate::plugins::rescan(&app);
        let _ = app.emit(
            "locale-changed",
            json!({ "locale": locale, "from": window.label() }),
        );
    }
    let _ = app.emit(
        "icons-changed",
        json!({ "icons": icons, "from": window.label() }),
    );
    Ok(())
}

/// Opens a link from the document: web URL → browser; relative markdown file →
/// new tab; other file → associated application.
#[tauri::command]
pub fn open_link(app: AppHandle, window: WebviewWindow, base_dir: String, href: String) {
    let href = href.split('#').next().unwrap_or("").trim();
    if href.is_empty() {
        return;
    }
    if href.starts_with("http://") || href.starts_with("https://") || href.starts_with("mailto:") {
        let _ = app.opener().open_url(href, None::<String>);
        return;
    }
    let p = PathBuf::from(href);
    let abs = if p.is_absolute() {
        p
    } else {
        PathBuf::from(&base_dir).join(p)
    };
    let Ok(abs) = dunce::canonicalize(&abs) else {
        return;
    };
    if !abs.is_file() {
        return;
    }
    if manager::is_supported_doc(&abs) {
        manager::open_paths_in_window(&app, window.label(), &[abs]);
    } else {
        let _ = app
            .opener()
            .open_path(abs.to_string_lossy(), None::<String>);
    }
}

/// Reads a data file referenced by a document's content — Plotly JSON spec
/// (`src=` of a ` ```plotly ` block) — **confined to the document's folder**,
/// `.json` extension only. Plugin reads (imports…)
/// go through `plugin_read_sibling` (manifest allowlist), which shares the
/// same confinement via `read_confined`.
#[tauri::command]
pub fn read_data_file(base_dir: String, rel: String) -> Result<String, String> {
    if !rel.to_ascii_lowercase().ends_with(".json") {
        return Err(tr!("error.data_file.json_only"));
    }
    read_confined(&base_dir, &rel).map_err(|e| e.message)
}

/// Failure of a confined read. `not_found` is only true for a path that
/// stayed inside the folder: outside the folder, the response is the same
/// whether the file exists or not (see `read_confined`).
pub struct ConfinedError {
    pub not_found: bool,
    pub message: String,
}

impl ConfinedError {
    fn denied(message: String) -> Self {
        Self {
            not_found: false,
            message,
        }
    }
}

/// Read confined to the `base_dir` folder. `rel` comes from a document's or a
/// plugin's content (untrusted): we first reject, **without touching the
/// disk**, any path that lexically leaves the folder (absolute, drive,
/// `..` climbing above it) — otherwise the difference between « not found » and
/// « outside the folder » would tell the caller whether a file exists elsewhere
/// on the machine. Then we canonicalize **both sides** before comparing, against
/// symlink escape. No network is possible (the CSP bounds `connect-src`), so the
/// read stays local and bounded. The extension allowlist is the caller's
/// responsibility.
pub fn read_confined(base_dir: &str, rel: &str) -> Result<String, ConfinedError> {
    let p = PathBuf::from(rel);
    if rel.contains('\0') {
        return Err(ConfinedError::denied(tr!("error.path.not_allowed")));
    }
    if let Some(message) = lexical_escape(&p) {
        return Err(ConfinedError::denied(message));
    }
    let base = dunce::canonicalize(base_dir)
        .map_err(|e| ConfinedError::denied(tr!("error.path.invalid_dir", error = e)))?;
    let abs = dunce::canonicalize(base.join(&p)).map_err(|e| ConfinedError {
        not_found: e.kind() == std::io::ErrorKind::NotFound,
        message: tr!("error.path.not_found", error = e),
    })?;
    if !abs.starts_with(&base) {
        return Err(ConfinedError::denied(tr!("error.path.outside_dir")));
    }
    if !abs.is_file() {
        return Err(ConfinedError::denied(tr!("error.path.not_file")));
    }
    let bytes = std::fs::read(&abs).map_err(|e| {
        ConfinedError::denied(tr!("error.file.read", path = abs.display(), error = e))
    })?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Error message if `rel` leaves the folder without even consulting the disk:
/// absolute or drive path (`C:x`, `\\srv\x`, `/x`), or `..` climbing
/// above the folder. `sous/../x` stays allowed.
fn lexical_escape(rel: &Path) -> Option<String> {
    let mut depth = 0usize;
    for c in rel.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => {
                return Some(tr!("error.path.not_allowed"))
            }
            Component::ParentDir => match depth.checked_sub(1) {
                Some(d) => depth = d,
                None => return Some(tr!("error.path.outside_dir")),
            },
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
        }
    }
    None
}

// --------------------------------------------------------------------------- //
// HTML export of the rendering (Export button of the view action stack)
// --------------------------------------------------------------------------- //

/// Saves a document's rendering as a standalone HTML page. The HTML comes from
/// the frontend (export.js), stylesheets already inlined; here we rewrite the
/// local `asset.localhost` images — internal protocol, dead outside the app —
/// as data-URIs (the CSP forbids fetching them on the frontend side), then the
/// « Enregistrer sous » (Save As) dialog and the write. Async: `blocking_save_file`
/// is forbidden on the main thread. Returns `false` if the user cancels.
#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    suggested_name: String,
    html: String,
) -> Result<bool, String> {
    let html = inline_asset_images(&html);
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter(tr!("dialog.filter.html_page"), &["html"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut dest = dest.into_path().map_err(|e| e.to_string())?;
    if dest.extension().is_none() {
        dest.set_extension("html");
    }
    std::fs::write(&dest, html.as_bytes())
        .map_err(|e| tr!("error.file.write", path = dest.display(), error = e))?;
    Ok(true)
}

/// « Enregistrer la session » (save session): serializes all windows and their
/// tabs into a `.kdws` file (see session.rs — the calling window goes first,
/// it will be the target on reopening). Async: `blocking_save_file`
/// is forbidden on the main thread. Returns `false` if the user cancels.
#[tauri::command]
pub async fn save_session(app: AppHandle, window: WebviewWindow) -> Result<bool, String> {
    let snap = crate::session::snapshot(&app, window.label());
    if snap.is_empty() {
        return Err(tr!("error.session.nothing_to_save"));
    }
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name("session.kdws")
        .add_filter(tr!("dialog.filter.session"), &[crate::session::SESSION_EXT])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut dest = dest.into_path().map_err(|e| e.to_string())?;
    if dest.extension().is_none() {
        dest.set_extension(crate::session::SESSION_EXT);
    }
    crate::session::write_session(&snap, &dest)?;
    Ok(true)
}

/// Rewrites each `src="…asset.localhost/<path>"` attribute (and the Linux
/// form `asset://localhost/…`) as a base64 data-URI. Unreadable file, too
/// big (> 20 MB) or non-image extension → fall back to a `file:///` URL: the
/// exported document stays viewable on the original workstation.
fn inline_asset_images(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find("src=\"") {
        let start = pos + "src=\"".len();
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest.find('"') else { break };
        out.push_str(&rewrite_asset_url(&rest[..end]));
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn rewrite_asset_url(url: &str) -> String {
    const PREFIXES: [&str; 3] = [
        "http://asset.localhost/",
        "https://asset.localhost/",
        "asset://localhost/",
    ];
    let Some(enc) = PREFIXES.iter().find_map(|p| url.strip_prefix(p)) else {
        return url.to_string();
    };
    let path = PathBuf::from(crate::plugins::percent_decode(enc));
    if let Some(mime) = image_mime(&path) {
        let small = std::fs::metadata(&path).is_ok_and(|m| m.len() <= 20 * 1024 * 1024);
        if small {
            if let Ok(bytes) = std::fs::read(&path) {
                use base64::Engine as _;
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                return format!("data:{mime};base64,{b64}");
            }
        }
    }
    file_url(&path.to_string_lossy())
}

/// MIME type of a local image, by extension (data-URI inlining).
fn image_mime(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// `file:///` URL of a local path (separators normalized, reserved characters
/// minimally escaped) — fallback when inlining is impossible.
fn file_url(path: &str) -> String {
    let p = path.replace('\\', "/");
    let mut enc = String::with_capacity(p.len());
    for c in p.chars() {
        match c {
            '%' => enc.push_str("%25"),
            ' ' => enc.push_str("%20"),
            '#' => enc.push_str("%23"),
            '?' => enc.push_str("%3F"),
            '"' => enc.push_str("%22"),
            _ => enc.push(c),
        }
    }
    format!("file:///{}", enc.trim_start_matches('/'))
}

#[cfg(test)]
mod confined_tests {
    use super::*;

    /// Temporary folder specific to the test: `<tmp>/<name>/doc/` contains
    /// `data.json` and `sub/`, `<tmp>/<name>/secret.json` is outside the folder.
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(name);
        let doc = root.join("doc");
        std::fs::create_dir_all(doc.join("sub")).unwrap();
        std::fs::write(doc.join("data.json"), "{}").unwrap();
        std::fs::write(root.join("secret.json"), "{}").unwrap();
        doc
    }

    fn read(doc: &Path, rel: &str) -> Result<String, ConfinedError> {
        read_confined(doc.to_str().unwrap(), rel)
    }

    #[test]
    fn lecture_dans_le_dossier() {
        let doc = fixture("kroki_confined_ok");
        assert_eq!(read(&doc, "data.json").ok().as_deref(), Some("{}"));
        assert_eq!(read(&doc, "sub/../data.json").ok().as_deref(), Some("{}"));
    }

    #[test]
    fn fichier_absent_dans_le_dossier_est_not_found() {
        let doc = fixture("kroki_confined_missing");
        assert!(read(&doc, "absent.json").is_err_and(|e| e.not_found));
    }

    #[test]
    fn hors_du_dossier_meme_reponse_que_le_fichier_existe_ou_non() {
        let doc = fixture("kroki_confined_escape");
        let present = read(&doc, "../secret.json").err().unwrap();
        let absent = read(&doc, "../absent.json").err().unwrap();
        assert!(!present.not_found && !absent.not_found);
        assert_eq!(present.message, absent.message);
        let abs = doc.parent().unwrap().join("secret.json");
        assert!(read(&doc, abs.to_str().unwrap()).is_err_and(|e| !e.not_found));
        assert!(read(&doc, "sub/../../secret.json").is_err_and(|e| !e.not_found));
    }
}

#[cfg(test)]
mod export_tests {
    use super::*;

    fn temp_png() -> PathBuf {
        let file = std::env::temp_dir().join("kroki_export_test.png");
        std::fs::write(&file, [0x89, b'P', b'N', b'G']).unwrap();
        file
    }

    #[test]
    fn image_asset_existante_inlinee_en_data_uri() {
        let file = temp_png();
        let url = format!(
            "http://asset.localhost/{}",
            file.to_string_lossy().replace('\\', "/")
        );
        let html = format!("<p>avant</p><img src=\"{url}\" alt=\"x\" /><p>après</p>");
        let out = inline_asset_images(&html);
        assert!(
            out.contains("src=\"data:image/png;base64,iVBORw==\""),
            "{out}"
        );
        assert!(out.starts_with("<p>avant</p>"));
        assert!(out.ends_with("<p>après</p>"));
    }

    #[test]
    fn image_asset_introuvable_retombe_en_file_url() {
        let html = r#"<img src="http://asset.localhost/C:/nulle%20part/x.png" />"#;
        let out = inline_asset_images(html);
        assert!(
            out.contains(r#"src="file:///C:/nulle%20part/x.png""#),
            "{out}"
        );
    }

    #[test]
    fn urls_non_asset_intactes() {
        let html = r#"<img src="https://ex.com/a.png" /><img src="data:image/png;base64,AA==" />"#;
        assert_eq!(inline_asset_images(html), html);
    }

    #[test]
    fn extension_non_image_retombe_en_file_url() {
        let file = std::env::temp_dir().join("kroki_export_test.exe");
        std::fs::write(&file, b"MZ").unwrap();
        let url = format!(
            "http://asset.localhost/{}",
            file.to_string_lossy().replace('\\', "/")
        );
        let out = inline_asset_images(&format!("<img src=\"{url}\" />"));
        assert!(out.contains("src=\"file:///"), "{out}");
        assert!(!out.contains("data:"), "{out}");
    }
}

/// `settings.json`, next to the plugins folder and for the same reason:
/// outside the Tauri identity folder, which follows the bundle's `identifier`.
pub fn settings_path() -> Option<PathBuf> {
    Some(crate::plugins::app_dir().join("settings.json"))
}

pub fn load_settings(app: &AppHandle) {
    let Some(path) = settings_path() else {
        return;
    };
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(data) = serde_json::from_slice::<SettingsData>(&bytes) {
            *app.state::<SettingsState>().0.lock().unwrap() = data;
        }
    }
}

pub fn save_settings(app: &AppHandle) {
    let Some(path) = settings_path() else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let data = app.state::<SettingsState>().0.lock().unwrap().clone();
    if let Ok(json) = serde_json::to_vec_pretty(&data) {
        let _ = std::fs::write(&path, json);
    }
}
