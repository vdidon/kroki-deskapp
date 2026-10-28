// Test of the latex-doc plugin (.tex rendering) — standalone, no npm dependency
// and no running application: it directly imports `plugins/latex-doc/tex.js`
// and compiles the emitted formulas with the **repo's vendored KaTeX**, the one
// that will actually run in the webview.
//
//   node tests/test_latex_plugin.mjs                 # regression suite
//   node tests/test_latex_plugin.mjs file.tex …      # + real documents
//
// The two checks that matter:
//   1. the expected structure is present in the derived markdown;
//   2. **every** emitted formula compiles — a formula rejected by KaTeX
//      would show up in red in the application.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const MARKER = String.fromCharCode(1); // internal reference marker (tex.js)
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
 * Extracts the formulas of a markdown: standalone `$$` blocks then inline `$…$`.
 * Fenced code blocks are excluded — markdown-it does not look for formulas
 * in them (folded TikZ source, example JSON…).
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
    // A literal `$` is emitted as an entity: an odd number of `$` on a
    // line is a formula cut by a line break, which texmath will not
    // recognize (and which the regex below would not see).
    if ((l.match(/(?<!\\)\$/g) ?? []).length % 2) split.push(i + 1);
    for (const m of l.matchAll(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g)) {
      out.push({ kind: "inline", line: i + 1, tex: m[1] });
    }
  });
  return { formulas: out, unclosed, split };
}

/**
 * Anchoring invariant: an anchor is always placed right before real
 * content. If it points at an empty line, a line was removed after the
 * fact without readjusting the anchors — the preview ↔ source sync would drift.
 */
function misalignedAnchors(md, anchors) {
  const lines = md.split("\n");
  return anchors.filter(([mdLine]) => mdLine >= lines.length || lines[mdLine].trim() === "");
}

