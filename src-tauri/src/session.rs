//! Sessions `.kdws` (Kroki Desk WorkSpace) : un fichier JSON qui liste des
//! documents à rouvrir, groupés par fenêtre, dans l'ordre des onglets.
//!
//! Format v1 (portable Windows/Linux) :
//! ```json
//! {
//!   "version": 1,
//!   "windows": [
//!     { "files": ["notes/a.md", "../spec/b.tex"], "active": 0 },
//!     { "files": ["D:/data/rapport.tex"] }
//!   ]
//! }
//! ```
//!
//! Règles de chemins : séparateur `/` à l'écriture (les `\` sont tolérés à la
//! lecture), chemins relatifs résolus par rapport au **dossier du `.kdws`**
//! (jamais au cwd), chemins absolus acceptés mais machine-spécifiques. À la
//! sauvegarde, tout chemin partageant un préfixe avec la destination est
//! relativisé automatiquement.
//!
//! À l'ouverture, une session arrive **toujours dans au moins une fenêtre
//! neuve** : la fenêtre cible (celle du drop / la première fenêtre pour le CLI)
//! n'est reprise que si elle est encore vide — au démarrage sur un `.kdws`, ou
//! sur une fenêtre « déposer un fichier ». Dès qu'elle contient un onglet, la
//! session s'ouvre à côté sans se mélanger au travail en cours ; les fenêtres
//! suivantes de la session sont neuves dans tous les cas. Les entrées invalides
//! (introuvable, extension non prise en charge, `.kdws` imbriqué) sont sautées
//! et signalées via l'événement `session-report` (toast côté frontend).

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::manager;
use crate::state::{path_key, AppState};

pub const SESSION_EXT: &str = "kdws";
const SESSION_VERSION: u32 = 1;
/// Nombre max de chemins ignorés détaillés dans le toast.
const REPORT_DETAIL_MAX: usize = 3;

/// Le chemin est-il un fichier de session `.kdws` ?
pub fn is_session_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(SESSION_EXT))
}

#[derive(Serialize, Deserialize)]
struct SessionFile {
    version: u32,
    windows: Vec<SessionWindow>,
}

#[derive(Serialize, Deserialize)]
struct SessionWindow {
    files: Vec<String>,
    /// Index (dans `files`) de l'onglet actif. Absent = dernier ouvert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active: Option<usize>,
}

/// Toast côté frontend (fenêtre cible uniquement).
#[derive(Serialize, Clone)]
struct SessionReport {
    message: String,
    error: bool,
}

fn report(app: &AppHandle, label: &str, message: String, error: bool) {
    let _ = app.emit_to(label, "session-report", SessionReport { message, error });
}

// ---------------------------------------------------------------------------
// Ouverture
// ---------------------------------------------------------------------------

