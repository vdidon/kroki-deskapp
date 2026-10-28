//! Plugin bundling strategy for the installers (MSI, .deb).
//!
//! Source: `bundled-plugins.txt` at the repository root (gitignored — the
//! selection specific to a workstation or a distribution), otherwise
//! `bundled-plugins.default.txt` (tracked — the default behavior). The
//! `KROKI_BUNDLED_PLUGINS` environment variable (path relative to the
//! repository root, or absolute) short-circuits that choice: it is how
//! `build_dist.py --channel` imposes the strategy of a distribution channel,
//! whatever local file is present. One line per plugin, in the display order
//! of the MSI page:
//!
//! ```text
//! # comment
//! latex-doc  on      ← checked (MSI) / installed at first launch (.deb)
//! csv-tables         ← bundled, unchecked / merely dropped alongside
//! ```
//!
//! Everything else is read from the `manifest.json` of each
//! `dist/<id>.kdext` archive — and not from `plugins/<id>/`, which may be a
//! junction to another repo, unresolvable in the .deb build container. The
//! displayed name comes from `name`, the file associations from `extensions`.
//!
//! Three outputs, all gitignored and regenerated on every build:
//! - `src-tauri/bundled-plugins/`: the retained archives (see `stage`);
//! - `src-tauri/wix/plugins.generated.wxs`: `PLUGIN_*` properties, components
//!   of the archives and of their associations, selection page (see `wix_fragment`);
//! - `src-tauri/tauri.deb.generated.json` + `src-tauri/linux/kroki-desk.generated.xml`:
//!   the complete .deb overlay and the shared-mime-info package (see `deb_overlay`).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::die;

const STRATEGY: &str = "bundled-plugins.txt";
const STRATEGY_DEFAULT: &str = "bundled-plugins.default.txt";
const STRATEGY_ENV: &str = "KROKI_BUNDLED_PLUGINS";

/// Extensions whose MIME type already exists in the freedesktop database: a
/// plugin that reads them is associated under that type. Any other extension
/// gets a Kroki Desk-specific type (`text/x-kroki-desk-<ext>`), generated in the
/// shared-mime-info package. A standard extension missing from this table
/// would wrongly receive a type of its own that would supplant the standard
/// one: extend it as needed.
const STANDARD_MIME: &[(&str, &str)] = &[
    ("tex", "text/x-tex"),
    ("latex", "text/x-tex"),
    ("ltx", "text/x-tex"),
    ("csv", "text/csv"),
    ("tsv", "text/tab-separated-values"),
];

pub struct Plugin {
    pub id: String,
    /// Checked by default (MSI) / installed at first launch (.deb).
    pub on: bool,
    pub name: String,
    /// Extensions served, without the dot, lowercase.
    pub extensions: Vec<String>,
}

impl Plugin {
    fn archive(&self) -> String {
        format!("{}.kdext", self.id)
    }
    /// `latex-doc` → `LatexDoc`: WiX identifiers and ProgID.
    fn camel(&self) -> String {
        self.id
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|s| !s.is_empty())
            .map(|s| {
                let mut c = s.chars();
                c.next()
                    .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                    .unwrap_or_default()
            })
            .collect()
    }
    /// `latex-doc` → `PLUGIN_LATEX_DOC`: public MSI property.
    fn property(&self) -> String {
        let up: String = self
            .id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_uppercase()
                } else {
                    '_'
                }
            })
            .collect();
        format!("PLUGIN_{up}")
    }
}

/// Reads the strategy and the manifests of the dist/ archives.
pub fn load(repo: &Path, cmd: &str) -> Vec<Plugin> {
    // When imposed, the strategy must exist: falling back to another file
    // would silently bundle the plugins of another channel.
    let forced = std::env::var_os(STRATEGY_ENV).filter(|v| !v.is_empty());
    let (path, text) = match forced {
        Some(v) => {
            let p = repo.join(v);
            match fs::read_to_string(&p) {
                Ok(t) => (p, t),
                Err(e) => die(&format!(
                    "{cmd}: {STRATEGY_ENV}={} unreadable: {e}",
                    p.display()
                )),
            }
        }
        None => [STRATEGY, STRATEGY_DEFAULT]
            .iter()
            .map(|f| repo.join(f))
            .find_map(|p| fs::read_to_string(&p).ok().map(|t| (p, t)))
            .unwrap_or_else(|| {
                die(&format!(
                    "{cmd}: neither {STRATEGY} nor {STRATEGY_DEFAULT} at the repository root"
                ))
            }),
    };
    eprintln!("{cmd}: bundled plugins per {}", path.display());

    let mut plugins: Vec<Plugin> = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        let mut words = line.split_whitespace();
        let Some(id) = words.next() else { continue };
        let mut on = false;
        for w in words {
            match w {
                "on" => on = true,
                other => die(&format!(
                    "{cmd}: {}:{}: unknown option \"{other}\" (expected: on)",
                    path.display(),
                    n + 1
                )),
            }
        }
        if plugins.iter().any(|p| p.id == id) {
            die(&format!(
                "{cmd}: {}:{}: \"{id}\" listed twice",
                path.display(),
                n + 1
            ));
        }
        let (name, extensions) =
            read_manifest(&repo.join("dist").join(format!("{id}.kdext")), id, cmd);
        plugins.push(Plugin {
            id: id.to_string(),
            on,
            name,
            extensions,
        });
    }
    plugins
}

