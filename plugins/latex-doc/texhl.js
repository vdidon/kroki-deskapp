// @ts-check
// Syntax highlighting of LaTeX source (`latex-source`), for the application's
// "source code" view.
//
// No highlight.js bundled here: LaTeX can be scanned in a single pass, and a
// home-made highlighter avoids 125 KB of vendor code for five concepts. The
// host's contract is plain HTML `<span class="hljs-…">` anyway (§6.4), re-sanitized
// on arrival — the classes are enough, the hljs machinery is not required.
//
// One color per **LaTeX concept**, not per technical family:
//   comment · math · structure (\section, \begin…) · environment name ·
//   other command · table separator.
//
// **Single** pass: one alternation regex decides which concept wins at each
// position, which makes overlaps impossible (a `$` in a comment does not open
// a formula, a `%` in a formula does not cut it short).

// Commands that structure the document — any other `\foo` is an ordinary
// command (formatting, user macro…).
const STRUCTURE = new Set([
  "documentclass", "usepackage", "begin", "end",
  "part", "chapter", "section", "subsection", "subsubsection", "paragraph",
  "newcommand", "renewcommand", "providecommand", "def",
  "newtheorem", "theoremstyle", "newenvironment",
  "label", "ref", "eqref", "pageref", "cite", "bibliography", "bibliographystyle",
  "input", "include", "title", "author", "date", "maketitle", "tableofcontents",
  "item", "caption", "footnote", "tag",
]);

const TOKEN = new RegExp(
  [
    // Display first: `\[` would otherwise be read as a plain escape sequence.
    "(?<dmath>\\$\\$[\\s\\S]*?\\$\\$|\\\\\\[[\\s\\S]*?\\\\\\]|\\\\\\([\\s\\S]*?\\\\\\))",
    "(?<esc>\\\\[^A-Za-z@])", // \% \& \\ … : before the rest (defuses % and $)
    "(?<comment>%[^\\n]*)",
    "(?<imath>\\$(?:\\\\.|[^$\\\\\\n])*\\$)", // inline: bounded to the line, a lone `$` contaminates nothing
    "(?<env>\\\\(?:begin|end)\\s*\\{[^}\\n]*\\})",
    "(?<cmd>\\\\[A-Za-z@]+\\*?)",
    "(?<amp>&)",
  ].join("|"),
  "g",
);

/**
 * @param {unknown} s
 * @returns {string}
 */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} cls classes hljs sans préfixe, séparées par une espace
 * @param {string} text
 * @returns {string}
 */
function span(cls, text) {
  const classes = cls.split(" ").map((c) => `hljs-${c}`).join(" ");
  return `<span class="${classes}">${esc(text)}</span>`;
}

/**
 * LaTeX source → colored HTML (`hljs-*` spans, escaped text).
 * @param {unknown} code
 * @returns {string}
 */
export function highlightLatex(code) {
  const src = String(code ?? "");
  let out = "";
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    // `TOKEN` only has named groups: `groups` is always present.
    const g = /** @type {Record<string, string | undefined>} */ (m.groups);
    if (g.esc || g.amp) out += span("operator", m[0]);
    else if (g.comment) out += span("comment", m[0]);
    // `hljs-formula` would be the right name, but the host's GitHub themes give
    // it the **comment** grey: math and comments would become indistinguishable.
    // `hljs-string` carries the only other free color — a navy blue close to
    // black, hence the italics of `hljs-emphasis` on top: math is then
    // recognized by its shape, as in mathematical typesetting.
    else if (g.dmath || g.imath) out += span("string emphasis", m[0]);
    else if (g.env) {
      // `\begin{align}`: the keyword and the environment name are two distinct
      // concepts — the braces are not colored.
      const cut = m[0].indexOf("{");
      out += span("keyword", m[0].slice(0, cut));
      out += `{${span("title", m[0].slice(cut + 1, -1))}}`;
    } else if (g.cmd) {
      const name = m[0].slice(1).replace(/\*$/, "");
      out += span(STRUCTURE.has(name) ? "keyword" : "built_in", m[0]);
    }
  }
  return out + esc(src.slice(last));
}
