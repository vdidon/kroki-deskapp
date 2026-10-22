//! Journal de l'application : dernières entrées de diagnostic, en mémoire.
//!
//! Le binaire de release n'a pas de console (`windows_subsystem = "windows"`) :
//! sans ce journal, un `eprintln!` (port de l'API occupé, surveillance de
//! fichiers en échec, plugin livré non installé…) ne s'affiche nulle part. Les
//! modules Rust y écrivent par `info`/`warn`/`error` ; les fenêtres y versent les
//! entrées de leurs plugins (`host/log`, échecs et mises en panne vus par
//! l'hôte) par `plugin_log`. Un seul journal pour tout le processus, donc toutes
//! les fenêtres : un worker de plugin vit dans une fenêtre, son journal non.
//!
//! Global (comme la langue d'`i18n`) : les erreurs naissent au fond de modules
//! qui n'ont pas d'`AppHandle`. Rien n'est écrit sur disque ; les messages des
//! modules Rust restent en anglais, comme toute sortie de log (cf. CLAUDE.md).
//! Les entrées gardent aussi leur sortie stderr, utile en `cargo run-app`.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Entrées conservées (les plus anciennes sont évincées).
const CAPACITY: usize = 500;
/// Longueur maximale d'un message, en caractères (le reste est tronqué).
const MAX_MESSAGE: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    /// Niveau envoyé par un plugin (§6.5) : toute valeur inconnue vaut `info`.
    fn parse(s: &str) -> Level {
        match s {
            "debug" => Level::Debug,
            "warn" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct JournalEntry {
    /// Rang croissant, unique pour la durée du processus.
    pub seq: u64,
    /// Horodatage, en millisecondes depuis l'époque Unix.
    pub time: u64,
    pub level: Level,
    /// Module Rust (`server`, `watcher`…) ou id du plugin si `plugin`.
    pub source: String,
    pub plugin: bool,
    pub message: String,
}

struct Journal {
    entries: VecDeque<JournalEntry>,
    next_seq: u64,
}

static JOURNAL: Mutex<Journal> = Mutex::new(Journal {
    entries: VecDeque::new(),
    next_seq: 1,
});

/// Pour `journal-entry` ; absent avant le `setup` (les entrées sont gardées).
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Branche l'émission de `journal-entry` vers les fenêtres.
pub fn attach(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

fn truncate(message: &str) -> String {
    match message.char_indices().nth(MAX_MESSAGE) {
        Some((cut, _)) => format!("{}…", &message[..cut]),
        None => message.to_string(),
    }
}

fn record(level: Level, source: &str, plugin: bool, message: &str) {
    let message = truncate(message);
    eprintln!("[{source}] {message}");
    let entry = {
        let mut j = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
        let entry = JournalEntry {
            seq: j.next_seq,
            time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64),
            level,
            source: source.to_string(),
            plugin,
            message,
        };
        j.next_seq += 1;
        j.entries.push_back(entry.clone());
        if j.entries.len() > CAPACITY {
            j.entries.pop_front();
        }
        entry
    };
    if let Some(app) = APP.get() {
        let _ = app.emit("journal-entry", &entry);
    }
}

pub fn info(source: &str, message: impl AsRef<str>) {
    record(Level::Info, source, false, message.as_ref());
}

pub fn warn(source: &str, message: impl AsRef<str>) {
    record(Level::Warn, source, false, message.as_ref());
}

pub fn error(source: &str, message: impl AsRef<str>) {
    record(Level::Error, source, false, message.as_ref());
}

/// Efface les entrées d'un plugin (désinstallation : un plugin réinstallé
/// repart d'un journal vide).
pub fn forget_plugin(id: &str) {
    let mut j = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
    j.entries.retain(|e| !(e.plugin && e.source == id));
}

/// Toutes les entrées, de la plus ancienne à la plus récente.
#[tauri::command]
pub fn get_journal() -> Vec<JournalEntry> {
    let j = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
    j.entries.iter().cloned().collect()
}

/// Entrée d'un plugin, versée par la fenêtre qui héberge son worker. `level`
/// est ramené aux quatre niveaux du protocole ; un id invalide est ignoré.
#[tauri::command]
pub fn plugin_log(plugin_id: String, level: String, message: String) {
    if crate::plugins::valid_id(&plugin_id) {
        record(Level::parse(&level), &plugin_id, true, &message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_and_truncation() {
        assert_eq!(Level::parse("warn"), Level::Warn);
        assert_eq!(Level::parse("WARN"), Level::Info);
        assert_eq!(Level::parse("constructor"), Level::Info);
        let long = "é".repeat(MAX_MESSAGE + 5);
        let cut = truncate(&long);
        assert_eq!(cut.chars().count(), MAX_MESSAGE + 1);
        assert!(cut.ends_with('…'));
        assert_eq!(truncate("court"), "court");
    }

    #[test]
    fn capacity_and_forget() {
        for i in 0..CAPACITY + 10 {
            record(Level::Info, "test-journal", true, &format!("m{i}"));
        }
        plugin_log("../x".into(), "error".into(), "ignored".into());
        let mine: Vec<_> = get_journal()
            .into_iter()
            .filter(|e| e.source == "test-journal")
            .collect();
        assert!(mine.len() <= CAPACITY);
        assert_eq!(mine.last().unwrap().message, format!("m{}", CAPACITY + 9));
        assert!(get_journal().iter().all(|e| e.message != "ignored"));
        forget_plugin("test-journal");
        assert!(get_journal().iter().all(|e| e.source != "test-journal"));
    }
}
