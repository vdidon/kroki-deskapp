// Langue de la webview de rendu cachée. Contexte JS distinct de la fenêtre
// principale (qui a `ui/js/i18n.js`, tirant `app.js` et le DOM de l'interface) :
// même catalogue, lu par la même commande `get_i18n`, mais un `t()` autonome.
// Les messages d'erreur levés ici remontent au Rust puis s'affichent dans le
// document : ils doivent suivre la langue de l'interface.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let messages = {};
let plurals = new Intl.PluralRules("en");

// Même contrat que `t()` de ui/js/i18n.js : paramètres `{nom}`, formes plurielles
// choisies par `params.count`. Clé inconnue → la clé elle-même, jamais d'exception.
export function t(key, params) {
  let s = messages[key];
  if (s && typeof s === "object") {
    s = s[plurals.select(Number(params?.count ?? 0))] ?? s.other;
  }
  if (typeof s !== "string") {
    console.warn(`i18n : clé inconnue « ${key} »`);
    return key;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

async function loadLocale() {
  const r = await invoke("get_i18n");
  messages = r.messages;
  plurals = new Intl.PluralRules(r.locale);
}

// Boot, puis à chaque changement de langue (quelle que soit la fenêtre à
// l'origine : cette webview n'a pas de réglage propre). Un catalogue
// indisponible ne doit pas empêcher le rendu : les clés s'afficheront telles quelles.
export async function initI18n() {
  try {
    await loadLocale();
  } catch (err) {
    console.error("i18n : catalogue indisponible :", err);
  }
  await listen("locale-changed", () =>
    loadLocale().catch((err) => console.error("i18n : rechargement en échec :", err)),
  );
}
