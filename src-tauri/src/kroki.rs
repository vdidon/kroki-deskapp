//! Client HTTP vers un serveur Kroki externe (optionnel) + cache de rendus
//! partagé entre le mode intégré et le mode externe.

use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::Duration;

pub struct KrokiState {
    pub client: reqwest::Client,
    /// hash(mode, type, source, options) -> SVG. Seuls les succès sont mis en cache,
    /// pour qu'un re-render retente naturellement les erreurs.
    pub cache: Mutex<HashMap<u64, String>>,
}

impl Default for KrokiState {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(40))
                .user_agent(concat!("kroki_deskapp/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("client http"),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

/// `mode` distingue le rendu intégré (« embedded ») des serveurs externes (URL).
pub fn cache_key(mode: &str, dtype: &str, source: &str, options: &BTreeMap<String, String>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    mode.hash(&mut h);
    dtype.hash(&mut h);
    source.hash(&mut h);
    options.hash(&mut h);
    h.finish()
}

/// Rend un diagramme via l'API d'un serveur Kroki externe (POST JSON sur la racine).
pub async fn render(
    kroki: &KrokiState,
    server: &str,
    dtype: &str,
    source: &str,
    options: BTreeMap<String, String>,
) -> Result<String, String> {
    if !dtype
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return Err(format!("Type de diagramme invalide : {dtype}"));
    }
    let server = server.trim_end_matches('/');

    let mut payload = serde_json::json!({
        "diagram_source": source,
        "diagram_type": dtype,
        "output_format": "svg",
    });
    if !options.is_empty() {
        payload["diagram_options"] = serde_json::json!(options);
    }

    let resp = kroki
        .client
        .post(format!("{server}/"))
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("Délai dépassé en contactant le serveur Kroki ({server})")
            } else if e.is_connect() {
                format!("Impossible de joindre le serveur Kroki ({server}) — vérifiez la connexion ou l'URL dans les réglages")
            } else {
                format!("Erreur réseau Kroki : {e}")
            }
        })?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Réponse Kroki illisible : {e}"))?;

    if !status.is_success() {
        return Err(format!("Kroki a répondu {status} :\n{}", body.trim()));
    }
    Ok(body)
}
