//! Multilingual MSI: **a single** `.msi` that displays in the Windows
//! display language.
//!
//! `tauri build` only produces the English base (`wix.language` in
//! tauri.msi.conf.json lists en-US alone): its loop runs one `light` pass per
//! language **sequentially**, each a full 44 MB cab compression plus ICE
//! validation, and cannot be parallelized (shared `locale.wxl`/`output.msi`).
//! `build_localized` then links the other languages itself, **in parallel**,
//! from the `.wixobj` that Tauri's `candle` left in `target/release/wix/x64/`,
//! with `-sval` (ICE validated once, on the base) and `-dcl:none` (stored
//! cab): those MSIs only feed `torch`, which diffs tables — their cab never
//! reaches the final MSI. We keep English as the base and **embed** the
//! difference to every other language into it:
//!
//! 1. `torch -t language base.msi fr.msi` → `.mst` transform;
//! 2. the transform goes into the base MSI's `_Storages` table, under the
//!    decimal name of its LCID (`1036`) — the base also gets its own (`1033`,
//!    nearly empty), the explicit target of the English choice;
//! 3. the summary's *Template* property lists all the languages
//!    (`x64;1033,1036`).
//!
//! At launch, Windows Installer applies by itself the transform whose LCID
//! matches the user's **display** language (not the regional formats);
//! `msiexec /i … ProductLanguage=1033` forces another choice.
//! `TRANSFORMS=:1033` does **not**: the transform chosen by Windows is
//! applied first, those of TRANSFORMS on top. The mechanism is not formally
//! documented by Microsoft, but it is stable and widely used.
//!
//! Prerequisite checked here: the MSIs of one build share their ProductCode.
//! This is not a given: `light`, which resolves `Product Id="*"`, runs once
//! per language — hence `TAURI_KROKI_DESK_PRODUCT_CODE`, drawn by `build_msi`
//! and read by src-tauri/wix/main.wxs. A transform that changed the ProductCode
//! would make each language a distinct product and break the upgrade.
//!
//! `msi.dll` is called directly (`windows` crate): the SDK scripts
//! (`WiSubStg.vbs`, `WiLangId.vbs`) are rarely installed, and VBScript is being
//! removed from Windows.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::ApplicationInstallationAndServicing::{
    MsiCloseHandle, MsiCreateRecord, MsiDatabaseCommit, MsiDatabaseOpenViewW,
    MsiGetSummaryInformationW, MsiOpenDatabaseW, MsiRecordGetStringW, MsiRecordSetStreamW,
    MsiRecordSetStringW, MsiSummaryInfoGetPropertyW, MsiSummaryInfoPersist,
    MsiSummaryInfoSetPropertyW, MsiViewExecute, MsiViewFetch, MsiViewModify, MSIDBOPEN_READONLY,
    MSIDBOPEN_TRANSACT, MSIHANDLE, MSIMODIFY_ASSIGN,
};

use crate::die;

/// Language of a per-language MSI: file suffix, LCID and database codepage
/// (values of tauri-bundler's `languages.json`, injected into the `.wxl` as
/// `TauriLanguage`/`TauriCodepage`, read by main.wxs).
pub struct Lang {
    pub tag: &'static str,
    pub lcid: u32,
    pub codepage: u32,
}

/// Base of the final MSI: the fallback language, applied when no transform
/// matches the user's display language.
pub const BASE: Lang = Lang {
    tag: "en-US",
    lcid: 1033,
    codepage: 1252,
};

/// Languages embedded as transforms, base excluded — linked by
/// `build_localized` from `src-tauri/wix/locales/<tag>.wxl`. The CJK languages change the database
/// codepage (932, 936, 949): `torch -t language` marks their transform as
/// suppressing the `ChangeCodepage` error, which is enough for Windows
/// Installer (prototype validated on 2026-10-19 — texts re-read identical to
/// the native MSI).
pub const OTHERS: &[Lang] = &[
    Lang {
        tag: "de-DE",
        lcid: 1031,
        codepage: 1252,
    },
    Lang {
        tag: "es-ES",
        lcid: 3082,
        codepage: 1252,
    },
    Lang {
        tag: "fr-FR",
        lcid: 1036,
        codepage: 1252,
    },
    Lang {
        tag: "it-IT",
        lcid: 1040,
        codepage: 1252,
    },
    Lang {
        tag: "ja-JP",
        lcid: 1041,
        codepage: 932,
    },
    Lang {
        tag: "ko-KR",
        lcid: 1042,
        codepage: 949,
    },
    Lang {
        tag: "pt-BR",
        lcid: 1046,
        codepage: 1252,
    },
    Lang {
        tag: "zh-CN",
        lcid: 2052,
        codepage: 936,
    },
];

