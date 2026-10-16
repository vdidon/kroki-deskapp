use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine;
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
        let doc = st.docs.get(&doc_id).ok_or("Document inconnu")?;
        (doc.path.clone(), doc.title.clone())
    };
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Impossible de lire {} : {e}", path.display()))?;
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

/// Rend un diagramme : moteurs intégrés par défaut, serveur Kroki externe si configuré.
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

    let svg = if external.is_empty() {
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
        .map_err(|e| format!("rendu interrompu : {e}"))??
    } else {
        kroki::render(&kroki, &external, &dtype, &source, opts).await?
    };

    kroki.cache.lock().unwrap().insert(key, svg.clone());
    Ok(svg)
}

/// Appelée par la webview de rendu quand ses moteurs sont chargés.
#[tauri::command]
pub fn renderer_ready(app: AppHandle, window: WebviewWindow) {
    if window.label() == engine::RENDERER_LABEL {
        engine::set_renderer_ready(&app, true);
    }
}

/// Réponse d'un job de rendu par la webview dédiée.
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
        (None, None) => Err("réponse vide du moteur de rendu".into()),
    };
    engine::complete_job(&app, id, result);
}

#[tauri::command]
pub fn open_paths(app: AppHandle, window: WebviewWindow, paths: Vec<String>) {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let resolved = manager::collect_file_args(paths, &cwd);
    manager::open_file_args(&app, window.label(), &resolved);
}

/// Références (`doc.tex#eq:x`, `doc.md#L42`) passées en ligne de commande et
/// destinées à cette fenêtre (cf. `manager::open_file_args`).
#[tauri::command]
pub fn take_pending_anchors(window: WebviewWindow) -> Vec<manager::PendingAnchor> {
    manager::take_pending_anchors(window.label())
}

