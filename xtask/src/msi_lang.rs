//! MSI multilingue : **un seul** `.msi` qui s'affiche dans la langue de
//! l'interface Windows.
//!
//! Tauri sait produire un MSI par langue (`wix.language` de
//! tauri.msi.conf.json, un passage de `light` par langue avec son `.wxl`).
//! On garde l'anglais comme base et on y **embarque** la différence vers
//! chaque autre langue :
//!
//! 1. `torch -t language base.msi fr.msi` → transform `.mst` ;
//! 2. la transform entre dans la table `_Storages` du MSI de base, sous le nom
//!    décimal de son LCID (`1036`) — la base reçoit aussi la sienne (`1033`,
//!    quasi vide), cible explicite du choix de l'anglais ;
//! 3. la propriété *Template* du résumé liste toutes les langues
//!    (`x64;1033,1036`).
//!
//! Au lancement, Windows Installer applique de lui-même la transform dont le
//! LCID correspond à la langue d'**interface** de l'utilisateur (pas aux formats
//! régionaux) ; `msiexec /i … ProductLanguage=1033` impose un autre choix.
//! `TRANSFORMS=:1033` ne le fait **pas** : la transform choisie par Windows est
//! appliquée d'abord, celles de TRANSFORMS par-dessus. Le mécanisme n'est
//! pas documenté formellement par Microsoft, mais il est stable et largement
//! employé.
//!
//! Prérequis vérifié ici : les MSI d'un même build partagent leur ProductCode.
//! Ce n'est pas acquis : `light`, qui résout `Product Id="*"`, tourne une fois
//! par langue — d'où `TAURI_KROKI_DESK_PRODUCT_CODE`, tiré par `build_msi` et lu par
//! src-tauri/wix/main.wxs. Une transform qui changerait le ProductCode ferait
//! de chaque langue un produit distinct et casserait la mise à jour.
//!
//! `msi.dll` est appelée directement (crate `windows`) : les scripts du SDK
//! (`WiSubStg.vbs`, `WiLangId.vbs`) sont rarement installés, et VBScript est en
//! voie de retrait de Windows.

use std::path::{Path, PathBuf};
use std::process::Command;

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::ApplicationInstallationAndServicing::{
    MsiCloseHandle, MsiCreateRecord, MsiDatabaseCommit, MsiDatabaseOpenViewW,
    MsiGetSummaryInformationW, MsiOpenDatabaseW, MsiRecordGetStringW, MsiRecordSetStreamW,
    MsiRecordSetStringW, MsiSummaryInfoGetPropertyW, MsiSummaryInfoPersist,
    MsiSummaryInfoSetPropertyW, MsiViewExecute, MsiViewFetch, MsiViewModify, MSIDBOPEN_READONLY,
    MSIDBOPEN_TRANSACT, MSIHANDLE, MSIMODIFY_ASSIGN,
};

use crate::die;

/// Langue d'un MSI produit par Tauri : suffixe du fichier et LCID.
pub struct Lang {
    pub tag: &'static str,
    pub lcid: u32,
}

/// Base du MSI final : la langue de repli, appliquée quand aucune transform ne
/// correspond à l'interface de l'utilisateur.
pub const BASE: Lang = Lang {
    tag: "en-US",
    lcid: 1033,
};

/// Langues embarquées en transforms — miroir des clés de `wix.language` dans
/// tauri.msi.conf.json, hors base.
pub const OTHERS: &[Lang] = &[Lang {
    tag: "fr-FR",
    lcid: 1036,
}];

const PID_TEMPLATE: u32 = 7;
const VT_LPSTR: u32 = 30;
const ERROR_SUCCESS: u32 = 0;