/// Links the MSI of every `OTHERS` language in parallel, next to the base
/// `base` produced by `tauri build` (same name, `_<tag>.msi` instead of
/// `_en-US.msi`), from the `.wixobj` of `wix_dir`. `locales` = folder of the
/// `.wxl`, `sources` = folders of the `.wxs` (scanned for WiX extensions).
pub fn build_localized(wix_dir: &Path, locales: &Path, sources: &[&Path], base: &Path) {
    let tools = wix_tools();
    let light = tools.join("light.exe");
    let extensions = wix_extensions(&tools, wix_dir, sources);
    let base_name = base
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let stem = base_name
        .strip_suffix(&format!("_{}.msi", BASE.tag))
        .unwrap_or_else(|| {
            die(&format!(
                "build-msi: {} does not end with _{}.msi",
                base.display(),
                BASE.tag
            ))
        });
    let dir = base.parent().unwrap_or(Path::new("."));

    let start = Instant::now();
    let results: Vec<(&Lang, Result<Duration, String>)> = std::thread::scope(|s| {
        let handles: Vec<_> = OTHERS
            .iter()
            .map(|lang| {
                let out = dir.join(format!("{stem}_{}.msi", lang.tag));
                let (light, extensions) = (&light, &extensions);
                (
                    lang,
                    s.spawn(move || link(light, extensions, wix_dir, locales, lang, &out)),
                )
            })
            .collect();
        handles
            .into_iter()
            .map(|(lang, h)| {
                let r = h
                    .join()
                    .unwrap_or_else(|_| Err("link thread panicked".into()));
                (lang, r)
            })
            .collect()
    });

    let mut failed = false;
    for (lang, r) in &results {
        match r {
            Ok(d) => eprintln!("xtask: light {} ({:.1} s)", lang.tag, d.as_secs_f64()),
            Err(e) => {
                failed = true;
                eprintln!("build-msi: light {} failed:\n{e}", lang.tag);
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
    eprintln!(
        "xtask: {} localized MSIs linked in parallel in {:.1} s",
        OTHERS.len(),
        start.elapsed().as_secs_f64()
    );
}

/// One `light` pass: same arguments as tauri-bundler (`-cultures`, `-loc`,
/// `-ext`, `*.wixobj` expanded by light, cleared environment), plus `-sval`
/// `-dcl:none` `-spdb` (see the module comment). Own `.wxl` and output per
/// language: the passes share only the `.wixobj`, read-only.
fn link(
    light: &Path,
    extensions: &[PathBuf],
    wix_dir: &Path,
    locales: &Path,
    lang: &Lang,
    out: &Path,
) -> Result<Duration, String> {
    let src = locales.join(format!("{}.wxl", lang.tag));
    let text =
        std::fs::read_to_string(&src).map_err(|e| format!("cannot read {}: {e}", src.display()))?;
    let loc = wix_dir.join(format!("locale-{}.wxl", lang.tag));
    std::fs::write(&loc, localize(&text, lang)?)
        .map_err(|e| format!("cannot write {}: {e}", loc.display()))?;

    let mut cmd = Command::new(light);
    for ext in extensions {
        cmd.arg("-ext").arg(ext);
    }
    cmd.arg("-nologo")
        .arg("-o")
        .arg(out)
        .arg(format!("-cultures:{};en-US", lang.tag.to_lowercase()))
        .arg("-loc")
        .arg(&loc)
        .args(["-sval", "-dcl:none", "-spdb", "*.wixobj"])
        .current_dir(wix_dir);
    // Same environment as tauri-bundler's `clear_env_for_wix`.
    cmd.env_clear();
    for (k, v) in std::env::vars_os() {
        let k = k.to_ascii_uppercase();
        let name = k.to_string_lossy();
        if ["SYSTEMROOT", "TMP", "TEMP"].contains(&name.as_ref()) || name.starts_with("TAURI") {
            cmd.env(&k, v);
        }
    }

    let t = Instant::now();
    let output = cmd.output();
    let _ = std::fs::remove_file(&loc);
    let output = output.map_err(|e| format!("cannot launch {}: {e}", light.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{}{}{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(t.elapsed())
}

/// Completes a `.wxl` like tauri-bundler does: `TauriLanguage`/`TauriCodepage`
/// added if absent. Its other default strings (`LaunchApp`…) must already be
/// there — ours redefine them translated; a missing one is an error rather
/// than an English text substituted silently.
fn localize(wxl: &str, lang: &Lang) -> Result<String, String> {
    for id in [
        "LaunchApp",
        "DowngradeErrorMessage",
        "PathEnvVarFeature",
        "InstallAppFeature",
    ] {
        if !wxl.contains(&format!("Id=\"{id}\"")) {
            return Err(format!("{}.wxl lacks the string {id}", lang.tag));
        }
    }
    let mut extra = String::new();
    for (id, value) in [
        ("TauriLanguage", lang.lcid),
        ("TauriCodepage", lang.codepage),
    ] {
        if !wxl.contains(&format!("Id=\"{id}\"")) {
            extra.push_str(&format!("  <String Id=\"{id}\">{value}</String>\n"));
        }
    }
    if !wxl.contains("</WixLocalization>") {
        return Err(format!("{}.wxl: no </WixLocalization>", lang.tag));
    }
    Ok(wxl.replacen(
        "</WixLocalization>",
        &format!("{extra}</WixLocalization>"),
        1,
    ))
}

/// `-ext` of tauri-bundler: WixUI + WixUtil, plus `Wix<Name>.dll` for every
/// `"http://schemas.microsoft.com/wix/<Name>"` namespace of the `.wxs`.
fn wix_extensions(tools: &Path, wix_dir: &Path, sources: &[&Path]) -> Vec<PathBuf> {
    let mut names = vec!["UIExtension".to_string(), "UtilExtension".to_string()];
    const NS: &str = "\"http://schemas.microsoft.com/wix/";
    for dir in std::iter::once(wix_dir).chain(sources.iter().copied()) {
        let files = std::fs::read_dir(dir).into_iter().flatten().flatten();
        for path in files.map(|e| e.path()) {
            if path.extension().is_none_or(|e| e != "wxs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            for (i, _) in text.match_indices(NS) {
                let rest = &text[i + NS.len()..];
                let end = rest
                    .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .unwrap_or(rest.len());
                if end > 0
                    && rest[end..].starts_with('"')
                    && !names.iter().any(|n| n == &rest[..end])
                {
                    names.push(rest[..end].to_string());
                }
            }
        }
    }
    names
        .iter()
        .map(|n| tools.join(format!("Wix{n}.dll")))
        .collect()
}

const PID_TEMPLATE: u32 = 7;
const VT_LPSTR: u32 = 30;
const ERROR_SUCCESS: u32 = 0;

/// Merges the per-language MSIs of `bundle_dir` (version `version`) into a
/// multilingual MSI, written alongside, whose path is returned.
pub fn merge(bundle_dir: &Path, version: &str, find: impl Fn(&str) -> PathBuf) -> PathBuf {
    let base = find(&format!("_{}.msi", BASE.tag));
    let base_code = product_code(&base);
    let out = bundle_dir.join(format!("{}-{version}-multilingual.msi", crate::BIN_NAME));
    std::fs::copy(&base, &out)
        .unwrap_or_else(|e| die(&format!("build-msi: cannot copy {}: {e}", base.display())));

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
            &format!("build-msi: torch {label}"),
        );
        embed_transform(&out, &lcid.to_string(), &mst);
        let _ = std::fs::remove_file(&mst);
    };

    // The base has its transform too: the `ProductLanguage=1033` choice thus
    // names an existing transform, like that of every other language (checked
    // by hand: it forces English on a French Windows). torch refuses two
    // identical databases: the copy carries one extra, inert property, which is
    // the whole difference.
    let tagged = bundle_dir.join(format!("{}.msi", BASE.lcid));
    std::fs::copy(&base, &tagged)
        .unwrap_or_else(|e| die(&format!("build-msi: cannot copy {}: {e}", base.display())));
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
                "build-msi: ProductCode differs between {} ({base_code}) and {} ({code}) — \
                 a language transform cannot change the product identity",
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
        "xtask: multilingual MSI ({}) → {}",
        lcids.join(", "),
        out.display()
    );
    out
}

/// `torch.exe` of the WiX 3 that Tauri downloads.
fn torch_exe() -> PathBuf {
    wix_tools().join("torch.exe")
}

/// Folder of the WiX 3 that Tauri downloads (`%LOCALAPPDATA%\tauri\WixTools314`).
fn wix_tools() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| die("build-msi: LOCALAPPDATA not set"));
    let tools = base.join("tauri").join("WixTools314");
    if !tools.join("light.exe").is_file() {
        die(&format!(
            "build-msi: WiX 3 not found in {} (downloaded by tauri build)",
            tools.display()
        ));
    }
    tools
}

/// MSI handle closed when it goes out of scope.
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
        die(&format!("build-msi: {what} (msi.dll, code {rc})"));
    }
}

