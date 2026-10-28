//! Built-in rendering engine: replaces the Kroki server with embedded engines.
//!
//! Four families:
//! - native Rust, compiled into the exe: svgbob, pikchr;
//! - JS/WASM, run in a dedicated hidden webview (« renderer »):
//!   mermaid, graphviz, vega, vegalite, nomnoml, wavedrom, bytefield;
//! - JVM: plantuml/c4plantuml (plantuml-mit.jar) and ditaa (ditaa-standalone.jar),
//!   run as a subprocess if Java is present;
//! - TeX: tikz, compiled by the workstation's TeX distribution (latex + dvisvgm)
//!   if present — nothing is embedded.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RENDERER_LABEL: &str = "renderer";

/// Version of the embedded jar — used to name the extracted file.
const PLANTUML_VERSION: &str = "1.2026.6";
static PLANTUML_JAR: &[u8] = include_bytes!("../assets/plantuml-mit.jar");

/// ditaa: standalone jar (Batik embedded for SVG output via `--svg`).
const DITAA_VERSION: &str = "0.11.0";
static DITAA_JAR: &[u8] = include_bytes!("../assets/ditaa-0.11.0-standalone.jar");

const JS_TYPES: &[&str] = &[
    "mermaid",
    "graphviz",
    "vega",
    "vegalite",
    "nomnoml",
    "wavedrom",
    "bytefield",
    "d2",
    "dbml",
    "erd",
    "excalidraw",
    "bpmn",
];
const NATIVE_TYPES: &[&str] = &["svgbob", "pikchr"];
const JAVA_TYPES: &[&str] = &["plantuml", "c4plantuml", "ditaa"];
const TEX_TYPES: &[&str] = &["tikz"];

/// Types known to upstream Kroki but **not** embedded in the application:
/// they are only rendered through an external Kroki server (see settings).
/// Reference list frozen from the Kroki docs — not auto-detected, to be updated
/// if a new engine is embedded or if Kroki adds some.
const EXTERNAL_ONLY_TYPES: &[&str] = &[
    "actdiag",
    "blockdiag",
    "diagramsnet",
    "nwdiag",
    "packetdiag",
    "rackdiag",
    "seqdiag",
    "structurizr",
    "symbolator",
    "umlet",
    "wireviz",
];

/// Aliases accepted in addition to the official Kroki names (shared with the frontend).
pub fn resolve_alias(dtype: &str) -> &str {
    match dtype {
        "dot" | "gv" => "graphviz",
        "vega-lite" | "vl" => "vegalite",
        "c4" => "c4plantuml",
        "puml" | "plant-uml" => "plantuml",
        other => other,
    }
}

pub fn supported_summary() -> String {
    tr!(
        "engine.supported_summary",
        js = JS_TYPES.join(", "),
        native = NATIVE_TYPES.join(", "),
        java = JAVA_TYPES.join(", "),
        tex = TEX_TYPES.join(", ")
    )
}

/// Official aliases accepted in addition to the Kroki names (see `resolve_alias`).
const ALIASES: &[&str] = &["dot", "gv", "vega-lite", "vl", "c4", "puml", "plant-uml"];

/// Flat list of all recognized types (Kroki names + aliases). Used by the
/// `/v1/health` route consumed by extensions (markdown-kroki) to know which
/// fences to render.
pub fn supported_types() -> Vec<&'static str> {
    JS_TYPES
        .iter()
        .chain(NATIVE_TYPES)
        .chain(JAVA_TYPES)
        .chain(TEX_TYPES)
        .chain(ALIASES)
        .copied()
        .collect()
}

