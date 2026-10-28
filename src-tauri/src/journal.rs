//! Application log: the latest diagnostic entries, in memory.
//!
//! The release binary has no console (`windows_subsystem = "windows"`):
//! without this log, an `eprintln!` (API port busy, file watching failing,
//! shipped plugin not installed…) shows up nowhere. The Rust modules write to
//! it through `info`/`warn`/`error`; the windows pour in their plugins' entries
//! (`host/log`, failures and breakdowns seen by the host) through `plugin_log`.
//! A single log for the whole process, hence for all windows: a plugin worker
//! lives in one window, its log does not.
//!
//! Global (like `i18n`'s language): errors are born deep in modules that have
//! no `AppHandle`. Nothing is written to disk; the Rust modules' messages stay
//! in English, like any log output (cf. CLAUDE.md). Entries also keep their
//! stderr output, useful with `cargo run-app`.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Entries kept (the oldest are evicted).
const CAPACITY: usize = 500;
/// Maximum length of a message, in characters (the rest is truncated).
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
    /// Level sent by a plugin (§6.5): any unknown value counts as `info`.
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
    /// Increasing rank, unique for the lifetime of the process.
    pub seq: u64,
    /// Timestamp, in milliseconds since the Unix epoch.
    pub time: u64,
    pub level: Level,
    /// Rust module (`server`, `watcher`…) or plugin id if `plugin`.
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

/// For `journal-entry`; absent before `setup` (entries are kept).
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Wires the emission of `journal-entry` to the windows.
pub fn attach(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// URL without credentials (`https://user:pass@host` → `https://host/`): the
/// log is meant to be copied into a bug report.
pub fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(mut u) => {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.to_string()
        }
        Err(_) => "(invalid URL)".to_string(),
    }
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

/// Clears a plugin's entries (uninstall: a reinstalled plugin starts from an
/// empty log).
pub fn forget_plugin(id: &str) {
    let mut j = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
    j.entries.retain(|e| !(e.plugin && e.source == id));
}

/// All entries, from oldest to newest.
#[tauri::command]
pub fn get_journal() -> Vec<JournalEntry> {
    let j = JOURNAL.lock().unwrap_or_else(|e| e.into_inner());
    j.entries.iter().cloned().collect()
}

/// A plugin's entry, poured in by the window that hosts its worker. `level`
/// is mapped to the protocol's four levels; an invalid id is ignored.
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
        assert_eq!(
            redact_url("https://u:p@kroki.example:8000/x"),
            "https://kroki.example:8000/x"
        );
        assert_eq!(redact_url("pas une url"), "(invalid URL)");
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
