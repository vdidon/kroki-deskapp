//! Registre des plugins — protocole v1, cf. `doc/plugin-protocol.md`.
//!
//! Un plugin est un dossier `plugins/<id>/` contenant un `manifest.json` (schéma
//! §3 de la spec) et son code (worker JS + assets). Le backend ne **jamais**
//! n'exécute le code d'un plugin : il énumère les manifestes (serde, champs
//! inconnus ignorés), installe/désinstalle les archives `.kdext` (zip), sert les
//! fichiers via le protocole custom `plugin://` (webview → worker) et applique
//! le confinement de `host/readFile`. L'exécution vit côté frontend
//! (`ui/js/plugins.js`, worker sandboxé).
//!
//! Le dossier des plugins est volontairement **hors** du dossier d'identité
//! Tauri (qui suit l'`identifier` du bundle) : `%APPDATA%\kroki-deskapp\plugins`
//! (Windows) / `$XDG_CONFIG_HOME/kroki-deskapp/plugins` (Linux) — spec §9.1.

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

/// Extension des archives de plugins (glisser-déposer + bouton « Ajouter »).
pub const ARCHIVE_EXT: &str = "kdext";

/// Changelog optionnel d'un plugin, à la racine de son dossier (spec §3.1) :
/// nom conventionnel fixe, pas de champ de manifeste.
const CHANGELOG_FILE: &str = "CHANGELOG.md";

/// Capacités que CET hôte sait servir (négociation `initialize`, spec §6.1).
pub const HOST_CAPABILITIES: &[&str] = &[
    "document:markdown",
    "fence:svg",
    "fence:html",
    "fence:markdown",
    "highlight:code",
    "read:siblings",
];

/// `manifest.json` d'un plugin (spec §3). Les champs inconnus sont ignorés
/// (compat ascendante) ; les listes absentes valent vide.
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

/// Entrée du registre, sérialisée telle quelle vers le frontend
/// (`list_plugins`, événement `plugins-changed`).
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
    /// Extensions revendiquées, normalisées : minuscules, sans point.
    pub extensions: Vec<String>,
    pub fences: Vec<String>,
    pub highlights: Vec<String>,
    pub capabilities: Vec<String>,
    pub sibling_extensions: Vec<String>,
    /// "ok" | "inert" (chargeable mais aucune capacité servable) | "invalid".
    pub status: String,
    pub status_reason: String,
    pub warnings: Vec<String>,
    /// Un `CHANGELOG.md` existe à la racine du plugin (bouton « Nouveautés »).
    pub has_changelog: bool,
    /// Ordre d'installation (mtime du dossier) — départage des conflits (§8).
    installed_at: u64,
}

static REGISTRY: OnceLock<RwLock<Vec<PluginInfo>>> = OnceLock::new();

fn registry() -> &'static RwLock<Vec<PluginInfo>> {
    REGISTRY.get_or_init(|| RwLock::new(Vec::new()))
}

/// `%APPDATA%\kroki-deskapp` (Windows) / `$XDG_CONFIG_HOME/kroki-deskapp`
/// (Linux, défaut `~/.config`) : plugins et réglages.
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

/// Charge le registre au démarrage (avant la première fenêtre).
pub fn init() {
    *registry().write().unwrap() = scan();
}

/// Re-scanne et notifie toutes les fenêtres (`plugins-changed`, payload = liste).
pub fn rescan(app: &AppHandle) {
    init();
    let list = list();
    let _ = app.emit("plugins-changed", &list);
}

/// Instantané du registre.
pub fn list() -> Vec<PluginInfo> {
    registry().read().unwrap().clone()
}

/// Un plugin actif revendique-t-il cette extension (minuscule, sans point) ?
pub fn claims_extension(ext: &str) -> bool {
    registry()
        .read()
        .unwrap()
        .iter()
        .any(|p| p.status == "ok" && p.extensions.iter().any(|e| e == ext))
}

/// Extensions de documents effectives : natives ∪ plugins actifs (spec §9.3).
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

