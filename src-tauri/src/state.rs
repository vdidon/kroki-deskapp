use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// An open document (= a tab). Two tabs on the same file = two documents.
pub struct Document {
    pub path: PathBuf,
    pub title: String,
}

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub id: u64,
    pub title: String,
    pub path: String,
}

/// Full state of a window's tabs, pushed to the frontend via the `tabs-updated` event.
#[derive(Serialize, Clone)]
pub struct TabsPayload {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u64>,
}

#[derive(Default)]
pub struct AppStateInner {
    pub docs: HashMap<u64, Document>,
    /// Labels of the live windows, in creation order. The first is the default
    /// target of CLI / second-instance opens.
    pub window_order: Vec<String>,
    /// window label -> document ids, in tab order.
    pub tabs: HashMap<String, Vec<u64>>,
    /// window label -> active tab.
    pub active: HashMap<String, u64>,
    pub next_doc_id: u64,
    pub next_win_id: u64,
}

#[derive(Default)]
pub struct AppState(pub Mutex<AppStateInner>);

impl AppStateInner {
    pub fn tabs_payload(&self, label: &str) -> TabsPayload {
        let tabs = self
            .tabs
            .get(label)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| {
                        self.docs.get(id).map(|d| TabInfo {
                            id: *id,
                            title: d.title.clone(),
                            path: d.path.to_string_lossy().into_owned(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        TabsPayload {
            window: label.to_string(),
            tabs,
            active: self.active.get(label).copied(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct SettingsData {
    /// URL of an external Kroki server. Empty = built-in rendering (default).
    pub external_url: String,
    /// Expose the local Kroki API (for other tools: VS Code, scripts…).
    pub server_enabled: bool,
    pub server_port: u16,
    /// Interface theme: `"auto"` (follows the system), `"light"` or `"dark"`.
    pub theme: String,
    /// Interface language: `"auto"` (follows the system) or a shipped code
    /// (`"en"`, `"fr"`), resolved by `i18n::resolve`.
    pub language: String,
    /// Visibility of the toolbar icons, **deliberately partial**:
    /// only the icons the user has explicitly checked or unchecked appear
    /// here. An absent icon follows the frontend registry's default
    /// (`ui/js/icons.js`) — changing a default in a later version therefore
    /// affects the workstations that never touched it, without overwriting the
    /// choices already made.
    /// `BTreeMap` and not `HashMap`: stable order in `settings.json`.
    pub icons: BTreeMap<String, bool>,
    /// Plugins the user has **explicitly deleted** (Plugins dialog).
    /// The only refusal signal we have for plugins shipped with the
    /// installer, which otherwise install silently at startup
    /// (`plugins::seed_bundled`): without this list, "Delete" (« Supprimer »)
    /// would be undone at the next launch. Reinstalling the plugin by hand
    /// removes it from here — the user then gets automatic updates again.
    pub removed_plugins: Vec<String>,
    /// Check at startup, at most once a day, whether a newer version is
    /// published on GitHub (`updates.rs`, notification only).
    pub update_check: bool,
    /// Timestamp (Unix seconds) of the last automatic check.
    /// Not exposed in the Settings (« Réglages ») dialog.
    pub update_checked_at: u64,
}

impl Default for SettingsData {
    fn default() -> Self {
        Self {
            external_url: String::new(),
            server_enabled: true,
            server_port: 8442,
            theme: "auto".to_string(),
            language: "auto".to_string(),
            icons: BTreeMap::new(),
            removed_plugins: Vec::new(),
            update_check: true,
            update_checked_at: 0,
        }
    }
}

#[derive(Default)]
pub struct SettingsState(pub Mutex<SettingsData>);

/// Case-insensitive path comparison key (Windows file system).
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

pub fn title_for(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}
