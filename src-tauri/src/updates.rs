//! Vérification des mises à jour : compare la version courante à la dernière
//! release publiée sur GitHub. **Notification seule** — l'application ne
//! télécharge ni n'installe rien elle-même : elle propose deux liens, ouverts
//! dans le navigateur, le fichier de la release qui correspond à cette
//! installation (`Format`) et la page de la release (notes de version).
//!
//! Seul appel réseau que l'application fait d'elle-même : désactivable dans
//! les Réglages (`SettingsData::update_check`), au plus une fois par jour, et
//! muet en cas d'échec (réseau filtré, quota de l'API GitHub atteint).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::commands;
use crate::kroki::KrokiState;
use crate::plugins::{self, version_less};
use crate::state::SettingsState;

/// Dépôt public, source unique : le champ `repository` de `Cargo.toml`.
const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");
/// Délai minimal entre deux vérifications automatiques.
const AUTO_INTERVAL_SECS: u64 = 24 * 3600;

/// Une seule vérification automatique par processus : chaque fenêtre appelle
/// la commande à son boot, seule la première compte.
static AUTO_DONE: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current: &'static str,
    pub latest: String,
    pub newer: bool,
    /// Page de la dernière release (formulée par nous, pas lue dans la réponse).
    pub release_url: String,
    /// Fichier de la release adapté à cette installation ; à défaut (format non
    /// publié, fichier oublié au téléversement), la page de la release.
    pub download_url: String,
    /// Nom de ce fichier, `None` si `download_url` est la page de la release.
    pub download_file: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// Format de cette installation, donc du fichier de release à proposer.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    Msi,
    PortableExe,
    Deb,
    AppImage,
    LinuxBinary,
}

impl Format {
    /// Le dossier `bundled-plugins` est créé par les deux installeurs (MSI,
    /// `postinst` du `.deb`) et absent des formats portables — même signal
    /// que le seeding des plugins livrés (`plugins::bundled_plugins_dir`).
    fn detect(app: &AppHandle) -> Option<Format> {
        let installed = plugins::bundled_plugins_dir(app).is_some_and(|d| d.is_dir());
        if cfg!(windows) {
            Some(if installed {
                Format::Msi
            } else {
                Format::PortableExe
            })
        } else if cfg!(target_os = "linux") {
            Some(if installed {
                Format::Deb
            } else if std::env::var_os("APPIMAGE").is_some() {
                Format::AppImage
            } else {
                Format::LinuxBinary
            })
        } else {
            None
        }
    }

    /// Noms publiés par le xtask (`publish_dist`) : `kroki_deskapp-<version>.msi`,
    /// `…-<version>-linux-<arch>-<distro>.deb`… Le tag de distro n'est pas
    /// figé ici : c'est celle du build, il peut changer.
    fn matches(self, name: &str) -> bool {
        if !name.starts_with(concat!(env!("CARGO_PKG_NAME"), "-")) {
            return false;
        }
        let linux = name.contains(&format!("-linux-{}-", std::env::consts::ARCH));
        match self {
            Format::Msi => name.ends_with(".msi"),
            Format::PortableExe => name.ends_with(".exe"),
            Format::Deb => linux && name.ends_with(".deb"),
            Format::AppImage => linux && name.ends_with(".AppImage"),
            Format::LinuxBinary => linux && !name.ends_with(".deb") && !name.ends_with(".AppImage"),
        }
    }
}

/// `automatic` (boot d'une fenêtre) : `None` si la vérification n'a pas lieu
/// (réglage désactivé, déjà faite aujourd'hui ou dans ce processus), si elle
/// échoue, ou si l'application est à jour — l'appelant n'affiche que le cas
/// utile. Sinon (bouton du dialog Informations) : toujours une requête, et
/// l'erreur remonte pour être affichée.
#[tauri::command]
pub async fn check_update(app: AppHandle, automatic: bool) -> Result<Option<UpdateInfo>, String> {
    if !automatic {
        return fetch(&app)
            .await
            .map(Some)
            .map_err(|e| tr!("error.update.failed", error = e));
    }
    if AUTO_DONE.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    {
        let settings = app.state::<SettingsState>();
        let mut s = settings.0.lock().unwrap();
        let recent = s.update_checked_at <= now && now - s.update_checked_at < AUTO_INTERVAL_SECS;
        if !s.update_check || recent {
            return Ok(None);
        }
        // Horodaté avant la requête : un réseau qui bloque GitHub ne doit pas
        // être sollicité à chaque lancement.
        s.update_checked_at = now;
    }
    commands::save_settings(&app);
    Ok(fetch(&app).await.ok().filter(|info| info.newer))
}

