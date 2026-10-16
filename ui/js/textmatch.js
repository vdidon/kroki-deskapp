// Recherche d'occurrences dans une vue, en `Range` pour la CSS Custom Highlight
// API (findword.js, docsearch.js et globalsearch.js). Le motif arrive déjà
// compilé en RegExp globale (cf. searchopts.js : casse, mot entier, regex).
//
// Un simple parcours des nœuds texte ne suffit plus depuis que la vue source est
// colorée : la coloration éclate une ligne en plusieurs nœuds texte
// (`fetch<span>(</span>…`), et une occurrence à cheval sur deux d'entre eux
// serait perdue. On concatène donc les nœuds texte d'une **même ligne source**
// (`.src-line`) avant de chercher, puis on remappe les positions.
//
// Hors vue source, chaque nœud reste isolé — coller les nœuds voisins créerait
// des occurrences fantômes entre deux blocs du preview (fin d'un paragraphe +
// début du suivant).
//
// Le contenu replié n'est pas cherché : corps d'un `<details>` fermé (les
// accordéons `kd-fold` des plugins, les sources repliées sous une figure
// TikZ…) et éléments `hidden`. Une occurrence qu'on ne voit pas ferait sauter
// la navigation vers un endroit où le mot n'apparaît pas. Le test est
// structurel, pas `checkVisibility()` : celle-ci rejetterait aussi les
// éléments `display: contents`, qui n'ont pas de boîte mais dont le texte
// s'affiche.

import { iterMatches } from "./searchopts.js";

// Plafond de sécurité : au-delà, le surlignage n'apporte plus rien et le coût
// (un Range par occurrence) devient sensible — `.` ou `\s` en mode regex.
const MAX_RANGES = 5000;

/** Corps d'un `<details>` fermé : tout sauf son `<summary>`. */
function inClosedDetails(node) {
  const p = node.parentElement;
  return p?.tagName === "DETAILS" && !p.open && node.nodeName !== "SUMMARY";
}

// Filtre du parcours : un sous-arbre replié est écarté d'un bloc (REJECT), les
// autres éléments sont traversés sans être rendus (SKIP) — seuls les nœuds
// texte visibles sortent du walker.
function visibleText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return inClosedDetails(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  }
  return node.hidden === true || inClosedDetails(node)
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_SKIP;
}

/** Positionne un offset du texte concaténé sur le nœud texte qui le porte. */
function locate(parts, offset) {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (offset >= parts[i].start) return [parts[i].node, offset - parts[i].start];
  }
  return [parts[0].node, 0];
}

function matchGroup(parts, text, re, ranges) {
  for (const m of iterMatches(re, text, MAX_RANGES - ranges.length)) {
    const range = document.createRange();
    range.setStart(...locate(parts, m.index));
    range.setEnd(...locate(parts, m.index + m[0].length));
    ranges.push(range);
  }
}

/**
 * Tous les `Range` couvrant les occurrences de `re` (RegExp globale) dans
 * `root`, dans l'ordre du document — contenu replié exclu.
 */
export function collectMatchRanges(root, re) {
  const ranges = [];
  if (!re) return ranges;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    visibleText,
  );
  let key = null; // ligne source courante, ou le nœud lui-même hors vue source
  let parts = [];
  let text = "";
  const flush = () => {
    if (parts.length && ranges.length < MAX_RANGES) matchGroup(parts, text, re, ranges);
    parts = [];
    text = "";
  };
  let node;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue;
    if (!value) continue;
    const group = node.parentElement?.closest(".src-line") || node;
    if (group !== key) {
      flush();
      key = group;
    }
    parts.push({ node, start: text.length });
    text += value;
  }
  flush();
  return ranges;
}
