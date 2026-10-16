// Export du rendu de l'onglet actif en page HTML autonome (bouton de la pile
// d'actions de vue).
//
// La page exportée rejoue la mise en page de l'app : toutes les feuilles de
// style du <head> sont inlinées — vendors, app.css, styles injectés au runtime
// (Plotly) — en conservant leurs attributs `media` (le forçage de thème via
// theme.js voyage donc tel quel), et l'attribut [data-theme] de <html> est
// reproduit. Les diagrammes sont déjà des SVG inline ; une figure Plotly est
// exportée figée (son SVG au moment de l'export, modebar retirée). Les images
// locales — réécrites en `asset.localhost` par render.js, protocole interne
// mort hors de l'app — sont converties en data-URI côté backend
// (`export_html`) : la CSP interdit leur fetch ici (connect-src), alors que
// celui des feuilles de style, servies en 'self', passe. Limitation assumée :
// les polices KaTeX (URLs relatives `fonts/…`) ne sont pas embarquées, les
// formules retombent sur les polices système.

import { invoke, state, escapeHtml } from "./app.js";
import { renderDocument } from "./render.js";
import { t, getLocale } from "./i18n.js";

// Neutralise la mise en page « application » (body flex plein cadre, vues
// empilées en position absolue) : la page exportée défile normalement.
const EXPORT_CSS = `
html, body { height: auto; overflow: auto; display: block; }
.doc-view { position: static; overflow: visible; }
`;

async function inlineStyles() {
  const parts = [];
  for (const node of document.querySelectorAll("head link[rel='stylesheet'], head style")) {
    if (node.tagName === "STYLE") {
      parts.push(node.outerHTML);
      continue;
    }
    try {
      const css = await (await fetch(node.getAttribute("href"))).text();
      const media = node.media ? ` media="${escapeHtml(node.media)}"` : "";
      parts.push(`<style${media}>\n${css}\n</style>`);
    } catch {
      /* feuille inaccessible : le style dégrade, l'export reste utilisable */
    }
  }
  return parts.join("\n");
}

// Article rendu du document : cloné depuis la vue si elle affiche le preview,
// sinon (vue source ou dérivée à l'écran) re-rendu dans un conteneur hors
// écran — largeur réaliste pour les mesures de mise en page (Plotly) — sans
// toucher à la vue de l'utilisateur.
async function previewArticle(v) {
  if (v.mode !== "source" && v.mode !== "derived") {
    return v.el.querySelector("article.markdown-body")?.cloneNode(true) ?? null;
  }
  const host = document.createElement("div");
  host.className = "doc-view";
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:996px;height:600px;overflow:auto;";
  document.body.appendChild(host);
  try {
    await renderDocument(host, { markdown: v.markdown, dir: v.dir, lineMap: v.lineMap });
    return host.querySelector("article.markdown-body")?.cloneNode(true) ?? null;
  } finally {
    host.remove();
  }
}

/**
 * Exporte le rendu de l'onglet actif : construit le document HTML autonome
 * puis délègue au backend (data-URI des images locales + dialog « Enregistrer
 * sous » + écriture). Résout `false` si rien à exporter ou export annulé.
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
