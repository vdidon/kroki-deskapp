//! Serveur HTTP local compatible avec l'API Kroki, adossé aux moteurs intégrés.
//! Permet à d'autres outils (extensions VS Code, scripts…) d'utiliser le rendu
//! de l'application : POST /, POST /{type}/svg, GET /{type}/svg/{deflate+base64url}.

use std::io::Read;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server};

use crate::engine;

#[derive(Default)]
pub struct ServerState {
    current: Mutex<Option<(u16, Arc<Server>)>>,
}

pub fn apply_settings(app: &AppHandle, enabled: bool, port: u16) {
    let st = app.state::<ServerState>();
    let mut cur = st.current.lock().unwrap();
    match (&*cur, enabled) {
        (Some((p, _)), true) if *p == port => return, // déjà dans le bon état
        _ => {}
    }
    if let Some((old, server)) = cur.take() {
        server.unblock();
        crate::journal::info("server", format!("local Kroki API stopped (port {old})"));
    }
    if !enabled {
        return;
    }
    match Server::http(("127.0.0.1", port)) {
        Ok(server) => {
            crate::journal::info(
                "server",
                format!("local Kroki API listening on http://127.0.0.1:{port}"),
            );
            let server = Arc::new(server);
            *cur = Some((port, server.clone()));
            let app = app.clone();
            std::thread::spawn(move || {
                for req in server.incoming_requests() {
                    let app = app.clone();
                    // Un thread par requête : les rendus peuvent être longs (JVM…).
                    // API technique lue par des outils : toujours en anglais, quelle
                    // que soit la langue de l'interface (la surcharge est par thread,
                    // d'où son installation ici, sur le thread qui sert la requête).
                    std::thread::spawn(move || {
                        crate::i18n::in_reference_language(|| handle(&app, req))
                    });
                }
            });
        }
        Err(e) => crate::journal::error("server", format!("port {port} unavailable: {e}")),
    }
}

fn cors() -> Vec<Header> {
    vec![
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap(),
    ]
}

/// Corps JSON compatible avec `/health` de Kroki :
/// `{"status":"pass","version":{"kroki":"…","mermaid":"…", …}}`.
/// L'extension markdown-kroki lit `Object.keys(version)` (en retirant "kroki")
/// pour connaître les types à rendre — d'où l'inclusion des alias.
fn health_body() -> String {
    let mut version = serde_json::Map::new();
    version.insert("kroki".into(), env!("CARGO_PKG_VERSION").into());
    for t in engine::supported_types() {
        version.insert(t.to_string(), "embedded".into());
    }
    serde_json::json!({ "status": "pass", "version": version }).to_string()
}

fn respond(req: tiny_http::Request, status: u16, ctype: &str, body: String) {
    let mut resp = Response::from_string(body).with_status_code(status);
    resp.add_header(Header::from_bytes("Content-Type", ctype).unwrap());
    for h in cors() {
        resp.add_header(h);
    }
    let _ = req.respond(resp);
}

/// Décode le format GET de Kroki : deflate (zlib) puis base64 url-safe.
fn decode_get_payload(payload: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::URL_SAFE
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload))
        .map_err(|e| format!("invalid base64: {e}"))?;
    let mut out = String::new();
    flate2::read::ZlibDecoder::new(&bytes[..])
        .read_to_string(&mut out)
        .map_err(|e| format!("decompression failed: {e}"))?;
    Ok(out)
}

fn handle(app: &AppHandle, mut req: tiny_http::Request) {
    if *req.method() == Method::Options {
        let mut resp = Response::empty(204);
        for h in cors() {
            resp.add_header(h);
        }
        let _ = req.respond(resp);
        return;
    }

    let url = req.url().trim_start_matches('/').to_string();
    let segments: Vec<String> = url
        .split('/')
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // (type, format, source)
    let parsed: Result<(String, String, String), String> = match (req.method(), segments.len()) {
        (Method::Post, 0) => {
            let mut body = String::new();
            if req.as_reader().read_to_string(&mut body).is_err() {
                Err("unreadable body".into())
            } else {
                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(v) => {
                        let dtype = v["diagram_type"].as_str().unwrap_or_default().to_string();
                        let source = v["diagram_source"].as_str().unwrap_or_default().to_string();
                        let fmt = v["output_format"].as_str().unwrap_or("svg").to_string();
                        if dtype.is_empty() || source.is_empty() {
                            Err("diagram_type and diagram_source are required".into())
                        } else {
                            Ok((dtype, fmt, source))
                        }
                    }
                    Err(e) => Err(format!("invalid JSON: {e}")),
                }
            }
        }
        (Method::Post, 1 | 2) => {
            let mut body = String::new();
            if req.as_reader().read_to_string(&mut body).is_err() {
                Err("unreadable body".into())
            } else {
                let fmt = segments.get(1).cloned().unwrap_or_else(|| "svg".into());
                Ok((segments[0].clone(), fmt, body))
            }
        }
        (Method::Get, 3) => decode_get_payload(&segments[2])
            .map(|src| (segments[0].clone(), segments[1].clone(), src)),
        (Method::Get, 0) => {
            respond(
                req,
                200,
                "text/plain; charset=utf-8",
                format!(
                    "Kroki Desk — local Kroki-compatible API (built-in rendering).\n{}\n",
                    engine::supported_summary()
                ),
            );
            return;
        }
        // Compat Kroki : /health et /v1/health renvoient l'état + la liste des
        // types. L'extension markdown-kroki (Cursor/VS Code) appelle /v1/health à
        // l'activation et n'enregistre son plugin que si la réponse est exploitable
        // (elle lit Object.keys(version) pour savoir quels fences rendre).
        (Method::Get, 1) if segments[0] == "health" => {
            respond(req, 200, "application/json", health_body());
            return;
        }
        (Method::Get, 2) if segments[0] == "v1" && segments[1] == "health" => {
            respond(req, 200, "application/json", health_body());
            return;
        }
        _ => Err("unknown route — POST /, POST /{type}/svg or GET /{type}/svg/{payload}".into()),
    };

    let (dtype, fmt, source) = match parsed {
        Ok(p) => p,
        Err(e) => {
            respond(req, 400, "text/plain; charset=utf-8", e);
            return;
        }
    };
    if fmt != "svg" {
        respond(
            req,
            400,
            "text/plain; charset=utf-8",
            format!("Only the svg format is supported (requested: {fmt})"),
        );
        return;
    }
    let dtype = engine::resolve_alias(&dtype.to_lowercase()).to_string();
    match engine::render_local(app, &dtype, &source, &serde_json::Map::new()) {
        Ok(svg) => respond(req, 200, "image/svg+xml", svg),
        Err(e) => respond(req, 400, "text/plain; charset=utf-8", e),
    }
}