/// Fusionne les MSI par langue de `bundle_dir` (version `version`) en un MSI
/// multilingue, écrit à côté, dont le chemin est renvoyé.
pub fn merge(bundle_dir: &Path, version: &str, find: impl Fn(&str) -> PathBuf) -> PathBuf {
    let base = find(&format!("_{}.msi", BASE.tag));
    let base_code = product_code(&base);
    let out = bundle_dir.join(format!("{}-{version}-multilingual.msi", crate::BIN_NAME));
    std::fs::copy(&base, &out).unwrap_or_else(|e| {
        die(&format!(
            "build-msi : copie de {} impossible : {e}",
            base.display()
        ))
    });

    let torch = torch_exe();
    let transform = |target: &Path, lcid: u32, label: &str| {
        let mst = bundle_dir.join(format!("{lcid}.mst"));
        crate::run_or_die(
            Command::new(&torch)
                .args(["-nologo", "-t", "language"])
                .arg(&base)
                .arg(target)
                .arg("-out")
                .arg(&mst),
            &format!("build-msi : torch {label}"),
        );
        embed_transform(&out, &lcid.to_string(), &mst);
        let _ = std::fs::remove_file(&mst);
    };

    // La base aussi a sa transform : le choix `ProductLanguage=1033` désigne
    // ainsi une transform existante, comme celui de chaque autre langue (vérifié
    // à la main : il force l'anglais sur un Windows français). torch refuse deux bases
    // identiques : la copie porte une propriété de plus, inerte, qui est toute
    // la différence.
    let tagged = bundle_dir.join(format!("{}.msi", BASE.lcid));
    std::fs::copy(&base, &tagged).unwrap_or_else(|e| {
        die(&format!(
            "build-msi : copie de {} impossible : {e}",
            base.display()
        ))
    });
    add_property(
        &tagged,
        "KrokiDeskInstallerLanguage",
        &BASE.lcid.to_string(),
    );
    transform(&tagged, BASE.lcid, &format!("{} (base)", BASE.tag));
    let _ = std::fs::remove_file(&tagged);

    let mut lcids = vec![BASE.lcid.to_string()];
    for lang in OTHERS {
        let localized = find(&format!("_{}.msi", lang.tag));
        let code = product_code(&localized);
        if code != base_code {
            die(&format!(
                "build-msi : ProductCode différent entre {} ({base_code}) et {} ({code}) — \
                 une transform de langue ne peut pas changer l'identité du produit",
                base.display(),
                localized.display()
            ));
        }
        transform(
            &localized,
            lang.lcid,
            &format!("{} → {}", BASE.tag, lang.tag),
        );
        lcids.push(lang.lcid.to_string());
    }
    set_languages(&out, &lcids);
    eprintln!(
        "xtask : MSI multilingue ({}) → {}",
        lcids.join(", "),
        out.display()
    );
    out
}

/// `torch.exe` du WiX 3 que Tauri télécharge (`%LOCALAPPDATA%\tauri\WixTools314`).
fn torch_exe() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| die("build-msi : LOCALAPPDATA non défini"));
    let torch = base.join("tauri").join("WixTools314").join("torch.exe");
    if !torch.is_file() {
        die(&format!(
            "build-msi : {} introuvable (WiX 3 téléchargé par tauri build)",
            torch.display()
        ));
    }
    torch
}

/// Poignée MSI fermée à la sortie de portée.
struct Handle(MSIHANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        if self.0 .0 != 0 {
            unsafe {
                MsiCloseHandle(self.0);
            }
        }
    }
}

fn check(rc: u32, what: &str) {
    if rc != ERROR_SUCCESS {
        die(&format!("build-msi : {what} (msi.dll, code {rc})"));
    }
}

fn open(path: &Path, mode: PCWSTR) -> Handle {
    let mut h = MSIHANDLE(0);
    let rc = unsafe { MsiOpenDatabaseW(&HSTRING::from(path.as_os_str()), mode, &mut h) };
    check(rc, &format!("ouverture de {}", path.display()));
    Handle(h)
}

fn view(db: &Handle, query: &str) -> Handle {
    let mut h = MSIHANDLE(0);
    let rc = unsafe { MsiDatabaseOpenViewW(db.0, &HSTRING::from(query), &mut h) };
    check(rc, query);
    let rc = unsafe { MsiViewExecute(h, MSIHANDLE(0)) };
    check(rc, query);
    Handle(h)
}