/// A group of engines sharing the same execution runtime, with its status
/// on the current workstation. Serialized for the info window.
#[derive(Serialize)]
pub struct RuntimeGroup {
    /// Underlying runtime: `native` | `webview` | `jvm` | `tex` | `external`.
    pub runtime: &'static str,
    /// Human-readable group label (in the interface language).
    pub label: String,
    /// System requirement (what the system needs to support it).
    pub requirement: String,
    /// `ok` (app + system) | `blocked` (app, system requirement missing) |
    /// `unsupported` (not handled by the application).
    pub status: &'static str,
    /// Contextual detail (Java detected or not, etc.).
    pub note: String,
    /// Diagram types covered by this group.
    pub types: Vec<&'static str>,
}

/// Runtime status for the info window: for each engine family, tells whether
/// it is supported by the app **and** by the system.
pub fn runtime_report(app: &AppHandle) -> Vec<RuntimeGroup> {
    let java_ok = java_available(app);
    let tex = find_tex(app);
    vec![
        RuntimeGroup {
            runtime: "native",
            label: tr!("runtimes.native.label"),
            requirement: tr!("runtimes.native.requirement"),
            status: "ok",
            note: tr!("runtimes.native.note"),
            types: NATIVE_TYPES.to_vec(),
        },
        RuntimeGroup {
            runtime: "webview",
            label: tr!("runtimes.webview.label"),
            requirement: tr!("runtimes.webview.requirement"),
            status: "ok",
            note: tr!("runtimes.webview.note"),
            types: JS_TYPES.to_vec(),
        },
        RuntimeGroup {
            runtime: "jvm",
            label: tr!("runtimes.jvm.label"),
            requirement: tr!("runtimes.jvm.requirement"),
            status: if java_ok { "ok" } else { "blocked" },
            note: if java_ok {
                tr!("runtimes.jvm.note_ok")
            } else {
                tr!("runtimes.jvm.note_missing")
            },
            types: JAVA_TYPES.to_vec(),
        },
        RuntimeGroup {
            runtime: "tex",
            label: tr!("runtimes.tex.label"),
            requirement: tr!("runtimes.tex.requirement"),
            status: if tex.is_some() { "ok" } else { "blocked" },
            note: match &tex {
                Some(t) if t.miktex => tr!("runtimes.tex.note_miktex"),
                Some(_) => tr!("runtimes.tex.note_other"),
                None => tr!("runtimes.tex.note_missing"),
            },
            types: TEX_TYPES.to_vec(),
        },
        RuntimeGroup {
            runtime: "external",
            label: tr!("runtimes.external.label"),
            requirement: tr!("runtimes.external.requirement"),
            status: "unsupported",
            note: tr!("runtimes.external.note"),
            types: EXTERNAL_ONLY_TYPES.to_vec(),
        },
    ]
}

#[derive(Default)]
pub struct EngineState {
    /// Jobs sent to the render webview, awaiting a response.
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<String, String>>>>,
    next_job: Mutex<u64>,
    /// The render webview has finished loading its engines.
    ready: (Mutex<bool>, Condvar),
    /// A creation of the render webview is already posted/in progress: avoids
    /// double creation when `ensure_renderer` is called concurrently (deferred
    /// boot + `render_js` safety net). Reset to false if the webview is destroyed.
    creating: AtomicBool,
    /// Path of java.exe: not probed (None) / probed absent (Some(None)) / present.
    java: Mutex<Option<Option<PathBuf>>>,
    /// TeX tools, same convention as `java`.
    tex: Mutex<Option<Option<TexTools>>>,
}

pub fn set_renderer_ready(app: &AppHandle, ready: bool) {
    let st = app.state::<EngineState>();
    let (lock, cv) = &st.ready;
    *lock.lock().unwrap() = ready;
    cv.notify_all();
}

pub fn complete_job(app: &AppHandle, id: u64, result: Result<String, String>) {
    let st = app.state::<EngineState>();
    let tx = st.pending.lock().unwrap().remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(result);
    }
}

