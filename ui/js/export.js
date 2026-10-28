// @ts-check
// Export of the active tab's rendering as a standalone HTML page (button of
// the view action stack).
//
// The exported page replays the app's layout: all the <head>'s stylesheets are
// inlined — vendors, app.css, styles injected at runtime (Plotly) — keeping
// their `media` attributes (the theme forcing via theme.js therefore travels
// as is), and <html>'s [data-theme] attribute is reproduced. Diagrams are
// already inline SVGs; a Plotly figure is exported frozen (its SVG at export
// time, modebar removed). Local images — rewritten to `asset.localhost` by
// render.js, an internal protocol dead outside the app — are converted to
// data-URIs on the backend side (`export_html`): the CSP forbids fetching them
// here (connect-src), whereas the stylesheets' fetch, served from 'self',
// passes. Accepted limitation: the KaTeX fonts (relative `fonts/…` URLs) are
// not embedded, formulas fall back to system fonts.

import { invoke, state, escapeHtml } from "./app.js";
import { renderDocument } from "./render.js";
import { t, getLocale } from "./i18n.js";

/** @typedef {import("../../types/app").View} View */

// Neutralizes the "application" layout (full-frame flex body, views stacked in
// absolute position): the exported page scrolls normally.
const EXPORT_CSS = `
html, body { height: auto; overflow: auto; display: block; }
.doc-view { position: static; overflow: visible; }
`;

/** @returns {Promise<string>} */
async function inlineStyles() {
  /** @type {string[]} */
  const parts = [];
  for (const node of /** @type {NodeListOf<HTMLLinkElement | HTMLStyleElement>} */ (
    document.querySelectorAll("head link[rel='stylesheet'], head style")
  )) {
    if (node.tagName === "STYLE") {
      parts.push(node.outerHTML);
      continue;
    }
    try {
      // The stylesheet `<link>`s in the <head> (index.html) all carry an href.
      const css = await (await fetch(/** @type {string} */ (node.getAttribute("href")))).text();
      const media = node.media ? ` media="${escapeHtml(node.media)}"` : "";
      parts.push(`<style${media}>\n${css}\n</style>`);
    } catch {
      /* unreachable stylesheet: styling degrades, the export stays usable */
    }
  }
  return parts.join("\n");
}

// Rendered article of the document: cloned from the view if it shows the
// preview, otherwise (source or derived view on screen) re-rendered in an
// offscreen container — realistic width for layout measurements (Plotly) —
// without touching the user's view.
/**
 * @param {View} v rendered view, non-null `markdown` (checked by `exportActiveView`)
 * @returns {Promise<Element | null>}
 */
async function previewArticle(v) {
  if (v.mode !== "source" && v.mode !== "derived") {
    // cloneNode is typed Node: the clone of an Element is an Element.
    return /** @type {Element | null} */ (
      v.el.querySelector("article.markdown-body")?.cloneNode(true) ?? null
    );
  }
  const host = document.createElement("div");
  host.className = "doc-view";
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:996px;height:600px;overflow:auto;";
  document.body.appendChild(host);
  try {
    // `markdown` and `dir` are set together by renderActive (main.js).
    await renderDocument(host, {
      markdown: /** @type {string} */ (v.markdown),
      dir: /** @type {string} */ (v.dir),
      lineMap: v.lineMap,
    });
    return /** @type {Element | null} */ (
      host.querySelector("article.markdown-body")?.cloneNode(true) ?? null
    );
  } finally {
    host.remove();
  }
}

/**
 * Exports the active tab's rendering: builds the standalone HTML document
 * then delegates to the backend (data-URIs for local images + "Save as"
 * dialog + write). Resolves `false` if there is nothing to export or the
 * export is cancelled.
 */
export async function exportActiveView() {
  const v = state.views.get(state.active);
  if (!v || !v.rendered || v.markdown == null) return false;
  const article = await previewArticle(v);
  if (!article) return false;
  for (const el of article.querySelectorAll(".modebar-container")) el.remove();

  const title = state.tabs.find((t) => t.id === state.active)?.title || t("export.default_title");
  const theme = document.documentElement.dataset.theme;
  const html =
    `<!doctype html>\n<html lang="${getLocale()}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ""}>\n` +
    `<head>\n<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `${await inlineStyles()}\n<style>${EXPORT_CSS}</style>\n</head>\n<body>\n` +
    `<div class="doc-view">${article.outerHTML}</div>\n</body>\n</html>\n`;

  return invoke("export_html", {
    suggestedName: `${title.replace(/\.[^.]+$/, "")}.html`,
    html,
  });
}