/// Lit le champ texte `field` d'un enregistrement.
fn record_string(rec: &Handle, field: u32) -> String {
    let mut len = 0u32;
    let mut empty = [0u16; 1];
    // Premier appel : longueur (ERROR_MORE_DATA attendu), sans le zéro final.
    unsafe {
        MsiRecordGetStringW(
            rec.0,
            field,
            Some(PWSTR(empty.as_mut_ptr())),
            Some(&mut len),
        )
    };
    let mut buf = vec![0u16; len as usize + 1];
    len += 1;
    let rc =
        unsafe { MsiRecordGetStringW(rec.0, field, Some(PWSTR(buf.as_mut_ptr())), Some(&mut len)) };
    check(rc, "lecture d'un enregistrement");
    String::from_utf16_lossy(&buf[..len as usize])
}

fn product_code(msi: &Path) -> String {
    let db = open(msi, MSIDBOPEN_READONLY);
    let v = view(
        &db,
        "SELECT `Value` FROM `Property` WHERE `Property`='ProductCode'",
    );
    let mut rec = MSIHANDLE(0);
    let rc = unsafe { MsiViewFetch(v.0, &mut rec) };
    check(rc, &format!("ProductCode de {}", msi.display()));
    record_string(&Handle(rec), 1)
}

/// Ajoute la propriété `name` = `value` à la table `Property` de `msi`.
fn add_property(msi: &Path, name: &str, value: &str) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let v = view(&db, "SELECT `Property`, `Value` FROM `Property`");
        let rec = Handle(unsafe { MsiCreateRecord(2) });
        check(
            unsafe { MsiRecordSetStringW(rec.0, 1, &HSTRING::from(name)) },
            "nom de la propriété",
        );
        check(
            unsafe { MsiRecordSetStringW(rec.0, 2, &HSTRING::from(value)) },
            "valeur de la propriété",
        );
        check(
            unsafe { MsiViewModify(v.0, MSIMODIFY_ASSIGN, rec.0) },
            &format!("ajout de la propriété {name}"),
        );
    }
    check(unsafe { MsiDatabaseCommit(db.0) }, "commit de la propriété");
}

/// Ajoute `mst` à la table `_Storages` de `msi` sous le nom `name`.
fn embed_transform(msi: &Path, name: &str, mst: &Path) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let v = view(&db, "SELECT `Name`, `Data` FROM `_Storages`");
        let rec = Handle(unsafe { MsiCreateRecord(2) });
        check(
            unsafe { MsiRecordSetStringW(rec.0, 1, &HSTRING::from(name)) },
            "nom de la transform",
        );
        check(
            unsafe { MsiRecordSetStreamW(rec.0, 2, &HSTRING::from(mst.as_os_str())) },
            &format!("lecture de {}", mst.display()),
        );
        check(
            unsafe { MsiViewModify(v.0, MSIMODIFY_ASSIGN, rec.0) },
            &format!("insertion de la transform {name}"),
        );
    }
    check(unsafe { MsiDatabaseCommit(db.0) }, "commit de la transform");
}

/// *Template* du résumé : plateforme d'origine conservée, langues remplacées
/// (`x64;1033,1036`).
fn set_languages(msi: &Path, lcids: &[String]) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let mut si = MSIHANDLE(0);
        check(
            unsafe { MsiGetSummaryInformationW(db.0, PCWSTR::null(), 1, &mut si) },
            "ouverture du résumé",
        );
        let si = Handle(si);
        let (mut kind, mut int) = (0u32, 0i32);
        let mut buf = vec![0u16; 256];
        let mut len = buf.len() as u32;
        check(
            unsafe {
                MsiSummaryInfoGetPropertyW(
                    si.0,
                    PID_TEMPLATE,
                    &mut kind,
                    &mut int,
                    None,
                    Some(PWSTR(buf.as_mut_ptr())),
                    Some(&mut len),
                )
            },
            "lecture du Template",
        );
        let template = String::from_utf16_lossy(&buf[..len as usize]);
        let platform = template.split(';').next().unwrap_or("x64");
        let value = format!("{platform};{}", lcids.join(","));
        check(
            unsafe {
                MsiSummaryInfoSetPropertyW(
                    si.0,
                    PID_TEMPLATE,
                    VT_LPSTR,
                    0,
                    std::ptr::null_mut(),
                    &HSTRING::from(value.as_str()),
                )
            },
            "écriture du Template",
        );
        check(
            unsafe { MsiSummaryInfoPersist(si.0) },
            "enregistrement du résumé",
        );
    }
    check(unsafe { MsiDatabaseCommit(db.0) }, "commit du résumé");
}