/// Requests creation of the hidden render webview if it does not exist yet.
///
/// Idempotent and safe from **any thread**: building a WebView2 webview must
/// happen on the main thread, so the `build()` is posted via
/// `run_on_main_thread`. Called twice: at boot (deferred off the critical
/// path, see `setup`) and as a safety net by `render_js` (which runs on a
/// `spawn_blocking` thread) if the webview crashed.
pub fn ensure_renderer(app: &AppHandle) {
    if app.get_webview_window(RENDERER_LABEL).is_some() {
        return;
    }
    let st = app.state::<EngineState>();
    // Only one creation in flight: if another is already posted, let it proceed.
    if st.creating.swap(true, Ordering::SeqCst) {
        return;
    }
    set_renderer_ready(app, false);
    let app = app.clone();
    let post = app.run_on_main_thread({
        let app = app.clone();
        move || build_renderer(&app)
    });
    if post.is_err() {
        // Cannot post to the main thread: release the lock so it can be retried.
        app.state::<EngineState>()
            .creating
            .store(false, Ordering::SeqCst);
    }
}

/// Actually builds the hidden webview. **Must** run on the main thread.
fn build_renderer(app: &AppHandle) {
    if app.get_webview_window(RENDERER_LABEL).is_some() {
        return;
    }
    let built = WebviewWindowBuilder::new(
        app,
        RENDERER_LABEL,
        WebviewUrl::App("renderer/renderer.html".into()),
    )
    // Hidden window, never shown: technical title, not translated.
    .title("Kroki Desk — renderer")
    .visible(false)
    .skip_taskbar(true)
    .inner_size(1200.0, 900.0)
    .build();
    if let Err(e) = built {
        crate::journal::error("engine", format!("cannot create the render webview: {e}"));
        // Failure: release the lock to allow a new attempt.
        app.state::<EngineState>()
            .creating
            .store(false, Ordering::SeqCst);
    }
}

/// To be called when the render webview is destroyed: releases the creation
/// lock and marks the engines as unavailable, so that the next render
/// recreates it.
pub fn renderer_destroyed(app: &AppHandle) {
    app.state::<EngineState>()
        .creating
        .store(false, Ordering::SeqCst);
    set_renderer_ready(app, false);
}

fn wait_renderer_ready(app: &AppHandle, timeout: Duration) -> Result<(), String> {
    let st = app.state::<EngineState>();
    let (lock, cv) = &st.ready;
    let guard = lock.lock().unwrap();
    let (guard, res) = cv
        .wait_timeout_while(guard, timeout, |ready| !*ready)
        .map_err(|_| tr!("engine.state_corrupted"))?;
    drop(guard);
    if res.timed_out() {
        Err(tr!("engine.renderer_timeout"))
    } else {
        Ok(())
    }
}

/// Rendering through the hidden webview (JS/WASM engines).
fn render_js(
    app: &AppHandle,
    dtype: &str,
    source: &str,
    options: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    ensure_renderer(app);
    wait_renderer_ready(app, Duration::from_secs(20))?;

    let (tx, rx) = mpsc::channel();
    let id = {
        let st = app.state::<EngineState>();
        let mut next = st.next_job.lock().unwrap();
        *next += 1;
        let id = *next;
        st.pending.lock().unwrap().insert(id, tx);
        id
    };
    let payload = json!({ "id": id, "dtype": dtype, "source": source, "options": options });
    if let Err(e) = app.emit_to(RENDERER_LABEL, "render-job", payload) {
        app.state::<EngineState>()
            .pending
            .lock()
            .unwrap()
            .remove(&id);
        return Err(tr!("engine.renderer_comm", error = e));
    }
    let res = rx.recv_timeout(Duration::from_secs(40));
    app.state::<EngineState>()
        .pending
        .lock()
        .unwrap()
        .remove(&id);
    match res {
        // Empty error = response with no result (see `render_job_done`): the text
        // is produced here, on the waiting thread, to follow its language (the
        // local HTTP API's is English, not the interface's).
        Ok(Err(e)) if e.is_empty() => Err(tr!("engine.empty_response")),
        Ok(r) => r,
        Err(_) => Err(tr!("engine.render_timeout", dtype = dtype)),
    }
}

// ---------- PlantUML (JVM) ----------

