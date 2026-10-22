// @ts-check
// Surligne toutes les occurrences du mot actuellement sélectionné dans la vue active
// (comme VS Code). Repose sur la CSS Custom Highlight API (`CSS.highlights` +
// `::highlight(word-occurrences)`, cf. app.css) : AUCUNE modification du DOM — pas de
// <mark> injecté. Conséquences voulues :
//   - compatible avec les SVG des diagrammes (aucun nœud déplacé/cloné), le mode source
//     et le rendu preview, sans repasser par DOMPurify ;
//   - le surlignage natif de la sélection (bleu) est peint PAR-DESSUS les custom
//     highlights → le mot sélectionné garde sa couleur de sélection intacte.
// Dégradation propre : si l'API manque (WebView2 trop ancien), le module ne fait rien.

import { state } from "./app.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher } from "./searchopts.js";

const HIGHLIGHT_NAME = "word-occurrences";
const MIN_LEN = 2; // évite le bruit d'un seul caractère
const MAX_LEN = 100; // au-delà, ce n'est plus un « mot » à pister

const supported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

let scheduled = 0;

function clearHighlight() {
  window.CSS.highlights.delete(HIGHLIGHT_NAME);
}

// La vue de l'onglet actif, seulement si elle est visible (les autres vues et la
// barre d'onglets / dialogues ne doivent pas déclencher le surlignage).
/** @returns {HTMLElement | null} */
function activeViewEl() {
  // `active` null : `get` rend undefined, écarté juste après.
  const v = state.views.get(/** @type {number} */ (state.active));
  if (!v || v.el.style.display === "none") return null;
  return v.el;
}

// Retourne le mot à pister, ou null si la sélection n'est pas un token unique exploitable.
/**
 * @param {Selection | null} sel
 * @returns {string | null}
 */
function selectedWord(sel) {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const trimmed = sel.toString().trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null;
  if (/\s/.test(trimmed)) return null; // un seul mot : pas d'espace/saut de ligne interne
  return trimmed;
}

// Un Range par occurrence dans la vue (insensible à la casse, comme une recherche ;
// cf. textmatch.js pour le recollement des nœuds d'une ligne colorée). Le mot
// sélectionné lui-même est inclus : la sélection native le recouvre visuellement.
/**
 * @param {HTMLElement} viewEl
 * @param {string} word
 */
function highlightOccurrences(viewEl, word) {
  const ranges = collectMatchRanges(viewEl, buildMatcher(word));
  if (ranges.length === 0) clearHighlight();
  else window.CSS.highlights.set(HIGHLIGHT_NAME, new window.Highlight(...ranges));
}

function update() {
  scheduled = 0;
  const sel = window.getSelection();
  const word = selectedWord(sel);
  const viewEl = activeViewEl();
  // Sélection vide/multi-mots, ou en dehors de la vue active (barre d'onglets, réglages…).
  // `sel` non nul ici : `selectedWord(null)` rend null, d'où le cast.
  if (!word || !viewEl || !viewEl.contains(/** @type {Selection} */ (sel).anchorNode)) {
    clearHighlight();
    return;
  }
  highlightOccurrences(viewEl, word);
}

export function initFindWord() {
  if (!supported) return;
  // selectionchange se déclenche en rafale pendant un drag ; on coalesce à une passe
  // par frame pour ne pas re-parcourir le document à chaque micro-événement.
  document.addEventListener("selectionchange", () => {
    if (scheduled) return;
    scheduled = requestAnimationFrame(update);
  });
}
