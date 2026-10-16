// Coloration du source LaTeX (`latex-source`), pour la vue « code source » de
// l'application.
//
// Pas de highlight.js embarqué ici : LaTeX se scanne en une passe, et un
// coloriseur maison évite 125 Ko de vendor pour cinq concepts. Le contrat de
// l'hôte est de toute façon du HTML `<span class="hljs-…">` (§6.4), re-sanitizé
// à l'arrivée — les classes suffisent, la mécanique hljs n'est pas requise.
//
// Une couleur par **concept LaTeX**, pas par famille technique :
//   commentaire · maths · structure (\section, \begin…) · nom d'environnement ·
//   autre commande · séparateur de tableau.
//
// Passe **unique** : une seule regex alternée décide quel concept l'emporte à
// chaque position, ce qui rend les chevauchements impossibles (un `$` dans un
// commentaire n'ouvre pas de formule, un `%` dans une formule ne la coupe pas).

// Commandes qui structurent le document — le reste des `\foo` est une commande
// ordinaire (mise en forme, macro utilisateur…).
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
    // Display d'abord : `\[` serait sinon lu comme une simple séquence échappée.
    "(?<dmath>\\$\\$[\\s\\S]*?\\$\\$|\\\\\\[[\\s\\S]*?\\\\\\]|\\\\\\([\\s\\S]*?\\\\\\))",
    "(?<esc>\\\\[^A-Za-z@])", // \% \& \\ … : avant le reste (désamorce % et $)
    "(?<comment>%[^\\n]*)",
    "(?<imath>\\$(?:\\\\.|[^$\\\\\\n])*\\$)", // inline : borné à la ligne, un `$` seul ne contamine rien
    "(?<env>\\\\(?:begin|end)\\s*\\{[^}\\n]*\\})",
    "(?<cmd>\\\\[A-Za-z@]+\\*?)",
    "(?<amp>&)",
  ].join("|"),
  "g",
);

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(cls, text) {
  const classes = cls.split(" ").map((c) => `hljs-${c}`).join(" ");
  return `<span class="${classes}">${esc(text)}</span>`;
}

/** Source LaTeX → HTML coloré (spans `hljs-*`, texte échappé). */
export function highlightLatex(code) {
  const src = String(code ?? "");
  let out = "";
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups;
    if (g.esc || g.amp) out += span("operator", m[0]);
    else if (g.comment) out += span("comment", m[0]);
    // `hljs-formula` serait le nom juste, mais les thèmes GitHub de l'hôte lui
    // donnent le gris **des commentaires** : maths et commentaires deviendraient
    // indistinguables. `hljs-string` porte la seule autre couleur libre — un bleu
    // marine proche du noir, d'où l'italique de `hljs-emphasis` par-dessus : les
    // maths se reconnaissent alors à la forme, comme en typographie mathématique.
    else if (g.dmath || g.imath) out += span("string emphasis", m[0]);
    else if (g.env) {
      // `\begin{align}` : le mot-clé et le nom de l'environnement sont deux
      // concepts distincts — on ne colore pas les accolades.
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