fn find_java(app: &AppHandle) -> Option<PathBuf> {
    let st = app.state::<EngineState>();
    let mut cache = st.java.lock().unwrap();
    if let Some(known) = cache.as_ref() {
        return known.clone();
    }
    #[cfg(windows)]
    const JAVA_BIN: &str = "java.exe";
    #[cfg(not(windows))]
    const JAVA_BIN: &str = "java";
    let candidates: Vec<PathBuf> = std::env::var_os("JAVA_HOME")
        .map(|h| PathBuf::from(h).join("bin").join(JAVA_BIN))
        .into_iter()
        .chain([PathBuf::from("java")])
        .collect();
    let found = candidates.into_iter().find_map(|p| {
        let mut cmd = std::process::Command::new(&p);
        cmd.arg("-version");
        no_window(&mut cmd);
        let out = cmd.output().ok().filter(|o| o.status.success())?;
        // `java -version` writes to stderr; 1st line = distribution and version.
        let version = first_line(&out.stderr);
        Some((p, version))
    });
    match &found {
        Some((p, version)) => {
            crate::journal::info("engine", format!("Java found: {} ({version})", p.display()))
        }
        None => crate::journal::info(
            "engine",
            "Java not found (JAVA_HOME, PATH): PlantUML/C4/ditaa need an external Kroki server",
        ),
    }
    let found = found.map(|(p, _)| p);
    *cache = Some(found.clone());
    found
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Is Java usable on this workstation? (probed once, cached)
pub fn java_available(app: &AppHandle) -> bool {
    find_java(app).is_some()
}

#[cfg(windows)]
fn no_window(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut std::process::Command) {}

fn ensure_plantuml_jar(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| tr!("engine.data_dir_not_found", error = e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let jar = dir.join(format!("plantuml-mit-{PLANTUML_VERSION}.jar"));
    let needs_write = match std::fs::metadata(&jar) {
        Ok(m) => m.len() != PLANTUML_JAR.len() as u64,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&jar, PLANTUML_JAR)
            .map_err(|e| tr!("engine.jar_extract_failed", name = "PlantUML", error = e))?;
    }
    Ok(jar)
}

fn render_plantuml(app: &AppHandle, source: &str) -> Result<String, String> {
    let Some(java) = find_java(app) else {
        return Err(tr!("engine.java_missing", name = "PlantUML"));
    };
    let jar = ensure_plantuml_jar(app)?;
    let src = if source.contains("@start") {
        source.to_string()
    } else {
        format!("@startuml\n{source}\n@enduml")
    };

    let mut cmd = std::process::Command::new(&java);
    cmd.args([
        "-Djava.awt.headless=true",
        "-jar",
        &jar.to_string_lossy(),
        "-tsvg",
        "-pipe",
        "-charset",
        "UTF-8",
    ])
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| tr!("engine.spawn_failed", name = "Java", error = e))?;
    child
        .stdin
        .take()
        .ok_or_else(|| tr!("engine.stdin_unavailable"))?
        .write_all(src.as_bytes())
        .map_err(|e| e.to_string())?;

    // wait_with_output closes stdin (already dropped) and reads everything; PlantUML
    // always terminates in -pipe mode, but we still bound it via a guard thread.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let output = match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(tr!("engine.tool_error", name = "PlantUML", error = e)),
        Err(_) => return Err(tr!("engine.tool_timeout", name = "PlantUML", seconds = 60)),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("<svg") {
        // On a syntax error, PlantUML produces an SVG describing the error:
        // we display it as is, it is the most useful diagnostic.
        Ok(stdout.into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(tr!(
            "engine.no_svg",
            name = "PlantUML",
            details = stderr.trim()
        ))
    }
}

// ---------- ditaa (JVM) ----------

fn ensure_ditaa_jar(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| tr!("engine.data_dir_not_found", error = e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let jar = dir.join(format!("ditaa-{DITAA_VERSION}.jar"));
    let needs_write = match std::fs::metadata(&jar) {
        Ok(m) => m.len() != DITAA_JAR.len() as u64,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&jar, DITAA_JAR)
            .map_err(|e| tr!("engine.jar_extract_failed", name = "ditaa", error = e))?;
    }
    Ok(jar)
}

fn render_ditaa(app: &AppHandle, source: &str) -> Result<String, String> {
    let Some(java) = find_java(app) else {
        return Err(tr!("engine.java_missing", name = "ditaa"));
    };
    let jar = ensure_ditaa_jar(app)?;

    // ditaa expects <input> <output>; « - » on both sides = stdin→stdout pipe
    // (like PlantUML), « -o » allows overwriting the « - » output.
    let mut cmd = std::process::Command::new(&java);
    cmd.args([
        "-Djava.awt.headless=true",
        "-jar",
        &jar.to_string_lossy(),
        "-",
        "-",
        "--svg",
        "-o",
    ])
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| tr!("engine.spawn_failed", name = "Java", error = e))?;
    child
        .stdin
        .take()
        .ok_or_else(|| tr!("engine.stdin_unavailable"))?
        .write_all(source.as_bytes())
        .map_err(|e| e.to_string())?;

    // Time guard as for PlantUML: ditaa terminates in pipe mode, but we bound it.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let output = match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(tr!("engine.tool_error", name = "ditaa", error = e)),
        Err(_) => return Err(tr!("engine.tool_timeout", name = "ditaa", seconds = 60)),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("<svg") {
        Ok(stdout.into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(tr!(
            "engine.no_svg",
            name = "ditaa",
            details = stderr.trim()
        ))
    }
}

// ---------- TikZ (workstation's TeX distribution) ----------

/// Timeout of one compilation step. Generous: the first call to a freshly
/// installed MiKTeX distribution rebuilds its file databases
/// (~15 s measured), subsequent ones take ~1 s.
const TEX_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct TexTools {
    /// MiKTeX: dedicated option to turn off automatic package installation.
    miktex: bool,
    /// 1st line of `latex --version` (journal).
    version: String,
}

/// Are `latex` and `dvisvgm` on the PATH? (probed once, cached)
fn find_tex(app: &AppHandle) -> Option<TexTools> {
    let st = app.state::<EngineState>();
    let mut cache = st.tex.lock().unwrap();
    if let Some(known) = cache.as_ref() {
        return known.clone();
    }
    let found = probe_tex();
    crate::journal::info(
        "engine",
        match &found {
            Some(t) => format!("TeX found: {}", t.version),
            None => {
                "TeX not found (latex and dvisvgm on PATH): tikz needs an external Kroki server"
                    .to_string()
            }
        },
    );
    *cache = Some(found.clone());
    found
}

fn probe_tex() -> Option<TexTools> {
    let probe = |bin: &str| {
        let mut cmd = std::process::Command::new(bin);
        cmd.arg("--version").stdin(std::process::Stdio::null());
        no_window(&mut cmd);
        cmd.output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    match (probe("latex"), probe("dvisvgm")) {
        (Some(version), Some(_)) => Some(TexTools {
            miktex: version.contains("MiKTeX"),
            version: first_line(version.as_bytes()),
        }),
        _ => None,
    }
}

/// Is a TeX distribution usable on this workstation?
pub fn tex_available(app: &AppHandle) -> bool {
    find_tex(app).is_some()
}

/// Compilation folder, removed no matter what.
struct ScratchDir(PathBuf);

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs `cmd` and waits for it at most `TEX_TIMEOUT`, then kills it. Standard
/// outputs are discarded: latex writes everything to its `.log`, dvisvgm its
/// diagnostics to `stderr_to`.
fn run_bounded(
    mut cmd: std::process::Command,
    what: &str,
    stderr_to: Option<&Path>,
) -> Result<std::process::ExitStatus, String> {
    use std::process::Stdio;
    let stderr = match stderr_to.map(std::fs::File::create) {
        Some(Ok(f)) => Stdio::from(f),
        _ => Stdio::null(),
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);
    no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| tr!("engine.spawn_failed", name = what, error = e))?;
    let deadline = Instant::now() + TEX_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(tr!(
                    "engine.tool_timeout",
                    name = what,
                    seconds = TEX_TIMEOUT.as_secs()
                ));
            }
            Err(e) => return Err(tr!("engine.tool_error", name = what, error = e)),
        }
    }
}

