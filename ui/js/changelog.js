// @ts-check
// "What's new" (« Nouveautés ») dialog: displays a markdown changelog rendered by
// a dedicated markdown-it instance — without render.js's Kroki fence: a
// changelog is prose, a diagram engine has nothing to hydrate in it — then
// sanitized by DOMPurify. Two sources: the application's CHANGELOG.md embedded
// in the binary (`get_changelog` command) and the optional CHANGELOG.md of an
// installed plugin (`plugin_changelog` command, spec §3.1) — same dialog,
// adjusted header.

import { invoke } from "./app.js";
import { onLocaleChange, t } from "./i18n.js";

/** @typedef {import("../../types/ipc").PluginInfo} PluginInfo */

// Static elements of ui/index.html.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("changelog-dialog"));
const title = /** @type {HTMLHeadingElement} */ (document.getElementById("changelog-title"));
const hint = /** @type {HTMLParagraphElement} */ (document.getElementById("changelog-hint"));
const body = /** @type {HTMLDivElement} */ (document.getElementById("changelog-body"));

const md = window.markdownit({ linkify: true });

// Key of the source currently rendered in the body ("app" or "plugin:<id>"):
// the app's changelog is frozen at compile time, the plugins' can change on
// every install — we only cache the last render, enough for successive
// reopenings of the same content.
/** @type {string | null} */
let shownKey = null;

// Source whose header (title + hint) is displayed: `null` for the application,
// the `list_plugins` entry for a plugin. The title and hint are in the current
// language, redone if it changes.
/** @type {PluginInfo | null} */
let headerPlugin = null;

function setHeader() {
  if (headerPlugin) {
    title.textContent = t("changelog.plugin_title", { name: headerPlugin.name || headerPlugin.id });
    hint.textContent = t("changelog.plugin_hint", { id: headerPlugin.id });
  } else {
    title.textContent = t("changelog.title");
    hint.textContent = t("changelog.hint");
  }
}

// Prepares the application's markdown: the title and preamble (already carried
// by the dialog header) are cut — the list starts at the first version
// section — and the reference link definitions at the bottom
// (`[2.2.2]: #222--…`, anchors internal to the file) are removed: with no
// target in the dialog, they would only break navigation. `[2.2.2]` becomes
// literal text again in the headings, faithful to the Keep a Changelog format.
/**
 * @param {string} src
 * @returns {string}
 */
function prepareApp(src) {
  const start = src.search(/^## /m);
  const versions = start >= 0 ? src.slice(start) : src;
  return versions.replace(/^\[[^\]]+\]:\s*#.*$/gm, "");
}

// Prepares a plugin's markdown: more conservative than `prepareApp` (a
// preamble may carry content), we only cut the leading `# …` title —
// redundant with the dialog header — and the reference links at the bottom.
/**
 * @param {string} src
 * @returns {string}
 */
function preparePlugin(src) {
  return src.replace(/^# .*\n+/, "").replace(/^\[[^\]]+\]:\s*#.*$/gm, "");
}

/** @param {string} markdown */
function render(markdown) {
  body.innerHTML = window.DOMPurify.sanitize(md.render(markdown), {
    USE_PROFILES: { html: true },
  });
}

/** @param {unknown} err `invoke` rejection (Rust error string) */
function renderError(err) {
  body.replaceChildren();
  const error = document.createElement("p");
  error.className = "settings-error";
  error.textContent = String(err);
  body.append(error);
}

function show() {
  dialog.showModal();
  body.scrollTop = 0;
}

export async function openChangelog() {
  if (shownKey !== "app") {
    try {
      render(prepareApp(await invoke("get_changelog")));
      shownKey = "app";
    } catch (err) {
      renderError(err);
      shownKey = null;
    }
  }
  headerPlugin = null;
  setHeader();
  show();
}

/**
 * Changelog of an installed plugin (`p` = `list_plugins` entry).
 * @param {PluginInfo} p
 * @returns {Promise<void>}
 */
export async function openPluginChangelog(p) {
  const key = `plugin:${p.id}`;
  if (shownKey !== key) {
    try {
      render(preparePlugin(await invoke("plugin_changelog", { id: p.id })));
      shownKey = key;
    } catch (err) {
      renderError(err);
      shownKey = null;
    }
  }
  headerPlugin = p;
  setHeader();
  show();
}

export function initChangelog() {
  onLocaleChange(setHeader);
  /** @type {HTMLButtonElement} */ (document.getElementById("changelog-close")).addEventListener(
    "click",
    () => dialog.close(),
  );
  // Any links in the body (URLs quoted in an entry): system browser via the
  // backend, never navigation of the webview itself.
  body.addEventListener("click", (e) => {
    // Click target: always an element (never a text node).
    const a = /** @type {Element} */ (e.target).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = (a.getAttribute("href") || "").trim();
    if (/^https?:/i.test(href)) invoke("open_link", { baseDir: "", href });
  });
}
