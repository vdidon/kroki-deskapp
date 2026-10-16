use std::path::{Path, PathBuf};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
#[cfg(windows)]
use windows::Win32::Foundation::POINT;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};

use crate::state::{path_key, title_for, AppState, Document};
use crate::watcher;

/// Extensions de documents gérées **nativement**. Le filtre effectif (dialogue
/// d'ouverture, liens internes, drag-drop Rust + JS) est natives ∪ extensions
/// revendiquées par les plugins actifs (cf. `plugins::effective_doc_extensions`).
/// `.tex`, par exemple, est servi par le plugin `latex-doc`.
/// `.html`/`.htm` (pages statiques, dont les exports de l'app) ne passent pas
/// par le pipeline markdown : affichés dans une iframe sandboxée (cf.
/// `renderHtmlDocument`, `ui/js/render.js`).
pub const DOC_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt", "html", "htm"];

/// Un chemin pointe-t-il vers un document ouvrable (extension native ou
/// revendiquée par un plugin actif) ?
pub fn is_supported_doc(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            DOC_EXTENSIONS.contains(&e.as_str()) || crate::plugins::claims_extension(&e)
        })
        .unwrap_or(false)
}

/// Développe une liste de chemins déposés en éléments réellement acceptables :
/// - un **fichier** supporté est gardé tel quel ;
/// - une **archive de plugin** `.kdext` est gardée telle quelle (routée vers le
///   flux d'installation par l'appelant, cf. `drop_target.rs` / `filedrop.js`) ;
/// - une **session** `.kdws` est gardée telle quelle (routée vers
///   `session::open_session` par `open_mixed_paths`) ;
/// - un **dossier** est développé en ses fichiers documents *directs* (non
///   récursif), triés par nom pour un ordre d'onglets déterministe ;
/// - tout le reste est ignoré.
///
/// Chaque chemin est canonicalisé (`dunce`) afin que la déduplication par
/// `path_key` et le watcher restent cohérents avec les ouvertures par fichier.
/// Partagé par le drag-drop Windows (Explorateur + Cursor, cf. `drop_target.rs`).
pub fn expand_dropped_docs(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in paths {
        let Ok(canon) = dunce::canonicalize(p) else {
            continue;
        };
        if canon.is_file() {
            if is_supported_doc(&canon)
                || crate::plugins::is_plugin_archive(&canon)
                || crate::session::is_session_file(&canon)
            {
                out.push(canon);
            }
        } else if canon.is_dir() {
            out.extend(docs_in_dir(&canon));
        }
    }
    out
}

/// Fichiers documents directs d'un dossier (non récursif), triés par nom
/// (insensible à la casse, comme l'Explorateur Windows).
fn docs_in_dir(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_supported_doc(p))
        .collect();
    files.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    files
}

/// Pousse l'état des onglets d'une fenêtre vers le frontend.
/// Émis globalement, chaque fenêtre filtre sur `payload.window`.
pub fn sync_window(app: &AppHandle, label: &str) {
    let payload = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.tabs_payload(label)
    };
    let _ = app.emit("tabs-updated", payload);
}

/// Crée une fenêtre vide et l'enregistre. Position/taille physiques optionnelles.
pub fn create_window(
    app: &AppHandle,
    at: Option<PhysicalPosition<f64>>,
    size: Option<PhysicalSize<u32>>,
) -> tauri::Result<String> {
    let label = {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        st.next_win_id += 1;
        let label = format!("win-{}", st.next_win_id);
        st.window_order.push(label.clone());
        st.tabs.insert(label.clone(), Vec::new());
        label
    };
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(concat!("Kroki Desk v", env!("CARGO_PKG_VERSION")))
        .inner_size(1100.0, 800.0)
        .min_inner_size(480.0, 320.0)
        .visible(false)
        .build();
    let win = match built {
        Ok(w) => w,
        Err(e) => {
            let st = app.state::<AppState>();
            let mut st = st.0.lock().unwrap();
            st.window_order.retain(|l| l != &label);
            st.tabs.remove(&label);
            return Err(e);
        }
    };
    if let Some(sz) = size {
        let _ = win.set_size(sz);
    }
    if let Some(p) = at {
        let _ = win.set_position(p);
    }
    let _ = win.show();
    let _ = win.set_focus();
    // Drag-drop : remplace le target wry (CF_HDROP seul) pour gérer aussi les
    // drags texte (Cursor/VS Code). Après `show()` : la webview enfant existe.
    #[cfg(windows)]
    crate::drop_target::install(&win);
    Ok(label)
}