/// Kroki expects a complete LaTeX document; a bare `tikzpicture`, or even
/// plain drawing commands, are also accepted and wrapped.
fn tikz_document(source: &str) -> String {
    if source.contains("\\documentclass") {
        return source.to_string();
    }
    let body = if source.contains("\\begin{tikzpicture}") {
        source.to_string()
    } else {
        format!("\\begin{{tikzpicture}}\n{source}\n\\end{{tikzpicture}}")
    };
    format!("\\documentclass[tikz,border=4pt]{{standalone}}\n\\begin{{document}}\n{body}\n\\end{{document}}\n")
}

/// Extracts the first TeX error from the `.log`: the `! …` line, then the
/// `l.<n>` line that locates it in the compiled document. TeX cuts the latter
/// at the error point and prints the rest on the next line: they are
/// glued back together. The interactive help that separates them
/// (« Type X to quit… ») is omitted, it makes no sense outside a terminal.
fn tex_error(log: &str) -> String {
    let lines: Vec<&str> = log.lines().collect();
    let Some(start) = lines.iter().position(|l| l.starts_with('!')) else {
        return tr!("engine.tex_no_error");
    };
    let mut message = lines[start].to_string();
    if let Some(at) = lines[start..]
        .iter()
        .take(20)
        .position(|l| l.starts_with("l."))
    {
        let at = start + at;
        let rest = lines.get(at + 1).map_or("", |l| l.trim());
        message = format!("{message}\n{} {rest}", lines[at].trim_end());
    }
    if message.contains(".sty' not found") || message.contains("Unknown option") {
        message = format!("{message}\n\n{}", tr!("engine.tex_package_missing"));
    }
    message
}