fn open(path: &Path, mode: PCWSTR) -> Handle {
    let mut h = MSIHANDLE(0);
    let rc = unsafe { MsiOpenDatabaseW(&HSTRING::from(path.as_os_str()), mode, &mut h) };
    check(rc, &format!("opening {}", path.display()));
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

/// Reads the text field `field` of a record.
fn record_string(rec: &Handle, field: u32) -> String {
    let mut len = 0u32;
    let mut empty = [0u16; 1];
    // First call: length (ERROR_MORE_DATA expected), without the trailing zero.
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
    check(rc, "reading a record");
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
    check(rc, &format!("ProductCode of {}", msi.display()));
    record_string(&Handle(rec), 1)
}

/// Adds the property `name` = `value` to the `Property` table of `msi`.
fn add_property(msi: &Path, name: &str, value: &str) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let v = view(&db, "SELECT `Property`, `Value` FROM `Property`");
        let rec = Handle(unsafe { MsiCreateRecord(2) });
        check(
            unsafe { MsiRecordSetStringW(rec.0, 1, &HSTRING::from(name)) },
            "property name",
        );
        check(
            unsafe { MsiRecordSetStringW(rec.0, 2, &HSTRING::from(value)) },
            "property value",
        );
        check(
            unsafe { MsiViewModify(v.0, MSIMODIFY_ASSIGN, rec.0) },
            &format!("adding property {name}"),
        );
    }
    check(unsafe { MsiDatabaseCommit(db.0) }, "property commit");
}