/// Ouvre une session dans des fenêtres neuves — `target_label` n'est repris
/// pour la fenêtre n°1 que s'il n'a aucun onglet. Ne renvoie rien : tout
/// problème (parse, entrées sautées) est signalé à l'utilisateur via
/// `session-report`.
pub fn open_session(app: &AppHandle, target_label: &str, path: &Path) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let parsed: SessionFile = match std::fs::read_to_string(path)
        .map_err(|e| e.to_string())
        .and_then(|txt| serde_json::from_str(&txt).map_err(|e| e.to_string()))
    {
        Ok(s) => s,
        Err(e) => {
            report(
                app,
                target_label,
                tr!("sessionfile.unreadable", name = name, error = e),
                true,
            );
            return;
        }
    };
    if parsed.version != SESSION_VERSION {
        report(
            app,
            target_label,
            tr!(
                "sessionfile.version",
                name = name,
                version = parsed.version,
                expected = SESSION_VERSION
            ),
            true,
        );
        return;
    }
    let base = path.parent().map(Path::to_path_buf).unwrap_or_default();

    let mut opened = 0usize;
    let mut skipped: Vec<String> = Vec::new();
    // Reprise de la fenêtre cible seulement si elle est vide : une session ne se
    // greffe jamais sur des onglets déjà ouverts, elle arrive dans les siennes.
    let mut reusable = window_is_empty(app, target_label);
    // Première fenêtre effectivement utilisée : destinataire du focus final et
    // du rapport (ce n'est plus forcément `target_label`).
    let mut first_label: Option<String> = None;
    for (i, win) in parsed.windows.iter().enumerate() {
        // Résolution alignée sur `files` : l'index `active` reste valable même
        // si des entrées sont sautées.
        let resolved: Vec<Option<PathBuf>> = win
            .files
            .iter()
            .map(|raw| match resolve_entry(raw, &base) {
                Ok(p) => Some(p),
                Err(reason) => {
                    skipped.push(tr!(
                        "sessionfile.skipped_entry",
                        path = raw,
                        reason = reason
                    ));
                    None
                }
            })
            .collect();
        let docs: Vec<PathBuf> = resolved.iter().flatten().cloned().collect();
        if docs.is_empty() {
            continue;
        }
        let label = if reusable {
            reusable = false;
            target_label.to_string()
        } else {
            match manager::create_window(app, None, None) {
                Ok(l) => l,
                Err(e) => {
                    skipped.push(tr!("sessionfile.skipped_window", n = i + 1, error = e));
                    continue;
                }
            }
        };
        if first_label.is_none() {
            first_label = Some(label.clone());
        }
        opened += docs.len();
        manager::open_paths_in_window(app, &label, &docs);
        if let Some(Some(p)) = win.active.and_then(|a| resolved.get(a)).cloned() {
            activate_doc_by_path(app, &label, &p);
        }
    }
    // Les fenêtres suivantes ont pris le focus à leur création : on le rend à la
    // première fenêtre de la session (la cible quand elle a été reprise).
    let front = first_label.as_deref().unwrap_or(target_label);
    if let Some(w) = app.get_webview_window(front) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }

    if skipped.is_empty() {
        return; // succès total : pas de bruit.
    }
    let mut detail: Vec<String> = skipped.iter().take(REPORT_DETAIL_MAX).cloned().collect();
    if skipped.len() > REPORT_DETAIL_MAX {
        detail.push(tr!(
            "sessionfile.more",
            count = skipped.len() - REPORT_DETAIL_MAX
        ));
    }
    report(
        app,
        front,
        tr!(
            "sessionfile.report",
            name = name,
            count = opened,
            skipped = skipped.len(),
            details = detail.join(" · ")
        ),
        true,
    );
}

/// Résout une entrée de session en chemin canonique ouvrable.
fn resolve_entry(raw: &str, base: &Path) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(tr!("sessionfile.reason.empty"));
    }
    // `\` toléré à la lecture (fichier écrit à la main sous Windows).
    let normalized = raw.replace('\\', "/");
    let p = PathBuf::from(&normalized);
    let abs = if p.is_absolute() { p } else { base.join(p) };
    let canon = dunce::canonicalize(&abs).map_err(|_| tr!("sessionfile.reason.not_found"))?;
    if !canon.is_file() {
        return Err(tr!("sessionfile.reason.not_file"));
    }
    if is_session_file(&canon) {
        return Err(tr!("sessionfile.reason.nested"));
    }
    if !manager::is_supported_doc(&canon) {
        return Err(tr!("sessionfile.reason.unsupported"));
    }
    Ok(canon)
}

/// La fenêtre `label` est-elle sans aucun onglet ? (fenêtre fraîchement créée,
/// ou vidée de ses onglets — état « déposer un fichier »).
fn window_is_empty(app: &AppHandle, label: &str) -> bool {
    let st = app.state::<AppState>();
    let st = st.0.lock().unwrap();
    st.tabs.get(label).is_none_or(|ids| ids.is_empty())
}

/// Active l'onglet d'une fenêtre pointant sur `path` (comparaison `path_key`).
fn activate_doc_by_path(app: &AppHandle, label: &str, path: &Path) {
    let key = path_key(path);
    {
        let st = app.state::<AppState>();
        let mut st = st.0.lock().unwrap();
        let Some(id) = st.tabs.get(label).and_then(|ids| {
            ids.iter()
                .copied()
                .find(|id| st.docs.get(id).is_some_and(|d| path_key(&d.path) == key))
        }) else {
            return;
        };
        st.active.insert(label.to_string(), id);
    }
    manager::sync_window(app, label);
}

// ---------------------------------------------------------------------------
// Sauvegarde
// ---------------------------------------------------------------------------

/// Instantané des fenêtres à sérialiser : la fenêtre `first_label` (celle où
/// l'utilisateur a cliqué « Enregistrer la session ») passe en tête — c'est
/// elle qui deviendra la fenêtre cible à la réouverture — puis les autres dans
/// l'ordre de création. Les fenêtres sans onglet sont omises.
pub fn snapshot(app: &AppHandle, first_label: &str) -> Vec<(Vec<PathBuf>, Option<usize>)> {
    let st = app.state::<AppState>();
    let st = st.0.lock().unwrap();
    let mut labels: Vec<&String> = st.window_order.iter().collect();
    labels.sort_by_key(|l| (l.as_str() != first_label) as u8);
    labels
        .into_iter()
        .filter_map(|label| {
            let ids = st.tabs.get(label)?;
            let paths: Vec<PathBuf> = ids
                .iter()
                .filter_map(|id| st.docs.get(id).map(|d| d.path.clone()))
                .collect();
            if paths.is_empty() {
                return None;
            }
            let active = st.active.get(label).and_then(|aid| {
                ids.iter()
                    .filter(|id| st.docs.contains_key(*id))
                    .position(|id| id == aid)
            });
            Some((paths, active))
        })
        .collect()
}

