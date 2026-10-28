//! Interface language: message catalogs and the current language.
//!
//! **Single source** of displayed texts, front and back: the catalogs
//! `src-tauri/i18n/<language>.json` are embedded at compile time; Rust reads
//! them via [`tr!`], the frontend receives them through the `get_i18n` command.
//! English is the reference language: any key missing from another catalog
//! falls back to it (then to the key itself, never a panic).
//!
//! Format: flat JSON object `key → text`, parameters `{name}`. A text that
//! depends on a number is an object of CLDR plural forms (`one`, `other`)
//! selected by the `count` parameter.
//!
//! The current language is **global** state (not a Tauri `State`): error
//! messages are born deep in modules that have no `AppHandle`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::LazyLock;

use serde_json::{Map, Value};

/// Shipped languages, the reference first: `(code, catalog)`. The code is the
/// primary language: `pt` (Brazilian Portuguese) also serves Portugal, `zh`
/// is Simplified Chinese (cf. [`language_code`] for Traditional).
const CATALOGS: [(&str, &str); 9] = [
    ("en", include_str!("../i18n/en.json")),
    ("de", include_str!("../i18n/de.json")),
    ("es", include_str!("../i18n/es.json")),
    ("fr", include_str!("../i18n/fr.json")),
    ("it", include_str!("../i18n/it.json")),
    ("ja", include_str!("../i18n/ja.json")),
    ("ko", include_str!("../i18n/ko.json")),
    ("pt", include_str!("../i18n/pt.json")),
    ("zh", include_str!("../i18n/zh.json")),
];

/// Parsed catalogs, in the order of [`CATALOGS`]. Invalid JSON is a
/// development error, caught by `tests/test_i18n.mjs` and the tests
/// below before any distributed build.
static PARSED: LazyLock<Vec<Map<String, Value>>> = LazyLock::new(|| {
    CATALOGS
        .iter()
        .map(|(code, src)| match serde_json::from_str::<Value>(src) {
            Ok(Value::Object(map)) => map,
            _ => panic!("catalogue i18n/{code}.json invalide"),
        })
        .collect()
});

/// Index of the current language in [`CATALOGS`].
static CURRENT: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    /// Language forced on the current thread, taking precedence over [`CURRENT`]:
    /// cf. [`in_reference_language`].
    static OVERRIDE: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

/// Runs `f` with messages in English **on this thread**, whatever the
/// interface language. For the local HTTP API (`server.rs`): a technical
/// interface read by tools must answer the same on every workstation. Does not
/// cover threads that `f` might spawn.
pub fn in_reference_language<R>(f: impl FnOnce() -> R) -> R {
    let previous = OVERRIDE.with(|o| o.replace(Some(0)));
    let out = f();
    OVERRIDE.with(|o| o.set(previous));
    out
}

/// Effective index: the thread's override, otherwise the interface language.
fn active() -> usize {
    OVERRIDE
        .with(|o| o.get())
        .unwrap_or_else(|| CURRENT.load(Ordering::Relaxed))
}

/// Resolves the `language` setting (`"auto"`, `"en"`, `"fr"`…) to a shipped
/// language code. `auto` — and any unknown value — follows the system's
/// interface language, and English if that one is not shipped.
pub fn resolve(setting: &str) -> &'static str {
    let wanted = if setting == "auto" || index_of(setting).is_none() {
        system_language()
    } else {
        setting.to_string()
    };
    CATALOGS[index_of(&wanted).unwrap_or(0)].0
}

/// The system's interface language, reduced to its primary code (`fr-FR` → `fr`).
/// Windows: the user's display language; Linux: `LC_ALL` /
/// `LC_MESSAGES` / `LANG`.
fn system_language() -> String {
    language_code(&sys_locale::get_locale().unwrap_or_default())
}

/// Primary code of a locale (`fr-FR`, `fr_FR.UTF-8` → `fr`). Exception:
/// Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant-…`) becomes
/// `zh-hant`, not shipped — English rather than the Simplified of the `zh`
/// catalog, as Windows itself does.
fn language_code(locale: &str) -> String {
    let lower = locale.to_ascii_lowercase();
    let mut parts = lower.split(['-', '_', '.']);
    let primary = parts.next().unwrap_or("").to_string();
    if primary == "zh" && parts.any(|p| matches!(p, "hant" | "tw" | "hk" | "mo")) {
        return "zh-hant".to_string();
    }
    primary
}

fn index_of(code: &str) -> Option<usize> {
    CATALOGS.iter().position(|(c, _)| *c == code)
}

/// Sets the current language from the setting; returns the code retained.
pub fn set_language(setting: &str) -> &'static str {
    let code = resolve(setting);
    CURRENT.store(index_of(code).unwrap_or(0), Ordering::Relaxed);
    code
}

/// Code of the current language (`"en"`, `"fr"`).
pub fn current() -> &'static str {
    CATALOGS[CURRENT.load(Ordering::Relaxed)].0
}

/// Codes of the shipped languages, reference first.
pub fn languages() -> Vec<&'static str> {
    CATALOGS.iter().map(|(c, _)| *c).collect()
}

/// Shipped languages for the Settings (« Réglages ») selector: `{code, name}`, `name` being
/// the endonym (« Français »), the `language.name` key of each catalog.
pub fn language_list() -> Vec<Value> {
    CATALOGS
        .iter()
        .zip(PARSED.iter())
        .map(|((code, _), map)| {
            let name = map
                .get("language.name")
                .and_then(Value::as_str)
                .unwrap_or(code);
            serde_json::json!({ "code": code, "name": name })
        })
        .collect()
}