/// Ouvre des fichiers dans une fenêtre. Si un fichier y est déjà ouvert, active
/// son onglet au lieu de créer un doublon. Le dernier fichier ouvert devient actif.
pub fn open_paths_in_window(app: &AppHandle, label: &str, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }
    let mut to_watch: Vec<PathBuf> = Vec::new();
    {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        if !st.tabs.contains_key(label) {
            return;
        }
        let mut to_activate = None;
        for p in paths {
            let key = path_key(p);
            let existing = st.tabs[label]
                .iter()
                .copied()
                .find(|id| st.docs.get(id).is_some_and(|d| path_key(&d.path) == key));
            if let Some(id) = existing {
                to_activate = Some(id);
                continue;
            }
            st.next_doc_id += 1;
            let id = st.next_doc_id;
            st.docs.insert(
                id,
                Document {
                    path: p.clone(),
                    title: title_for(p),
                },
            );
            st.tabs.get_mut(label).unwrap().push(id);
            to_activate = Some(id);
            to_watch.push(p.clone());
        }
        if let Some(id) = to_activate {
            st.active.insert(label.to_string(), id);
        }
    }
    for p in &to_watch {
        watcher::watch_file(app, p);
    }
    sync_window(app, label);
}

/// Ouvre un mélange de documents, de sessions `.kdws` et d'archives de plugins
/// `.kdext` dans une fenêtre : les documents en onglets, chaque session
/// appliquée avec cette fenêtre comme cible de sa première fenêtre (cf.
/// `session::open_session`), chaque archive routée vers le flux d'installation
/// (dialog de confiance côté frontend, spec §9.2). Entonnoir commun du CLI, de
/// la seconde instance, des drops et du dialogue d'ouverture — d'où le routage
/// des `.kdext` ici et non dans `drop_target.rs` : une archive arrive aussi par
/// double-clic quand l'installeur a associé l'extension.
pub fn open_mixed_paths(app: &AppHandle, label: &str, paths: &[PathBuf]) {
    let (archives, rest): (Vec<PathBuf>, Vec<PathBuf>) = paths
        .iter()
        .cloned()
        .partition(|p| crate::plugins::is_plugin_archive(p));
    let (sessions, docs): (Vec<PathBuf>, Vec<PathBuf>) = rest
        .into_iter()
        .partition(|p| crate::session::is_session_file(p));
    open_paths_in_window(app, label, &docs);
    for s in &sessions {
        crate::session::open_session(app, label, s);
    }
    for a in &archives {
        crate::plugins::request_install(app, label, a);
    }
}

/// La plus ancienne fenêtre encore vivante — cible par défaut des ouvertures externes.
pub fn first_window(app: &AppHandle) -> Option<WebviewWindow> {
    let labels: Vec<String> = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.window_order.clone()
    };
    labels
        .iter()
        .find_map(|label| app.get_webview_window(label))
}

/// Relance de l'exe sans fichier (re-clic) : ouvre une nouvelle fenêtre vide.
/// `create_window` se charge de `show()` + `set_focus()`.
pub fn open_new_window(app: &AppHandle) {
    if let Err(e) = create_window(app, None, None) {
        eprintln!("[window] cannot create window: {e}");
    }
}