/// Le chemin est-il une archive de plugin `.kdext` ?
pub fn is_plugin_archive(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(ARCHIVE_EXT))
}

/// Archives en attente du dialog de confiance (§9.2). Une file, et non un
/// simple événement porteur du chemin : une archive peut arriver **avant** que
/// la fenêtre ait enregistré son écouteur — c'est le cas du double-clic quand
/// l'application n'est pas déjà lancée, l'ouverture ayant lieu dans le `setup`
/// alors que la webview charge son JS ensuite. L'événement
/// `plugin-install-request` n'est donc qu'un signal ; la charge utile se
/// récupère par `take_pending_plugin_installs`, que le frontend appelle aussi
/// une fois son écouteur en place.
static PENDING_INSTALLS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn pending_installs() -> &'static Mutex<Vec<String>> {
    PENDING_INSTALLS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Empile une archive pour installation et signale la fenêtre cible.
pub fn request_install(app: &AppHandle, label: &str, path: &Path) {
    pending_installs()
        .lock()
        .unwrap()
        .push(path.to_string_lossy().into_owned());
    let _ = app.emit_to(label, "plugin-install-request", ());
}

/// Récupère et vide la file des archives en attente.
#[tauri::command]
pub fn take_pending_plugin_installs() -> Vec<String> {
    std::mem::take(&mut *pending_installs().lock().unwrap())
}

// --------------------------------------------------------------------------- //
// Scan du dossier des plugins
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
    // Ordre d'installation ≈ mtime du dossier (l'extraction crée un dossier
    // frais) : départage « dernier installé gagne » (§8.2).
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

/// Minuscules, sans point de tête — forme canonique des extensions/fences.
fn norm_ext(e: &str) -> String {
    e.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Erreurs **dures** du manifeste : refus à l'installation, statut `invalid` au
/// scan. Les cas « soft » (runtime inconnu, aucune capacité servable) rendent
/// le plugin inerte, pas invalide (spec §3).
fn validate_hard(m: &Manifest) -> Result<(), String> {
    if !valid_id(&m.id) {
        return Err(format!("id invalide « {} » (attendu : [a-z0-9-])", m.id));
    }
    if m.manifest_version != 1 {
        return Err(format!(
            "manifestVersion {} non supporté (hôte : 1)",
            m.manifest_version
        ));
    }
    if m.api_version != "1" && !m.api_version.starts_with("1.") {
        return Err(format!(
            "apiVersion « {} » non supportée (hôte : 1)",
            m.api_version
        ));
    }
    let entry = Path::new(&m.entry);
    if m.entry.is_empty()
        || entry.is_absolute()
        || entry
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("entry invalide « {} »", m.entry));
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
        Err(e) => return invalid(format!("manifest.json illisible : {e}")),
    };
    let m: Manifest = match serde_json::from_slice(&bytes) {
        Ok(m) => m,
        Err(e) => return invalid(format!("manifest.json invalide : {e}")),
    };
    if let Err(e) = validate_hard(&m) {
        return invalid(e);
    }
    if m.id != dirname {
        return invalid(format!(
            "l'id du manifeste « {} » doit correspondre au nom du dossier « {dirname} »",
            m.id
        ));
    }
    if !dir.join(&m.entry).is_file() {
        return invalid(format!("entry introuvable : {}", m.entry));
    }

    // Statut : inerte si le runtime est inconnu ou si aucune capacité
    // productrice n'est servable par cet hôte.
    let (status, status_reason) = if m.runtime != "worker" {
        (
            "inert",
            format!(
                "runtime « {} » non supporté par cette version de Kroki Desk",
                m.runtime
            ),
        )
    } else if !m
        .capabilities
        .iter()
        .any(|c| HOST_CAPABILITIES.contains(&c.as_str()) && c != "read:siblings")
    {
        (
            "inert",
            "aucune capacité servable — ce plugin requiert une version plus récente de Kroki Desk"
                .to_string(),
        )
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

/// Règles de conflit (§8) : le natif gagne toujours (extensions — les fences
/// natives sont arbitrées côté frontend qui connaît `KROKI_TYPES`), puis entre
/// plugins le dernier installé gagne, avec avertissement des deux côtés.
fn resolve_conflicts(list: &mut [PluginInfo]) {
    // Natif d'abord : une extension native est retirée de la revendication.
    for p in list.iter_mut() {
        if p.status != "ok" {
            continue;
        }
        let (native, kept): (Vec<String>, Vec<String>) = p
            .extensions
            .drain(..)
            .partition(|e| manager::DOC_EXTENSIONS.contains(&e.as_str()));
        for e in native {
            p.warnings
                .push(format!(".{e} est géré nativement — revendication ignorée"));
        }
        p.extensions = kept;
    }
    // Entre plugins : pour chaque revendication, le dernier installé (fin de
    // liste) gagne. `list` est trié par installed_at croissant.
    for kind in 0..3usize {
        let claims = |p: &PluginInfo| -> Vec<String> {
            match kind {
                0 => p.extensions.clone(),
                1 => p.fences.clone(),
                _ => p.highlights.clone(),
            }
        };
        let label = ["l'extension .", "la fence ", "la coloration "][kind];
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
                    list[i].warnings.push(format!(
                        "{label}{c} est reprise par « {winner} » (installé plus récemment)"
                    ));
                    list[j]
                        .warnings
                        .push(format!("{label}{c} remplace celle de « {loser} »"));
                }
            }
        }
    }
}

