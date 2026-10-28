// @ts-check
// Search for occurrences in a view, as `Range`s for the CSS Custom Highlight
// API (findword.js, docsearch.js and globalsearch.js). The pattern arrives
// already compiled as a global RegExp (cf. searchopts.js: case, whole word,
// regex).
//
// A plain walk over the text nodes is no longer enough now that the source view
// is colorized: the coloring splits a line into several text nodes
// (`fetch<span>(</span>…`), and an occurrence straddling two of them would be
// lost. So we concatenate the text nodes of a **single source line**
// (`.src-line`) before searching, then remap the positions.
//
// Outside the source view, each node stays isolated — gluing neighboring nodes
// would create phantom occurrences between two preview blocks (end of one
// paragraph + start of the next).
//
// Folded content is not searched: body of a closed `<details>` (the plugins'
// `kd-fold` accordions, the sources folded under a TikZ figure…) and `hidden`
// elements. An occurrence nobody can see would make navigation jump to a place
// where the word does not appear. The test is structural, not
// `checkVisibility()`: that one would also reject `display: contents`
// elements, which have no box but whose text is displayed.

import { iterMatches } from "./searchopts.js";

// Safety cap: beyond it, highlighting adds nothing and the cost (one Range per
// occurrence) becomes noticeable — `.` or `\s` in regex mode.
const MAX_RANGES = 5000;

/** @typedef {{ node: Text, start: number }} Part  text node and its offset in the concatenated text */

/**
 * Body of a closed `<details>`: everything except its `<summary>`.
 * @param {Node} node
 * @returns {boolean}
 */
function inClosedDetails(node) {
  const p = node.parentElement;
  return p?.tagName === "DETAILS" && !(/** @type {HTMLDetailsElement} */ (p).open) && node.nodeName !== "SUMMARY";
}

// Walk filter: a folded subtree is dropped as a whole (REJECT), other elements
// are traversed without being emitted (SKIP) — only visible text nodes come
// out of the walker.
/**
 * @param {Node} node
 * @returns {number}
 */
function visibleText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return inClosedDetails(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  }
  // `hidden`: HTMLElement only — undefined on an SVG/MathML element.
  return /** @type {HTMLElement} */ (node).hidden === true || inClosedDetails(node)
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_SKIP;
}

/**
 * Maps an offset in the concatenated text onto the text node that holds it.
 * @param {Part[]} parts
 * @param {number} offset
 * @returns {[Text, number]}
 */
function locate(parts, offset) {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (offset >= parts[i].start) return [parts[i].node, offset - parts[i].start];
  }
  return [parts[0].node, 0];
}

/**
 * @param {Part[]} parts
 * @param {string} text
 * @param {RegExp} re
 * @param {Range[]} ranges
 */
function matchGroup(parts, text, re, ranges) {
  for (const m of iterMatches(re, text, MAX_RANGES - ranges.length)) {
    const range = document.createRange();
    range.setStart(...locate(parts, m.index));
    range.setEnd(...locate(parts, m.index + m[0].length));
    ranges.push(range);
  }
}

/**
 * All the `Range`s covering the occurrences of `re` (global RegExp) in
 * `root`, in document order — folded content excluded.
 * @param {Node} root
 * @param {RegExp | null} re
 * @returns {Range[]}
 */
export function collectMatchRanges(root, re) {
  /** @type {Range[]} */
  const ranges = [];
  if (!re) return ranges;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    visibleText,
  );
  /** @type {Node | null} */
  let key = null; // current source line, or the node itself outside the source view
  /** @type {Part[]} */
  let parts = [];
  let text = "";
  const flush = () => {
    if (parts.length && ranges.length < MAX_RANGES) matchGroup(parts, text, re, ranges);
    parts = [];
    text = "";
  };
  /** @type {Text | null} — the filter only accepts text nodes */
  let node;
  while ((node = /** @type {Text | null} */ (walker.nextNode()))) {
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