/// Point d'entrée des fichiers venant du CLI ou d'une seconde instance.
pub fn open_in_first_window(app: &AppHandle, args: &[FileArg]) {
    let win = match first_window(app) {
        Some(w) => w,
        None => match create_window(app, None, None) {
            Ok(label) => match app.get_webview_window(&label) {
                Some(w) => w,
                None => return,
            },
            Err(e) => {
                eprintln!("[window] cannot create window: {e}");
                return;
            }
        },
    };
    open_file_args(app, win.label(), args);
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// Nettoyage quand une fenêtre est détruite : libère ses documents et leurs watchers.
pub fn cleanup_window(app: &AppHandle, label: &str) {
    let removed_paths: Vec<PathBuf> = {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        st.window_order.retain(|l| l != label);
        st.active.remove(label);
        let ids = st.tabs.remove(label).unwrap_or_default();
        ids.iter()
            .filter_map(|id| st.docs.remove(id).map(|d| d.path))
            .collect()
    };
    for p in &removed_paths {
        watcher::unwatch_file(app, p);
    }
}

/// Ferme un onglet. La fenêtre reste ouverte même sans onglet (état « déposer un fichier »).
pub fn close_tab(app: &AppHandle, label: &str, doc_id: u64) {
    let removed_path: Option<PathBuf> = {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        let Some(ids) = st.tabs.get_mut(label) else {
            return;
        };
        let Some(idx) = ids.iter().position(|id| *id == doc_id) else {
            return;
        };
        ids.remove(idx);
        let ids_now = st.tabs[label].clone();
        if st.active.get(label) == Some(&doc_id) {
            if ids_now.is_empty() {
                st.active.remove(label);
            } else {
                let next = ids_now[idx.min(ids_now.len() - 1)];
                st.active.insert(label.to_string(), next);
            }
        }
        st.docs.remove(&doc_id).map(|d| d.path)
    };
    if let Some(p) = removed_path {
        watcher::unwatch_file(app, &p);
    }
    sync_window(app, label);
}

/// Ferme en un seul passage les onglets à gauche (`left`), à droite (`right`) ou
/// autour (`others`) de `doc_id`, qui reste ouvert. L'ordre est lu ici et non
/// fourni par le frontend : un réordonnancement concurrent ne fait rien fermer
/// de travers. Si l'onglet actif est fermé, `doc_id` le remplace.
pub fn close_tabs_around(app: &AppHandle, label: &str, doc_id: u64, side: &str) {
    let removed_paths: Vec<PathBuf> = {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        let Some(ids) = st.tabs.get_mut(label) else {
            return;
        };
        let Some(idx) = ids.iter().position(|id| *id == doc_id) else {
            return;
        };
        let closed: Vec<u64> = match side {
            "left" => ids.drain(..idx).collect(),
            "right" => ids.drain(idx + 1..).collect(),
            "others" => {
                let all = std::mem::replace(ids, vec![doc_id]);
                all.into_iter().filter(|id| *id != doc_id).collect()
            }
            _ => return,
        };
        if st.active.get(label).is_some_and(|a| closed.contains(a)) {
            st.active.insert(label.to_string(), doc_id);
        }
        closed
            .iter()
            .filter_map(|id| st.docs.remove(id).map(|d| d.path))
            .collect()
    };
    for p in &removed_paths {
        watcher::unwatch_file(app, p);
    }
    sync_window(app, label);
}

/// Retire un onglet d'une fenêtre sans libérer le document (transfert en cours).
/// Retourne `false` si l'onglet n'y était pas, et indique si la fenêtre est maintenant vide.
fn take_tab(app: &AppHandle, label: &str, doc_id: u64) -> Option<bool> {
    let st = app.state::<AppState>();
    let mut st = st.0.lock().unwrap();
    let ids = st.tabs.get_mut(label)?;
    let idx = ids.iter().position(|id| *id == doc_id)?;
    ids.remove(idx);
    let ids_now = st.tabs[label].clone();
    if st.active.get(label) == Some(&doc_id) {
        if ids_now.is_empty() {
            st.active.remove(label);
        } else {
            let next = ids_now[idx.min(ids_now.len() - 1)];
            st.active.insert(label.to_string(), next);
        }
    }
    Some(ids_now.is_empty())
}

fn give_tab(app: &AppHandle, label: &str, doc_id: u64) -> bool {
    let st = app.state::<AppState>();
    let mut st = st.0.lock().unwrap();
    if let Some(ids) = st.tabs.get_mut(label) {
        ids.push(doc_id);
        st.active.insert(label.to_string(), doc_id);
        true
    } else {
        false
    }
}

/// Transfère un onglet d'une fenêtre vers une autre. Ferme la source si elle se vide.
pub fn transfer_tab(app: &AppHandle, from: &str, to: &str, doc_id: u64) {
    let Some(from_empty) = take_tab(app, from, doc_id) else {
        return;
    };
    if !give_tab(app, to, doc_id) {
        // La cible a disparu entre-temps : on restaure l'onglet dans la source.
        give_tab(app, from, doc_id);
        sync_window(app, from);
        return;
    }
    sync_window(app, from);
    sync_window(app, to);
    if let Some(w) = app.get_webview_window(to) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    if from_empty {
        if let Some(w) = app.get_webview_window(from) {
            let _ = w.close();
        }
    }
}

/// Détache un onglet dans une nouvelle fenêtre positionnée sous le curseur.
pub fn detach_to_new_window(
    app: &AppHandle,
    source: &WebviewWindow,
    doc_id: u64,
    cursor: PhysicalPosition<f64>,
) {
    let scale = source.scale_factor().unwrap_or(1.0);
    let pos = PhysicalPosition::new(cursor.x - 120.0 * scale, cursor.y - 16.0 * scale);
    move_tab_to_new_window(app, source, doc_id, pos);
}

/// Menu contextuel d'onglet : détache l'onglet dans une nouvelle fenêtre de
/// même taille, décalée en cascade depuis la fenêtre source. Sans effet si
/// l'onglet n'est plus dans cette fenêtre ou s'il y est seul (recréer la même
/// fenêtre n'aurait pas de sens) — le menu le désactive déjà, mais l'état a
/// pu changer entre-temps.
pub fn detach_tab(app: &AppHandle, source: &WebviewWindow, doc_id: u64) {
    let detachable = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.tabs
            .get(source.label())
            .is_some_and(|t| t.len() > 1 && t.contains(&doc_id))
    };
    if !detachable {
        return;
    }
    let scale = source.scale_factor().unwrap_or(1.0);
    let origin = source.outer_position().unwrap_or_default();
    let pos = PhysicalPosition::new(
        f64::from(origin.x) + 32.0 * scale,
        f64::from(origin.y) + 32.0 * scale,
    );
    move_tab_to_new_window(app, source, doc_id, pos);
}

