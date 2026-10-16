//! Langue de l'interface : catalogues de messages et langue courante.
//!
//! **Source unique** des textes affichés, front comme back : les catalogues
//! `src-tauri/i18n/<langue>.json` sont embarqués à la compilation ; le Rust les
//! lit via [`tr!`], le frontend les reçoit par la commande `get_i18n`.
//! L'anglais est la langue de référence : toute clé absente d'un autre
//! catalogue retombe sur lui (puis sur la clé elle-même, jamais de panique).
//!
//! Format : objet JSON plat `clé → texte`, paramètres `{nom}`. Un texte qui
//! dépend d'un nombre est un objet de formes plurielles CLDR (`one`, `other`)
//! sélectionné par le paramètre `count`.
//!
//! La langue courante est un état **global** (et non un `State` Tauri) : les
//! messages d'erreur naissent au fond de modules qui n'ont pas d'`AppHandle`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::LazyLock;

use serde_json::{Map, Value};

/// Langues livrées, la référence en tête : `(code, catalogue)`.
const CATALOGS: [(&str, &str); 2] = [
    ("en", include_str!("../i18n/en.json")),
    ("fr", include_str!("../i18n/fr.json")),
];

/// Catalogues parsés, dans l'ordre de [`CATALOGS`]. Un JSON invalide est une
/// erreur de développement, attrapée par `tests/test_i18n.mjs` et les tests
/// ci-dessous avant tout build distribué.
static PARSED: LazyLock<Vec<Map<String, Value>>> = LazyLock::new(|| {
    CATALOGS
        .iter()
        .map(|(code, src)| match serde_json::from_str::<Value>(src) {
            Ok(Value::Object(map)) => map,
            _ => panic!("catalogue i18n/{code}.json invalide"),
        })
        .collect()
});

/// Index de la langue courante dans [`CATALOGS`].
static CURRENT: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    /// Langue imposée au thread courant, prioritaire sur [`CURRENT`] : cf.
    /// [`in_reference_language`].
    static OVERRIDE: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

/// Exécute `f` avec les messages en anglais **sur ce thread**, quelle que soit
/// la langue de l'interface. Pour l'API HTTP locale (`server.rs`) : une
/// interface technique lue par des outils doit répondre pareil sur tous les
/// postes. Ne couvre pas les threads que `f` lancerait.
pub fn in_reference_language<R>(f: impl FnOnce() -> R) -> R {
    let previous = OVERRIDE.with(|o| o.replace(Some(0)));
    let out = f();
    OVERRIDE.with(|o| o.set(previous));
    out
}

/// Index effectif : surcharge du thread, sinon langue de l'interface.
fn active() -> usize {
    OVERRIDE.with(|o| o.get()).unwrap_or_else(|| CURRENT.load(Ordering::Relaxed))
}

/// Résout le réglage `language` (`"auto"`, `"en"`, `"fr"`…) en code de langue
/// livrée. `auto` — et toute valeur inconnue — suit la langue d'interface du
/// système, et l'anglais si celle-ci n'est pas livrée.
pub fn resolve(setting: &str) -> &'static str {
    let wanted = if setting == "auto" || index_of(setting).is_none() {
        system_language()
    } else {
        setting.to_string()
    };
    CATALOGS[index_of(&wanted).unwrap_or(0)].0
}

/// Langue d'interface du système, réduite à son code primaire (`fr-FR` → `fr`).
/// Windows : langue d'affichage de l'utilisateur ; Linux : `LC_ALL` /
/// `LC_MESSAGES` / `LANG`.
fn system_language() -> String {
    sys_locale::get_locale()
        .unwrap_or_default()
        .split(['-', '_', '.'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn index_of(code: &str) -> Option<usize> {
    CATALOGS.iter().position(|(c, _)| *c == code)
}

/// Fixe la langue courante à partir du réglage ; renvoie le code retenu.
pub fn set_language(setting: &str) -> &'static str {
    let code = resolve(setting);
    CURRENT.store(index_of(code).unwrap_or(0), Ordering::Relaxed);
    code
}

/// Code de la langue courante (`"en"`, `"fr"`).
pub fn current() -> &'static str {
    CATALOGS[CURRENT.load(Ordering::Relaxed)].0
}

/// Codes des langues livrées, référence en tête.
pub fn languages() -> Vec<&'static str> {
    CATALOGS.iter().map(|(c, _)| *c).collect()
}

/// Langues livrées pour le sélecteur des Réglages : `{code, name}`, `name` étant
/// l'endonyme (« Français »), clé `language.name` de chaque catalogue.
pub fn language_list() -> Vec<Value> {
    CATALOGS
        .iter()
        .zip(PARSED.iter())
        .map(|((code, _), map)| {
            let name = map.get("language.name").and_then(Value::as_str).unwrap_or(code);
            serde_json::json!({ "code": code, "name": name })
        })
        .collect()
}

/// Catalogue complet de la langue courante, complété par la référence : ce que
/// reçoit le frontend, qui n'a ainsi jamais à gérer de repli.
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

/// Forme plurielle CLDR de `n` pour une langue livrée.
fn plural_category(lang: &str, n: f64) -> &'static str {
    match lang {
        // fr : 0 et 1 au singulier (« 0 onglet », « 1 onglet »).
        "fr" if (0.0..2.0).contains(&n.abs()) => "one",
        "fr" => "other",
        _ if n == 1.0 => "one",
        _ => "other",
    }
}

/// Texte de `key` dans la langue courante, paramètres substitués. Utiliser la
/// macro [`tr!`] plutôt que cette fonction.
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

/// Remplace chaque `{nom}` connu ; un `{…}` sans paramètre reste tel quel.
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

/// Message traduit : `tr!("clé")` ou `tr!("clé", nom = valeur, …)` — toute
/// valeur `Display`. La clé doit être un littéral : `tests/test_i18n.mjs` les
/// relève dans le source pour vérifier qu'elles existent dans les catalogues.
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
        assert_eq!(substitute("port ≥ {min}", &[("min", "1024".into())]), "port ≥ 1024");
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
    }

    #[test]
    fn resolution() {
        assert_eq!(resolve("fr"), "fr");
        assert_eq!(resolve("en"), "en");
        // auto / inconnu : une langue livrée, quelle que soit celle du poste.
        assert!(languages().contains(&resolve("auto")));
        assert!(languages().contains(&resolve("xx")));
    }
}
