// @ts-check
// Langue de l'interface : catalogue courant, `t()` et traduction du HTML statique.
//
// Le catalogue vient du Rust (commande `get_i18n`), source unique partagée avec
// les messages du backend (`src-tauri/i18n/<langue>.json`, cf. i18n.rs) : il
// arrive déjà complété par l'anglais, la langue de référence. Une clé absente
// des deux s'affiche telle quelle (et s'annonce en console), jamais d'exception.
//
// HTML statique : `data-i18n="clé"` (texte), `data-i18n-html="clé"` (texte
// à balisage inline — `<code>`, `<kbd>`, `<strong>` : le catalogue est à nous,
// pas au document), `data-i18n-title`, `data-i18n-placeholder`,
// `data-i18n-aria-label` (attributs). Le texte écrit
// dans index.html n'est qu'un repli anglais : `applyLocale` le remplace avant
// le premier paint (cf. `data-i18n-pending`, app.css).
//
// Textes construits par le JS : appeler `t()` au moment de les écrire, et
// s'abonner à `onLocaleChange` pour ceux qui restent affichés (indications
// d'un dialog, libellés générés à l'init).

import { invoke } from "./app.js";

/** @typedef {import("../../types/ipc").I18nPayload} I18nPayload */

let locale = "en";
let setting = "auto";
/** @type {I18nPayload["languages"]} */
let languages = [{ code: "en", name: "English" }];
/** @type {I18nPayload["messages"]} */
let messages = {};
let plurals = new Intl.PluralRules("en");
/** @type {Set<(locale: string) => void>} */
const listeners = new Set();

// [clé dans dataset, attribut traduit]
/** @type {[string, string][]} */
const ATTRS = [
  ["i18nTitle", "title"],
  ["i18nPlaceholder", "placeholder"],
  ["i18nAriaLabel", "aria-label"],
];

// Texte de `key`, paramètres `{nom}` substitués. Une valeur objet est un jeu de
// formes plurielles CLDR choisi par `params.count`.
/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  /** @type {string | Record<string, string> | undefined} — clé absente du catalogue */
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

// Code de la langue courante (`en`, `fr`) : `Intl`, `localeCompare`, `<html lang>`.
export function getLocale() {
  return locale;
}

// Réglage brut (`auto` ou un code) et langues livrées (`{code, name}`, name =
// endonyme) : dialog Réglages.
export function getLanguageSetting() {
  return setting;
}

export function getLanguages() {
  return languages;
}

// Traduit le sous-arbre `root` (document entier par défaut) : à rappeler sur
// tout fragment HTML statique inséré après coup. Les sélecteurs garantissent
// la présence de l'attribut lu, d'où les casts `string`.
/** @param {ParentNode} [root] */
export function applyLocale(root = document) {
  if (root === document) document.documentElement.lang = locale;
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-i18n]"))) {
    el.textContent = t(/** @type {string} */ (el.dataset.i18n));
  }
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-i18n-html]"))) {
    el.innerHTML = t(/** @type {string} */ (el.dataset.i18nHtml));
  }
  for (const [data, attr] of ATTRS) {
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (
      root.querySelectorAll(`[data-i18n-${attr}]`)
    )) {
      el.setAttribute(attr, t(/** @type {string} */ (el.dataset[data])));
    }
  }
}

// Recharge le catalogue depuis le backend et retraduit toute la fenêtre.
// Au boot, puis à chaque changement de langue (cette fenêtre ou une autre).
export async function loadLocale() {
  const r = await invoke("get_i18n");
  locale = r.locale;
  setting = r.setting || "auto";
  languages = r.languages;
  messages = r.messages;
  plurals = new Intl.PluralRules(locale);
  applyLocale();
  for (const fn of listeners) {
    try {
      fn(locale);
    } catch (err) {
      console.error("i18n : abonné en échec :", err);
    }
  }
}

// `fn(locale)` après chaque changement de langue (pas au boot : les modules
// écrivent leurs textes à l'init, après `loadLocale`).
/** @param {(locale: string) => void} fn */
export function onLocaleChange(fn) {
  listeners.add(fn);
}

// Premier chargement : la fenêtre reste masquée tant que le HTML statique n'est
// pas traduit (pas de flash du repli anglais), et réapparaît même en cas
// d'échec — une interface en anglais vaut mieux qu'une fenêtre vide.
export async function initI18n() {
  try {
    await loadLocale();
  } catch (err) {
    console.error("i18n : catalogue indisponible :", err);
  } finally {
    delete document.documentElement.dataset.i18nPending;
  }
}
