// Coloration syntaxique de la **vue code source** (bouton « code source »).
//
// Contrainte structurelle : la vue est une `<div class="src-line">` par ligne
// (cf. renderSource) — c'est ce qui garantit « 1 ligne logique = 1 ligne
// visuelle » et rend l'alignement preview ↔ source indépendant du rendu. Or un
// coloriseur produit **un seul** flot HTML où un `<span>` peut chevaucher
// plusieurs lignes (fence markdown, chaîne ou commentaire multi-lignes) : c'est
// `splitHighlightedLines` (hlsplit.js) qui le recoupe.
//
// Deux sources de coloration, mêmes règles qu'ailleurs dans l'app (§6.4) :
//   - grammaire hljs de l'hôte (markdown) — sortie de confiance, hljs échappe
//     lui-même le texte ;
//   - plugin `highlight:code` (tex-source…) — code tiers, asynchrone :
//     seuls les `<span class="…">` survivent à DOMPurify.
//
// Jamais bloquant et jamais destructeur : au moindre doute (erreur, nombre de
// lignes qui ne retombe pas juste, vue déjà rebasculée) on garde le texte brut.

import { pluginHighlight } from "./plugins.js";
import { splitHighlightedLines } from "./hlsplit.js";

// Au-delà, on ne colore pas : le coût (coloration + N innerHTML) ne vaut pas le
// confort sur un fichier que personne ne lit ligne à ligne.
const MAX_CHARS = 1_000_000;

/** Sortie d'un plugin (code tiers) : on ne garde que les spans et leur classe. */
function sanitizeSpans(html) {
  return window.DOMPurify.sanitize(html, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] });
}

/**
 * Applique un flot coloré aux lignes déjà rendues. Abandonne — sans rien
 * toucher — si la découpe ne recouvre pas exactement les lignes affichées ou si
 * la vue a changé entre-temps (coloration asynchrone d'un plugin).
 */
function applyLines(root, lines, html) {
  if (!root.isConnected) return;
  const painted = splitHighlightedLines(html);
  if (painted.length !== lines.length || root.children.length !== lines.length) return;
  const divs = root.children;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "") continue; // ligne vide : garder le ZWSP qui tient la hauteur
    divs[i].innerHTML = painted[i];
  }
}

/**
 * Colore une vue source déjà construite. `hl` = `{ lang, plugin }` obtenu de
 * `sourceHighlightFor` (plugin null → grammaire hljs de l'hôte). Sans effet si
 * la grammaire est absente : la vue reste en texte brut.
 */
export function paintSource(root, lines, hl) {
  if (!hl || !hl.lang) return;
  const text = lines.join("\n");
  if (text.length > MAX_CHARS) return;
  if (!hl.plugin) {
    if (!window.hljs.getLanguage(hl.lang)) return;
    try {
      const { value } = window.hljs.highlight(text, { language: hl.lang, ignoreIllegals: true });
      applyLines(root, lines, value);
    } catch {
      /* grammaire en échec : texte brut, rien de cassé */
    }
    return;
  }
  // Plugin : worker + timeout (§7.1). La coloration arrive après coup, sans
  // toucher aux hauteurs (1 div = 1 ligne) — donc sans perturber le
  // `scrollToLine` que l'appelant a déjà fait.
  pluginHighlight(hl.plugin, { lang: hl.lang, code: text })
    .then((html) => applyLines(root, lines, sanitizeSpans(html)))
    .catch(() => {});
}
