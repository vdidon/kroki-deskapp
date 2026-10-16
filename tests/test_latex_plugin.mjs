// Test du plugin latex-doc (rendu des .tex) — autonome, sans dépendance npm et
// sans application lancée : il importe directement `plugins/latex-doc/tex.js`
// et compile les formules produites avec le **KaTeX vendoré du dépôt**, celui
// qui tournera réellement dans la webview.
//
//   node tests/test_latex_plugin.mjs                 # suite de non-régression
//   node tests/test_latex_plugin.mjs fichier.tex …   # + vrais documents
//
// Les deux vérifications qui comptent :
//   1. la structure attendue est présente dans le markdown dérivé ;
//   2. **toute** formule émise compile — une formule refusée par KaTeX
//      s'afficherait en rouge dans l'application.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const MARKER = String.fromCharCode(1); // marqueur interne de reference (tex.js)
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const katex = require(path.join(repo, "ui/vendor/katex/katex.min.js"));
const { texToMarkdown, docLanguage } = await import(
  "file:///" + path.join(repo, "plugins/latex-doc/tex.js").replace(/\\/g, "/")
);
const { highlightLatex } = await import(
  "file:///" + path.join(repo, "plugins/latex-doc/texhl.js").replace(/\\/g, "/")
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

/**
 * Extrait les formules d'un markdown : blocs `$$` isolés puis `$…$` inline.
 * Les blocs de code clôturés sont exclus — markdown-it n'y cherche pas de
 * formule (source TikZ replié, JSON d'exemple…).
 */
function formulasOf(md) {
  const lines = md.split("\n");
  const out = [];
  const inDisplay = new Set();
  let open = -1;
  let fence = null;
  lines.forEach((l, i) => {
    const f = /^\s*(`{3,})/.exec(l);
    if (fence ? f && f[1].length >= fence.length && !l.trim().slice(f[1].length) : f) {
      fence = fence ? null : f[1];
      inDisplay.add(i);
      return;
    }
    if (fence) {
      inDisplay.add(i);
      return;
    }
    if (l.trim() !== "$$") return;
    if (open < 0) {
      open = i;
    } else {
      out.push({ kind: "display", line: open + 1, tex: lines.slice(open + 1, i).join("\n") });
      for (let k = open; k <= i; k++) inDisplay.add(k);
      open = -1;
    }
  });
  const unclosed = open >= 0 ? open + 1 : 0;
  const split = [];
  lines.forEach((l, i) => {
    if (inDisplay.has(i)) return;
    // Un `$` littéral est émis en entité : un nombre impair de `$` sur une
    // ligne est une formule coupée par une fin de ligne, que texmath ne
    // reconnaîtra pas (et que la regex ci-dessous ne verrait pas).
    if ((l.match(/(?<!\\)\$/g) ?? []).length % 2) split.push(i + 1);
    for (const m of l.matchAll(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g)) {
      out.push({ kind: "inline", line: i + 1, tex: m[1] });
    }
  });
  return { formulas: out, unclosed, split };
}

/**
 * Invariant d'ancrage : une ancre est toujours posée juste avant un contenu
 * réel. Si elle pointe une ligne vide, c'est qu'une ligne a été retirée après
 * coup sans réaccorder les ancres — la synchro preview ↔ source dériverait.
 */
function misalignedAnchors(md, anchors) {
  const lines = md.split("\n");
  return anchors.filter(([mdLine]) => mdLine >= lines.length || lines[mdLine].trim() === "");
}

/** Compile toutes les formules ; retourne la liste des échecs. */
function katexErrors(md) {
  const { formulas, unclosed, split } = formulasOf(md);
  const errors = [];
  if (unclosed) errors.push({ line: unclosed, tex: "(bloc $$ non fermé)", msg: "délimiteur display non fermé" });
  for (const line of split) {
    errors.push({ line, tex: md.split("\n")[line - 1], msg: "formule inline coupée par une fin de ligne" });
  }
  for (const f of formulas) {
    try {
      katex.renderToString(f.tex, {
        displayMode: f.kind === "display",
        throwOnError: true,
        output: "htmlAndMathml",
      });
    } catch (e) {
      errors.push({ ...f, msg: String(e.message).replace(/\s+/g, " ").slice(0, 160) });
    }
  }
  return { errors, total: formulas.length };
}

const doc = (body, preamble = "") =>
  `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;

// --------------------------------------------------------------------------- //

group("Titre, sections et sommaire", () => {
  const { markdown } = texToMarkdown(
    doc("\\section{Objet}\\label{s:o}\nTexte.\n\\subsection{Détail}\nSuite.\n\\section*{Annexe}\nFin."),
    { title: "fallback" },
  );
  check("titre de repli utilisé quand \\title est absent", markdown.startsWith("# fallback"), markdown.slice(0, 60));
  check("section numérotée en h2", /^## 1 Objet$/m.test(markdown), markdown);
  check("sous-section numérotée en h3", /^### 1\.1 Détail$/m.test(markdown), markdown);
  check("section étoilée non numérotée", /^## Annexe$/m.test(markdown), markdown);
  check("ancre posée avant le titre", markdown.includes('<div id="sec-1"></div>'), markdown);

  const t = texToMarkdown(doc("Corps."), { title: "x", }).markdown;
  check("document sans \\title reste titré", t.startsWith("# x"), t.slice(0, 40));

  const withTitle = texToMarkdown(
    doc("Corps.", "\\title{Vrai titre \\\\ sur deux lignes}\\author{A}"),
    { title: "ignoré" },
  ).markdown;
  check("\\title prime sur le nom de fichier", withTitle.startsWith("# Vrai titre sur deux lignes"), withTitle.slice(0, 80));
  check("\\\\ dans le titre replié sur une ligne", !/^# .*\n .*sur deux/.test(withTitle), withTitle.slice(0, 80));
  check("auteur rendu", withTitle.includes("*A*"), withTitle.slice(0, 120));
});

group("Références croisées", () => {
  const { markdown, warnings } = texToMarkdown(
    doc(
      "\\section{Un}\\label{s:un}\n" +
        "Voir section~\\ref{s:un} et l'équation~\\eqref{e:a}.\n" +
        "\\begin{equation}\\label{e:a} x = 1 \\end{equation}\n" +
        "Et \\ref{s:deux}.\n\\section{Deux}\\label{s:deux}\nFin.",
    ),
  );
  check("\\ref arrière résolu en lien", markdown.includes("[1](#sec-1)"), markdown);
  check("\\eqref en avant résolu avec parenthèses", markdown.includes("[(1)](#eq-1)"), markdown);
  check("\\ref en avant résolu", markdown.includes("[2](#sec-2)"), markdown);
  check("équation numérotée taguée", markdown.includes("\\tag{1}"), markdown);
  check("ancre d'équation posée", markdown.includes('<div id="eq-1"></div>'), markdown);
  check("aucun marqueur interne résiduel", !markdown.includes(MARKER), markdown);
  check("aucun avertissement", warnings.length === 0, warnings.join(" | "));

  const broken = texToMarkdown(doc("Voir \\ref{inconnu}."));
  check("référence inconnue signalée", broken.warnings.some((w) => w.includes("unresolved")), broken.warnings.join(" | "));
  check("référence inconnue rendue visiblement", broken.markdown.includes("**?**"), broken.markdown);
});

// Une ancre numérotée (`eq-3`) bouge dès qu'on insère une équation en amont :
// seul le label LaTeX est une cible stable pour un lien venu d'un autre document
// (`../doc/modele.tex#eq:sigmaU`).
group("Ancres de label (cibles stables inter-documents)", () => {
  const { markdown, anchors } = texToMarkdown(
    doc(
      "\\section{Modèle}\\label{sec:modele}\n" +
        "\\begin{equation}\\label{eq:sigmaU} \\sigma = 1 \\end{equation}\n" +
        "\\subsection*{Annexe C}\\label{sec:annexeC}\n" +
        "Voir \\eqref{eq:sigmaU} et la section~\\ref{sec:modele}.\n",
    ),
  );
  const lines = markdown.split("\n");
  const lineOf = (id) => lines.findIndex((l) => l.includes(`<div id="${id}"></div>`));

  check("label d'équation posé en ancre", lineOf("eq:sigmaU") >= 0, markdown);
  check("alias greffé sur la ligne de l'ancre numérotée", lineOf("eq:sigmaU") === lineOf("eq-1"), markdown);
  check("casse du label préservée", !markdown.includes('id="eq:sigmau"'), markdown);
  check("label de section numérotée", lineOf("sec:modele") >= 0 && lineOf("sec:modele") === lineOf("sec-1"), markdown);
  check("label de sous-section étoilée", lineOf("sec:annexeC") >= 0, markdown);
  check("\\eqref vise toujours l'ancre numérotée", markdown.includes("[(1)](#eq-1)"), markdown);
  check("ancres de synchro toujours alignées", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const multi = texToMarkdown(doc("\\begin{equation}\\label{eq:a}\\label{eq:b} x = 1 \\end{equation}")).markdown;
  check(
    "deux labels sur une même cible → deux ancres",
    multi.includes('<div id="eq:a"></div>') && multi.includes('<div id="eq:b"></div>'),
    multi,
  );

  // Un label qui porte le nom d'une ancre numérotée ne doit pas la dupliquer.
  const clash = texToMarkdown(
    doc("\\begin{equation} x = 1 \\end{equation}\n\\begin{equation}\\label{eq-1} y = 2 \\end{equation}"),
  ).markdown;
  check("aucun identifiant dupliqué", (clash.match(/id="eq-1"/g) || []).length === 1, clash);

  // Cible non ancrable (aucun objet numéroté ouvert) : aucune ancre inventée.
  const orphan = texToMarkdown(doc("Texte nu.\\label{x:orphelin}")).markdown;
  check("label orphelin ignoré", !orphan.includes('id="x:orphelin"'), orphan);

  // Les listes retirent des lignes déjà émises : l'index de l'ancre doit suivre.
  const inList = texToMarkdown(
    doc(
      "\\begin{itemize}\n\\item Un\n\\item Deux\n\\end{itemize}\n" +
        "\\section{Après}\\label{sec:apres}\n\\begin{equation}\\label{eq:apres} z = 0 \\end{equation}",
    ),
  ).markdown.split("\n");
  const at = (id) => inList.findIndex((l) => l.includes(`<div id="${id}"></div>`));
  check("alias correct après une liste (section)", at("sec:apres") >= 0 && at("sec:apres") === at("sec-1"), inList.join("\n"));
  check("alias correct après une liste (équation)", at("eq:apres") >= 0 && at("eq:apres") === at("eq-1"), inList.join("\n"));
});

group("Théorèmes (amsthm)", () => {
  const preamble =
    "\\newtheorem{theorem}{Théorème}\n" +
    "\\newtheorem{proposition}[theorem]{Proposition}\n" +
    "\\newtheorem{hypothese}{Hypothèse}\n" +
    "\\newtheorem*{rem}{Remarque}\n";
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{theorem}[Nommé]\\label{t:1} Énoncé. \\end{theorem}\n" +
        "\\begin{proposition}\\label{p:1} Autre. \\end{proposition}\n" +
        "\\begin{hypothese}\\label{h:1} Une hypothèse. \\end{hypothese}\n" +
        "\\begin{rem} Sans numéro. \\end{rem}\n" +
        "\\begin{proof} La preuve. \\end{proof}\n" +
        "Voir \\ref{t:1}, \\ref{p:1} et \\ref{h:1}.",
      preamble,
    ),
  );
  check("théorème numéroté avec son titre, fondu dans le corps", markdown.includes("**Théorème 1** (Nommé). Énoncé."), markdown);
  check("compteur partagé [theorem] respecté", markdown.includes("**Proposition 2.** Autre."), markdown);
  check("compteur indépendant pour hypothese", markdown.includes("**Hypothèse 1.**"), markdown);
  check("environnement étoilé non numéroté", /\*\*Remarque\.\*\*/.test(markdown), markdown);
  check("démonstration rendue (libellé anglais sans babel)", markdown.includes("*Proof.* La preuve."), markdown);
  check("fin de preuve marquée", markdown.includes("∎"), markdown);
  check("références aux théorèmes résolues", /\[1\]\(#theorem-1\)/.test(markdown), markdown);
  check("référence à la proposition résolue", /\[2\]\(#proposition-2\)/.test(markdown), markdown);
});

group("Macros du préambule", () => {
  const preamble =
    "\\newcommand{\\E}{\\mathbb{E}}\n" +
    "\\newcommand{\\hyp}[1]{H\\ref{#1}}\n" +
    "\\newcommand{\\pow}[2][2]{#2^{#1}}\n" +
    "\\DeclareMathOperator{\\tr}{tr}\n" +
    "\\newtheorem{hypothese}{Hypothèse}\n";
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{hypothese}\\label{h:iid} Indépendance. \\end{hypothese}\n" +
        "Sous \\hyp{h:iid}, $\\E[X]$ et $\\tr(A)$ et $\\pow{y}$ et $\\pow[3]{z}$.\n" +
        "\\begin{equation} \\E[\\tr(A)] = 0 \\end{equation}",
      preamble,
    ),
  );
  check("macro sans argument expansée", markdown.includes("\\mathbb{E}[X]"), markdown);
  check("\\DeclareMathOperator expansé", markdown.includes("\\operatorname{tr}(A)"), markdown);
  check("macro à argument optionnel (défaut)", markdown.includes("y^{2}"), markdown);
  check("macro à argument optionnel (fourni)", markdown.includes("z^{3}"), markdown);
  check("macro texte contenant \\ref expansée et résolue", /H\[1\]\(#hypothese-1\)/.test(markdown), markdown);
  check("expansion appliquée aussi en display", markdown.includes("\\mathbb{E}[\\operatorname{tr}(A)]"), markdown);
});

group("Listes", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{itemize}\n\\item Premier point.\n\\item Deuxième avec $x$.\n\\end{itemize}\n" +
        "\\begin{enumerate}\n\\item Un.\n\\item Deux.\n\\end{enumerate}\n" +
        "\\begin{description}\n\\item[Terme] Sa définition.\n\\end{description}",
    ),
  );
  check("puces avec leur contenu", /^- Premier point\.$/m.test(markdown), markdown);
  check("puce contenant une formule", /^- Deuxième avec \$x\$\.$/m.test(markdown), markdown);
  check("liste numérotée", /^1\. Un\.$/m.test(markdown) && /^2\. Deux\.$/m.test(markdown), markdown);
  check("item à marqueur explicite", /^- \*\*Terme\*\* Sa définition\.$/m.test(markdown), markdown);
  check("aucune puce vide", !/^\s*[-\d]+\.?\s*$/m.test(markdown.replace(/^---$/gm, "")), markdown);

  // Les listes retirent des lignes déjà émises : les ancres doivent suivre.
  const nested = texToMarkdown(
    doc(
      "\\section{A}\n\\begin{itemize}\n\\item Externe\n\\begin{itemize}\n\\item Interne\n\\end{itemize}\n" +
        "\\item Suivant\n\\end{itemize}\n\\section{B}\nAprès la liste.",
    ),
  );
  check("liste imbriquée indentée", /^ {2}- Interne$/m.test(nested.markdown), nested.markdown);
  const bad = misalignedAnchors(nested.markdown, nested.anchors);
  check("ancres réaccordées après suppression de lignes", bad.length === 0, JSON.stringify(bad));
});

group("Sauts de ligne", () => {
  const { markdown } = texToMarkdown(doc("Ligne un \\\\ ligne deux.\n\nAutre paragraphe."));
  check("\\\\ rendu en saut de ligne markdown", /Ligne un {2}\nligne deux\./.test(markdown), JSON.stringify(markdown));
  check("paragraphes séparés", /ligne deux\.\n\nAutre paragraphe\./.test(markdown), JSON.stringify(markdown));
});

group("Tables", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{tabular}{lc}\n\\hline\nSymbole & Définition \\\\\n\\hline\n" +
        "$h$ & nombre d'heures \\\\\nP\\&L & résultat \\\\\n\\hline\n\\end{tabular}",
    ),
  );
  const rows = markdown.split("\n").filter((l) => l.startsWith("|"));
  check("table émise avec en-tête et séparateur", rows.length >= 4, markdown);
  check("séparateur & interprété comme colonne", rows[0] === "| Symbole | Définition |", rows[0]);
  check("alignement de la spec repris", rows[1] === "| --- | :---: |", rows[1]);
  check("\\& littéral conservé dans la cellule", rows.some((r) => r.includes("P&L")), rows.join("\n"));
  check("formule préservée en cellule", rows.some((r) => r.includes("$h$")), rows.join("\n"));
});

group("Texte, symboles et échappements", () => {
  const { markdown } = texToMarkdown(
    doc("Coût en \\euro{} --- 100\\% de \\textbf{gras} et \\emph{italique}, caf\\'e, na\\\"ive, gar\\c con. Underscore\\_ici. ``Cité''."),
  );
  check("symbole euro", markdown.includes("€"), markdown);
  check("tiret cadratin", markdown.includes("—"), markdown);
  check("pourcentage échappé rendu", markdown.includes("100%"), markdown);
  check("gras et italique", markdown.includes("**gras**") && markdown.includes("*italique*"), markdown);
  check("accent aigu recomposé", markdown.includes("café"), markdown);
  check("tréma recomposé", markdown.includes("naïve"), markdown);
  check("cédille recomposée", markdown.includes("garçon"), markdown);
  check("underscore échappé pour markdown", markdown.includes("\\_"), markdown);
  check("guillemets typographiques", markdown.includes("“Cité”"), markdown);
});

group("Environnements mathématiques", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{align*} a &= b \\\\ c &= d \\end{align*}\n" +
        "\\begin{equation} \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\end{equation}\n" +
        "\\begin{equation*} u = v \\end{equation*}\n" +
        "\\[ w = z \\]",
    ),
  );
  check("align* ré-encapsulé pour KaTeX", markdown.includes("\\begin{align*}"), markdown);
  check("sauts de ligne \\\\ préservés", markdown.includes("\\\\"), markdown);
  check("equation numérotée", markdown.includes("\\tag{1}"), markdown);
  check("equation* non numérotée", !markdown.includes("\\tag{2}"), markdown);
  check("\\[ \\] rendu en display", /^\$\$$/m.test(markdown), markdown);
});

group("Fragment (fence ```latex)", () => {
  const { markdown } = texToMarkdown("\\section{Titre}\nDu texte avec $x^2$.", { fragment: true });
  check("pas de titre h1 ajouté", !markdown.startsWith("# "), markdown.slice(0, 60));
  // `x^2` ressort en `x^{2}` : le parseur normalise les groupes implicites.
  check("contenu rendu sans \\begin{document}", /Du texte avec \$x\^\{?2\}?\$\./.test(markdown), markdown);
  check("section présente", markdown.includes("## 1 Titre"), markdown);
});

group("Robustesse", () => {
  for (const [name, src] of [
    ["source vide", ""],
    ["accolade non fermée", doc("\\textbf{jamais fermé")],
    ["environnement non fermé", doc("\\begin{itemize}\\item a")],
    ["fin sans début", "\\end{document}"],
    ["binaire", " � \\section{x}"],
  ]) {
    let res;
    try {
      res = texToMarkdown(src, { title: "T" });
    } catch (e) {
      check(`${name} : ne lève jamais`, false, e.stack);
      continue;
    }
    check(`${name} : ne lève jamais`, true);
    check(`${name} : markdown non nul`, typeof res.markdown === "string", typeof res.markdown);
    check(
      `${name} : ancres valides`,
      Array.isArray(res.anchors) &&
        res.anchors.length > 0 &&
        res.anchors.every((a) => Array.isArray(a) && a.length === 2 && a.every((v) => Number.isFinite(v) && v >= 0)),
      JSON.stringify(res.anchors?.slice(0, 3)),
    );
    check(
      `${name} : ancres triées`,
      res.anchors.every((a, i, arr) => i === 0 || arr[i - 1][0] <= a[0]),
      JSON.stringify(res.anchors?.slice(0, 6)),
    );
    check(`${name} : pas de marqueur interne résiduel`, !res.markdown.includes(MARKER), name);
  }
});

group("Langue du document (libellés insérés par le plugin)", () => {
  check("sans babel : anglais", docLanguage(doc("x")) === "en");
  const lang = (preamble) => docLanguage(doc("x", preamble));
  check("babel french", lang(String.raw`\usepackage[french]{babel}`) === "fr");
  check("babel : dernière langue = principale", lang(String.raw`\usepackage[french,english]{babel}`) === "en");
  check("babel : option de classe ignorée", lang(String.raw`\usepackage[french,a4paper]{babel}`) === "fr");
  check("babel main=", lang(String.raw`\usepackage[main=french,english]{babel}`) === "fr");
  check(
    "langue passée en option de classe",
    docLanguage(String.raw`\documentclass[11pt,francais]{article} \usepackage{babel} \begin{document}x\end{document}`) === "fr",
  );
  check("polyglossia", lang(String.raw`\usepackage{polyglossia} \setdefaultlanguage{french}`) === "fr");
  check("babel commenté ignoré", lang(String.raw`% \usepackage[french]{babel}`) === "en");
  check("langue sans libellés : anglais", lang(String.raw`\usepackage[ngerman]{babel}`) === "en");
  const body = [
    String.raw`\begin{abstract}Court.\end{abstract}`,
    String.raw`\part{Cadrage}`,
    String.raw`\section{}`,
    String.raw`\begin{proof}Ok.\end{proof}`,
  ].join("\n");
  const fr = texToMarkdown(doc(body, String.raw`\usepackage{amsthm} \usepackage[french]{babel}`)).markdown;
  check(
    "fr : Résumé, Partie, Démonstration, sans titre",
    fr.includes("**Résumé**") && /^## Partie I — Cadrage$/m.test(fr) && fr.includes("*Démonstration.* Ok.") && fr.includes("(sans titre)"),
    fr,
  );
  const tikz = (nodes) =>
    [String.raw`\begin{tikzpicture}`, nodes ? String.raw`\node (a) at (0,0) {Étape};` : String.raw`\draw (0,0) -- (1,1);`, String.raw`\end{tikzpicture}`].join("\n");
  const frTikz = (nodes) => texToMarkdown(doc(tikz(nodes), String.raw`\usepackage{tikz} \usepackage[french]{babel}`)).markdown;
  check("fr : TikZ avec nœuds", frTikz(true).includes("<details><summary>Texte des nœuds et source TikZ</summary>"), frTikz(true));
  check("fr : TikZ sans nœud", frTikz(false).includes("<details><summary>Source TikZ</summary>"), frTikz(false));
  const en = texToMarkdown(doc(body, String.raw`\usepackage{amsthm}`)).markdown;
  check(
    "en : Abstract, Part, Proof, untitled",
    en.includes("**Abstract**") && /^## Part I — Cadrage$/m.test(en) && en.includes("*Proof.* Ok.") && en.includes("(untitled)"),
    en,
  );
});

group("Langue de l'interface (avertissements, bannière, titre par défaut)", () => {
  const src = doc(String.raw`\foo \ref{nulle} \begin{inconnu}x\end{inconnu}`);
  const en = texToMarkdown(src).warnings;
  check(
    "sans locale : anglais",
    en.includes(String.raw`unknown command \foo ignored`) && en.includes("unresolved reference: nulle") &&
      en.includes(`environment "inconnu" rendered without formatting`),
    en,
  );
  const fr = texToMarkdown(src, { locale: "fr" }).warnings;
  check(
    "locale fr : français",
    fr.includes(String.raw`commande inconnue \foo ignorée`) && fr.includes("référence non résolue : nulle") &&
      fr.includes("environnement « inconnu » rendu sans mise en forme"),
    fr,
  );
  // La langue de l'interface ne touche pas aux libellés du rendu, qui suivent le document.
  const proof = texToMarkdown(doc(String.raw`\begin{proof}Ok.\end{proof}`, String.raw`\usepackage{amsthm}`), { locale: "fr" });
  check("locale fr, document anglais : Proof", proof.markdown.includes("*Proof.* Ok."), proof.markdown);
  check("titre par défaut localisé", texToMarkdown("x", { locale: "fr" }).markdown.startsWith("# Document LaTeX"), texToMarkdown("x", { locale: "fr" }).markdown);
});

// Écarts relevés en confrontant un document réel (~40 pages) à son PDF.
group("Fidélité au PDF : structure", () => {
  const { markdown, anchors } = texToMarkdown(
    doc(
      "\\part{Cadrage}\\label{part:a}\n\\section{Objet}\\label{sec:objet}\nTexte.\n" +
        "\\part{Modèle}\\label{part:b}\n\\section{Suite}\n\\subsection{Détail}\n" +
        "Voir la partie~\\ref{part:b}, §\\ref{sec:objet} et l'annexe~\\ref{app:x}.\n" +
        "\\appendix\n\\section{Annexe}\\label{app:x}\n\\subsection{Sous-annexe}\nFin.",
    ),
  );
  check("partie en h2 numérotée en romain", /^## Part I — Cadrage$/m.test(markdown), markdown);
  check("sections sous une partie descendent d'un niveau", /^### 1 Objet$/m.test(markdown), markdown);
  check("numérotation des sections continue d'une partie à l'autre", /^### 2 Suite$/m.test(markdown), markdown);
  check("sous-section sous une partie", /^#### 2\.1 Détail$/m.test(markdown), markdown);
  check("référence à une partie en romain", markdown.includes("[II](#part-ii)"), markdown);
  check("annexe lettrée", /^### A Annexe$/m.test(markdown) && /^#### A\.1 Sous-annexe$/m.test(markdown), markdown);
  check("référence à une annexe", markdown.includes("[A](#sec-a)"), markdown);
  check("référence au corps intacte après \\appendix", markdown.includes("[1](#sec-1)"), markdown);
  check("aucun identifiant dupliqué", new Set(markdown.match(/id="[^"]+"/g)).size === markdown.match(/id="[^"]+"/g).length, markdown);
  check("ancres alignées", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const plain = texToMarkdown(doc("\\section{Seule}\nTexte.")).markdown;
  check("sans \\part, sections toujours en h2", /^## 1 Seule$/m.test(plain), plain);

  const titled = texToMarkdown(
    doc("x", "\\title{Titre principal\\\\[6pt]\n\\large Sous-titre un\\\\\n\\large Sous-titre deux}"),
  ).markdown;
  check("titre sans ses sous-titres", titled.startsWith("# Titre principal\n"), titled.slice(0, 120));
  check("sous-titres sous le titre", titled.includes("Sous-titre un  \nSous-titre deux"), titled.slice(0, 120));
});

group("Fidélité au PDF : théorèmes", () => {
  const preamble =
    "\\newtheorem{theorem}{Théorème}\n\\theoremstyle{definition}\n\\newtheorem{hypothese}{Hypothèse}\n" +
    "\\theoremstyle{remark}\n\\newtheorem{remark}[theorem]{Remarque}\n";
  const { markdown, anchors } = texToMarkdown(
    doc(
      "\\begin{hypothese}[Agrégation exacte]\\label{h:a}\nPour tout scénario,\n\\[ x = 1 \\]\n\\end{hypothese}\n" +
        "\\begin{remark}[Rangs]\\label{r:a}\nCorps de la remarque.\n\\end{remark}\n" +
        "\\begin{theorem}\n\\[ y = 2 \\]\nPuis du texte.\n\\end{theorem}",
      preamble,
    ),
  );
  check("titre d'un environnement de théorème personnalisé", markdown.includes("**Hypothèse 1** (Agrégation exacte). Pour tout scénario,"), markdown);
  check("crochets du titre absents du corps", !markdown.includes("\\[Agrégation"), markdown);
  check("style remark : tête en italique", markdown.includes("*Remarque 1* (Rangs). Corps de la remarque."), markdown);
  check("corps débutant par une formule : en-tête sur sa ligne", /^\*\*Théorème 2\.\*\*\n\n\$\$$/m.test(markdown), markdown);
  check("ancres alignées après fusion de l'en-tête", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));
});

group("Fidélité au PDF : texte et macros", () => {
  const preamble =
    "\\newcommand{\\Kdiff}{K_{\\text{diff}}}\n\\newcommand{\\Sigr}{\\Sigma^{r}}\n\\newcommand{\\al}{\\alpha}\n";
  const { markdown } = texToMarkdown(
    doc(
      "Le c\\oe ur et les n\\oe uds.\n\n" +
        "Route \\texttt{group\\_order/freeze} et \\texttt{a*b}.\n\n" +
        "$\\sqrt{\\sum\\Kdiff^2}+\\sum\\Kdiff$ et $\\al x$ et $\\Sigr w$.\n\n" +
        "0.92 n'est pas une liste.\n\n1. en est une.\n\n" +
        "Formule longue $a = b,\\\n  c = d$ sur deux lignes.\n\n" +
        "\\begin{enumerate}\n\\item[(a)] Premier.\n\\item[(b)] Second.\n\\end{enumerate}",
      preamble,
    ),
  );
  check("espace après un mot de commande absorbée", markdown.includes("Le cœur et les nœuds."), markdown);
  check("code inline sans antislash d'échappement", markdown.includes("`group_order/freeze`") && markdown.includes("`a*b`"), markdown);
  check("macro expansée collée à une commande", markdown.includes("\\sum K_{\\text{diff}}") && !markdown.includes("\\sumK"), markdown);
  check("macro suivie d'une lettre", markdown.includes("\\alpha x"), markdown);
  check("nombre en tête de paragraphe non échappé", /^0\.92 n’est pas une liste\.$/m.test(markdown), markdown);
  check("vrai marqueur de liste échappé", /^1\\\. en est une\.$/m.test(markdown), markdown);
  check("marqueur explicite sans numéro doublé", /^- \(a\) Premier\.$/m.test(markdown) && !/^1\. \(a\)/m.test(markdown), markdown);
  const { errors } = katexErrors(markdown);
  check("formules compilent", errors.length === 0, errors.map((e) => `${e.msg} — ${e.tex}`).join("\n"));
});

group("Fidélité au PDF : tables, encadrés, TikZ", () => {
  const src = doc(
      "\\begin{tabular}{l p{5.0cm} c c p{3.5cm}}\nA & B & C & D & E \\\\\n" +
        "\\multicolumn{5}{l}{\\emph{Groupe}} \\\\\n1 & 2 & 3 & 4 & 5 \\\\\n\\end{tabular}\n\n" +
        "\\begin{center}\n\\fbox{\\parbox{0.92\\textwidth}{\\centering\nEngagement \\textbf{fort}.}}\n\\end{center}\n\n" +
        "\\begin{center}\n\\fbox{\\parbox{0.86\\textwidth}{\\ttfamily\\small\n\\{\\\\\n\\hspace*{1em}\"geo\\_zone\": \"FR\",\\\\\n\\}\n}}\n\\end{center}\n\n" +
        "\\begin{center}\n\\rule{0.4\\textwidth}{0.4pt}\\\\[0.5em]\n\\emph{Pied.}\n\\end{center}\n\n" +
        "\\begin{tikzpicture}[box/.style={draw}]\n\\node[box] (a) at (0,0) {\\textbf{Étape} $x_1$};\n" +
        "\\node[box, below=3mm of a] (b) {Suite\\\\ \\emph{fin}};\n\\draw[->] (a) -- node[above]{non} (b);\n\\end{tikzpicture}\n\n" +
        "\\begin{verbatim}\na\n\n\nb\n\\end{verbatim}\n\n\\section{Après}\nFin.",
  );
  const { markdown, anchors, warnings } = texToMarkdown(src);
  // Ancre exacte (et pas seulement « non vide ») : une ligne de trop émise en
  // amont décale la synchro d'une ligne sur tout le reste du document.
  const secSrc = src.split("\n").findIndex((l) => l.startsWith("\\section{Après}"));
  const secMd = markdown.split("\n").indexOf('<div id="sec-1"></div>');
  check(
    "ancre de la section suivante exactement sur sa ligne",
    anchors.some(([m, s]) => m === secMd && s === secSrc),
    JSON.stringify({ secMd, secSrc, anchors: anchors.slice(-4) }),
  );
  check("lignes vides d'un verbatim préservées", markdown.includes("\na\n\n\nb\n"), markdown);
  const rows = markdown.split("\n").filter((l) => l.startsWith("|"));
  check("spec de colonnes lue par jetons (le c de cm ignoré)", rows[1] === "| --- | --- | :---: | :---: | --- |", rows[1]);
  check("\\multicolumn réduit à son contenu", rows.some((r) => r.startsWith("| *Groupe* |")), rows.join("\n"));
  check("encadré rendu en citation, sans sa largeur", markdown.includes("> Engagement **fort**.") && !markdown.includes("0.92"), markdown);
  check("encadré \\ttfamily rendu en bloc de code", markdown.includes('```\n{\n  "geo_zone": "FR",\n}\n```'), markdown);
  check("\\rule sans résidu de dimensions", !markdown.includes("0.4pt") && /^\*Pied\.\*$/m.test(markdown), markdown);
  check("TikZ : fence tikz émise", /^```tikz$/m.test(markdown), markdown);
  check("TikZ : texte des nœuds replié", markdown.includes("<details><summary>Node text and TikZ source</summary>"), markdown);
  check("TikZ : texte des nœuds restitué", markdown.includes("- **Étape** $x_{1}$") || markdown.includes("- **Étape** $x_1$"), markdown);
  check("TikZ : nœud multi-lignes", /^- Suite {2}\n {2}\*fin\*$/m.test(markdown), markdown);
  const prose = markdown.replace(/^(`{3,})[a-z]*\n[\s\S]*?\n\1$/gm, "");
  check("TikZ : commandes de tracé hors des blocs de code", !/\[->\]|\(a\) –/.test(prose), prose);
  check("TikZ : aucun avertissement (le rendu dépend de l'hôte)", !warnings.some((w) => w.includes("TikZ")), warnings.join(" | "));
  check("ancres alignées", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));
});

group("TikZ : document autonome compilable", () => {
  const preamble =
    "\\usepackage[utf8]{inputenc}\n\\usepackage[french]{babel}\n\\usepackage{geometry,amsmath}\n" +
    "\\usepackage{tikz}\n\\usetikzlibrary{arrows.meta,positioning}\n% \\usepackage{hyperref}\n" +
    "\\tikzset{box/.style={draw, rounded corners}}\n\\geometry{margin=2cm}\n" +
    "\\newcommand{\\hyp}[1]{H\\ref{#1}}\n\\newcommand\\Bp{\\mathsf{B}}\n" +
    "\\renewcommand{\\contentsname}{Sommaire}\n\\DeclareMathOperator{\\Var}{Var}\n" +
    "\\newtheorem{hypothese}{Hypothèse}";
  const src = doc(
    "\\begin{hypothese}\\label{h:iid}X.\\end{hypothese}\n\\begin{equation}a\\label{eq:a}\\end{equation}\n" +
      "\\begin{tikzpicture}[box/.style={draw}]\n\\node[box] (a) {\\hyp{h:iid}, \\eqref{eq:a}, \\ref{eq:zz}};\n\n" +
      "\\draw (a) -- (1,1);\n\\end{tikzpicture}\n\nFin.",
    preamble,
  ).replace("\\documentclass{article}", "\\documentclass[11pt,a4paper]{article}");
  const { markdown, anchors, warnings } = texToMarkdown(src);
  const figure = /^(`{3,})tikz\n([\s\S]*?)\n\1$/m.exec(markdown)?.[2] ?? "";
  const lines = figure.split("\n");
  check("classe standalone, taille de police reprise", lines[0] === "\\documentclass[11pt,tikz,border=4pt]{standalone}", lines[0]);
  check("paquets de la liste blanche, options conservées", lines.includes("\\usepackage[utf8]{inputenc}") && lines.includes("\\usepackage{tikz}"), figure);
  check("liste de paquets filtrée (geometry retiré)", lines.includes("\\usepackage{amsmath}"), figure);
  check("babel, geometry et paquets commentés exclus", !/babel|geometry|hyperref/.test(figure), figure);
  check("bibliothèques et styles TikZ repris", lines.includes("\\usetikzlibrary{arrows.meta,positioning}") && lines.includes("\\tikzset{box/.style={draw, rounded corners}}"), figure);
  check("macros utilisateur reprises", lines.includes("\\newcommand{\\hyp}[1]{H\\ref{#1}}") && lines.includes("\\newcommand\\Bp{\\mathsf{B}}") && lines.includes("\\DeclareMathOperator{\\Var}{Var}"), figure);
  check("\\renewcommand protégé par \\providecommand", lines.includes("\\providecommand{\\contentsname}{}\\renewcommand{\\contentsname}{Sommaire}"), figure);
  check("\\newtheorem non repris", !figure.includes("newtheorem"), figure);
  check("label atteint à travers une macro", lines.includes("\\newlabel{h:iid}{{1}{}}"), figure);
  check("label d'équation numéroté", lines.includes("\\newlabel{eq:a}{{1}{}}"), figure);
  check("label inconnu : « ? » et avertissement", lines.includes("\\newlabel{eq:zz}{{?}{}}") && warnings.some((w) => w.includes("eq:zz")), figure + "\n" + warnings.join(" | "));
  check("corps entre \\begin{document} et \\end{document}", /\\begin\{document\}\n\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}\n\\end\{document\}$/.test(figure), figure);
  check("ligne vide de la figure préservée", figure.includes("};\n\n\\draw"), figure);
  check("ancres alignées", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const frag = texToMarkdown("\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}", { fragment: true }).markdown;
  check("fragment : classe standalone sans préambule", frag.includes("```tikz\n\\documentclass[tikz,border=4pt]{standalone}\n\\begin{document}\n"), frag);
  check("fragment sans nœud : seul le source est replié", frag.includes("<details><summary>TikZ source</summary>"), frag);
});

group("Formules émises : compilation KaTeX", () => {
  const samples = [
    doc("$\\alpha_i$ et \\begin{equation} \\sum_{i \\in Q} w_i = 1 \\end{equation}"),
    doc("\\begin{align*} \\nabla f &= 0 \\\\ H &\\succ 0 \\end{align*}"),
    doc("Coût $\\theta = 0.75\\,\\text{\\euro}/\\mathrm{MWh}$ et $q^{\\*}$.", ""),
    doc("$\\E[X]$", "\\newcommand{\\E}{\\mathbb{E}}"),
  ];
  samples.forEach((src, i) => {
    const { markdown } = texToMarkdown(src);
    const { errors, total } = katexErrors(markdown);
    check(`échantillon ${i + 1} : ${total} formule(s) compilent`, errors.length === 0, errors.map((e) => `L${e.line} ${e.msg} — ${e.tex}`).join("\n"));
  });
});

// --------------------------------------------------------------------------- //
// Coloration `latex-source` (vue code source de l'application)
// --------------------------------------------------------------------------- //

group("Coloration du source LaTeX", () => {
  const plain = (html) =>
    html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const src = [
    "% commentaire avec un $ isolé et <balise>",
    "\\documentclass{article}",
    "\\begin{align}",
    "  a &= b \\\\", // `&` séparateur + `\\` fin de ligne
    "\\end{align}",
    "Texte avec $x^2$ et 100\\% & fin.",
    "$$",
    "\\int_0^1 f",
    "$$",
  ].join("\n");
  const html = highlightLatex(src);

  check("texte intégralement préservé", plain(html) === src, plain(html));
  check("HTML échappé", !html.includes("<balise>") && html.includes("&lt;balise&gt;"));
  check("commentaire coloré en entier", html.includes('<span class="hljs-comment">% commentaire avec un $ isolé et &lt;balise&gt;</span>'));
  check("commande de structure = mot-clé", html.includes('<span class="hljs-keyword">\\documentclass</span>'));
  check("nom d'environnement distingué", html.includes('<span class="hljs-title">align</span>'));
  check("formule inline colorée", html.includes('<span class="hljs-string hljs-emphasis">$x^2$</span>'));
  check("formule display multi-lignes colorée", html.includes('<span class="hljs-string hljs-emphasis">$$\n\\int_0^1 f\n$$</span>'));
  check("`\\%` échappé n'ouvre pas de commentaire", !html.includes('<span class="hljs-comment">% & fin.'));
  const disp = highlightLatex("avant\n\\[\n  \\sum_k a_k\n\\]\naprès");
  check("display `\\[…\\]` coloré en une formule", disp.includes('<span class="hljs-string hljs-emphasis">\\[\n  \\sum_k a_k\n\\]</span>'), disp);
  check("display `\\(…\\)` inline coloré", highlightLatex("soit \\(x\\) réel").includes('<span class="hljs-string hljs-emphasis">\\(x\\)</span>'));
  check("séparateur de tableau coloré", html.includes('<span class="hljs-operator">&amp;</span>'));
  check("commande ordinaire ≠ structure", highlightLatex("\\emph{x}").includes('<span class="hljs-built_in">\\emph</span>'));
  check("`$` seul ne contamine pas la suite", plain(highlightLatex("prix : 5 $ et suite\nligne 2")) === "prix : 5 $ et suite\nligne 2");
  check("entrée vide tolérée", highlightLatex("") === "");
});

// --------------------------------------------------------------------------- //
// Documents réels passés en argument
// --------------------------------------------------------------------------- //

const args = process.argv.slice(2);
if (args.length) {
  group("Documents fournis", () => {
    for (const file of args) {
      if (!fs.existsSync(file)) {
        check(`${file} : lisible`, false, "fichier introuvable");
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      const t0 = Date.now();
      const res = texToMarkdown(src, { title: path.basename(file, path.extname(file)) });
      const ms = Date.now() - t0;
      const { errors, total } = katexErrors(res.markdown);
      const name = path.basename(file);
      console.log(`  · ${name} — ${ms} ms, ${res.markdown.split("\n").length} lignes, ${total} formules, ${res.anchors.length} ancres`);
      if (res.warnings.length) console.log(`      warnings : ${res.warnings.join(" | ")}`);
      check(`${name} : conversion sous 30 s (timeout de l'hôte)`, ms < 30000, `${ms} ms`);
      check(`${name} : toutes les formules compilent`, errors.length === 0, errors.slice(0, 5).map((e) => `L${e.line} ${e.msg}\n        ${e.tex.slice(0, 140)}`).join("\n      "));
      check(`${name} : aucun marqueur interne résiduel`, !res.markdown.includes(MARKER));
      check(`${name} : aucune référence non résolue`, !res.markdown.includes("**?**"), res.warnings.join(" | "));
      check(`${name} : ancres triées et positives`, res.anchors.every((a, i, arr) => (i === 0 || arr[i - 1][0] <= a[0]) && a[0] >= 0 && a[1] >= 0));
      const bad = misalignedAnchors(res.markdown, res.anchors);
      check(`${name} : ancres alignées sur du contenu`, bad.length === 0, `${bad.length} ancre(s) sur ligne vide : ${JSON.stringify(bad.slice(0, 5))}`);
    }
  });
}

console.log(`\n${failures ? "ÉCHEC" : "OK"} — ${checks - failures}/${checks} vérifications passées`);
process.exit(failures ? 1 : 0);