/// Adds `mst` to the `_Storages` table of `msi` under the name `name`.
fn embed_transform(msi: &Path, name: &str, mst: &Path) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let v = view(&db, "SELECT `Name`, `Data` FROM `_Storages`");
        let rec = Handle(unsafe { MsiCreateRecord(2) });
        check(
            unsafe { MsiRecordSetStringW(rec.0, 1, &HSTRING::from(name)) },
            "transform name",
        );
        check(
            unsafe { MsiRecordSetStreamW(rec.0, 2, &HSTRING::from(mst.as_os_str())) },
            &format!("reading {}", mst.display()),
        );
        check(
            unsafe { MsiViewModify(v.0, MSIMODIFY_ASSIGN, rec.0) },
            &format!("inserting transform {name}"),
        );
    }
    check(unsafe { MsiDatabaseCommit(db.0) }, "transform commit");
}

/// Summary *Template*: original platform kept, languages replaced
/// (`x64;1033,1036`).
fn set_languages(msi: &Path, lcids: &[String]) {
    let db = open(msi, MSIDBOPEN_TRANSACT);
    {
        let mut si = MSIHANDLE(0);
        check(
            unsafe { MsiGetSummaryInformationW(db.0, PCWSTR::null(), 1, &mut si) },
            "opening the summary information",
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
            "reading Template",
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
            "writing Template",
        );
        check(
            unsafe { MsiSummaryInfoPersist(si.0) },
            "persisting the summary information",
        );
    }
    check(
        unsafe { MsiDatabaseCommit(db.0) },
        "summary information commit",
    );
}