/// Crée une fenêtre à `pos` (de la taille de la source) et y déplace l'onglet.
fn move_tab_to_new_window(
    app: &AppHandle,
    source: &WebviewWindow,
    doc_id: u64,
    pos: PhysicalPosition<f64>,
) {
    let size = source.inner_size().ok();
    let label = match create_window(app, Some(pos), size) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[window] cannot detach tab: {e}");
            return;
        }
    };
    let from = source.label().to_string();
    if take_tab(app, &from, doc_id).is_none() {
        return;
    }
    let _ = give_tab(app, &label, doc_id);
    sync_window(app, &from);
    sync_window(app, &label);
}

/// Fenêtre de l'application située sous le curseur (coordonnées physiques écran),
/// en respectant l'ordre Z réel grâce à Win32 `WindowFromPoint`.
#[cfg(windows)]
pub fn window_under_cursor(app: &AppHandle, pos: PhysicalPosition<f64>) -> Option<WebviewWindow> {
    let point = POINT {
        x: pos.x as i32,
        y: pos.y as i32,
    };
    let root = unsafe {
        let hit = WindowFromPoint(point);
        if hit.is_invalid() {
            return None;
        }
        GetAncestor(hit, GA_ROOT)
    };
    if root.is_invalid() {
        return None;
    }
    let root_id = root.0 as isize;
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.hwnd().map(|h| h.0 as isize == root_id).unwrap_or(false))
        .map(|(_, w)| w)
}

