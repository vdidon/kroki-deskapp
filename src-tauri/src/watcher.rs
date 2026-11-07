use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{path_key, AppState};

/// Watches the parent folders of open files (more robust than watching the files
/// themselves: editors that save by renaming break a direct watch).
#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// refcount per open file (case-insensitive key).
    file_refs: Mutex<HashMap<String, usize>>,
    /// refcount per watched folder.
    dir_refs: Mutex<HashMap<PathBuf, usize>>,
    /// event generation per file, for the "trailing edge" debounce.
    pending: Mutex<HashMap<String, u64>>,
    /// `.git` folder of each open file inside a repository (key = file
    /// key): watched too, so that a commit — which leaves the file untouched —
    /// refreshes the uncommitted-change marks (`git.rs`). Shares `dir_refs`.
    git_dirs: Mutex<HashMap<String, PathBuf>>,
    /// generation of the `git-changed` debounce (one for all repositories).
    git_pending: Mutex<u64>,
}

pub fn init(app: &AppHandle) {
    let handle = app.clone();
    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Access(_)) {
                return;
            }
            for p in &ev.paths {
                on_fs_event(&handle, p);
            }
        }
    });
    match watcher {
        Ok(w) => *app.state::<WatcherState>().watcher.lock().unwrap() = Some(w),
        Err(e) => crate::journal::error("watcher", format!("initialization failed: {e}")),
    }
}

fn on_fs_event(app: &AppHandle, path: &Path) {
    let ws = app.state::<WatcherState>();
    if is_git_state_file(&ws, path) {
        on_git_event(app);
        return;
    }
    let key = path_key(path);
    if !ws.file_refs.lock().unwrap().contains_key(&key) {
        return;
    }
    // 250 ms debounce on the end of the burst: only the last generation emits,
    // so that a half-written file is never rendered.
    let generation = {
        let mut pend = ws.pending.lock().unwrap();
        let g = pend.entry(key.clone()).or_insert(0);
        *g += 1;
        *g
    };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        let ws = app.state::<WatcherState>();
        let still_last = ws.pending.lock().unwrap().get(&key) == Some(&generation);
        if !still_last {
            return;
        }
        let targets: Vec<(String, u64)> = {
            let st = app.state::<AppState>();
            let st = st.0.lock().unwrap();
            st.tabs
                .iter()
                .flat_map(|(win, ids)| {
                    ids.iter()
                        .filter(|id| st.docs.get(id).is_some_and(|d| path_key(&d.path) == key))
                        .map(|id| (win.clone(), *id))
                })
                .collect()
        };
        for (win, id) in targets {
            let _ = app.emit("doc-changed", json!({ "window": win, "id": id }));
        }
    });
}

/// `index` or `HEAD` of a watched `.git` folder: what a commit, a reset, a
/// checkout or a stage rewrites.
fn is_git_state_file(ws: &WatcherState, path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str());
    if !matches!(name, Some("index" | "HEAD")) {
        return false;
    }
    let Some(parent) = path.parent() else {
        return false;
    };
    let parent = path_key(parent);
    ws.git_dirs
        .lock()
        .unwrap()
        .values()
        .any(|d| path_key(d) == parent)
}

/// A git operation rewrites `index` in several steps (lock file, rename):
/// same 250 ms trailing debounce as the documents, then one global event —
/// each window re-reads the marks of its own tabs.
fn on_git_event(app: &AppHandle) {
    let generation = {
        let ws = app.state::<WatcherState>();
        let mut g = ws.git_pending.lock().unwrap();
        *g += 1;
        *g
    };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        if *app.state::<WatcherState>().git_pending.lock().unwrap() == generation {
            let _ = app.emit("git-changed", ());
        }
    });
}

/// Refcounted watch of a folder (document folders and `.git` folders share
/// the counter: watching the same folder twice would let the first unwatch
/// drop the other's watch).
fn ref_dir(ws: &WatcherState, dir: &Path) {
    let first_dir = {
        let mut dirs = ws.dir_refs.lock().unwrap();
        let c = dirs.entry(dir.to_path_buf()).or_insert(0);
        *c += 1;
        *c == 1
    };
    if first_dir {
        if let Some(w) = ws.watcher.lock().unwrap().as_mut() {
            if let Err(e) = w.watch(dir, RecursiveMode::NonRecursive) {
                crate::journal::warn("watcher", format!("cannot watch {}: {e}", dir.display()));
            }
        }
    }
}

fn unref_dir(ws: &WatcherState, dir: &Path) {
    let last_dir = {
        let mut dirs = ws.dir_refs.lock().unwrap();
        match dirs.get_mut(dir) {
            Some(c) if *c > 1 => {
                *c -= 1;
                false
            }
            Some(_) => {
                dirs.remove(dir);
                true
            }
            None => false,
        }
    };
    if last_dir {
        if let Some(w) = ws.watcher.lock().unwrap().as_mut() {
            let _ = w.unwatch(dir);
        }
    }
}

pub fn watch_file(app: &AppHandle, path: &Path) {
    let ws = app.state::<WatcherState>();
    let key = path_key(path);
    let first_ref = {
        let mut refs = ws.file_refs.lock().unwrap();
        let c = refs.entry(key).or_insert(0);
        *c += 1;
        *c == 1
    };
    if !first_ref {
        return;
    }
    let Some(dir) = path.parent() else {
        return;
    };
    ref_dir(&ws, dir);
    if let Some(git_dir) = crate::git::git_dir_for(path) {
        ref_dir(&ws, &git_dir);
        ws.git_dirs.lock().unwrap().insert(path_key(path), git_dir);
    }
}

pub fn unwatch_file(app: &AppHandle, path: &Path) {
    let ws = app.state::<WatcherState>();
    let key = path_key(path);
    let last_ref = {
        let mut refs = ws.file_refs.lock().unwrap();
        match refs.get_mut(&key) {
            Some(c) if *c > 1 => {
                *c -= 1;
                false
            }
            Some(_) => {
                refs.remove(&key);
                true
            }
            None => false,
        }
    };
    if !last_ref {
        return;
    }
    let Some(dir) = path.parent() else {
        return;
    };
    unref_dir(&ws, dir);
    let git_dir = ws.git_dirs.lock().unwrap().remove(&path_key(path));
    if let Some(git_dir) = git_dir {
        unref_dir(&ws, &git_dir);
    }
}
