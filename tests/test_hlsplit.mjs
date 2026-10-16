// Test du découpage ligne à ligne d'un flot HTML coloré (ui/js/hlsplit.js) —
// autonome, sans dépendance npm et sans application lancée : il importe le
// module pur et le confronte au **highlight.js vendoré du dépôt**, celui qui
// tournera réellement dans la webview.
//
//   node tests/test_hlsplit.mjs                 # suite de non-régression
//   node tests/test_hlsplit.mjs fichier.md …    # + vrais documents
//
// Les deux invariants qui comptent — c'est sur eux que repose l'alignement
// preview ↔ source de la vue code source :
//   1. une entrée par ligne du source, exactement ;
//   2. le texte, spans retirés, est identique au source ligne pour ligne.

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

/** Texte visible d'une ligne HTML : balises retirées, entités hljs décodées. */
function plain(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Chaque ligne doit être un fragment HTML équilibré (spans refermés). */
function balanced(html) {
  let depth = 0;
  for (const m of html.matchAll(/<span\b[^>]*>|<\/span>/g)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Invariants complets sur un source colorisé par une grammaire hljs. */
function checkRoundTrip(label, source, lang) {
  const html = hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
  const lines = source.split("\n");
  const painted = splitHighlightedLines(html);
  check(`${label} : une entrée par ligne`, painted.length === lines.length, `${painted.length} ≠ ${lines.length}`);
  const bad = [];
  for (let i = 0; i < Math.min(painted.length, lines.length); i++) {
    if (plain(painted[i]) !== lines[i]) bad.push(`L${i + 1} : ${JSON.stringify(plain(painted[i]).slice(0, 80))} ≠ ${JSON.stringify(lines[i].slice(0, 80))}`);
  }
  check(`${label} : texte préservé ligne à ligne`, bad.length === 0, bad.slice(0, 5).join("\n"));
  const unbalanced = painted.map((h, i) => (balanced(h) ? null : i + 1)).filter(Boolean);
  check(`${label} : spans équilibrés sur chaque ligne`, unbalanced.length === 0, `lignes ${unbalanced.slice(0, 10).join(", ")}`);
  return painted;
}

group("Découpage — cas de base", () => {
  check("texte nu, 3 lignes", splitHighlightedLines("a\nb\nc").length === 3);
  check("chaîne vide → 1 ligne vide", JSON.stringify(splitHighlightedLines("")) === '[""]');
  check(
    "aucun saut de ligne → flot intact",
    splitHighlightedLines('<span class="hljs-x">a</span>')[0] === '<span class="hljs-x">a</span>',
  );
  const nl = splitHighlightedLines("a\n\nb");
  check("ligne vide médiane conservée", nl.length === 3 && nl[1] === "", JSON.stringify(nl));
});

group("Découpage — spans à cheval", () => {
  const out = splitHighlightedLines('<span class="hljs-c">un\ndeux</span>fin');
  check("2 lignes", out.length === 2, JSON.stringify(out));
  check("span refermé en fin de ligne 1", out[0] === '<span class="hljs-c">un</span>', out[0]);
  check("span rouvert à l'identique ligne 2", out[1] === '<span class="hljs-c">deux</span>fin', out[1]);

  const nested = splitHighlightedLines('<span class="a"><span class="b">x\ny</span>z</span>');
  check("imbrication : 2 lignes", nested.length === 2, JSON.stringify(nested));
  check("imbrication : pile rouverte dans l'ordre", nested[1].startsWith('<span class="a"><span class="b">y'), nested[1]);
  check("imbrication : lignes équilibrées", nested.every(balanced), JSON.stringify(nested));

  const deep = splitHighlightedLines('<span class="a">1\n<span class="b">2\n3</span>\n4</span>');
  check("3 sauts → 4 lignes", deep.length === 4, JSON.stringify(deep));
  check("profondeur variable : lignes équilibrées", deep.every(balanced), JSON.stringify(deep));
});

group("Découpage — entrées malformées (jamais de crash)", () => {
  check("fermeture orpheline ignorée", splitHighlightedLines("a</span>\nb").length === 2);
  check("`<` isolé toléré", splitHighlightedLines("a < b\nc").length === 2);
  const unclosed = splitHighlightedLines('<span class="a">x\ny');
  check("span jamais refermé : lignes équilibrées", unclosed.every(balanced), JSON.stringify(unclosed));
});

group("Markdown réel (grammaire hljs vendorée)", () => {
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
  const painted = checkRoundTrip("markdown de référence", md, "markdown");
  check("fence colorée (au moins un span)", painted.some((l) => l.includes("<span")), "aucune coloration émise");
});

group("Grammaire absente / autres langages", () => {
  check("langage inconnu signalé par hljs", !hljs.getLanguage("tex-source"));
  checkRoundTrip("xml", '<a href="x">\n<b/>\n</a>', "xml");
});

const files = process.argv.slice(2);
if (files.length) {
  group("Documents fournis", () => {
    for (const file of files) {
      if (!fs.existsSync(file)) {
        check(`${file} : lisible`, false, "fichier introuvable");
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      const t0 = Date.now();
      const painted = checkRoundTrip(path.basename(file), src, "markdown");
      console.log(`  · ${path.basename(file)} — ${Date.now() - t0} ms, ${painted.length} lignes`);
    }
  });
}

console.log(`\n${failures ? "ÉCHEC" : "OK"} — ${checks - failures}/${checks} vérifications passées`);
process.exit(failures ? 1 : 0);
