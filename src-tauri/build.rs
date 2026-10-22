//! En plus de `tauri_build`, empaquette le plugin `latex-doc` (`plugins/latex-doc/`)
//! en `.kdext` dans `OUT_DIR`, que `plugins.rs` embarque dans le binaire : c'est
//! la source de `plugins::seed_bundled` quand aucun installeur n'a posé de
//! dossier `bundled-plugins/` (portable, AppImage, debug).
//!
//! L'empaquetage vit ici, et non dans xtask ou `build_dist.py`, pour que tous les
//! chemins de compilation (`cargo run-app`, `build-app`, le `tauri build` des
//! installeurs, `cargo build` brut, conteneur Linux) produisent le même binaire,
//! sans étape préalable à respecter.

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;

use zip::write::SimpleFileOptions;

/// Plugin embarqué ; son archive est `OUT_DIR/<id>.kdext`.
const EMBEDDED: &str = "latex-doc";

fn main() {
    pack_embedded_plugin();
    tauri_build::build()
}

/// Même sélection que `pack_plugin.py` avec `packInclude` : `manifest.json` et
/// l'entry en tête, puis la liste, dédoublonnée. Seule cette branche est
/// reproduite — sans `packInclude`, le build échoue plutôt que de recopier les
/// exclusions du script Python, deux règles qui finiraient par diverger.
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

    // Date fixe : l'archive ne change que si son contenu change.
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
