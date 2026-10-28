// @ts-check
// Splitting of a colorized HTML stream into one entry per line.
//
// **Pure** module (no DOM or app dependency): it is the only risky part of the
// source view's highlighting, and is tested outside the browser by
// `tests/test_hlsplit.mjs`.

/**
 * Splits `html` at every `\n`, rebalancing the straddling `<span>`s: those
 * still open are closed at the end of the line and reopened identically at the
 * start of the next. Expected input: only `<span …>`, `</span>` and escaped
 * text (`&lt;`) — the form produced by hljs and, after DOMPurify
 * sanitization, by the `highlight:code` plugins.
 *
 * The number of returned entries always equals `html.split("\n").length` on the
 * text side: the caller uses it as a safeguard before painting.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function splitHighlightedLines(html) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const open = []; // stack of opening tags, verbatim (classes included)
  let cur = "";
  const re = /<span\b[^>]*>|<\/span>|[^<]+|</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tok = m[0];
    if (tok[0] === "<") {
      if (tok === "<") continue; // lone `<`: neither tag nor text, ignored
      if (tok[1] === "/") {
        if (open.length === 0) continue; // orphan closing tag: do not unbalance
        open.pop();
      } else {
        open.push(tok);
      }
      cur += tok;
      continue;
    }
    const parts = tok.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        cur += "</span>".repeat(open.length);
        lines.push(cur);
        cur = open.join("");
      }
      cur += parts[i];
    }
  }
  lines.push(cur + "</span>".repeat(open.length)); // truncated stream: close it
  return lines;
}
