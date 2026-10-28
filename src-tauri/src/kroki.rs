//! HTTP client for an external (optional) Kroki server + a render cache
//! shared between the built-in and the external mode.

use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::Duration;

pub struct KrokiState {
    pub client: reqwest::Client,
    /// hash(mode, type, source, options) -> SVG. Only successes are cached, so
    /// that a re-render naturally retries errors.
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

/// `mode` distinguishes built-in rendering ("embedded") from external servers (URL).
pub fn cache_key(mode: &str, dtype: &str, source: &str, options: &BTreeMap<String, String>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    mode.hash(&mut h);
    dtype.hash(&mut h);
    source.hash(&mut h);
    options.hash(&mut h);
    h.finish()
}

/// Renders a diagram through an external Kroki server's API (JSON POST on the root).
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
        return Err(tr!("kroki.invalid_type", dtype = dtype));
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
                tr!("kroki.timeout", server = server)
            } else if e.is_connect() {
                tr!("kroki.unreachable", server = server)
            } else {
                tr!("kroki.network_error", error = e)
            }
        })?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| tr!("kroki.unreadable_response", error = e))?;

    if !status.is_success() {
        return Err(tr!(
            "kroki.http_status",
            status = status,
            body = body.trim()
        ));
    }
    Ok(body)
}
