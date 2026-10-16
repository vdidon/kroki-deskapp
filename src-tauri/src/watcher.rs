use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{path_key, AppState};

/// Surveille les dossiers parents des fichiers ouverts (plus robuste que de surveiller
/// les fichiers eux-mêmes : les éditeurs qui sauvegardent par renommage cassent un watch direct).
#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// refcount par fichier ouvert (clé insensible à la casse).
    file_refs: Mutex<HashMap<String, usize>>,
    /// refcount par dossier surveillé.
    dir_refs: Mutex<HashMap<PathBuf, usize>>,
    /// génération d'événement par fichier, pour le debounce « trailing edge ».
    pending: Mutex<HashMap<String, u64>>,
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
        Err(e) => eprintln!("[watcher] initialisation impossible : {e}"),
    }
}

fn on_fs_event(app: &AppHandle, path: &Path) {
    let ws = app.state::<WatcherState>();
    let key = path_key(path);
    if !ws.file_refs.lock().unwrap().contains_key(&key) {
        return;
    }
    // Debounce 250 ms côté fin de rafale : seule la dernière génération émet,
    // pour ne jamais rendre un fichier écrit à moitié.
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
    let Some(dir) = path.parent().map(Path::to_path_buf) else {
        return;
    };
    let first_dir = {
        let mut dirs = ws.dir_refs.lock().unwrap();
        let c = dirs.entry(dir.clone()).or_insert(0);
        *c += 1;
        *c == 1
    };
    if first_dir {
        if let Some(w) = ws.watcher.lock().unwrap().as_mut() {
            if let Err(e) = w.watch(&dir, RecursiveMode::NonRecursive) {
                eprintln!("[watcher] watch {} impossible : {e}", dir.display());
            }
        }
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
    let Some(dir) = path.parent().map(Path::to_path_buf) else {
        return;
    };
    let last_dir = {
        let mut dirs = ws.dir_refs.lock().unwrap();
        match dirs.get_mut(&dir) {
            Some(c) if *c > 1 => {
                *c -= 1;
                false
            }
            Some(_) => {
                dirs.remove(&dir);
                true
            }
            None => false,
        }
    };
    if last_dir {
        if let Some(w) = ws.watcher.lock().unwrap().as_mut() {
            let _ = w.unwatch(&dir);
        }
    }
}