/// Prefixes the identifiers of a dvisvgm SVG. Its glyphs are named
/// `g20-11` in **every** file: two figures inserted in the same page
/// would share these `id`s, and the second would be displayed with the
/// first one's glyphs. The prefix derives from the source: two identical
/// figures stay consistent.
fn scope_svg_ids(svg: &str, source: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut h);
    let p = format!("tikz{:x}-", h.finish());
    let svg = &svg[svg.find("<svg").unwrap_or(0)..]; // without the XML prologue
    svg.replace(" id='", &format!(" id='{p}"))
        .replace(" id=\"", &format!(" id=\"{p}"))
        .replace("href='#", &format!("href='#{p}"))
        .replace("href=\"#", &format!("href=\"#{p}"))
        .replace("url(#", &format!("url(#{p}"))
}

/// Fonts that dvisvgm could not vectorize, according to its log: it only
/// has outlines for Type 1 fonts, and otherwise falls back on METAFONT, which
/// commonly fails (« failed to create ecrm1000.gf »). The SVG is
/// still written, **without the text** of those fonts.
fn missing_glyph_fonts(log: &str) -> Vec<String> {
    log.lines()
        .filter_map(|l| l.split_once("failed to create ").map(|(_, f)| f.trim()))
        .map(|f| f.trim_end_matches(".gf").to_string())
        .collect()
}