/** Compiles all the formulas; returns the list of failures. */
function katexErrors(md) {
  const { formulas, unclosed, split } = formulasOf(md);
  const errors = [];
  if (unclosed) errors.push({ line: unclosed, tex: "(unclosed $$ block)", msg: "unclosed display delimiter" });
  for (const line of split) {
    errors.push({ line, tex: md.split("\n")[line - 1], msg: "inline formula split by a line break" });
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

group("Title, sections and table of contents", () => {
  const { markdown } = texToMarkdown(
    doc("\\section{Objet}\\label{s:o}\nTexte.\n\\subsection{Détail}\nSuite.\n\\section*{Annexe}\nFin."),
    { title: "fallback" },
  );
  check("fallback title used when \\title is absent", markdown.startsWith("# fallback"), markdown.slice(0, 60));
  check("numbered section as h2", /^## 1 Objet$/m.test(markdown), markdown);
  check("numbered subsection as h3", /^### 1\.1 Détail$/m.test(markdown), markdown);
  check("starred section not numbered", /^## Annexe$/m.test(markdown), markdown);
  check("anchor placed before the heading", markdown.includes('<div id="sec-1"></div>'), markdown);

  const t = texToMarkdown(doc("Corps."), { title: "x", }).markdown;
  check("document without \\title still gets a title", t.startsWith("# x"), t.slice(0, 40));

  const withTitle = texToMarkdown(
    doc("Corps.", "\\title{Vrai titre \\\\ sur deux lignes}\\author{A}"),
    { title: "ignoré" },
  ).markdown;
  check("\\title takes precedence over the file name", withTitle.startsWith("# Vrai titre sur deux lignes"), withTitle.slice(0, 80));
  check("\\\\ in the title folded onto one line", !/^# .*\n .*sur deux/.test(withTitle), withTitle.slice(0, 80));
  check("author rendered", withTitle.includes("*A*"), withTitle.slice(0, 120));
});

group("Cross-references", () => {
  const { markdown, warnings } = texToMarkdown(
    doc(
      "\\section{Un}\\label{s:un}\n" +
        "Voir section~\\ref{s:un} et l'équation~\\eqref{e:a}.\n" +
        "\\begin{equation}\\label{e:a} x = 1 \\end{equation}\n" +
        "Et \\ref{s:deux}.\n\\section{Deux}\\label{s:deux}\nFin.",
    ),
  );
  check("backward \\ref resolved to a link", markdown.includes("[1](#sec-1)"), markdown);
  check("forward \\eqref resolved with parentheses", markdown.includes("[(1)](#eq-1)"), markdown);
  check("forward \\ref resolved", markdown.includes("[2](#sec-2)"), markdown);
  check("numbered equation tagged", markdown.includes("\\tag{1}"), markdown);
  check("equation anchor placed", markdown.includes('<div id="eq-1"></div>'), markdown);
  check("no residual internal marker", !markdown.includes(MARKER), markdown);
  check("no warning", warnings.length === 0, warnings.join(" | "));

  const broken = texToMarkdown(doc("Voir \\ref{inconnu}."));
  check("unknown reference reported", broken.warnings.some((w) => w.includes("unresolved")), broken.warnings.join(" | "));
  check("unknown reference rendered visibly", broken.markdown.includes("**?**"), broken.markdown);
});

// A numbered anchor (`eq-3`) moves as soon as an equation is inserted upstream:
// only the LaTeX label is a stable target for a link coming from another document
// (`../doc/modele.tex#eq:sigmaU`).
group("Label anchors (stable cross-document targets)", () => {
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

  check("equation label placed as an anchor", lineOf("eq:sigmaU") >= 0, markdown);
  check("alias grafted onto the numbered anchor's line", lineOf("eq:sigmaU") === lineOf("eq-1"), markdown);
  check("label case preserved", !markdown.includes('id="eq:sigmau"'), markdown);
  check("numbered section label", lineOf("sec:modele") >= 0 && lineOf("sec:modele") === lineOf("sec-1"), markdown);
  check("starred subsection label", lineOf("sec:annexeC") >= 0, markdown);
  check("\\eqref still targets the numbered anchor", markdown.includes("[(1)](#eq-1)"), markdown);
  check("sync anchors still aligned", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const multi = texToMarkdown(doc("\\begin{equation}\\label{eq:a}\\label{eq:b} x = 1 \\end{equation}")).markdown;
  check(
    "two labels on the same target → two anchors",
    multi.includes('<div id="eq:a"></div>') && multi.includes('<div id="eq:b"></div>'),
    multi,
  );

  // A label bearing the name of a numbered anchor must not duplicate it.
  const clash = texToMarkdown(
    doc("\\begin{equation} x = 1 \\end{equation}\n\\begin{equation}\\label{eq-1} y = 2 \\end{equation}"),
  ).markdown;
  check("no duplicate identifier", (clash.match(/id="eq-1"/g) || []).length === 1, clash);

  // Non-anchorable target (no numbered object open): no anchor invented.
  const orphan = texToMarkdown(doc("Texte nu.\\label{x:orphelin}")).markdown;
  check("orphan label ignored", !orphan.includes('id="x:orphelin"'), orphan);

  // Lists remove lines already emitted: the anchor index must follow.
  const inList = texToMarkdown(
    doc(
      "\\begin{itemize}\n\\item Un\n\\item Deux\n\\end{itemize}\n" +
        "\\section{Après}\\label{sec:apres}\n\\begin{equation}\\label{eq:apres} z = 0 \\end{equation}",
    ),
  ).markdown.split("\n");
  const at = (id) => inList.findIndex((l) => l.includes(`<div id="${id}"></div>`));
  check("correct alias after a list (section)", at("sec:apres") >= 0 && at("sec:apres") === at("sec-1"), inList.join("\n"));
  check("correct alias after a list (equation)", at("eq:apres") >= 0 && at("eq:apres") === at("eq-1"), inList.join("\n"));
});

group("Theorems (amsthm)", () => {
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
  check("numbered theorem with its title, merged into the body", markdown.includes("**Théorème 1** (Nommé). Énoncé."), markdown);
  check("shared [theorem] counter respected", markdown.includes("**Proposition 2.** Autre."), markdown);
  check("independent counter for hypothese", markdown.includes("**Hypothèse 1.**"), markdown);
  check("starred environment not numbered", /\*\*Remarque\.\*\*/.test(markdown), markdown);
  check("proof rendered (English label without babel)", markdown.includes("*Proof.* La preuve."), markdown);
  check("end of proof marked", markdown.includes("∎"), markdown);
  check("theorem references resolved", /\[1\]\(#theorem-1\)/.test(markdown), markdown);
  check("proposition reference resolved", /\[2\]\(#proposition-2\)/.test(markdown), markdown);
});

group("Preamble macros", () => {
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
  check("argument-less macro expanded", markdown.includes("\\mathbb{E}[X]"), markdown);
  check("\\DeclareMathOperator expanded", markdown.includes("\\operatorname{tr}(A)"), markdown);
  check("macro with optional argument (default)", markdown.includes("y^{2}"), markdown);
  check("macro with optional argument (provided)", markdown.includes("z^{3}"), markdown);
  check("text macro containing \\ref expanded and resolved", /H\[1\]\(#hypothese-1\)/.test(markdown), markdown);
  check("expansion also applied in display math", markdown.includes("\\mathbb{E}[\\operatorname{tr}(A)]"), markdown);
});

group("Listes", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{itemize}\n\\item Premier point.\n\\item Deuxième avec $x$.\n\\end{itemize}\n" +
        "\\begin{enumerate}\n\\item Un.\n\\item Deux.\n\\end{enumerate}\n" +
        "\\begin{description}\n\\item[Terme] Sa définition.\n\\end{description}",
    ),
  );
  check("bullets with their content", /^- Premier point\.$/m.test(markdown), markdown);
  check("bullet containing a formula", /^- Deuxième avec \$x\$\.$/m.test(markdown), markdown);
  check("numbered list", /^1\. Un\.$/m.test(markdown) && /^2\. Deux\.$/m.test(markdown), markdown);
  check("item with explicit marker", /^- \*\*Terme\*\* Sa définition\.$/m.test(markdown), markdown);
  check("no empty bullet", !/^\s*[-\d]+\.?\s*$/m.test(markdown.replace(/^---$/gm, "")), markdown);

  // Lists remove lines already emitted: the anchors must follow.
  const nested = texToMarkdown(
    doc(
      "\\section{A}\n\\begin{itemize}\n\\item Externe\n\\begin{itemize}\n\\item Interne\n\\end{itemize}\n" +
        "\\item Suivant\n\\end{itemize}\n\\section{B}\nAprès la liste.",
    ),
  );
  check("nested list indented", /^ {2}- Interne$/m.test(nested.markdown), nested.markdown);
  const bad = misalignedAnchors(nested.markdown, nested.anchors);
  check("anchors realigned after line removal", bad.length === 0, JSON.stringify(bad));
});

group("Line breaks", () => {
  const { markdown } = texToMarkdown(doc("Ligne un \\\\ ligne deux.\n\nAutre paragraphe."));
  check("\\\\ rendered as a markdown line break", /Ligne un {2}\nligne deux\./.test(markdown), JSON.stringify(markdown));
  check("paragraphs separated", /ligne deux\.\n\nAutre paragraphe\./.test(markdown), JSON.stringify(markdown));
});

group("Tables", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{tabular}{lc}\n\\hline\nSymbole & Définition \\\\\n\\hline\n" +
        "$h$ & nombre d'heures \\\\\nP\\&L & résultat \\\\\n\\hline\n\\end{tabular}",
    ),
  );
  const rows = markdown.split("\n").filter((l) => l.startsWith("|"));
  check("table emitted with header and separator", rows.length >= 4, markdown);
  check("& separator interpreted as a column", rows[0] === "| Symbole | Définition |", rows[0]);
  check("spec alignment carried over", rows[1] === "| --- | :---: |", rows[1]);
  check("literal \\& kept in the cell", rows.some((r) => r.includes("P&L")), rows.join("\n"));
  check("formula preserved in cell", rows.some((r) => r.includes("$h$")), rows.join("\n"));
});

group("Text, symbols and escapes", () => {
  const { markdown } = texToMarkdown(
    doc("Coût en \\euro{} --- 100\\% de \\textbf{gras} et \\emph{italique}, caf\\'e, na\\\"ive, gar\\c con. Underscore\\_ici. ``Cité''."),
  );
  check("symbole euro", markdown.includes("€"), markdown);
  check("tiret cadratin", markdown.includes("—"), markdown);
  check("escaped percent rendered", markdown.includes("100%"), markdown);
  check("bold and italic", markdown.includes("**gras**") && markdown.includes("*italique*"), markdown);
  check("acute accent recomposed", markdown.includes("café"), markdown);
  check("diaeresis recomposed", markdown.includes("naïve"), markdown);
  check("cedilla recomposed", markdown.includes("garçon"), markdown);
  check("underscore escaped for markdown", markdown.includes("\\_"), markdown);
  check("typographic quotes", markdown.includes("“Cité”"), markdown);
});

group("Math environments", () => {
  const { markdown } = texToMarkdown(
    doc(
      "\\begin{align*} a &= b \\\\ c &= d \\end{align*}\n" +
        "\\begin{equation} \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\end{equation}\n" +
        "\\begin{equation*} u = v \\end{equation*}\n" +
        "\\[ w = z \\]",
    ),
  );
  check("align* re-wrapped for KaTeX", markdown.includes("\\begin{align*}"), markdown);
  check("\\\\ line breaks preserved", markdown.includes("\\\\"), markdown);
  check("numbered equation", markdown.includes("\\tag{1}"), markdown);
  check("equation* not numbered", !markdown.includes("\\tag{2}"), markdown);
  check("\\[ \\] rendered as display", /^\$\$$/m.test(markdown), markdown);
});

group("Fragment (fence ```latex)", () => {
  const { markdown } = texToMarkdown("\\section{Titre}\nDu texte avec $x^2$.", { fragment: true });
  check("no h1 title added", !markdown.startsWith("# "), markdown.slice(0, 60));
  // `x^2` comes out as `x^{2}`: the parser normalizes implicit groups.
  check("content rendered without \\begin{document}", /Du texte avec \$x\^\{?2\}?\$\./.test(markdown), markdown);
  check("section present", markdown.includes("## 1 Titre"), markdown);
});

group("Robustness", () => {
  for (const [name, src] of [
    ["empty source", ""],
    ["unclosed brace", doc("\\textbf{jamais fermé")],
    ["unclosed environment", doc("\\begin{itemize}\\item a")],
    ["end without begin", "\\end{document}"],
    ["binary"," � \\section{x}"],
  ]) {
    let res;
    try {
      res = texToMarkdown(src, { title: "T" });
    } catch (e) {
      check(`${name}: never throws`, false, e.stack);
      continue;
    }
    check(`${name}: never throws`, true);
    check(`${name}: non-null markdown`, typeof res.markdown === "string", typeof res.markdown);
    check(
      `${name}: valid anchors`,
      Array.isArray(res.anchors) &&
        res.anchors.length > 0 &&
        res.anchors.every((a) => Array.isArray(a) && a.length === 2 && a.every((v) => Number.isFinite(v) && v >= 0)),
      JSON.stringify(res.anchors?.slice(0, 3)),
    );
    check(
      `${name}: sorted anchors`,
      res.anchors.every((a, i, arr) => i === 0 || arr[i - 1][0] <= a[0]),
      JSON.stringify(res.anchors?.slice(0, 6)),
    );
    check(`${name}: no residual internal marker`, !res.markdown.includes(MARKER), name);
  }
});

group("Document language (labels inserted by the plugin)", () => {
  check("without babel: English", docLanguage(doc("x")) === "en");
  const lang = (preamble) => docLanguage(doc("x", preamble));
  check("babel french", lang(String.raw`\usepackage[french]{babel}`) === "fr");
  check("babel: last language = main", lang(String.raw`\usepackage[french,english]{babel}`) === "en");
  check("babel: class option ignored", lang(String.raw`\usepackage[french,a4paper]{babel}`) === "fr");
  check("babel main=", lang(String.raw`\usepackage[main=french,english]{babel}`) === "fr");
  check(
    "language passed as a class option",
    docLanguage(String.raw`\documentclass[11pt,francais]{article} \usepackage{babel} \begin{document}x\end{document}`) === "fr",
  );
  check("polyglossia", lang(String.raw`\usepackage{polyglossia} \setdefaultlanguage{french}`) === "fr");
  check("commented-out babel ignored", lang(String.raw`% \usepackage[french]{babel}`) === "en");
  check("language without labels: English", lang(String.raw`\usepackage[ngerman]{babel}`) === "en");
  const body = [
    String.raw`\begin{abstract}Court.\end{abstract}`,
    String.raw`\part{Cadrage}`,
    String.raw`\section{}`,
    String.raw`\begin{proof}Ok.\end{proof}`,
  ].join("\n");
  const fr = texToMarkdown(doc(body, String.raw`\usepackage{amsthm} \usepackage[french]{babel}`)).markdown;
  check(
    "fr: Résumé, Partie, Démonstration, sans titre",
    fr.includes("**Résumé**") && /^## Partie I — Cadrage$/m.test(fr) && fr.includes("*Démonstration.* Ok.") && fr.includes("(sans titre)"),
    fr,
  );
  const tikz = (nodes) =>
    [String.raw`\begin{tikzpicture}`, nodes ? String.raw`\node (a) at (0,0) {Étape};` : String.raw`\draw (0,0) -- (1,1);`, String.raw`\end{tikzpicture}`].join("\n");
  const frTikz = (nodes) => texToMarkdown(doc(tikz(nodes), String.raw`\usepackage{tikz} \usepackage[french]{babel}`)).markdown;
  check("fr: TikZ with nodes", frTikz(true).includes("<details><summary>Texte des nœuds et source TikZ</summary>"), frTikz(true));
  check("fr: TikZ without nodes", frTikz(false).includes("<details><summary>Source TikZ</summary>"), frTikz(false));
  const en = texToMarkdown(doc(body, String.raw`\usepackage{amsthm}`)).markdown;
  check(
    "en: Abstract, Part, Proof, untitled",
    en.includes("**Abstract**") && /^## Part I — Cadrage$/m.test(en) && en.includes("*Proof.* Ok.") && en.includes("(untitled)"),
    en,
  );
});

group("Interface language (warnings, banner, default title)", () => {
  const src = doc(String.raw`\foo \ref{nulle} \begin{inconnu}x\end{inconnu}`);
  const en = texToMarkdown(src).warnings;
  check(
    "without locale: English",
    en.includes(String.raw`unknown command \foo ignored`) && en.includes("unresolved reference: nulle") &&
      en.includes(`environment "inconnu" rendered without formatting`),
    en,
  );
  const fr = texToMarkdown(src, { locale: "fr" }).warnings;
  check(
    "fr locale: French",
    fr.includes(String.raw`commande inconnue \foo ignorée`) && fr.includes("référence non résolue : nulle") &&
      fr.includes("environnement « inconnu » rendu sans mise en forme"),
    fr,
  );
  // The interface language does not affect the render's labels, which follow the document.
  const proof = texToMarkdown(doc(String.raw`\begin{proof}Ok.\end{proof}`, String.raw`\usepackage{amsthm}`), { locale: "fr" });
  check("fr locale, English document: Proof", proof.markdown.includes("*Proof.* Ok."), proof.markdown);
  check("localized default title", texToMarkdown("x", { locale: "fr" }).markdown.startsWith("# Document LaTeX"), texToMarkdown("x", { locale: "fr" }).markdown);
});

// Discrepancies found by comparing a real document (~40 pages) against its PDF.
group("PDF fidelity: structure", () => {
  const { markdown, anchors } = texToMarkdown(
    doc(
      "\\part{Cadrage}\\label{part:a}\n\\section{Objet}\\label{sec:objet}\nTexte.\n" +
        "\\part{Modèle}\\label{part:b}\n\\section{Suite}\n\\subsection{Détail}\n" +
        "Voir la partie~\\ref{part:b}, §\\ref{sec:objet} et l'annexe~\\ref{app:x}.\n" +
        "\\appendix\n\\section{Annexe}\\label{app:x}\n\\subsection{Sous-annexe}\nFin.",
    ),
  );
  check("part as h2 numbered in roman numerals", /^## Part I — Cadrage$/m.test(markdown), markdown);
  check("sections under a part go down one level", /^### 1 Objet$/m.test(markdown), markdown);
  check("section numbering continues from one part to the next", /^### 2 Suite$/m.test(markdown), markdown);
  check("subsection under a part", /^#### 2\.1 Détail$/m.test(markdown), markdown);
  check("reference to a part in roman numerals", markdown.includes("[II](#part-ii)"), markdown);
  check("lettered appendix", /^### A Annexe$/m.test(markdown) && /^#### A\.1 Sous-annexe$/m.test(markdown), markdown);
  check("reference to an appendix", markdown.includes("[A](#sec-a)"), markdown);
  check("body reference intact after \\appendix", markdown.includes("[1](#sec-1)"), markdown);
  check("no duplicate identifier", new Set(markdown.match(/id="[^"]+"/g)).size === markdown.match(/id="[^"]+"/g).length, markdown);
  check("anchors aligned", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const plain = texToMarkdown(doc("\\section{Seule}\nTexte.")).markdown;
  check("without \\part, sections still h2", /^## 1 Seule$/m.test(plain), plain);

  const titled = texToMarkdown(
    doc("x", "\\title{Titre principal\\\\[6pt]\n\\large Sous-titre un\\\\\n\\large Sous-titre deux}"),
  ).markdown;
  check("title without its subtitles", titled.startsWith("# Titre principal\n"), titled.slice(0, 120));
  check("subtitles under the title", titled.includes("Sous-titre un  \nSous-titre deux"), titled.slice(0, 120));
});

group("PDF fidelity: theorems", () => {
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
  check("title of a custom theorem environment", markdown.includes("**Hypothèse 1** (Agrégation exacte). Pour tout scénario,"), markdown);
  check("title brackets absent from the body", !markdown.includes("\\[Agrégation"), markdown);
  check("remark style: italic head", markdown.includes("*Remarque 1* (Rangs). Corps de la remarque."), markdown);
  check("body starting with a formula: header on its own line", /^\*\*Théorème 2\.\*\*\n\n\$\$$/m.test(markdown), markdown);
  check("anchors aligned after header merge", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));
});

group("PDF fidelity: text and macros", () => {
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
  check("space after a command word absorbed", markdown.includes("Le cœur et les nœuds."), markdown);
  check("inline code without escape backslash", markdown.includes("`group_order/freeze`") && markdown.includes("`a*b`"), markdown);
  check("expanded macro glued to a command", markdown.includes("\\sum K_{\\text{diff}}") && !markdown.includes("\\sumK"), markdown);
  check("macro followed by a letter", markdown.includes("\\alpha x"), markdown);
  check("number at paragraph start not escaped", /^0\.92 n’est pas une liste\.$/m.test(markdown), markdown);
  check("real list marker escaped", /^1\\\. en est une\.$/m.test(markdown), markdown);
  check("explicit marker without a duplicated number", /^- \(a\) Premier\.$/m.test(markdown) && !/^1\. \(a\)/m.test(markdown), markdown);
  const { errors } = katexErrors(markdown);
  check("formules compilent", errors.length === 0, errors.map((e) => `${e.msg} — ${e.tex}`).join("\n"));
});

group("PDF fidelity: tables, boxes, TikZ", () => {
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
  // Exact anchor (not merely "non-empty"): one extra line emitted
  // upstream shifts the sync by one line over the whole rest of the document.
  const secSrc = src.split("\n").findIndex((l) => l.startsWith("\\section{Après}"));
  const secMd = markdown.split("\n").indexOf('<div id="sec-1"></div>');
  check(
    "next section's anchor exactly on its line",
    anchors.some(([m, s]) => m === secMd && s === secSrc),
    JSON.stringify({ secMd, secSrc, anchors: anchors.slice(-4) }),
  );
  check("verbatim blank lines preserved", markdown.includes("\na\n\n\nb\n"), markdown);
  const rows = markdown.split("\n").filter((l) => l.startsWith("|"));
  check("column spec read by tokens (the c of cm ignored)", rows[1] === "| --- | --- | :---: | :---: | --- |", rows[1]);
  check("\\multicolumn reduced to its content", rows.some((r) => r.startsWith("| *Groupe* |")), rows.join("\n"));
  check("box rendered as a quote, without its width", markdown.includes("> Engagement **fort**.") && !markdown.includes("0.92"), markdown);
  check("\\ttfamily box rendered as a code block", markdown.includes('```\n{\n  "geo_zone": "FR",\n}\n```'), markdown);
  check("\\rule without leftover dimensions", !markdown.includes("0.4pt") && /^\*Pied\.\*$/m.test(markdown), markdown);
  check("TikZ: tikz fence emitted", /^```tikz$/m.test(markdown), markdown);
  check("TikZ: node text folded", markdown.includes("<details><summary>Node text and TikZ source</summary>"), markdown);
  check("TikZ: node text restored", markdown.includes("- **Étape** $x_{1}$") || markdown.includes("- **Étape** $x_1$"), markdown);
  check("TikZ: multi-line node", /^- Suite {2}\n {2}\*fin\*$/m.test(markdown), markdown);
  const prose = markdown.replace(/^(`{3,})[a-z]*\n[\s\S]*?\n\1$/gm, "");
  check("TikZ: drawing commands outside code blocks", !/\[->\]|\(a\) –/.test(prose), prose);
  check("TikZ: no warning (rendering depends on the host)", !warnings.some((w) => w.includes("TikZ")), warnings.join(" | "));
  check("anchors aligned", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));
});

group("Listings (lstlisting, alltt)", () => {
  // Neither is a `verbatim` node for the parser: their content
  // is a list of nodes (alltt even interprets the macros), which used to come out
  // as "[object Object]".
  const { markdown, anchors } = texToMarkdown(
    doc(
      "\\begin{lstlisting}[language=Python]\ndef f(x):\n    return {x: 1}  # 50% $y$\n\\end{lstlisting}\n\n" +
        "\\begin{lstlisting}\nbrut\n\\end{lstlisting}\n\n" +
        "\\begin{itemize}\n\\item un\n\\begin{alltt}\na \\textbf{b} {c}\n  d\n\\end{alltt}\n\\end{itemize}",
    ),
  );
  check("no [object Object]", !markdown.includes("[object Object]"), markdown);
  check(
    "lstlisting: language kept, indentation and special characters intact",
    markdown.includes("```python\ndef f(x):\n    return {x: 1}  # 50% $y$\n```"),
    markdown,
  );
  check("lstlisting without language: text fence", markdown.includes("```text\nbrut\n```"), markdown);
  check("alltt in a list: raw source, line breaks kept", markdown.includes("  ```\n  a \\textbf{b} {c}\n    d\n  ```"), markdown);
  check("anchors aligned", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));
});

group("Tricky names and malformed preambles", () => {
  // The symbol tables are objects: without a null prototype, these names
  // found the members of Object.prototype there — inside a \ttfamily box,
  // "function Object() { [native code] }" showed up in the render, and elsewhere
  // the macro was swallowed without the unknown-command warning.
  const box = texToMarkdown(
    doc("\\begin{center}\n\\fbox{\\parbox{0.86\\textwidth}{\\ttfamily\na \\constructor b \\toString c\n}}\n\\end{center}"),
  ).markdown;
  check("\\ttfamily box: no function code", box.includes("```\na b c\n```"), box);
  const { markdown, warnings } = texToMarkdown(doc("Avant \\constructor{} après."));
  check("macro named like an Object.prototype member: ignored", /^Avant +après\.$/m.test(markdown), markdown);
  check("... and reported like any unknown command", warnings.some((w) => w.includes("\\constructor")), warnings.join(" | "));
  // `\newcommand\` glued to `\begin{document}`: truncated declaration, the rest
  // of the document renders (before: degraded render of the whole document).
  const tikz = texToMarkdown(
    "\\documentclass{article}\n\\newcommand\\\\begin{document}\n\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}\n\\end{document}",
  ).markdown;
  check("preamble ending with \\: no degraded rendering", !tikz.includes("⚠️") && /^```tikz$/m.test(tikz), tikz);
});

group("TikZ: compilable standalone document", () => {
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
  check("standalone class, font size carried over", lines[0] === "\\documentclass[11pt,tikz,border=4pt]{standalone}", lines[0]);
  check("whitelisted packages, options kept", lines.includes("\\usepackage[utf8]{inputenc}") && lines.includes("\\usepackage{tikz}"), figure);
  check("package list filtered (geometry removed)", lines.includes("\\usepackage{amsmath}"), figure);
  check("babel, geometry and commented-out packages excluded", !/babel|geometry|hyperref/.test(figure), figure);
  check("TikZ libraries and styles carried over", lines.includes("\\usetikzlibrary{arrows.meta,positioning}") && lines.includes("\\tikzset{box/.style={draw, rounded corners}}"), figure);
  check("user macros carried over", lines.includes("\\newcommand{\\hyp}[1]{H\\ref{#1}}") && lines.includes("\\newcommand\\Bp{\\mathsf{B}}") && lines.includes("\\DeclareMathOperator{\\Var}{Var}"), figure);
  check("\\renewcommand protected by \\providecommand", lines.includes("\\providecommand{\\contentsname}{}\\renewcommand{\\contentsname}{Sommaire}"), figure);
  check("\\newtheorem not carried over", !figure.includes("newtheorem"), figure);
  check("label reached through a macro", lines.includes("\\newlabel{h:iid}{{1}{}}"), figure);
  check("numbered equation label", lines.includes("\\newlabel{eq:a}{{1}{}}"), figure);
  check("unknown label: \"?\" and warning", lines.includes("\\newlabel{eq:zz}{{?}{}}") && warnings.some((w) => w.includes("eq:zz")), figure + "\n" + warnings.join(" | "));
  check("body between \\begin{document} and \\end{document}", /\\begin\{document\}\n\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}\n\\end\{document\}$/.test(figure), figure);
  check("figure blank line preserved", figure.includes("};\n\n\\draw"), figure);
  check("anchors aligned", misalignedAnchors(markdown, anchors).length === 0, JSON.stringify(misalignedAnchors(markdown, anchors)));

  const frag = texToMarkdown("\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}", { fragment: true }).markdown;
  check("fragment: standalone class without preamble", frag.includes("```tikz\n\\documentclass[tikz,border=4pt]{standalone}\n\\begin{document}\n"), frag);
  check("fragment without nodes: only the source is folded", frag.includes("<details><summary>TikZ source</summary>"), frag);
});

group("Emitted formulas: KaTeX compilation", () => {
  const samples = [
    doc("$\\alpha_i$ et \\begin{equation} \\sum_{i \\in Q} w_i = 1 \\end{equation}"),
    doc("\\begin{align*} \\nabla f &= 0 \\\\ H &\\succ 0 \\end{align*}"),
    doc("Coût $\\theta = 0.75\\,\\text{\\euro}/\\mathrm{MWh}$ et $q^{\\*}$.", ""),
    doc("$\\E[X]$", "\\newcommand{\\E}{\\mathbb{E}}"),
  ];
  samples.forEach((src, i) => {
    const { markdown } = texToMarkdown(src);
    const { errors, total } = katexErrors(markdown);
    check(`sample ${i + 1}: ${total} formula(s) compile`, errors.length === 0, errors.map((e) => `L${e.line} ${e.msg} — ${e.tex}`).join("\n"));
  });
});

// --------------------------------------------------------------------------- //
// `latex-source` highlighting (the application's source code view)
// --------------------------------------------------------------------------- //

group("LaTeX source highlighting", () => {
  const plain = (html) =>
    html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const src = [
    "% commentaire avec un $ isolé et <balise>",
    "\\documentclass{article}",
    "\\begin{align}",
    "  a &= b \\\\", // `&` separator + `\\` end of line
    "\\end{align}",
    "Texte avec $x^2$ et 100\\% & fin.",
    "$$",
    "\\int_0^1 f",
    "$$",
  ].join("\n");
  const html = highlightLatex(src);

  check("text fully preserved", plain(html) === src, plain(html));
  check("HTML escaped", !html.includes("<balise>") && html.includes("&lt;balise&gt;"));
  check("comment colored in full", html.includes('<span class="hljs-comment">% commentaire avec un $ isolé et &lt;balise&gt;</span>'));
  check("structure command = keyword", html.includes('<span class="hljs-keyword">\\documentclass</span>'));
  check("environment name distinguished", html.includes('<span class="hljs-title">align</span>'));
  check("inline formula colored", html.includes('<span class="hljs-string hljs-emphasis">$x^2$</span>'));
  check("multi-line display formula colored", html.includes('<span class="hljs-string hljs-emphasis">$$\n\\int_0^1 f\n$$</span>'));
  check("escaped `\\%` does not open a comment", !html.includes('<span class="hljs-comment">% & fin.'));
  const disp = highlightLatex("avant\n\\[\n  \\sum_k a_k\n\\]\naprès");
  check("display `\\[…\\]` colored as one formula", disp.includes('<span class="hljs-string hljs-emphasis">\\[\n  \\sum_k a_k\n\\]</span>'), disp);
  check("inline `\\(…\\)` colored", highlightLatex("soit \\(x\\) réel").includes('<span class="hljs-string hljs-emphasis">\\(x\\)</span>'));
  check("table separator colored", html.includes('<span class="hljs-operator">&amp;</span>'));
  check("ordinary command ≠ structure", highlightLatex("\\emph{x}").includes('<span class="hljs-built_in">\\emph</span>'));
  check("lone `$` does not contaminate what follows", plain(highlightLatex("prix : 5 $ et suite\nligne 2")) === "prix : 5 $ et suite\nligne 2");
  check("empty input tolerated", highlightLatex("") === "");
});

// --------------------------------------------------------------------------- //
// Real documents passed as arguments
// --------------------------------------------------------------------------- //

const args = process.argv.slice(2);
if (args.length) {
  group("Supplied documents", () => {
    for (const file of args) {
      if (!fs.existsSync(file)) {
        check(`${file}: readable`, false, "file not found");
        continue;
      }
      const src = fs.readFileSync(file, "utf8");
      const t0 = Date.now();
      const res = texToMarkdown(src, { title: path.basename(file, path.extname(file)) });
      const ms = Date.now() - t0;
      const { errors, total } = katexErrors(res.markdown);
      const name = path.basename(file);
      console.log(`  · ${name} — ${ms} ms, ${res.markdown.split("\n").length} lines, ${total} formulas, ${res.anchors.length} anchors`);
      if (res.warnings.length) console.log(`      warnings : ${res.warnings.join(" | ")}`);
      check(`${name}: conversion under 30 s (host timeout)`, ms < 30000, `${ms} ms`);
      check(`${name}: all formulas compile`, errors.length === 0, errors.slice(0, 5).map((e) => `L${e.line} ${e.msg}\n        ${e.tex.slice(0, 140)}`).join("\n      "));
      check(`${name}: no residual internal marker`, !res.markdown.includes(MARKER));
      check(`${name}: no unresolved reference`, !res.markdown.includes("**?**"), res.warnings.join(" | "));
      check(`${name}: anchors sorted and positive`, res.anchors.every((a, i, arr) => (i === 0 || arr[i - 1][0] <= a[0]) && a[0] >= 0 && a[1] >= 0));
      const bad = misalignedAnchors(res.markdown, res.anchors);
      check(`${name}: anchors aligned on content`, bad.length === 0, `${bad.length} anchor(s) on an empty line:${JSON.stringify(bad.slice(0, 5))}`);
    }
  });
}

console.log(`\n${failures ? "FAILED" : "OK"} — ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
