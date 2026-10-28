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

/// Document extensions handled **natively**. The effective filter (open
/// dialog, internal links, Rust + JS drag-drop) is native ∪ extensions
/// claimed by active plugins (see `plugins::effective_doc_extensions`).
/// `.tex`, for example, is served by the `latex-doc` plugin.
/// `.html`/`.htm` (static pages, including the app's exports) do not go
/// through the markdown pipeline: displayed in a sandboxed iframe (see
/// `renderHtmlDocument`, `ui/js/render.js`).
pub const DOC_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt", "html", "htm"];

/// Does a path point to an openable document (native extension or one
/// claimed by an active plugin)?
pub fn is_supported_doc(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            DOC_EXTENSIONS.contains(&e.as_str()) || crate::plugins::claims_extension(&e)
        })
        .unwrap_or(false)
}

/// Expands a list of dropped paths into genuinely acceptable items:
/// - a supported **file** is kept as is;
/// - a `.kdext` **plugin archive** is kept as is (routed to the install flow
///   by the caller, see `drop_target.rs` / `filedrop.js`);
/// - a `.kdws` **session** is kept as is (routed to
///   `session::open_session` by `open_mixed_paths`);
/// - a **folder** is expanded into its *direct* document files (non
///   recursive), sorted by name for a deterministic tab order;
/// - everything else is ignored.
///
/// Each path is canonicalized (`dunce`) so that deduplication by
/// `path_key` and the watcher stay consistent with per-file opens.
/// Shared by the Windows drag-drop (Explorer + Cursor, see `drop_target.rs`),
/// its only caller: hence the `cfg`, without which the Linux build flags it as dead.
#[cfg(windows)]
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

/// Direct document files of a folder (non recursive), sorted by name
/// (case-insensitive, like Windows Explorer).
#[cfg(windows)]
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

/// Pushes a window's tab state to the frontend.
/// Emitted globally, each window filters on `payload.window`.
pub fn sync_window(app: &AppHandle, label: &str) {
    let payload = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.tabs_payload(label)
    };
    let _ = app.emit("tabs-updated", payload);
}

/// Creates an empty window and registers it. Optional physical position/size.
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
    // Drag-drop: replaces the wry target (CF_HDROP only) to also handle
    // text drags (Cursor/VS Code). After `show()`: the child webview exists.
    #[cfg(windows)]
    crate::drop_target::install(&win);
    Ok(label)
}

/// Opens files in a window. If a file is already open there, activates
/// its tab instead of creating a duplicate. The last opened file becomes active.
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

/// Opens a mix of documents, `.kdws` sessions and `.kdext` plugin archives
/// in a window: documents as tabs, each session applied with this window as
/// the target of its first window (see `session::open_session`), each archive
/// routed to the install flow (trust dialog on the frontend side, spec §9.2).
/// Common funnel for the CLI, the second instance, drops and the open dialog —
/// hence the `.kdext` routing here and not in `drop_target.rs`: an archive also
/// arrives by double-click when the installer associated the extension.
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

/// The oldest window still alive — default target of external opens.
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

/// Relaunch of the exe without a file (re-click): opens a new empty window.
/// `create_window` takes care of `show()` + `set_focus()`.
pub fn open_new_window(app: &AppHandle) {
    if let Err(e) = create_window(app, None, None) {
        crate::journal::error("window", format!("cannot create window: {e}"));
    }
}