/// TikZ → SVG: `latex` to DVI with the PGF `dvisvgm` driver, then `dvisvgm
/// --no-fonts`, which converts text to outlines — the SVG depends on no
/// installed font. For these outlines to exist, the fonts must be
/// vector: `lmodern` (Type 1) is therefore loaded **before** the class if it
/// is installed. Without it, `\usepackage[T1]{fontenc}` alone selects the
/// EC fonts, bitmap, from which dvisvgm draws no glyph; a font choice
/// in the document, loaded afterwards, still takes precedence. Compilation happens in a temporary folder, without
/// `\write18` and, under MiKTeX, without automatic package installation (which
/// would open its window mid-render). Under TeX Live, `openin_any=p`
/// additionally forbids reading files by absolute path.
fn render_tikz(app: &AppHandle, source: &str) -> Result<String, String> {
    let Some(tex) = find_tex(app) else {
        return Err(tr!("engine.tex_missing"));
    };
    compile_tikz(&tex, source)
}

fn compile_tikz(tex: &TexTools, source: &str) -> Result<String, String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let dir = ScratchDir(std::env::temp_dir().join(format!(
        "kroki-desk-tikz-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )));
    std::fs::create_dir_all(&dir.0).map_err(|e| tr!("engine.tex_dir_failed", error = e))?;
    std::fs::write(dir.0.join("figure.tex"), tikz_document(source))
        .map_err(|e| tr!("engine.tex_write_failed", error = e))?;

    let mut latex = std::process::Command::new("latex");
    latex.current_dir(&dir.0).args([
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-no-shell-escape",
        "-jobname=figure",
    ]);
    if tex.miktex {
        latex.arg("--disable-installer");
    }
    latex
        .arg(concat!(
            r"\def\pgfsysdriver{pgfsys-dvisvgm.def}",
            r"\IfFileExists{lmodern.sty}{\RequirePackage{lmodern}}{}",
            r"\input{figure.tex}"
        ))
        .env("openin_any", "p");
    let status = run_bounded(latex, "latex", None)?;
    if !status.success() || !dir.0.join("figure.dvi").exists() {
        let log = std::fs::read(dir.0.join("figure.log"))
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default();
        return Err(tr!("engine.tikz_failed", details = tex_error(&log)));
    }

    let mut dvisvgm = std::process::Command::new("dvisvgm");
    dvisvgm.current_dir(&dir.0).args([
        "--no-fonts",
        "--exact-bbox",
        "-o",
        "figure.svg",
        "figure.dvi",
    ]);
    let stderr = dir.0.join("dvisvgm.log");
    let status = run_bounded(dvisvgm, "dvisvgm", Some(&stderr))?;
    let missing = missing_glyph_fonts(&std::fs::read_to_string(&stderr).unwrap_or_default());
    if !missing.is_empty() {
        // A figure stripped of its text would pass for correct: refuse it.
        return Err(tr!("engine.tex_fonts_missing", fonts = missing.join(", ")));
    }
    match std::fs::read_to_string(dir.0.join("figure.svg")) {
        Ok(svg) if status.success() && svg.contains("<svg") => Ok(scope_svg_ids(&svg, source)),
        _ => Err(tr!(
            "engine.no_svg",
            name = "dvisvgm",
            details = std::fs::read_to_string(&stderr).unwrap_or_default().trim()
        )),
    }
}

// ---------- Native Rust ----------

fn render_svgbob(source: &str) -> Result<String, String> {
    Ok(svgbob::to_svg_string_pretty(source))
}

fn render_pikchr(source: &str) -> Result<String, String> {
    let mut flags = pikchr::PikchrFlags::default();
    flags.generate_plain_errors();
    pikchr::Pikchr::render(source, None, flags)
        .map(|p| p.to_string())
        .map_err(|e| e.to_string())
}

// ---------- Dispatch ----------

/// Renders a diagram with the built-in engines. `dtype` must already be
/// resolved (alias) and lowercase.
pub fn render_local(
    app: &AppHandle,
    dtype: &str,
    source: &str,
    options: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    match dtype {
        "svgbob" => render_svgbob(source),
        "pikchr" => render_pikchr(source),
        // ditaa is a Java type but has its own pipeline (ditaa args, not
        // PlantUML's -pipe): intercepted before the JAVA_TYPES guard below.
        "ditaa" => render_ditaa(app, source),
        t if JS_TYPES.contains(&t) => render_js(app, t, source, options),
        t if JAVA_TYPES.contains(&t) => render_plantuml(app, source),
        t if TEX_TYPES.contains(&t) => render_tikz(app, source),
        other => Err(tr!(
            "engine.type_unavailable",
            dtype = other,
            summary = supported_summary()
        )),
    }
}

#[cfg(test)]
mod tikz_tests {
    use super::*;

    #[test]
    fn enrobe_une_figure_nue() {
        let doc = tikz_document(r"\draw (0,0) -- (1,1);");
        assert!(doc.starts_with(r"\documentclass[tikz,border=4pt]{standalone}"));
        assert!(doc.contains("\\begin{tikzpicture}\n\\draw"));
        let pic = r"\begin{tikzpicture}\end{tikzpicture}";
        assert_eq!(tikz_document(pic).matches("tikzpicture").count(), 2);
        let full = r"\documentclass{article}\begin{document}x\end{document}";
        assert_eq!(tikz_document(full), full);
    }

    #[test]
    fn erreur_tex_recollee_sans_aide_interactive() {
        let log = concat!(
            "(tikz.sty)\n",
            "! LaTeX Error: File `inexistant.sty' not found.\n",
            "\n",
            "Type X to quit or <RETURN> to proceed,\n",
            "! Emergency stop.\n",
            "l.3 \\begin\n",
            "          {document}\\begin{tikzpicture}\n",
        );
        let msg = tex_error(log);
        assert!(
            msg.starts_with(
                "! LaTeX Error: File `inexistant.sty' not found.\nl.3 \\begin {document}"
            ),
            "{msg}"
        );
        assert!(!msg.contains("Type X"));
        // Compared against the catalog rather than a literal text: the test does not
        // depend on the language (tests run in English, the reference).
        assert!(msg.ends_with(&tr!("engine.tex_package_missing")), "{msg}");
        assert_eq!(tex_error("rien"), tr!("engine.tex_no_error"));
    }

    #[test]
    fn identifiants_prefixes() {
        let svg = "<?xml version='1.0'?>\n<svg><defs><path id='g20-11' d=''/></defs>\
                   <use xlink:href='#g20-11'/><g fill='url(#p1)'/></svg>";
        let a = scope_svg_ids(svg, "a");
        assert!(a.starts_with("<svg"));
        let p = &a[a.find("id='").unwrap() + 4..a.find("g20-11").unwrap()];
        assert!(p.starts_with("tikz"));
        assert!(a.contains(&format!("href='#{p}g20-11'")));
        assert!(a.contains(&format!("url(#{p}p1)")));
        assert_ne!(a, scope_svg_ids(svg, "b"));
    }

    #[test]
    fn polices_non_vectorisees_detectees() {
        let log = "processing page 1\n  running Metafont for ecrm0800\n  \
                   WARNING: failed to create ecrm0800.gf\n  output written to figure.svg\n";
        assert_eq!(missing_glyph_fonts(log), ["ecrm0800"]);
        assert!(missing_glyph_fonts("1 of 1 page converted").is_empty());
    }

    /// Real compilation, if the workstation has a TeX distribution (otherwise nothing to test).
    #[test]
    fn compile_une_figure_si_tex_present() {
        let Some(tex) = probe_tex() else { return };
        let svg = compile_tikz(&tex, r"\node[draw] {$x^2$ é};").unwrap();
        assert!(svg.starts_with("<svg"));
        // T1 without a vector font: lmodern, preloaded, must supply the glyphs.
        let t1 = "\\documentclass[tikz]{standalone}\n\\usepackage[T1]{fontenc}\n\
                  \\begin{document}\\tikz\\node{chaîne};\\end{document}";
        assert!(compile_tikz(&tex, t1).unwrap().contains("<path"));
        let err = compile_tikz(&tex, "\\draw (0,0) -- (1,1)\n\\node {x};").unwrap_err();
        assert!(err.contains("l."), "{err}");
    }
}