// --------------------------------------------------------------------------- //
// Protocole custom `plugin://` — sert les fichiers des plugins au worker
// --------------------------------------------------------------------------- //

fn http_response(status: u16, ctype: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", ctype)
        // Le worker (blob, origine de l'app) importe les modules du plugin en
        // cross-origin : les module scripts exigent CORS.
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

/// Handler du protocole : `plugin://localhost/<id>/<chemin>` (Windows :
/// `http://plugin.localhost/<id>/<chemin>`). Lecture seule, confinée au dossier
/// du plugin (canonicalisation + `starts_with`, comme `read_data_file`).
pub fn serve(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let not_found = || http_response(404, "text/plain", b"introuvable".to_vec());
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
// Installation / désinstallation (archives .kdext)
// --------------------------------------------------------------------------- //

fn archive_manifest(path: &Path) -> Result<Manifest, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("archive illisible : {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("archive invalide : {e}"))?;
    let mut entry = zip.by_name("manifest.json").map_err(|e| match e {
        zip::result::ZipError::FileNotFound => {
            "manifest.json absent à la racine de l'archive".to_string()
        }
        // Ex. méthode de compression non supportée (PPMd) : montrer la cause.
        e => format!("manifest.json illisible : {e}"),
    })?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut entry, &mut bytes)
        .map_err(|e| format!("manifest.json illisible : {e}"))?;
    let m: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("manifest.json invalide : {e}"))?;
    validate_hard(&m)?;
    Ok(m)
}

/// Comparaison de versions `x.y.z` (composantes numériques, lexicographique).
fn version_less(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.split(['.', '-', '+'])
            .map(|c| c.parse().unwrap_or(0))
            .collect()
    };
    parse(a) < parse(b)
}

/// Aperçu d'une archive pour le dialog de confiance (spec §9.2) — lu sans
/// exécuter le moindre code du plugin.
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

/// Installe (ou met à jour) une archive `.kdext` : extraction vers un dossier
/// temporaire, bascule atomique, précédente version en `<id>.bak` (spec §9.2).
///
/// Ne touche ni au registre ni aux réglages : l'appelant décide. Partagé par la
/// commande `install_plugin` (dialog de confiance en amont) et par `seed_bundled`
/// (plugins livrés avec l'installeur).
fn install_archive(src: &Path) -> Result<Manifest, String> {
    let m = archive_manifest(src)?;
    let dir = plugins_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("dossier des plugins : {e}"))?;

    let tmp = dir.join(format!(".tmp-{}", m.id));
    let _ = std::fs::remove_dir_all(&tmp);
    let file = std::fs::File::open(src).map_err(|e| format!("archive illisible : {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("archive invalide : {e}"))?;
    zip.extract(&tmp).map_err(|e| {
        let _ = std::fs::remove_dir_all(&tmp);
        format!("extraction impossible : {e}")
    })?;

    let dest = dir.join(&m.id);
    let bak = dir.join(format!("{}.bak", m.id));
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&bak);
        std::fs::rename(&dest, &bak).map_err(|e| format!("sauvegarde impossible : {e}"))?;
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        // Restaure l'ancienne version si la bascule échoue.
        if bak.exists() {
            let _ = std::fs::rename(&bak, &dest);
        }
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("installation impossible : {e}"));
    }
    Ok(m)
}

