//! In addition to `tauri_build`, packs the `latex-doc` plugin (`plugins/latex-doc/`)
//! into a `.kdext` in `OUT_DIR`, which `plugins.rs` embeds in the binary: it is
//! the source for `plugins::seed_bundled` when no installer has laid down a
//! `bundled-plugins/` folder (portable, AppImage, debug).
//!
//! The packing lives here, and not in xtask or `build_dist.py`, so that every
//! build path (`cargo run-app`, `build-app`, the installers' `tauri build`, a bare
//! `cargo build`, the Linux container) produces the same binary, with no
//! prerequisite step to remember.

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;

use zip::write::SimpleFileOptions;

/// Embedded plugin; its archive is `OUT_DIR/<id>.kdext`.
const EMBEDDED: &str = "latex-doc";

fn main() {
    pack_embedded_plugin();
    tauri_build::build()
}

/// Same selection as `pack_plugin.py` with `packInclude`: `manifest.json` and
/// the entry first, then the list, deduplicated. Only this branch is
/// reproduced — without `packInclude`, the build fails rather than copying the
/// Python script's exclusions, two rules that would end up diverging.
fn pack_embedded_plugin() {
    let src = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../plugins")
        .join(EMBEDDED);
    println!("cargo:rerun-if-changed={}", src.display());

    let manifest_path = src.join("manifest.json");
    let raw = std::fs::read(&manifest_path)
        .unwrap_or_else(|e| panic!("{} unreadable: {e}", manifest_path.display()));
    let manifest: serde_json::Value = serde_json::from_slice(&raw)
        .unwrap_or_else(|e| panic!("{} invalid: {e}", manifest_path.display()));
    let include = manifest["packInclude"].as_array().unwrap_or_else(|| {
        panic!(
            "{}: packInclude required for an embedded plugin",
            manifest_path.display()
        )
    });

    let mut files = vec!["manifest.json".to_string()];
    files.extend(manifest["entry"].as_str().map(str::to_string));
    for f in include {
        let f = f
            .as_str()
            .unwrap_or_else(|| panic!("packInclude: expected a path, found {f}"));
        files.push(f.to_string());
    }
    let mut seen = HashSet::new();
    files.retain(|f| seen.insert(f.clone()));

    // Fixed date: the archive only changes when its content does.
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default());
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for rel in &files {
        let bytes = std::fs::read(src.join(rel))
            .unwrap_or_else(|e| panic!("packInclude: {rel} not found in {EMBEDDED}: {e}"));
        zip.start_file(rel.as_str(), opts).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    let archive = zip.finish().unwrap().into_inner();

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join(format!("{EMBEDDED}.kdext"));
    std::fs::write(&out, archive).unwrap_or_else(|e| panic!("cannot write {}: {e}", out.display()));
}