#[tauri::command]
pub fn open_file_dialog(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    // Extensions effectives = natives ∪ plugins actifs (cf. plugins.rs §9.3).
    let exts = crate::plugins::effective_doc_extensions();
    let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .add_filter("Documents (Markdown + plugins)", &ext_refs)
        .add_filter("Session Kroki Desk", &[crate::session::SESSION_EXT])
        .add_filter("Tous les fichiers", &["*"])
        .pick_files(move |files| {
            let Some(files) = files else { return };
            let paths: Vec<PathBuf> = files
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .filter_map(|p| dunce::canonicalize(&p).ok())
                .filter(|p| p.is_file())
                .collect();
            // `pick_files` ne fournit pas de handle : on le récupère via la fenêtre.
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

/// Menu contextuel d'onglet : `side` = `left` | `right` | `others`.
#[tauri::command]
pub fn close_tabs_around(app: AppHandle, window: WebviewWindow, doc_id: u64, side: String) {
    manager::close_tabs_around(&app, window.label(), doc_id, &side);
}

/// Menu contextuel d'onglet : détache l'onglet dans une nouvelle fenêtre.
/// Async, comme `finish_tab_drag` : créer une fenêtre depuis une commande
/// synchrone bloquerait sur le main thread (WebView2).
#[tauri::command]
pub async fn detach_tab(app: AppHandle, window: WebviewWindow, doc_id: u64) {
    manager::detach_tab(&app, &window, doc_id);
}

/// Menu contextuel d'onglet : ouvre le dossier du document dans le gestionnaire
/// de fichiers, fichier sélectionné. Le chemin est relu dans l'état, pas fourni
/// par le frontend. Async : l'appel au shell ne bloque pas le main thread.
#[tauri::command]
pub async fn reveal_tab_file(app: AppHandle, doc_id: u64) -> Result<(), String> {
    let path = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.docs.get(&doc_id).map(|d| d.path.clone())
    }
    .ok_or("Document introuvable.")?;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Impossible d'afficher le fichier : {e}"))
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

// Les commands qui créent des fenêtres sont async : sur Windows, une command
// synchrone s'exécute sur le main thread et bloque l'initialisation WebView2
// de la nouvelle fenêtre (la webview resterait sur about:blank).
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

/// Variante de test (builds debug uniquement) : position de relâchement fournie
/// au lieu d'être lue sur le curseur réel. Inerte en release.
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

/// État des runtimes/moteurs pour la fenêtre d'information (cf. bouton « i »).
#[tauri::command]
pub fn get_runtimes(app: AppHandle) -> Vec<engine::RuntimeGroup> {
    engine::runtime_report(&app)
}

/// `CHANGELOG.md` embarqué à la compilation (dialog « Nouveautés ») : source
/// unique à la racine du dépôt, toujours en phase avec la version buildée.
#[tauri::command]
pub fn get_changelog() -> &'static str {
    include_str!("../../CHANGELOG.md")
}

/// Thème seul (`"auto"|"light"|"dark"`), lu au boot de chaque fenêtre pour appliquer
/// l'éventuel override avant le premier rendu — sans le coût de `get_settings`.
#[tauri::command]
pub fn get_theme(settings: State<SettingsState>) -> String {
    settings.0.lock().unwrap().theme.clone()
}

/// Visibilité des icônes, seule (cf. `SettingsData::icons`) : lue au boot de
/// chaque fenêtre pour masquer les icônes désactivées avant le premier paint —
/// même motivation que `get_theme`, sans le coût de `get_settings`.
#[tauri::command]
pub fn get_icons(settings: State<SettingsState>) -> BTreeMap<String, bool> {
    settings.0.lock().unwrap().icons.clone()
}

// Frontière IPC : la liste plate d'arguments est la forme naturelle d'une
// commande Tauri (les regrouper n'apporterait qu'une struct de transport).
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
    icons: BTreeMap<String, bool>,
) -> Result<(), String> {
    let url = external_url.trim().trim_end_matches('/').to_string();
    if !url.is_empty() && !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("L'URL du serveur externe doit commencer par http:// ou https:// (ou rester vide pour le rendu intégré)".into());
    }
    if server_port < 1024 {
        return Err("Le port doit être ≥ 1024".into());
    }
    // Valeur inconnue → on retombe sur « auto » (tolérant plutôt qu'erreur bloquante).
    let theme = match theme.as_str() {
        "light" | "dark" => theme,
        _ => "auto".to_string(),
    };
    {
        let mut s = settings.0.lock().unwrap();
        // Non exposé au dialog Réglages : préservé tel quel (alimenté par
        // plugins::install_plugin / uninstall_plugin).
        let removed_plugins = std::mem::take(&mut s.removed_plugins);
        *s = SettingsData {
            external_url: url,
            server_enabled,
            server_port,
            theme: theme.clone(),
            icons: icons.clone(),
            removed_plugins,
        };
    }
    save_settings(&app);
    server::apply_settings(&app, server_enabled, server_port);
    // Réglages globaux : propager thème et icônes à TOUTES les fenêtres. `from`
    // permet à la fenêtre initiatrice (déjà mise à jour localement) d'ignorer son
    // propre echo.
    let _ = app.emit(
        "theme-changed",
        json!({ "mode": theme, "from": window.label() }),
    );
    let _ = app.emit(
        "icons-changed",
        json!({ "icons": icons, "from": window.label() }),
    );
    Ok(())
}

/// Ouvre un lien du document : URL web → navigateur ; fichier markdown relatif →
/// nouvel onglet ; autre fichier → application associée.
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

/// Lit un fichier de données référencé par le contenu d'un document — spec JSON
/// Plotly (`src=` d'un bloc ` ```plotly `) — **confiné au dossier du document**,
/// extension `.json` uniquement. Les lectures des plugins (imports…)
/// passent par `plugin_read_sibling` (allowlist du manifeste), qui partage le
/// même confinement via `read_confined`.
#[tauri::command]
pub fn read_data_file(base_dir: String, rel: String) -> Result<String, String> {
    if !rel.to_ascii_lowercase().ends_with(".json") {
        return Err("Seuls les fichiers .json sont autorisés".into());
    }
    read_confined(&base_dir, &rel)
}