fn read_manifest(kdext: &Path, id: &str, cmd: &str) -> (String, Vec<String>) {
    let file = fs::File::open(kdext).unwrap_or_else(|_| {
        die(&format!(
            "{cmd}: {} missing — build the shipped plugins first:\n    \
             python build_dist.py --plugins-only",
            kdext.display()
        ))
    });
    let mut text = String::new();
    zip::ZipArchive::new(file)
        .and_then(|mut z| {
            z.by_name("manifest.json")?.read_to_string(&mut text)?;
            Ok(())
        })
        .unwrap_or_else(|e| {
            die(&format!(
                "{cmd}: unreadable manifest.json in {}: {e}",
                kdext.display()
            ))
        });
    let m: Value = serde_json::from_str(&text).unwrap_or_else(|e| {
        die(&format!(
            "{cmd}: invalid manifest.json in {}: {e}",
            kdext.display()
        ))
    });
    if m["id"].as_str() != Some(id) {
        die(&format!(
            "{cmd}: {} declares id {} instead of \"{id}\"",
            kdext.display(),
            m["id"]
        ));
    }
    let name = m["name"].as_str().unwrap_or(id).to_string();
    let extensions = m["extensions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    (name, extensions)
}

/// Copies the retained archives from dist/ to src-tauri/bundled-plugins/
/// (gitignored), from where the installers embed them.
///
/// Both read under `src-tauri/` and not from dist/, for distinct reasons: the
/// `<File>` entries of the WiX fragment are written as
/// `$(sys.SOURCEFILEDIR)..\bundled-plugins\…`, which candle resolves from the
/// .wxs's folder; the `bundle.resources` of the .deb overlay is resolved from
/// the tauri.conf.json folder, where the CLI sits before bundling. The
/// subfolder, for its part, is not cosmetic — `resource_dir()` being the
/// executable's folder, without that level the portable binary launched from
/// dist/ would install *all* the `.kdext` found there.
pub fn stage(repo: &Path, plugins: &[Plugin], cmd: &str) {
    let payload = repo.join("src-tauri/bundled-plugins");
    // Clean slate: a plugin removed from the strategy must not survive into a
    // later installer.
    let _ = fs::remove_dir_all(&payload);
    fs::create_dir_all(&payload)
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot create {}: {e}", payload.display())));
    for p in plugins {
        let kdext = p.archive();
        fs::copy(repo.join("dist").join(&kdext), payload.join(&kdext))
            .unwrap_or_else(|e| die(&format!("{cmd}: cannot copy {kdext}: {e}")));
    }
}

// --------------------------------------------------------------------------- //
// MSI
// --------------------------------------------------------------------------- //

/// Writes `src-tauri/wix/plugins.generated.wxs`, wired in by
/// tauri.msi.conf.json (`fragmentPaths` + `componentGroupRefs`). See the header
/// of src-tauri/wix/installer.wxs for the why of each mechanism.
pub fn write_wix_fragment(repo: &Path, plugins: &[Plugin], cmd: &str) {
    let out = repo.join("src-tauri/wix/plugins.generated.wxs");
    fs::write(&out, wix_fragment(plugins, cmd))
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", out.display())));
}

fn wix_fragment(plugins: &[Plugin], cmd: &str) -> String {
    let exe = format!("[INSTALLDIR]{}.exe", crate::BIN_NAME);
    let mut props = String::new();
    // Folder created even if no plugin is checked: its presence tells
    // `plugins::seed_bundled` that an installer made the choice — without it,
    // the exe would install the embedded plugin (latex-doc) despite the
    // unchecked box.
    let mut files = format!(
        "        <Component Id=\"BundledPluginsFolder\" Guid=\"{}\">\n          \
         <CreateFolder />\n        </Component>\n",
        stable_guid("kroki-desk/bundled-plugins-folder")
    );
    let mut assocs = String::new();
    let mut checkboxes = String::new();
    let mut file_refs = String::from("      <ComponentRef Id=\"BundledPluginsFolder\" />\n");
    let mut assoc_refs = String::new();

    for (i, p) in plugins.iter().enumerate() {
        let (camel, prop) = (p.camel(), p.property());
        let cond = format!("<Condition><![CDATA[{prop} = \"1\"]]></Condition>");
        let value = if p.on { " Value=\"1\"" } else { "" };
        props.push_str(&format!(
            "    <Property Id=\"{prop}\"{value} Secure=\"yes\" />\n"
        ));

        files.push_str(&format!(
            "        <Component Id=\"Kdext{camel}\" Guid=\"*\">\n          {cond}\n          \
             <File Id=\"File{camel}\" KeyPath=\"yes\"\n                \
             Source=\"$(sys.SOURCEFILEDIR)..\\bundled-plugins\\{}\" />\n        </Component>\n",
            p.archive()
        ));
        file_refs.push_str(&format!("      <ComponentRef Id=\"Kdext{camel}\" />\n"));

        if !p.extensions.is_empty() {
            // Registry key as KeyPath: fixed GUID mandatory (no auto-GUID under
            // HKMU), derived from the id to stay stable from one build to the next.
            let progid = format!("KrokiDesk.{camel}");
            let mut values = String::new();
            for ext in &p.extensions {
                values.push_str(&format!(
                    "        <RegistryValue Root=\"HKMU\" Key=\"Software\\Classes\\.{ext}\" Type=\"string\" Value=\"{progid}\" />\n        \
                     <RegistryValue Root=\"HKMU\" Key=\"Software\\Classes\\.{ext}\\OpenWithProgids\"\n                       \
                     Name=\"{progid}\" Type=\"string\" Value=\"\" />\n"
                ));
            }
            assocs.push_str(&format!(
                "      <Component Id=\"Assoc{camel}\" Guid=\"{guid}\">\n        {cond}\n        \
                 <RegistryValue Root=\"HKMU\" Key=\"Software\\Kroki Desk\\FileAssociations\"\n                       \
                 Name=\"plugin-{id}\" Type=\"integer\" Value=\"1\" KeyPath=\"yes\" />\n        \
                 <RegistryKey Root=\"HKMU\" Key=\"Software\\Classes\\{progid}\" ForceDeleteOnUninstall=\"yes\">\n          \
                 <RegistryValue Type=\"string\" Value=\"{name}\" />\n          \
                 <RegistryValue Key=\"DefaultIcon\" Type=\"string\" Value=\"{exe},0\" />\n          \
                 <RegistryValue Key=\"shell\\open\\command\" Type=\"string\"\n                         \
                 Value=\"&quot;{exe}&quot; &quot;%1&quot;\" />\n        </RegistryKey>\n{values}      </Component>\n",
                guid = stable_guid(&format!("kroki-desk/assoc/{}", p.id)),
                id = p.id,
                name = xml_escape(&p.name),
            ));
            assoc_refs.push_str(&format!("      <ComponentRef Id=\"Assoc{camel}\" />\n"));
        }

        checkboxes.push_str(&format!(
            "        <Control Id=\"Cb{camel}\" Type=\"CheckBox\" X=\"28\" Y=\"{y}\" Width=\"320\" Height=\"12\"\n                 \
             Property=\"{prop}\" CheckBoxValue=\"1\"\n                 Text=\"{text}\" />\n",
            y = 92 + 15 * i,
            // No NoPrefix on a CheckBox (CNDL0004): a `&` there would mark a
            // keyboard shortcut, doubled it is displayed as is.
            text = wix_text(&p.name.replace('&', "&&")),
        ));
    }

    let ui = if plugins.is_empty() {
        String::new()
    } else {
        // Fixed 370×270 page (WixUI size): the note takes what remains
        // below the checkboxes, down to the bottom line (Y=234).
        let note_y = 92 + 15 * plugins.len() + 9;
        let note_h = 228usize.saturating_sub(note_y);
        if note_h < 26 {
            die(&format!(
                "{cmd}: too many plugins for the MSI page ({}; 6 at most)",
                plugins.len()
            ));
        }
        format!(
            r#"
    <UI>
      <Dialog Id="PluginDlg" Width="370" Height="270" Title="[ProductName]">
        <Control Id="BannerBitmap" Type="Bitmap" X="0" Y="0" Width="370" Height="44"
                 TabSkip="no" Text="!(loc.InstallDirDlgBannerBitmap)" />
        <Control Id="BannerLine" Type="Line" X="0" Y="44" Width="370" Height="0" />
        <Control Id="BottomLine" Type="Line" X="0" Y="234" Width="370" Height="0" />
        <Control Id="Title" Type="Text" X="15" Y="6" Width="280" Height="15" Transparent="yes"
                 NoPrefix="yes" Text="{{\WixUI_Font_Title}}Plugins" />
        <Control Id="Description" Type="Text" X="25" Y="23" Width="330" Height="15" Transparent="yes"
                 NoPrefix="yes" Text="!(loc.KdPluginDlgDescription)" />

        <Control Id="PluginLabel" Type="Text" X="20" Y="58" Width="330" Height="12" NoPrefix="yes"
                 Text="{{\WixUI_Font_Title}}!(loc.KdPluginDlgHeading)" />
        <Control Id="PluginHint" Type="Text" X="20" Y="72" Width="330" Height="12" NoPrefix="yes"
                 Text="!(loc.KdPluginDlgHint)" />

{checkboxes}
        <Control Id="Note" Type="Text" X="20" Y="{note_y}" Width="330" Height="{note_h}" NoPrefix="yes"
                 Text="!(loc.KdPluginDlgNote)" />

        <Control Id="Back" Type="PushButton" X="180" Y="243" Width="56" Height="17"
                 Text="!(loc.WixUIBack)">
          <Publish Event="NewDialog" Value="InstallDirDlg">1</Publish>
        </Control>
        <Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes"
                 Text="!(loc.WixUINext)">
          <Publish Event="NewDialog" Value="VerifyReadyDlg">1</Publish>
        </Control>
        <Control Id="Cancel" Type="PushButton" X="304" Y="243" Width="56" Height="17" Cancel="yes"
                 Text="!(loc.WixUICancel)">
          <Publish Event="SpawnDialog" Value="CancelDlg">1</Publish>
        </Control>
      </Dialog>

      <Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="PluginDlg"
               Order="5">WIXUI_DONTVALIDATEPATH OR WIXUI_INSTALLDIR_VALID="1"</Publish>
      <Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="PluginDlg"
               Order="5">NOT Installed</Publish>
    </UI>
"#
        )
    };

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by xtask (xtask/src/bundled.rs) from the plugin bundling
     strategy — do not edit, do not commit. -->
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Fragment>

{props}
    <DirectoryRef Id="INSTALLDIR">
      <Directory Id="BundledPluginsDir" Name="bundled-plugins">
{files}      </Directory>
    </DirectoryRef>

    <DirectoryRef Id="TARGETDIR">
{assocs}    </DirectoryRef>

    <ComponentGroup Id="KrokiDeskBundledPlugins">
{file_refs}    </ComponentGroup>

    <ComponentGroup Id="KrokiDeskPluginAssociations">
{assoc_refs}    </ComponentGroup>
{ui}
  </Fragment>
</Wix>
"#
    )
}

