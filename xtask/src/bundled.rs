//! Stratégie d'embarquement des plugins dans les installeurs (MSI, .deb).
//!
//! Source : `bundled-plugins.txt` à la racine du dépôt (gitignoré — la
//! sélection propre à un poste ou à une distribution), sinon
//! `bundled-plugins.default.txt` (suivi — le comportement par défaut). La
//! variable d'environnement `KROKI_BUNDLED_PLUGINS` (chemin relatif à la racine
//! du dépôt, ou absolu) court-circuite ce choix : c'est par elle que
//! `build_dist.py --channel` impose la stratégie d'un canal de distribution,
//! quel que soit le fichier local présent. Une ligne par plugin, dans l'ordre d'affichage de la page du MSI :
//!
//! ```text
//! # commentaire
//! latex-doc  on      ← coché (MSI) / installé au premier lancement (.deb)
//! csv-tables         ← embarqué, décoché / simplement posé à côté
//! ```
//!
//! Tout le reste est lu dans le `manifest.json` de chaque archive
//! `dist/<id>.kdext` — et non dans `plugins/<id>/`, qui peut être une jonction
//! vers un autre dépôt, irrésoluble dans le conteneur du build .deb. Le nom
//! affiché vient de `name`, les associations de fichiers de `extensions`.
//!
//! Trois sorties, toutes gitignorées et régénérées à chaque build :
//! - `src-tauri/bundled-plugins/` : les archives retenues (cf. `stage`) ;
//! - `src-tauri/wix/plugins.generated.wxs` : propriétés `PLUGIN_*`, composants
//!   des archives et de leurs associations, page de sélection (cf. `wix_fragment`) ;
//! - `src-tauri/tauri.deb.generated.json` + `src-tauri/linux/kroki-desk.generated.xml` :
//!   l'overlay .deb complet et le paquet shared-mime-info (cf. `deb_overlay`).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::die;

const STRATEGY: &str = "bundled-plugins.txt";
const STRATEGY_DEFAULT: &str = "bundled-plugins.default.txt";
const STRATEGY_ENV: &str = "KROKI_BUNDLED_PLUGINS";

/// Extensions dont le type MIME existe déjà dans la base freedesktop : un
/// plugin qui les lit s'y associe sous ce type. Toute autre extension reçoit un
/// type propre à Kroki Desk (`text/x-kroki-desk-<ext>`), généré dans le paquet
/// shared-mime-info. Une extension standard absente de cette table recevrait à
/// tort un type propre qui supplanterait le sien : la compléter au besoin.
const STANDARD_MIME: &[(&str, &str)] = &[
    ("tex", "text/x-tex"),
    ("latex", "text/x-tex"),
    ("ltx", "text/x-tex"),
    ("csv", "text/csv"),
    ("tsv", "text/tab-separated-values"),
];

pub struct Plugin {
    pub id: String,
    /// Coché par défaut (MSI) / installé au premier lancement (.deb).
    pub on: bool,
    pub name: String,
    /// Extensions servies, sans point, en minuscules.
    pub extensions: Vec<String>,
}