/// Lecture confinée au dossier `base_dir`. Le `rel` provient du contenu d'un
/// document (potentiellement non fiable) : on rejette les chemins absolus et
/// toute échappée hors du dossier (traversée `..`, symlink) en canonicalisant
/// **les deux côtés** avant de comparer. Pas de réseau possible (la CSP borne
/// `connect-src`), la lecture reste donc locale et bornée. L'allowlist
/// d'extensions est la responsabilité de l'appelant.
pub fn read_confined(base_dir: &str, rel: &str) -> Result<String, String> {
    let p = PathBuf::from(rel);
    if p.is_absolute() || rel.contains('\0') {
        return Err("Chemin non autorisé".into());
    }
    let base = dunce::canonicalize(base_dir).map_err(|e| format!("Dossier invalide : {e}"))?;
    let abs =
        dunce::canonicalize(base.join(&p)).map_err(|e| format!("Chemin introuvable : {e}"))?;
    if !abs.starts_with(&base) {
        return Err("Chemin hors du dossier du document".into());
    }
    if !abs.is_file() {
        return Err("Le chemin ne désigne pas un fichier".into());
    }
    let bytes =
        std::fs::read(&abs).map_err(|e| format!("Impossible de lire {} : {e}", abs.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// --------------------------------------------------------------------------- //
// Export HTML du rendu (bouton Exporter de la pile d'actions de vue)
// --------------------------------------------------------------------------- //

/// Enregistre le rendu d'un document en page HTML autonome. Le HTML arrive du
/// frontend (export.js), feuilles de style déjà inlinées ; ici on réécrit les
/// images locales `asset.localhost` — protocole interne, mort hors de l'app —
/// en data-URI (la CSP interdit leur fetch côté frontend), puis dialog
/// « Enregistrer sous » et écriture. Async : `blocking_save_file` est interdit
/// sur le main thread. Retourne `false` si l'utilisateur annule.
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
        .add_filter("Page HTML", &["html"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut dest = dest.into_path().map_err(|e| e.to_string())?;
    if dest.extension().is_none() {
        dest.set_extension("html");
    }
    std::fs::write(&dest, html.as_bytes())
        .map_err(|e| format!("Impossible d'écrire {} : {e}", dest.display()))?;
    Ok(true)
}

/// « Enregistrer la session » : sérialise toutes les fenêtres et leurs onglets
/// dans un fichier `.kdws` (cf. session.rs — la fenêtre appelante passe en
/// tête, elle sera la cible à la réouverture). Async : `blocking_save_file`
/// est interdit sur le main thread. Retourne `false` si l'utilisateur annule.
#[tauri::command]
pub async fn save_session(app: AppHandle, window: WebviewWindow) -> Result<bool, String> {
    let snap = crate::session::snapshot(&app, window.label());
    if snap.is_empty() {
        return Err("Aucun onglet ouvert : rien à enregistrer.".into());
    }
    let Some(dest) = app
        .dialog()
        .file()
        .set_file_name("session.kdws")
        .add_filter("Session Kroki Desk", &[crate::session::SESSION_EXT])
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

/// Réécrit chaque attribut `src="…asset.localhost/<chemin>"` (et la forme
/// Linux `asset://localhost/…`) en data-URI base64. Fichier illisible, trop
/// gros (> 20 Mo) ou d'extension non-image → repli en URL `file:///` : le
/// document exporté reste consultable sur le poste d'origine.
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

/// Type MIME d'une image locale, par extension (inlining en data-URI).
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

/// URL `file:///` d'un chemin local (séparateurs normalisés, caractères
/// réservés minimalement échappés) — repli quand l'inlining est impossible.
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

/// `settings.json`, à côté du dossier des plugins et pour la même raison :
/// hors du dossier d'identité Tauri, qui suit l'`identifier` du bundle.
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
