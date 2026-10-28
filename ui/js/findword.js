// @ts-check
// Highlights every occurrence of the currently selected word in the active view
// (like VS Code). Relies on the CSS Custom Highlight API (`CSS.highlights` +
// `::highlight(word-occurrences)`, cf. app.css): NO DOM modification — no
// <mark> injected. Intended consequences:
//   - compatible with diagram SVGs (no node moved/cloned), the source mode
//     and the preview rendering, without going through DOMPurify again;
//   - the native selection highlight (blue) is painted ON TOP of the custom
//     highlights → the selected word keeps its selection color intact.
// Graceful degradation: if the API is missing (WebView2 too old), the module does nothing.

import { state } from "./app.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher } from "./searchopts.js";

const HIGHLIGHT_NAME = "word-occurrences";
const MIN_LEN = 2; // avoids single-character noise
const MAX_LEN = 100; // beyond this, it is no longer a "word" to track

const supported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

let scheduled = 0;

function clearHighlight() {
  window.CSS.highlights.delete(HIGHLIGHT_NAME);
}

// The active tab's view, only if it is visible (the other views and the tab
// bar / dialogs must not trigger highlighting).
/** @returns {HTMLElement | null} */
function activeViewEl() {
  // `active` null: `get` returns undefined, discarded right after.
  const v = state.views.get(/** @type {number} */ (state.active));
  if (!v || v.el.style.display === "none") return null;
  return v.el;
}

// Returns the word to track, or null if the selection is not a single usable token.
/**
 * @param {Selection | null} sel
 * @returns {string | null}
 */
function selectedWord(sel) {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const trimmed = sel.toString().trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null;
  if (/\s/.test(trimmed)) return null; // a single word: no inner space/line break
  return trimmed;
}

// One Range per occurrence in the view (case-insensitive, like a search;
// cf. textmatch.js for the re-gluing of a colorized line's nodes). The selected
// word itself is included: the native selection visually covers it.
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
  // Empty/multi-word selection, or outside the active view (tab bar, settings…).
  // `sel` is non-null here: `selectedWord(null)` returns null, hence the cast.
  if (!word || !viewEl || !viewEl.contains(/** @type {Selection} */ (sel).anchorNode)) {
    clearHighlight();
    return;
  }
  highlightOccurrences(viewEl, word);
}

export function initFindWord() {
  if (!supported) return;
  // selectionchange fires in bursts during a drag; we coalesce to one pass
  // per frame so as not to re-walk the document on every micro-event.
  document.addEventListener("selectionchange", () => {
    if (scheduled) return;
    scheduled = requestAnimationFrame(update);
  });
}