async fn fetch(app: &AppHandle) -> Result<UpdateInfo, String> {
    let api = format!(
        "{}/releases/latest",
        REPOSITORY.replacen("https://github.com/", "https://api.github.com/repos/", 1)
    );
    // Client partagé : il porte déjà le User-Agent, exigé par l'API GitHub.
    let client = app.state::<KrokiState>().client.clone();
    let resp = client
        .get(&api)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    let release: Release = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    Ok(update_info(&release, Format::detect(app)))
}

fn update_info(release: &Release, format: Option<Format>) -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION");
    let latest = release.tag_name.trim().trim_start_matches('v').to_string();
    let release_url = format!("{REPOSITORY}/releases/latest");
    // Seule URL lue dans la réponse : ouverte dans le navigateur, elle doit
    // rester un fichier de release de ce dépôt.
    let downloads = format!("{REPOSITORY}/releases/download/");
    let asset = format.and_then(|f| {
        release
            .assets
            .iter()
            .find(|a| f.matches(&a.name) && a.browser_download_url.starts_with(&downloads))
    });
    UpdateInfo {
        current,
        newer: version_less(current, &latest),
        latest,
        download_url: asset.map_or_else(|| release_url.clone(), |a| a.browser_download_url.clone()),
        download_file: asset.map(|a| a.name.clone()),
        release_url,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les fichiers d'une vraie release (3.27.0), à l'architecture près.
    fn release(tag: &str) -> Release {
        let arch = std::env::consts::ARCH;
        let names = [
            "barchart-1.0.1.kdext".to_string(),
            "latex-doc-1.5.0.kdext".to_string(),
            format!("kroki_deskapp-3.27.0-linux-{arch}-debian12"),
            format!("kroki_deskapp-3.27.0-linux-{arch}-debian12.AppImage"),
            format!("kroki_deskapp-3.27.0-linux-{arch}-debian12.deb"),
            "kroki_deskapp-3.27.0.exe".to_string(),
            "kroki_deskapp-3.27.0.msi".to_string(),
        ];
        Release {
            tag_name: tag.to_string(),
            assets: names
                .into_iter()
                .map(|name| Asset {
                    browser_download_url: format!("{REPOSITORY}/releases/download/{tag}/{name}"),
                    name,
                })
                .collect(),
        }
    }

    fn file(format: Format) -> Option<String> {
        update_info(&release("v3.27.0"), Some(format)).download_file
    }

    #[test]
    fn depot_github() {
        assert!(
            REPOSITORY.starts_with("https://github.com/"),
            "{REPOSITORY}"
        );
    }

    #[test]
    fn comparaison_au_tag() {
        let info = |tag: &str| update_info(&release(tag), None);
        assert!(info("v999.0.0").newer);
        assert!(!info(&format!("v{}", env!("CARGO_PKG_VERSION"))).newer);
        assert!(!info("v0.1.0").newer);
        assert_eq!(info("v3.4.5").latest, "3.4.5");
    }

    #[test]
    fn fichier_selon_le_format() {
        let linux = format!(
            "kroki_deskapp-3.27.0-linux-{}-debian12",
            std::env::consts::ARCH
        );
        assert_eq!(
            file(Format::Msi).as_deref(),
            Some("kroki_deskapp-3.27.0.msi")
        );
        assert_eq!(
            file(Format::PortableExe).as_deref(),
            Some("kroki_deskapp-3.27.0.exe")
        );
        assert_eq!(file(Format::LinuxBinary), Some(linux.clone()));
        assert_eq!(file(Format::Deb), Some(format!("{linux}.deb")));
        assert_eq!(file(Format::AppImage), Some(format!("{linux}.AppImage")));
    }

    #[test]
    fn repli_sur_la_page_de_release() {
        // Format inconnu.
        let info = update_info(&release("v3.27.0"), None);
        assert_eq!(
            (info.download_file, info.download_url),
            (None, info.release_url)
        );
        // Fichier absent de la release.
        let mut r = release("v3.27.0");
        r.assets.retain(|a| !a.name.ends_with(".msi"));
        assert_eq!(update_info(&r, Some(Format::Msi)).download_file, None);
        // URL hors des releases du dépôt.
        let mut r = release("v3.27.0");
        for a in &mut r.assets {
            a.browser_download_url = format!("https://example.com/{}", a.name);
        }
        let info = update_info(&r, Some(Format::Msi));
        assert_eq!(
            (info.download_file, info.download_url),
            (None, info.release_url)
        );
    }
}