/// Sérialise un instantané vers `dest` : chemins relativisés par rapport au
/// dossier de destination quand c'est possible, séparateur `/` partout.
pub fn write_session(
    snapshot: &[(Vec<PathBuf>, Option<usize>)],
    dest: &Path,
) -> Result<(), String> {
    let base = dest.parent().unwrap_or_else(|| Path::new(""));
    let file = SessionFile {
        version: SESSION_VERSION,
        windows: snapshot
            .iter()
            .map(|(paths, active)| SessionWindow {
                files: paths.iter().map(|p| portable_string(p, base)).collect(),
                active: *active,
            })
            .collect(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(dest, format!("{json}\n"))
        .map_err(|e| tr!("error.file.write", path = dest.display(), error = e))
}

/// Chemin portable : relatif au dossier du `.kdws` si un préfixe est commun
/// (même volume), absolu sinon ; toujours avec `/`.
fn portable_string(target: &Path, base: &Path) -> String {
    let p = relativize(target, base).unwrap_or_else(|| target.to_path_buf());
    p.to_string_lossy().replace('\\', "/")
}

/// Équivalent minimal de `pathdiff` : préfixe commun composant par composant
/// (insensible à la casse sous Windows), `..` pour remonter. `None` si aucun
/// composant commun (autre lecteur Windows) → le chemin restera absolu.
fn relativize(target: &Path, base: &Path) -> Option<PathBuf> {
    fn eq(a: &Component, b: &Component) -> bool {
        if cfg!(windows) {
            a.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
        } else {
            a.as_os_str() == b.as_os_str()
        }
    }
    let t: Vec<Component> = target.components().collect();
    let b: Vec<Component> = base.components().collect();
    let common = t.iter().zip(&b).take_while(|(x, y)| eq(x, y)).count();
    if common == 0 {
        return None;
    }
    let mut out = PathBuf::new();
    for _ in common..b.len() {
        out.push("..");
    }
    for c in &t[common..] {
        out.push(c.as_os_str());
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn relativise_meme_dossier_et_sous_dossier() {
        let base = Path::new("D:\\proj\\notes");
        assert_eq!(
            portable_string(Path::new("D:\\proj\\notes\\a.md"), base),
            "a.md"
        );
        assert_eq!(
            portable_string(Path::new("D:\\proj\\notes\\sub\\c.md"), base),
            "sub/c.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn relativise_remontee_parent() {
        let base = Path::new("D:\\proj\\notes");
        assert_eq!(
            portable_string(Path::new("D:\\proj\\spec\\s.md"), base),
            "../spec/s.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn autre_lecteur_reste_absolu_avec_slashes() {
        let base = Path::new("D:\\proj");
        assert_eq!(
            portable_string(Path::new("E:\\data\\x.md"), base),
            "E:/data/x.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn relativise_insensible_a_la_casse_windows() {
        let base = Path::new("D:\\Proj\\Notes");
        assert_eq!(
            portable_string(Path::new("d:\\proj\\notes\\a.md"), base),
            "a.md"
        );
    }

    #[test]
    fn ecriture_relecture_round_trip() {
        let dir = std::env::temp_dir().join("kdws_test_round_trip");
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("s.kdws");
        let snap = vec![
            (
                vec![dir.join("a.md"), dir.join("sub").join("c.md")],
                Some(1),
            ),
            (vec![dir.join("b.md")], None),
        ];
        write_session(&snap, &dest).unwrap();
        let parsed: SessionFile =
            serde_json::from_str(&std::fs::read_to_string(&dest).unwrap()).unwrap();
        assert_eq!(parsed.version, SESSION_VERSION);
        assert_eq!(parsed.windows.len(), 2);
        assert_eq!(parsed.windows[0].files, vec!["a.md", "sub/c.md"]);
        assert_eq!(parsed.windows[0].active, Some(1));
        assert_eq!(parsed.windows[1].files, vec!["b.md"]);
        assert_eq!(parsed.windows[1].active, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
