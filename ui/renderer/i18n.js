// @ts-check

// Language of the hidden render webview. A JS context separate from the main
// window (which has `ui/js/i18n.js`, pulling in `app.js` and the interface DOM):
// same catalog, read through the same `get_i18n` command, but a standalone `t()`.
// Error messages raised here bubble up to Rust and are then shown in the
// document: they must follow the interface language.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** @type {import("../../types/ipc").I18nPayload["messages"]} */
let messages = {};
let plurals = new Intl.PluralRules("en");

// Same contract as `t()` in ui/js/i18n.js: `{name}` parameters, plural forms
// picked by `params.count`. Unknown key -> the key itself, never an exception.
/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  /** @type {string | Record<string, string> | undefined} */
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

async function loadLocale() {
  const r = await invoke("get_i18n");
  messages = r.messages;
  plurals = new Intl.PluralRules(r.locale);
}

// At boot, then on every language change (whichever window it originates
// from: this webview has no setting of its own). An unavailable catalog must
// not prevent rendering: keys will simply be displayed as-is.
export async function initI18n() {
  try {
    await loadLocale();
  } catch (err) {
    console.error("i18n: catalog unavailable:", err);
  }
  await listen("locale-changed", () =>
    loadLocale().catch((err) => console.error("i18n: reload failed:", err)),
  );
}