/// Entry point for files coming from the CLI or a second instance.
pub fn open_in_first_window(app: &AppHandle, args: &[FileArg]) {
    let win = match first_window(app) {
        Some(w) => w,
        None => match create_window(app, None, None) {
            Ok(label) => match app.get_webview_window(&label) {
                Some(w) => w,
                None => return,
            },
            Err(e) => {
                crate::journal::error("window", format!("cannot create window: {e}"));
                return;
            }
        },
    };
    open_file_args(app, win.label(), args);
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// Cleanup when a window is destroyed: frees its documents and their watchers.
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

/// Closes a tab. The window stays open even without a tab (« déposer un fichier » state).
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

/// Closes in one pass the tabs to the left (`left`), to the right (`right`) or
/// around (`others`) `doc_id`, which stays open. The order is read here and not
/// supplied by the frontend: a concurrent reorder cannot make it close the
/// wrong tabs. If the active tab is closed, `doc_id` replaces it.
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

/// Removes a tab from a window without freeing the document (transfer in progress).
/// Returns `None` if the tab was not there, and tells whether the window is now empty.
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

/// Transfers a tab from one window to another. Closes the source if it becomes empty.
pub fn transfer_tab(app: &AppHandle, from: &str, to: &str, doc_id: u64) {
    let Some(from_empty) = take_tab(app, from, doc_id) else {
        return;
    };
    if !give_tab(app, to, doc_id) {
        // The target disappeared in the meantime: restore the tab in the source.
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

/// Detaches a tab into a new window positioned under the cursor.
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

/// Tab context menu: detaches the tab into a new window of the same
/// size, cascaded from the source window. No effect if the tab is no longer
/// in this window or is alone there (recreating the same window would make no
/// sense) — the menu already disables it, but the state may have changed in
/// the meantime.
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
    move_tab_to_new_window(app, source, doc_id, cascade_position(source));
}

/// Tab context menu: reopens the tab's document in a new window (same size,
/// cascaded), the original tab staying in place. Allowed even on a lone tab.
/// The duplicate is a full document of its own (its own `doc_id`): the watcher
/// is counted per path, so closing one does not cut the other's reloading.
pub fn duplicate_tab(app: &AppHandle, source: &WebviewWindow, doc_id: u64) {
    let path = {
        let st = app.state::<AppState>();
        let st = st.0.lock().unwrap();
        st.docs.get(&doc_id).map(|d| d.path.clone())
    };
    let Some(path) = path else {
        return;
    };
    let size = source.inner_size().ok();
    match create_window(app, Some(cascade_position(source)), size) {
        Ok(label) => open_paths_in_window(app, &label, &[path]),
        Err(e) => crate::journal::error("window", format!("cannot duplicate tab: {e}")),
    }
}

/// Position of a window opened from the tab menu: cascaded from the
/// source window.
fn cascade_position(source: &WebviewWindow) -> PhysicalPosition<f64> {
    let scale = source.scale_factor().unwrap_or(1.0);
    let origin = source.outer_position().unwrap_or_default();
    PhysicalPosition::new(
        f64::from(origin.x) + 32.0 * scale,
        f64::from(origin.y) + 32.0 * scale,
    )
}

/// Creates a window at `pos` (the source's size) and moves the tab there.
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
            crate::journal::error("window", format!("cannot detach tab: {e}"));
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

/// Application window under the cursor (physical screen coordinates),
/// honoring the real Z order thanks to Win32 `WindowFromPoint`.
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

/// Linux/degraded: no global cross-window hit-test (forbidden under Wayland,
/// fragile under X11). Always `None` → a tab dragged out of the bar detaches
/// into a new window, with no transfer to an existing window by drop.
#[cfg(not(windows))]
pub fn window_under_cursor(_app: &AppHandle, _pos: PhysicalPosition<f64>) -> Option<WebviewWindow> {
    None
}

/// End of a tab drag out of the bar: transfer, detach or move.
pub fn finish_tab_drag(app: &AppHandle, source: &WebviewWindow, doc_id: u64) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    finish_tab_drag_at(app, source, doc_id, cursor);
}

/// Same logic with a supplied position (entry point for automated tests).
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
            // Released on the source window, outside the tab bar: cancel.
        }
        None => {
            let only_tab = {
                let st = app.state::<AppState>();
                let st = st.0.lock().unwrap();
                st.tabs.get(&source_label).map(|t| t.len()) == Some(1)
            };
            if only_tab {
                // Detaching the only tab would amount to recreating the same window:
                // just move the window under the cursor, like Chrome.
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

/// Resolved file argument: the canonical path, and the reference to
/// reach in the document if it carries one (`modele.tex#eq:sigmaU`,
/// `rapport.md#L42`) — same syntax and same resolution as the fragment of an
/// internal link (`jumpToFragment`, `ui/js/main.js`).
pub struct FileArg {
    pub path: PathBuf,
    pub fragment: Option<String>,
}

/// Resolves CLI arguments into existing files, optional fragment included.
///
/// `#` is a legal character in a file name: the whole argument is
/// therefore tried first as a path, and is only split at the **last** `#`
/// if it names no file. `a#b.md` thus stays openable as is.
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
                crate::journal::warn("cli", format!("file not found, ignored: {a}"));
            }
            arg
        })
        .collect()
}

/// Reference waiting to be jumped to, for a given window.
#[derive(Clone, serde::Serialize)]
pub struct PendingAnchor {
    #[serde(skip)]
    window: String,
    path: String,
    fragment: String,
}

/// References coming from the command line, waiting to be picked up
/// by their window. Same detour as `plugins::request_install`: an argument
/// passed at launch is handled in `setup`, **before** the webview has
/// registered its listener — an event carrying the reference would be lost.
static PENDING_ANCHORS: std::sync::Mutex<Vec<PendingAnchor>> = std::sync::Mutex::new(Vec::new());

/// Opens file arguments in a window and schedules the jump to their
/// fragment. Only documents carry one: a fragment on a session or a plugin
/// archive is ignored.
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
    // Queued before opening: the window may claim the queue as soon as it
    // sees its tabs change.
    PENDING_ANCHORS.lock().unwrap().extend(anchors);
    let paths: Vec<PathBuf> = args.iter().map(|a| a.path.clone()).collect();
    open_mixed_paths(app, label, &paths);
    if has_anchor {
        let _ = app.emit_to(label, "anchor-request", ());
    }
}

/// Removes and returns the pending references for window `label`.
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
        // `#` in the name: the file exists as is, no split.
        assert_eq!(resolve(&dir, "a#b.md"), [("a#b.md".into(), None)]);
        // Splits at the last `#`, empty fragment ignored.
        assert_eq!(
            resolve(&dir, "a#b.md#L3"),
            [("a#b.md".into(), Some("L3".into()))]
        );
        assert_eq!(resolve(&dir, "doc.md#"), [("doc.md".into(), None)]);
        assert!(resolve(&dir, "absent.md#L1").is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
