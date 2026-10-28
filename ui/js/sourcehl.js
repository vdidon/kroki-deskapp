// @ts-check
// Syntax highlighting of the **source code view** (the "source code" button).
//
// Structural constraint: the view is one `<div class="src-line">` per line
// (cf. renderSource) — this is what guarantees "1 logical line = 1 visual
// line" and makes the preview ↔ source alignment independent of rendering. Yet
// a colorizer produces **a single** HTML stream where a `<span>` can straddle
// several lines (markdown fence, multi-line string or comment): it is
// `splitHighlightedLines` (hlsplit.js) that re-cuts it.
//
// Two coloring sources, same rules as elsewhere in the app (§6.4):
//   - the host's hljs grammar (markdown) — trusted output, hljs escapes the
//     text itself;
//   - `highlight:code` plugin (tex-source…) — third-party code, asynchronous:
//     only `<span class="…">` survive DOMPurify.
//
// Never blocking and never destructive: at the slightest doubt (error, line
// count that does not add up, view already toggled again) we keep the plain text.

import { pluginHighlight } from "./plugins.js";
import { splitHighlightedLines } from "./hlsplit.js";

/** Requested highlighting: `{ lang, plugin }` from `sourceHighlightFor`, or null.
 * @typedef {ReturnType<typeof import("./plugins.js").sourceHighlightFor>} SourceHighlight */

// Beyond this, we do not color: the cost (highlighting + N innerHTML) is not
// worth the comfort on a file nobody reads line by line.
const MAX_CHARS = 1_000_000;

/**
 * Output of a plugin (third-party code): we only keep the spans and their class.
 *
 * @param {string} html
 * @returns {string}
 */
function sanitizeSpans(html) {
  return window.DOMPurify.sanitize(html, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] });
}

/**
 * Applies a colorized stream to the already-rendered lines. Gives up — touching
 * nothing — if the split does not exactly cover the displayed lines or if the
 * view changed in the meantime (asynchronous plugin highlighting).
 *
 * @param {HTMLElement} root
 * @param {string[]} lines
 * @param {string} html
 */
function applyLines(root, lines, html) {
  if (!root.isConnected) return;
  const painted = splitHighlightedLines(html);
  if (painted.length !== lines.length || root.children.length !== lines.length) return;
  const divs = root.children;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "") continue; // empty line: keep the ZWSP that holds the height
    divs[i].innerHTML = painted[i];
  }
}

/**
 * Colors an already-built source view. `hl` = `{ lang, plugin }` obtained from
 * `sourceHighlightFor` (null plugin → the host's hljs grammar). No effect if
 * the grammar is missing: the view stays plain text.
 *
 * @param {HTMLElement} root
 * @param {string[]} lines
 * @param {SourceHighlight} hl
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
      /* grammar failed: plain text, nothing broken */
    }
    return;
  }
  // Plugin: worker + timeout (§7.1). The coloring arrives afterwards, without
  // touching heights (1 div = 1 line) — so without disturbing the
  // `scrollToLine` the caller has already done.
  pluginHighlight(hl.plugin, { lang: hl.lang, code: text })
    .then((html) => applyLines(root, lines, sanitizeSpans(html)))
    .catch(() => {});
}