/// Linux/dégradé : pas de hit-test global inter-fenêtres (interdit sous Wayland,
/// fragile sous X11). Toujours `None` → un onglet tiré hors de la barre se détache
/// en nouvelle fenêtre, sans transfert vers une fenêtre existante par drop.
#[cfg(not(windows))]
pub fn window_under_cursor(_app: &AppHandle, _pos: PhysicalPosition<f64>) -> Option<WebviewWindow> {
    None
}

/// Fin d'un drag d'onglet sorti de la barre : transfert, détachement ou déplacement.
pub fn finish_tab_drag(app: &AppHandle, source: &WebviewWindow, doc_id: u64) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    finish_tab_drag_at(app, source, doc_id, cursor);
}

/// Même logique avec une position fournie (point d'entrée des tests automatisés).
pub fn finish_tab_drag_at(
    app: &AppHandle,
    source: &WebviewWindow,
    doc_id: u64,
    cursor: PhysicalPosition<f64>,
) {
    let source_label = source.label().to_string();
    match window_under_cursor(app, cursor) {
        Some(target) if target.label() != source_label => {
            transfer_tab(app, &source_label, target.label(), doc_id);
        }
        Some(_) => {
            // Relâché sur la fenêtre source, hors de la barre d'onglets : annulation.
        }
        None => {
            let only_tab = {
                let st = app.state::<AppState>();
                let st = st.0.lock().unwrap();
                st.tabs.get(&source_label).map(|t| t.len()) == Some(1)
            };
            if only_tab {
                // Détacher l'unique onglet reviendrait à recréer la même fenêtre :
                // on déplace simplement la fenêtre sous le curseur, comme Chrome.
                let scale = source.scale_factor().unwrap_or(1.0);
                let pos = PhysicalPosition::new(cursor.x - 120.0 * scale, cursor.y - 16.0 * scale);
                let _ = source.set_position(pos);
                let _ = source.set_focus();
            } else {
                detach_to_new_window(app, source, doc_id, cursor);
            }
        }
    }
}

/// Argument de fichier résolu : le chemin canonique, et la référence à
/// atteindre dans le document s'il en porte une (`modele.tex#eq:sigmaU`,
/// `rapport.md#L42`) — même syntaxe et même résolution que le fragment d'un
/// lien interne (`jumpToFragment`, `ui/js/main.js`).
pub struct FileArg {
    pub path: PathBuf,
    pub fragment: Option<String>,
}

/// Résout les arguments CLI en fichiers existants, fragment éventuel compris.
///
/// `#` est un caractère légal dans un nom de fichier : l'argument entier est
/// donc essayé d'abord comme chemin, et n'est coupé au **dernier** `#` que
/// s'il ne désigne aucun fichier. `a#b.md` reste ainsi ouvrable tel quel.
pub fn collect_file_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<FileArg> {
    let resolve = |s: &str| {
        let p = PathBuf::from(s);
        let abs = if p.is_absolute() { p } else { cwd.join(p) };
        dunce::canonicalize(&abs).ok().filter(|c| c.is_file())
    };
    args.into_iter()
        .filter(|a| !a.starts_with('-') && !a.trim().is_empty())
        .filter_map(|a| {
            let arg = if let Some(path) = resolve(&a) {
                Some(FileArg {
                    path,
                    fragment: None,
                })
            } else {
                a.rsplit_once('#').and_then(|(file, frag)| {
                    resolve(file).map(|path| FileArg {
                        path,
                        fragment: (!frag.is_empty()).then(|| frag.to_string()),
                    })
                })
            };
            if arg.is_none() {
                eprintln!("[cli] file not found, ignored: {a}");
            }
            arg
        })
        .collect()
}