/// Deterministic GUID (128-bit FNV-1a over two seeds, RFC 4122 version 5 and
/// variant bits set): stable from one build to the next for the same key.
pub fn stable_guid(key: &str) -> String {
    let fnv = |seed: u64| {
        key.bytes().fold(seed, |h, b| {
            (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3)
        })
    };
    let (a, b) = (fnv(0xcbf2_9ce4_8422_2325), fnv(0x6c62_272e_07bb_0142));
    let a = (a & !0xf000) | 0x5000;
    let b = (b & !(0xc << 60)) | (0x8 << 60);
    format!(
        "{:08X}-{:04X}-{:04X}-{:04X}-{:012X}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xffff,
        b >> 48,
        b & 0xffff_ffff_ffff
    )
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// WiX control text: XML-escaped, with `[`/`]` neutralized — they are property
/// references for the MSI engine.
fn wix_text(s: &str) -> String {
    xml_escape(s)
        .chars()
        .map(|c| match c {
            '[' => "[\\[]".to_string(),
            ']' => "[\\]]".to_string(),
            c => c.to_string(),
        })
        .collect()
}

// --------------------------------------------------------------------------- //
// .deb
// --------------------------------------------------------------------------- //

/// Writes the complete .deb overlay (`src-tauri/tauri.deb.generated.json`) and
/// the shared-mime-info package (`src-tauri/linux/kroki-desk.generated.xml`);
/// returns the overlay's path, to pass to `tauri build --config`.
///
/// The overlay is the tracked `tauri.deb.conf.json` completed, not a second
/// overlay: merging Tauri configurations replaces arrays instead of
/// concatenating them, so a partial `fileAssociations` would erase those of the
/// native formats.
///
/// With no selection page possible (see CLAUDE.md § "Debian/Ubuntu package
/// (.deb)"), the choice is expressed by the destination: `on` plugins go in
/// `bundled-plugins/` (installed at first launch by
/// `plugins::seed_bundled`), the others in `example-plugins/`, which nothing
/// reads. Only the former get associations.
pub fn write_deb_overlay(repo: &Path, plugins: &[Plugin], cmd: &str) -> PathBuf {
    let tauri = repo.join("src-tauri");
    let base = tauri.join("tauri.deb.conf.json");
    let mut conf: Value = fs::read_to_string(&base)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| die(&format!("{cmd}: {} unreadable", base.display())));

    let mut resources = serde_json::Map::new();
    let mut own_types = String::new();
    let assocs = conf["bundle"]["fileAssociations"]
        .as_array_mut()
        .unwrap_or_else(|| {
            die(&format!(
                "{cmd}: bundle.fileAssociations missing from {}",
                base.display()
            ))
        });
    for p in plugins {
        let dest = if p.on {
            "bundled-plugins"
        } else {
            "example-plugins"
        };
        resources.insert(
            format!("bundled-plugins/{}", p.archive()),
            json!(format!("{dest}/{}", p.archive())),
        );
        if !p.on {
            continue;
        }
        for ext in &p.extensions {
            let mime = match STANDARD_MIME.iter().find(|(e, _)| e == ext) {
                Some((_, m)) => m.to_string(),
                None => {
                    let m = format!("text/x-kroki-desk-{ext}");
                    own_types.push_str(&format!(
                        "\n  <mime-type type=\"{m}\">\n    <comment>{name}</comment>\n    \
                         <sub-class-of type=\"text/plain\"/>\n    <glob pattern=\"*.{ext}\"/>\n    \
                         <icon name=\"kroki_deskapp\"/>\n  </mime-type>\n",
                        name = xml_escape(&p.name)
                    ));
                    m
                }
            };
            assocs.push(json!({ "ext": [ext], "name": p.name, "mimeType": mime }));
        }
    }
    conf["bundle"]["resources"] = Value::Object(resources);

    // MIME package: the tracked one (native formats) + the plugins' own types.
    let mime_base = tauri.join("linux/kroki-desk.xml");
    let xml = fs::read_to_string(&mime_base)
        .unwrap_or_else(|e| die(&format!("{cmd}: {} unreadable: {e}", mime_base.display())));
    let close = xml.rfind("</mime-info>").unwrap_or_else(|| {
        die(&format!(
            "{cmd}: </mime-info> missing from {}",
            mime_base.display()
        ))
    });
    let generated = format!(
        "{}  <!-- Own types of the bundled plugins, generated by xtask (bundled.rs). -->\n{own_types}\n{}",
        &xml[..close],
        &xml[close..]
    );
    let mime_out = tauri.join("linux/kroki-desk.generated.xml");
    fs::write(&mime_out, generated)
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", mime_out.display())));
    conf["bundle"]["linux"]["deb"]["files"]["/usr/share/mime/packages/kroki-desk.xml"] =
        json!("linux/kroki-desk.generated.xml");

    let out = tauri.join("tauri.deb.generated.json");
    let text = serde_json::to_string_pretty(&conf).expect("serializing the .deb overlay");
    fs::write(&out, text + "\n")
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", out.display())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiants_derives_de_l_id() {
        let p = Plugin {
            id: "latex-doc".into(),
            on: true,
            name: "x".into(),
            extensions: vec![],
        };
        assert_eq!(p.camel(), "LatexDoc");
        assert_eq!(p.property(), "PLUGIN_LATEX_DOC");
    }

    #[test]
    fn guid_stable_et_bien_forme() {
        let g = stable_guid("kroki-desk/assoc/latex-doc");
        assert_eq!(g, stable_guid("kroki-desk/assoc/latex-doc"));
        assert_ne!(g, stable_guid("kroki-desk/assoc/csv-tables"));
        assert_eq!(g.len(), 36);
        assert_eq!(&g[14..15], "5");
        assert!(matches!(&g[19..20], "8" | "9" | "A" | "B"));
    }

    #[test]
    fn crochets_neutralises_dans_les_textes_wix() {
        assert_eq!(wix_text("a [b] & c"), "a [\\[]b[\\]] &amp; c");
    }
}