#[tauri::command]
pub fn install_plugin(app: AppHandle, path: String) -> Result<(), String> {
    let m = install_archive(Path::new(&path))?;
    // Installer à la main lève un refus antérieur : le plugin redevient
    // éligible aux mises à jour silencieuses de l'installeur.
    set_removed(&app, &m.id, false);
    rescan(&app);
    Ok(())
}

/// Supprime un plugin (dossier + `.bak`). Pas de corbeille : l'utilisateur
/// ré-installe depuis son archive s'il se trompe (spec §9.4).
#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("id invalide".into());
    }
    let dir = plugins_dir();
    let dest = dir.join(&id);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| format!("suppression impossible : {e}"))?;
    }
    let _ = std::fs::remove_dir_all(dir.join(format!("{id}.bak")));
    // Mémorise le refus, sinon un plugin livré avec l'installeur reviendrait au
    // démarrage suivant (cf. `seed_bundled`).
    set_removed(&app, &id, true);
    rescan(&app);
    Ok(())
}

// --------------------------------------------------------------------------- //
// Plugins livrés avec l'installeur
// --------------------------------------------------------------------------- //

/// Marque (ou démarque) un plugin comme supprimé par l'utilisateur, et persiste.
fn set_removed(app: &AppHandle, id: &str, removed: bool) {
    {
        let st = app.state::<SettingsState>();
        let mut s = st.0.lock().unwrap();
        let present = s.removed_plugins.iter().any(|x| x == id);
        match (removed, present) {
            (true, false) => s.removed_plugins.push(id.to_string()),
            (false, true) => s.removed_plugins.retain(|x| x != id),
            // Déjà dans l'état voulu : pas de réécriture de settings.json.
            _ => return,
        }
    }
    save_settings(app);
}

/// Dossier des plugins livrés avec l'application — l'installeur y dépose les
/// `.kdext` **cochés à l'installation** (composants conditionnés de
/// `src-tauri/wix/installer.wxs`). Rien à filtrer ici : le seeding installe ce
/// qu'il trouve, un plugin décoché est simplement absent du dossier.
/// Absent des builds portables et du debug : le seeding y est un no-op.
///
/// Le sous-dossier est essentiel, et pas seulement par propreté : `resource_dir()`
/// est le dossier de l'exécutable, or le binaire portable est publié dans `dist/`
/// — à côté de toutes les archives produites par `build_dist.py`. Sans
/// ce niveau, le lancer depuis là installerait n'importe quel `.kdext` voisin.
fn bundled_plugins_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("bundled-plugins"))
}

/// Version installée d'un plugin, lue directement sur disque : le registre
/// n'est pas encore chargé quand le seeding tourne (avant `init`).
fn installed_version(id: &str) -> Option<String> {
    let bytes = std::fs::read(plugins_dir().join(id).join("manifest.json")).ok()?;
    serde_json::from_slice::<Manifest>(&bytes)
        .ok()
        .map(|m| m.version)
}

