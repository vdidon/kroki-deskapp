// Test of the line-by-line splitting of a colored HTML stream (ui/js/hlsplit.js) —
// standalone, no npm dependency and no running application: it imports the
// pure module and checks it against the **repo's vendored highlight.js**, the
// one that will actually run in the webview.
//
//   node tests/test_hlsplit.mjs                 # regression suite
//   node tests/test_hlsplit.mjs file.md …       # + real documents
//
// The two invariants that matter — the preview ↔ source alignment of the
// source code view rests on them:
//   1. exactly one entry per source line;
//   2. the text, spans stripped, is identical to the source line for line.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const hljs = require(path.join(repo, "ui/vendor/highlight.min.js"));
const { splitHighlightedLines } = await import(
  "file:///" + path.join(repo, "ui/js/hlsplit.js").replace(/\\/g, "/")
);

let failures = 0;
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (cond) return;
  failures++;
  console.log(`  ✗ ${name}`);
  if (detail) console.log(`      ${String(detail).replace(/\n/g, "\n      ").slice(0, 600)}`);
}

function group(title, fn) {
  console.log(`\n${title}`);
  fn();
}

/** Visible text of an HTML line: tags stripped, hljs entities decoded. */
function plain(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Each line must be a balanced HTML fragment (spans closed). */
function balanced(html) {
  let depth = 0;
  for (const m of html.matchAll(/<span\b[^>]*>|<\/span>/g)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Full invariants on a source colorized by an hljs grammar. */
function checkRoundTrip(label, source, lang) {
  const html = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
  const lines = source.split("\n");
  const painted = splitHighlightedLines(html);
  check(`${label}: one entry per line`, painted.length === lines.length, `${painted.length} ≠ ${lines.length}`);
  const bad = [];
  for (let i = 0; i < Math.min(painted.length, lines.length); i++) {
    if (plain(painted[i]) !== lines[i]) bad.push(`L${i + 1} : ${JSON.stringify(plain(painted[i]).slice(0, 80))} ≠ ${JSON.stringify(lines[i].slice(0, 80))}`);
  }
  check(`${label}: text preserved line by line`, bad.length === 0, bad.slice(0, 5).join("\n"));
  const unbalanced = painted.map((h, i) => (balanced(h) ? null : i + 1)).filter(Boolean);
  check(`${label}: balanced spans on every line`, unbalanced.length === 0, `lines ${unbalanced.slice(0, 10).join(", ")}`);
  return painted;
}

group("Splitting — basic cases", () => {
  check("plain text, 3 lines", splitHighlightedLines("a\nb\nc").length === 3);
  check("empty string → 1 empty line", JSON.stringify(splitHighlightedLines("")) === '[""]');
  check(
    "no line break → stream intact",
    splitHighlightedLines('<span class="hljs-x">a</span>')[0] === '<span class="hljs-x">a</span>',
  );
  const nl = splitHighlightedLines("a\n\nb");
  check("middle empty line kept", nl.length === 3 && nl[1] === "", JSON.stringify(nl));
});

group("Splitting — spans straddling lines", () => {
  const out = splitHighlightedLines('<span class="hljs-c">un\ndeux</span>fin');
  check("2 lines", out.length === 2, JSON.stringify(out));
  check("span closed at end of line 1", out[0] === '<span class="hljs-c">un</span>', out[0]);
  check("span reopened identically on line 2", out[1] === '<span class="hljs-c">deux</span>fin', out[1]);

  const nested = splitHighlightedLines('<span class="a"><span class="b">x\ny</span>z</span>');
  check("nesting: 2 lines", nested.length === 2, JSON.stringify(nested));
  check("nesting: stack reopened in order", nested[1].startsWith('<span class="a"><span class="b">y'), nested[1]);
  check("nesting: balanced lines", nested.every(balanced), JSON.stringify(nested));

  const deep = splitHighlightedLines('<span class="a">1\n<span class="b">2\n3</span>\n4</span>');
  check("3 breaks → 4 lines", deep.length === 4, JSON.stringify(deep));
  check("varying depth: balanced lines", deep.every(balanced), JSON.stringify(deep));
});

group("Splitting — malformed input (never crashes)", () => {
  check("orphan closing tag ignored", splitHighlightedLines("a</span>\nb").length === 2);
  check("stray `<` tolerated", splitHighlightedLines("a < b\nc").length === 2);
  const unclosed = splitHighlightedLines('<span class="a">x\ny');
  check("span never closed: balanced lines", unclosed.every(balanced), JSON.stringify(unclosed));
});

group("Real Markdown (vendored hljs grammar)", () => {
  const md = [
    "# Titre",
    "",
    "Un *paragraphe* avec `code` et un [lien](http://x/y).",
    "",
    "```js",
    "const a = 1; // commentaire",
    "const s = `chaîne",
    "sur deux lignes`;",
    "```",
    "",
    "> citation & <balise> \"guillemets\"",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
  ].join("\n");
  const painted = checkRoundTrip("reference markdown", md, "markdown");
  check("colored fence (at least one span)", painted.some((l) => l.includes("<span")), "no coloring emitted");
});

group("Missing grammar / other languages", () => {
  check("unknown language reported by hljs", !hljs.getLanguage("tex-source"));
  checkRoundTrip("xml", '<a href="x">\n<b/>\n</a>', "xml");
});

const files = process.argv.slice(2);
if (files.length) {
  group("Supplied documents", () => {
    for (const file of files) {
      if (!fs.existsSync(file)) {
        check(`${file}: readable`, false, "file not found");
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      const t0 = Date.now();
      const painted = checkRoundTrip(path.basename(file), src, "markdown");
      console.log(`  · ${path.basename(file)} — ${Date.now() - t0} ms, ${painted.length} lines`);
    }
  });
}

console.log(`\n${failures ? "FAILED" : "OK"} — ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