impl Plugin {
    fn archive(&self) -> String {
        format!("{}.kdext", self.id)
    }
    /// `latex-doc` → `LatexDoc` : identifiants WiX et ProgID.
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
    /// `latex-doc` → `PLUGIN_LATEX_DOC` : propriété publique du MSI.
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

/// Lit la stratégie et les manifestes des archives de dist/.
pub fn load(repo: &Path, cmd: &str) -> Vec<Plugin> {
    // Imposée, la stratégie doit exister : retomber sur un autre fichier
    // embarquerait en silence les plugins d'un autre canal.
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

/// Recopie les archives retenues de dist/ vers src-tauri/bundled-plugins/
/// (gitignoré), d'où les installeurs les embarquent.
///
/// Les deux lisent sous `src-tauri/` et non dans dist/, pour des raisons
/// distinctes : les `<File>` du fragment WiX sont écrits en
/// `$(sys.SOURCEFILEDIR)..\bundled-plugins\…`, que candle résout depuis le
/// dossier du .wxs ; le `bundle.resources` de l'overlay .deb est résolu depuis le
/// dossier de tauri.conf.json, où le CLI se place avant de bundler. Le
/// sous-dossier, lui, n'est pas cosmétique — `resource_dir()` étant le dossier
/// de l'exécutable, sans ce niveau le binaire portable lancé depuis dist/
/// installerait *tous* les `.kdext` qui s'y trouvent.
pub fn stage(repo: &Path, plugins: &[Plugin], cmd: &str) {
    let payload = repo.join("src-tauri/bundled-plugins");
    // Table rase : un plugin retiré de la stratégie ne doit pas survivre dans
    // un installeur ultérieur.
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

/// Écrit `src-tauri/wix/plugins.generated.wxs`, branché par
/// tauri.msi.conf.json (`fragmentPaths` + `componentGroupRefs`). Cf. l'en-tête
/// de src-tauri/wix/installer.wxs pour le pourquoi de chaque mécanisme.
pub fn write_wix_fragment(repo: &Path, plugins: &[Plugin], cmd: &str) {
    let out = repo.join("src-tauri/wix/plugins.generated.wxs");
    fs::write(&out, wix_fragment(plugins, cmd))
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", out.display())));
}

fn wix_fragment(plugins: &[Plugin], cmd: &str) -> String {
    let exe = format!("[INSTALLDIR]{}.exe", crate::BIN_NAME);
    let mut props = String::new();
    // Dossier créé même si aucun plugin n'est coché : sa présence dit à
    // `plugins::seed_bundled` qu'un installeur a choisi — sans lui, l'exe
    // installerait le plugin embarqué (latex-doc) malgré la case décochée.
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
            // Clé de registre en KeyPath : GUID fixe obligatoire (pas d'auto-GUID
            // sous HKMU), dérivé de l'id pour rester stable d'un build à l'autre.
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
            // Pas de NoPrefix sur une CheckBox (CNDL0004) : un `&` y
            // marquerait un raccourci clavier, doublé il s'affiche tel quel.
            text = wix_text(&p.name.replace('&', "&&")),
        ));
    }

    let ui = if plugins.is_empty() {
        String::new()
    } else {
        // Page fixe de 370×270 (taille WixUI) : la note occupe ce qui reste
        // sous les cases, jusqu'à la ligne du bas (Y=234).
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
<!-- Généré par xtask (xtask/src/bundled.rs) depuis la stratégie d'embarquement
     des plugins — ne pas éditer, ne pas committer. -->
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

/// GUID déterministe (FNV-1a 128 bits sur deux graines, bits de version 5 et
/// de variante RFC 4122 posés) : stable d'un build à l'autre pour une même clé.
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

/// Texte de contrôle WiX : XML échappé, et `[`/`]` neutralisés — ce sont des
/// références de propriété pour le moteur MSI.
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

/// Écrit l'overlay .deb complet (`src-tauri/tauri.deb.generated.json`) et le
/// paquet shared-mime-info (`src-tauri/linux/kroki-desk.generated.xml`) ;
/// renvoie le chemin de l'overlay, à passer à `tauri build --config`.
///
/// L'overlay est le suivi `tauri.deb.conf.json` complété, et non un second
/// overlay : la fusion des configurations Tauri remplace les tableaux au lieu
/// de les concaténer, un `fileAssociations` partiel effacerait ceux des
/// formats natifs.
///
/// Sans page de sélection possible (cf. CLAUDE.md § « Paquet Debian/Ubuntu »),
/// le choix se rend par la destination : les plugins `on` dans
/// `bundled-plugins/` (installés au premier lancement par
/// `plugins::seed_bundled`), les autres dans `example-plugins/`, que rien ne
/// lit. Seuls les premiers reçoivent des associations.
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

    // Paquet MIME : le suivi (formats natifs) + les types propres des plugins.
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
        "{}  <!-- Types propres des plugins embarqués, générés par xtask (bundled.rs). -->\n{own_types}\n{}",
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