/// Full catalog of the current language, completed by the reference: what the
/// frontend receives, so it never has to handle a fallback.
pub fn messages() -> Map<String, Value> {
    let mut out = PARSED[0].clone();
    let cur = CURRENT.load(Ordering::Relaxed);
    if cur != 0 {
        for (k, v) in &PARSED[cur] {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// CLDR plural form of `n` for a shipped language — the frontend has
/// `Intl.PluralRules` instead. An added language whose rules are in no
/// branch (`few`, `many`: Russian, Polish…) must be given one.
fn plural_category(lang: &str, n: f64) -> &'static str {
    match lang {
        // fr, pt: 0 and 1 are singular ("0 onglet", "1 onglet").
        "fr" | "pt" if (0.0..2.0).contains(&n.abs()) => "one",
        "fr" | "pt" => "other",
        // No grammatical plural: `other` only.
        "ja" | "ko" | "zh" => "other",
        // en, de, es, it: singular for 1 only.
        _ if n == 1.0 => "one",
        _ => "other",
    }
}

/// Text of `key` in the current language, parameters substituted. Use the
/// [`tr!`] macro rather than this function.
pub fn text(key: &str, params: &[(&str, String)]) -> String {
    let cur = active();
    let (lang, value) = match PARSED[cur].get(key) {
        Some(v) => (CATALOGS[cur].0, v),
        None => match PARSED[0].get(key) {
            Some(v) => (CATALOGS[0].0, v),
            None => return key.to_string(),
        },
    };
    let template = match value {
        Value::String(s) => s.as_str(),
        Value::Object(forms) => {
            let n = params
                .iter()
                .find(|(name, _)| *name == "count")
                .and_then(|(_, v)| v.parse::<f64>().ok())
                .unwrap_or(0.0);
            forms
                .get(plural_category(lang, n))
                .or_else(|| forms.get("other"))
                .and_then(Value::as_str)
                .unwrap_or(key)
        }
        _ => key,
    };
    substitute(template, params)
}

/// Replaces each known `{name}`; a `{…}` with no matching parameter is left as is.
fn substitute(template: &str, params: &[(&str, String)]) -> String {
    if params.is_empty() {
        return template.to_string();
    }
    let by_name: BTreeMap<&str, &str> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if by_name.contains_key(&after[..end]) => {
                out.push_str(by_name[&after[..end]]);
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Translated message: `tr!("<key>")` or `tr!("<key>", name = value, …)` — any
/// `Display` value. The key must be a literal: `tests/test_i18n.mjs` collects
/// them from the source to check that they exist in the catalogs.
#[macro_export]
macro_rules! tr {
    ($key:literal) => {
        $crate::i18n::text($key, &[])
    };
    ($key:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::i18n::text($key, &[$((stringify!($name), ($value).to_string())),+])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogues_valides_et_alignes() {
        let reference: std::collections::BTreeSet<_> = PARSED[0].keys().collect();
        for (i, (code, _)) in CATALOGS.iter().enumerate() {
            let keys: std::collections::BTreeSet<_> = PARSED[i].keys().collect();
            assert_eq!(keys, reference, "clés de i18n/{code}.json ≠ en.json");
        }
    }

    #[test]
    fn substitution_et_repli() {
        assert_eq!(
            substitute("port ≥ {min}", &[("min", "1024".into())]),
            "port ≥ 1024"
        );
        assert_eq!(substitute("{x} {y}", &[("x", "a".into())]), "a {y}");
        assert_eq!(text("clé.inconnue", &[]), "clé.inconnue");
    }

    #[test]
    fn surcharge_anglaise_par_thread() {
        let fr = index_of("fr").unwrap();
        CURRENT.store(fr, Ordering::Relaxed);
        assert_eq!(active(), fr);
        assert_eq!(in_reference_language(active), 0);
        assert_eq!(active(), fr);
        CURRENT.store(0, Ordering::Relaxed);
    }

    #[test]
    fn pluriels() {
        assert_eq!(plural_category("fr", 0.0), "one");
        assert_eq!(plural_category("fr", 1.0), "one");
        assert_eq!(plural_category("fr", 2.0), "other");
        assert_eq!(plural_category("en", 0.0), "other");
        assert_eq!(plural_category("en", 1.0), "one");
        assert_eq!(plural_category("pt", 0.0), "one");
        assert_eq!(plural_category("de", 0.0), "other");
        assert_eq!(plural_category("ja", 1.0), "other");
    }

    #[test]
    fn code_de_langue() {
        assert_eq!(language_code("fr-FR"), "fr");
        assert_eq!(language_code("pt_PT.UTF-8"), "pt");
        assert_eq!(language_code("zh-CN"), "zh");
        assert_eq!(language_code("zh-Hans-SG"), "zh");
        assert_eq!(language_code("zh-TW"), "zh-hant");
        assert_eq!(language_code("zh-Hant-HK"), "zh-hant");
        assert_eq!(language_code(""), "");
    }

    #[test]
    fn resolution() {
        assert_eq!(resolve("fr"), "fr");
        assert_eq!(resolve("en"), "en");
        // auto / unknown: a shipped language, whatever the workstation's.
        assert!(languages().contains(&resolve("auto")));
        assert!(languages().contains(&resolve("xx")));
    }
}
