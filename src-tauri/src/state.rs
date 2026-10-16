use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Un document ouvert (= un onglet). Deux onglets sur le même fichier = deux documents.
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

/// État complet des onglets d'une fenêtre, poussé au frontend via l'event `tabs-updated`.
#[derive(Serialize, Clone)]
pub struct TabsPayload {
    pub window: String,
    pub tabs: Vec<TabInfo>,
    pub active: Option<u64>,
}

#[derive(Default)]
pub struct AppStateInner {
    pub docs: HashMap<u64, Document>,
    /// Labels des fenêtres vivantes, dans l'ordre de création. La première est la
    /// cible par défaut des ouvertures CLI / seconde instance.
    pub window_order: Vec<String>,
    /// label de fenêtre -> ids de documents, dans l'ordre des onglets.
    pub tabs: HashMap<String, Vec<u64>>,
    /// label de fenêtre -> onglet actif.
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
    /// URL d'un serveur Kroki externe. Vide = rendu intégré (défaut).
    pub external_url: String,
    /// Exposer l'API Kroki locale (pour d'autres outils : VS Code, scripts…).
    pub server_enabled: bool,
    pub server_port: u16,
    /// Thème de l'interface : `"auto"` (suit le système), `"light"` ou `"dark"`.
    pub theme: String,
    /// Visibilité des icônes des barres d'outils, **volontairement partielle** :
    /// seules les icônes que l'utilisateur a explicitement cochées ou décochées y
    /// figurent. Une icône absente suit le défaut du registre frontend
    /// (`ui/js/icons.js`) — changer un défaut dans une version ultérieure touche
    /// donc les postes qui n'y ont jamais touché, sans écraser les choix faits.
    /// `BTreeMap` et non `HashMap` : ordre stable dans `settings.json`.
    pub icons: BTreeMap<String, bool>,
    /// Plugins que l'utilisateur a **explicitement supprimés** (dialog Plugins).
    /// Seul signal de refus dont on dispose pour les plugins livrés avec
    /// l'installeur, qui s'installent sinon silencieusement au démarrage
    /// (`plugins::seed_bundled`) : sans cette liste, « Supprimer » serait
    /// annulé au lancement suivant. Réinstaller le plugin à la main l'en
    /// retire — l'utilisateur reprend alors les mises à jour automatiques.
    pub removed_plugins: Vec<String>,
}

impl Default for SettingsData {
    fn default() -> Self {
        Self {
            external_url: String::new(),
            server_enabled: true,
            server_port: 8442,
            theme: "auto".to_string(),
            icons: BTreeMap::new(),
            removed_plugins: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct SettingsState(pub Mutex<SettingsData>);

/// Clé de comparaison de chemins insensible à la casse (système de fichiers Windows).
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

pub fn title_for(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}
