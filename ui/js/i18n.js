// @ts-check
// Interface language: current catalog, `t()` and static HTML translation.
//
// The catalog comes from Rust (`get_i18n` command), a single source shared with
// the backend messages (`src-tauri/i18n/<lang>.json`, cf. i18n.rs): it arrives
// already completed with English, the reference language. A key missing from
// both is displayed as is (and announced in the console), never an exception.
//
// Static HTML: `data-i18n="key"` (text), `data-i18n-html="key"` (text with
// inline markup — `<code>`, `<kbd>`, `<strong>`: the catalog is ours, not the
// document's), `data-i18n-title`, `data-i18n-placeholder`,
// `data-i18n-aria-label` (attributes). The text written in index.html is only
// an English fallback: `applyLocale` replaces it before the first paint (cf.
// `data-i18n-pending`, app.css).
//
// Texts built by JS: call `t()` when writing them, and subscribe to
// `onLocaleChange` for those that stay displayed (dialog hints, labels
// generated at init).

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

// [key in dataset, translated attribute]
/** @type {[string, string][]} */
const ATTRS = [
  ["i18nTitle", "title"],
  ["i18nPlaceholder", "placeholder"],
  ["i18nAriaLabel", "aria-label"],
];

// Text of `key`, `{name}` parameters substituted. An object value is a set of
// CLDR plural forms chosen by `params.count`.
/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  /** @type {string | Record<string, string> | undefined} — key missing from the catalog */
  let s = messages[key];
  if (s && typeof s === "object") {
    s = s[plurals.select(Number(params?.count ?? 0))] ?? s.other;
  }
  if (typeof s !== "string") {
    console.warn(`i18n: unknown key "${key}"`);
    return key;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// Current language code (`en`, `fr`): `Intl`, `localeCompare`, `<html lang>`.
export function getLocale() {
  return locale;
}

// Raw setting (`auto` or a code) and shipped languages (`{code, name}`, name =
// endonym): Settings (« Réglages ») dialog.
export function getLanguageSetting() {
  return setting;
}

export function getLanguages() {
  return languages;
}

// Translates the `root` subtree (whole document by default): to be called again
// on any static HTML fragment inserted afterwards. The selectors guarantee the
// presence of the attribute read, hence the `string` casts.
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

// Reloads the catalog from the backend and re-translates the whole window.
// At boot, then on every language change (this window or another).
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
      console.error("i18n: subscriber failed:", err);
    }
  }
}

// `fn(locale)` after every language change (not at boot: modules write their
// texts at init, after `loadLocale`).
/** @param {(locale: string) => void} fn */
export function onLocaleChange(fn) {
  listeners.add(fn);
}

// First load: the window stays hidden until the static HTML is translated (no
// flash of the English fallback), and reappears even on failure — an English
// interface beats an empty window.
export async function initI18n() {
  try {
    await loadLocale();
  } catch (err) {
    console.error("i18n: catalog unavailable:", err);
  } finally {
    delete document.documentElement.dataset.i18nPending;
  }
}