/// Référence en attente de saut, pour une fenêtre donnée.
#[derive(Clone, serde::Serialize)]
pub struct PendingAnchor {
    #[serde(skip)]
    window: String,
    path: String,
    fragment: String,
}

/// Références venues de la ligne de commande, en attente d'être récupérées
/// par leur fenêtre. Même détour que `plugins::request_install` : un argument
/// passé au lancement est traité dans le `setup`, **avant** que la webview ait
/// enregistré son écouteur — un événement porteur de la référence serait perdu.
static PENDING_ANCHORS: std::sync::Mutex<Vec<PendingAnchor>> = std::sync::Mutex::new(Vec::new());

/// Ouvre des arguments de fichier dans une fenêtre et y programme le saut vers
/// leur fragment. Seuls les documents en portent un : un fragment sur une
/// session ou une archive de plugin est ignoré.
pub fn open_file_args(app: &AppHandle, label: &str, args: &[FileArg]) {
    let anchors: Vec<PendingAnchor> = args
        .iter()
        .filter(|a| is_supported_doc(&a.path))
        .filter_map(|a| {
            a.fragment.as_ref().map(|f| PendingAnchor {
                window: label.to_string(),
                path: a.path.to_string_lossy().into_owned(),
                fragment: f.clone(),
            })
        })
        .collect();
    let has_anchor = !anchors.is_empty();
    // Empilé avant l'ouverture : la fenêtre peut réclamer la file dès qu'elle
    // voit ses onglets changer.
    PENDING_ANCHORS.lock().unwrap().extend(anchors);
    let paths: Vec<PathBuf> = args.iter().map(|a| a.path.clone()).collect();
    open_mixed_paths(app, label, &paths);
    if has_anchor {
        let _ = app.emit_to(label, "anchor-request", ());
    }
}

/// Retire et renvoie les références en attente pour la fenêtre `label`.
pub fn take_pending_anchors(label: &str) -> Vec<PendingAnchor> {
    let mut q = PENDING_ANCHORS.lock().unwrap();
    let (mine, rest): (Vec<_>, Vec<_>) = q.drain(..).partition(|a| a.window == label);
    *q = rest;
    mine
}

#[cfg(test)]
mod file_arg_tests {
    use super::collect_file_args;

    fn resolve(dir: &std::path::Path, arg: &str) -> Vec<(String, Option<String>)> {
        collect_file_args([arg.to_string()], dir)
            .into_iter()
            .map(|a| {
                let name = a.path.file_name().unwrap().to_string_lossy().into_owned();
                (name, a.fragment)
            })
            .collect()
    }

    #[test]
    fn fragment_split_only_when_whole_arg_is_not_a_file() {
        let dir = std::env::temp_dir().join(format!("kd_file_args_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("doc.md"), "x").unwrap();
        std::fs::write(dir.join("a#b.md"), "x").unwrap();

        assert_eq!(resolve(&dir, "doc.md"), [("doc.md".into(), None)]);
        assert_eq!(
            resolve(&dir, "doc.md#L42"),
            [("doc.md".into(), Some("L42".into()))]
        );
        assert_eq!(
            resolve(&dir, "doc.md#eq:sigmaU"),
            [("doc.md".into(), Some("eq:sigmaU".into()))]
        );
        // `#` dans le nom : le fichier existe tel quel, aucune coupe.
        assert_eq!(resolve(&dir, "a#b.md"), [("a#b.md".into(), None)]);
        // Coupe au dernier `#`, fragment vide ignoré.
        assert_eq!(
            resolve(&dir, "a#b.md#L3"),
            [("a#b.md".into(), Some("L3".into()))]
        );
        assert_eq!(resolve(&dir, "doc.md#"), [("doc.md".into(), None)]);
        assert!(resolve(&dir, "absent.md#L1").is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
