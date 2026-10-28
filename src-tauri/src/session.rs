//! `.kdws` sessions (Kroki Desk WorkSpace): a JSON file that lists documents
//! to reopen, grouped by window, in tab order.
//!
//! Format v1 (portable Windows/Linux):
//! ```json
//! {
//!   "version": 1,
//!   "windows": [
//!     { "files": ["notes/a.md", "../spec/b.tex"], "active": 0 },
//!     { "files": ["D:/data/report.tex"] }
//!   ]
//! }
//! ```
//!
//! Path rules: `/` separator when writing (`\` is tolerated when reading),
//! relative paths resolved against the **`.kdws`'s folder** (never the cwd),
//! absolute paths accepted but machine-specific. On save, any path sharing a
//! prefix with the destination is made relative automatically.
//!
//! On opening, a session **always arrives in at least one new window**: the
//! target window (the drop's / the first window for the CLI) is only reused if
//! it is still empty — at startup on a `.kdws`, or on a "drop a file"
//! (« déposer un fichier ») window. As soon as it holds a tab, the session
//! opens alongside without mixing with ongoing work; the session's following
//! windows are new in every case. Invalid entries (not found, unsupported
//! extension, nested `.kdws`) are skipped and reported via the `session-report`
//! event (a toast on the frontend side).

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::manager;
use crate::state::{path_key, AppState};

pub const SESSION_EXT: &str = "kdws";
const SESSION_VERSION: u32 = 1;
/// Max number of skipped paths detailed in the toast.
const REPORT_DETAIL_MAX: usize = 3;

/// Is the path a `.kdws` session file?
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
    /// Index (in `files`) of the active tab. Absent = last opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active: Option<usize>,
}

/// Toast on the frontend side (target window only).
#[derive(Serialize, Clone)]
struct SessionReport {
    message: String,
    error: bool,
}

fn report(app: &AppHandle, label: &str, message: String, error: bool) {
    let _ = app.emit_to(label, "session-report", SessionReport { message, error });
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/// Opens a session in new windows — `target_label` is only reused for
/// window no. 1 if it has no tab. Returns nothing: any problem (parse,
/// skipped entries) is reported to the user via `session-report`.
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
    // Reuse the target window only if it is empty: a session never grafts
    // itself onto already-open tabs, it arrives in its own.
    let mut reusable = window_is_empty(app, target_label);
    // First window actually used: recipient of the final focus and of the
    // report (no longer necessarily `target_label`).
    let mut first_label: Option<String> = None;
    for (i, win) in parsed.windows.iter().enumerate() {
        // Resolution aligned with `files`: the `active` index stays valid even
        // if entries are skipped.
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
    // The following windows took focus when created: hand it back to the
    // session's first window (the target when it was reused).
    let front = first_label.as_deref().unwrap_or(target_label);
    if let Some(w) = app.get_webview_window(front) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }

    if skipped.is_empty() {
        return; // total success: no noise.
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

/// Resolves a session entry to an openable canonical path.
fn resolve_entry(raw: &str, base: &Path) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(tr!("sessionfile.reason.empty"));
    }
    // `\` tolerated when reading (file written by hand on Windows).
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

/// Does window `label` have no tab at all? (freshly created window, or one
/// emptied of its tabs — the "drop a file" (« déposer un fichier ») state).
fn window_is_empty(app: &AppHandle, label: &str) -> bool {
    let st = app.state::<AppState>();
    let st = st.0.lock().unwrap();
    st.tabs.get(label).is_none_or(|ids| ids.is_empty())
}

/// Activates the window's tab pointing at `path` (`path_key` comparison).
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
// Saving
// ---------------------------------------------------------------------------

/// Snapshot of the windows to serialize: the `first_label` window (the one
/// where the user clicked "Save session" (« Enregistrer la session »)) goes
/// first — it is the one that will become the target window on reopening —
/// then the others in creation order. Windows with no tab are omitted.
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

/// Serializes a snapshot to `dest`: paths made relative to the destination
/// folder when possible, `/` separator everywhere.
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

/// Portable path: relative to the `.kdws`'s folder if a prefix is shared
/// (same volume), absolute otherwise; always with `/`.
fn portable_string(target: &Path, base: &Path) -> String {
    let p = relativize(target, base).unwrap_or_else(|| target.to_path_buf());
    p.to_string_lossy().replace('\\', "/")
}

/// Minimal equivalent of `pathdiff`: common prefix component by component
/// (case-insensitive on Windows), `..` to go up. `None` if no component is
/// shared (another Windows drive) → the path will stay absolute.
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