/// Installe et met à jour les plugins livrés avec l'application, **sans dialog
/// de confiance** : ils proviennent du même installeur que l'exécutable, donc
/// de la même chaîne de confiance (dérogation au §9.2 de la spec, seule voie
/// d'installation qui s'en dispense — drop et dialog Plugins le conservent).
///
/// À appeler avant `init()` : le premier scan voit alors l'état final, et aucun
/// worker n'a chargé la version précédente.
///
/// Deux garde-fous : jamais de régression de version (un `.kdext` plus récent
/// posé à la main est conservé), et un plugin supprimé par l'utilisateur n'est
/// pas réinstallé (`SettingsData::removed_plugins`).
pub fn seed_bundled(app: &AppHandle) {
    let Some(dir) = bundled_plugins_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return; // build portable : aucun plugin livré
    };
    let removed = app
        .state::<SettingsState>()
        .0
        .lock()
        .unwrap()
        .removed_plugins
        .clone();
    let archives = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_plugin_archive(p));
    for path in archives {
        let m = match archive_manifest(&path) {
            Ok(m) => m,
            Err(e) => {
                eprintln!(
                    "[plugins] archive livrée ignorée ({}) : {e}",
                    path.display()
                );
                continue;
            }
        };
        if removed.contains(&m.id) {
            continue;
        }
        // Installé en version égale ou supérieure : ne rien faire.
        if installed_version(&m.id).is_some_and(|cur| !version_less(&cur, &m.version)) {
            continue;
        }
        match install_archive(&path) {
            Ok(_) => eprintln!(
                "[plugins] {} {} installé (livré avec l'app)",
                m.id, m.version
            ),
            Err(e) => eprintln!("[plugins] installation de {} impossible : {e}", m.id),
        }
    }
}

#[tauri::command]
pub fn list_plugins() -> Vec<PluginInfo> {
    list()
}

/// Ouvre le dossier des plugins dans le gestionnaire de fichiers de la
/// plateforme (Explorateur / xdg-open). Le dossier n'existe pas tant que rien
/// n'a été installé : on le crée d'abord pour que le bouton marche toujours.
#[tauri::command]
pub fn open_plugins_dir(app: AppHandle) -> Result<(), String> {
    let dir = plugins_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("création du dossier impossible : {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<String>)
        .map_err(|e| format!("ouverture impossible : {e}"))
}

/// Sélecteur natif d'archive `.kdext` (bouton « Ajouter un plugin… ») : le
/// chemin choisi repart vers le frontend par la même file que le drop et le
/// double-clic, toutes les voies convergent vers le dialog de confiance (§9.4).
#[tauri::command]
pub fn pick_plugin_archive(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    app.dialog()
        .file()
        .add_filter("Plugin Kroki Desk", &[ARCHIVE_EXT])
        .pick_file(move |file| {
            let Some(file) = file else { return };
            let Ok(path) = file.into_path() else { return };
            request_install(window.app_handle(), label.as_str(), &path);
        });
}

/// Contenu du `CHANGELOG.md` d'un plugin installé (bouton « Nouveautés » du
/// dialog Plugins, spec §3.1). Nom de fichier **fixe** joint au dossier du
/// plugin — aucun chemin fourni par l'appelant, pas de traversée possible.
#[tauri::command]
pub fn plugin_changelog(id: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("id invalide".into());
    }
    std::fs::read_to_string(plugins_dir().join(&id).join(CHANGELOG_FILE))
        .map_err(|e| format!("changelog illisible : {e}"))
}

/// Service `host/readFile` (capacité `read:siblings`, spec §6.5) : lecture
/// confinée au dossier du document en cours, allowlist = `siblingExtensions`
/// du manifeste. Même garde anti-traversée que `read_data_file`.
#[tauri::command]
pub fn plugin_read_sibling(
    plugin_id: String,
    base_dir: String,
    rel: String,
) -> Result<String, String> {
    let allowed: Vec<String> = registry()
        .read()
        .unwrap()
        .iter()
        .find(|p| p.id == plugin_id && p.status == "ok")
        .map(|p| p.sibling_extensions.clone())
        .ok_or("plugin inconnu")?;
    let ext = Path::new(&rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !allowed.contains(&ext) {
        return Err(format!(
            "extension .{ext} non autorisée par le manifeste du plugin"
        ));
    }
    crate::commands::read_confined(&base_dir, &rel)
}
