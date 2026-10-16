// Rendering of standalone LaTeX documents (.tex) — core of the transformation.
//
// A .tex fed as-is to the markdown pipeline yields nothing: commands stay
// literal and formulas are not recognized. We therefore generate a derived
// markdown, relying on what the host already knows how to do:
//   - math is emitted as `$…$` / `$$…$$` and rendered by the application's
//     KaTeX (markdown-it-texmath, `dollars` mode) — the plugin renders no
//     formula itself, it just delimits them cleanly;
//   - headings stay markdown headings (`##`) to feed the outline;
//   - the `<div id="…">` anchors placed before each numbered object make
//     cross-references clickable (initLinks, `ui/js/main.js`, resolves the
//     `href="#id"` in the current view).
//
// Three mechanisms carry most of the fidelity:
//
// 1. **Double parse.** The signatures of user macros are only known after the
//    preamble has been read; a first parse collects the
//    `\newcommand`/`\DeclareMathOperator`/`\newtheorem`, the second re-parses
//    the document while declaring these signatures to the parser — otherwise
//    `\hyp{h:iid}` would be read as the macro `\hyp` followed by an independent
//    group.
// 2. **User macro expansion.** KaTeX knows nothing of `\E`, `\Var`, `\SigU`…
//    defined in the preamble; the plugin expands them (LaTeX body, parameters
//    `#1`…`#9` substituted) before emitting the formula.
// 3. **Reference placeholders.** Numbering is done in a single pass; forward
//    `\ref`s are therefore emitted as opaque markers (`\u0001`) resolved once
//    the whole document is numbered.
//
// The rendering is deliberately *semantic*, not typographic: LaTeX page layout
// (geometry, floats, pagination, columns) has no markdown equivalent and is
// not reproduced.

import { getParser, printRaw } from "./vendor/unified-latex.esm.js";

// --------------------------------------------------------------------------- //
// Tables de correspondance
// --------------------------------------------------------------------------- //

// Math environments: their content goes to KaTeX as-is, which knows these
// environments — only the delimiters are rewritten.
const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*",
  "gather", "gather*", "multline", "multline*", "flalign", "flalign*",
  "eqnarray", "eqnarray*", "displaymath", "math",
]);

// Environments whose content must be re-wrapped in `\begin{…}`: KaTeX handles
// them, but only inside a math block.
const MATH_ENVS_WRAPPED = new Set([
  "align", "align*", "alignat", "alignat*", "gather", "gather*",
  "multline", "multline*", "flalign", "flalign*", "eqnarray", "eqnarray*",
]);

// Environments numbered by LaTeX (`equation` counter) — the starred ones are
// not.
const NUMBERED_MATH = new Set([
  "equation", "align", "alignat", "gather", "multline", "flalign", "eqnarray",
]);

// Layout macros with no markdown counterpart: silently ignored (they carry no
// information once pagination is dropped).
const IGNORED_MACROS = new Set([
  "maketitle", "tableofcontents", "listoffigures", "listoftables",
  "noindent", "indent", "centering", "raggedright", "raggedleft",
  "medskip", "bigskip", "smallskip", "vspace", "hspace", "vfill", "hfill",
  "clearpage", "newpage", "pagebreak", "linebreak", "nolinebreak",
  "thispagestyle", "pagestyle", "setlength", "addtolength", "setcounter",
  "addtocounter", "renewcommand", "newcommand", "providecommand",
  "DeclareMathOperator", "newtheorem", "theoremstyle", "usepackage",
  "documentclass", "geometry", "hypersetup", "bibliographystyle",
  "protect", "phantom", "vphantom", "hphantom", "small", "footnotesize",
  "large", "Large", "LARGE", "huge", "Huge", "normalsize", "scriptsize",
  "tiny", "bfseries", "itshape", "rmfamily", "sffamily", "ttfamily",
  "normalfont", "selectfont", "sloppy", "fussy", "allowdisplaybreaks",
  "numberwithin", "captionsetup", "graphicspath", "author", "date", "title",
  "today", "bibliography", "nocite", "markboth", "markright",
  // lengths and rules: no information outside page layout
  "rule", "textwidth", "linewidth", "columnwidth", "textheight", "paperwidth",
  "baselineskip", "parindent", "parskip", "tabcolsep", "arraystretch",
  "arraybackslash", "strut", "usetikzlibrary", "emergencystretch",
]);

// Boxes where only the **last** argument carries text (the previous ones are
// widths, positions or colors — `\parbox{0.9\textwidth}{…}`).
const BOX_MACROS = new Set([
  "fbox", "framebox", "parbox", "makebox", "colorbox", "fcolorbox", "raisebox",
]);

// Size changes that open a subtitle in `\title{… \\ \large …}`.
const SIZE_MACROS = new Set([
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large",
  "LARGE", "huge", "Huge",
]);

// LaTeX separators and spaces rendered as text.
// `\` followed by a line break is a control space, like `\ `.
const SPACING_MACROS = new Set([",", ";", ":", "!", " ", "\n", "\t", "quad", "qquad", "thinspace", "enspace"]);

// Text symbols (outside math mode).
const TEXT_SYMBOLS = {
  euro: "€", texteuro: "€", pounds: "£", textdollar: "$", S: "§", P: "¶",
  copyright: "©", textcopyright: "©", textregistered: "®", dag: "†", ddag: "‡",
  ldots: "…", dots: "…", textellipsis: "…", oe: "œ", OE: "Œ", ae: "æ", AE: "Æ",
  aa: "å", AA: "Å", o: "ø", O: "Ø", ss: "ß", i: "ı", j: "ȷ", l: "ł", L: "Ł",
  textbackslash: "\\", textasciitilde: "~", textasciicircum: "^",
  textbar: "|", textless: "<", textgreater: ">", textunderscore: "_",
  degree: "°", textdegree: "°", times: "×", div: "÷", pm: "±",
  textbullet: "•", textperiodcentered: "·", textemdash: "—", textendash: "–",
  textquotedblleft: "“", textquotedblright: "”", textquoteleft: "‘",
  textquoteright: "’", LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2ε",
  // reserved characters escaped in LaTeX: rendered literally
  "&": "&", "%": "%", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}",
};

// LaTeX accents → combining diacritics (recomposed to NFC on emission).
// Written as Unicode escapes: these characters are invisible in an editor
// and get lost on copy-paste.
const ACCENTS = {
  "'": "\u0301", // combining acute accent
  "`": "\u0300", // combining grave accent
  "^": "\u0302", // combining circumflex accent
  '"': "\u0308", // combining diaeresis
  "~": "\u0303", // combining tilde
  "=": "\u0304", // combining macron
  ".": "\u0307", // combining dot above
  u: "\u0306", // combining breve
  v: "\u030C", // combining caron
  c: "\u0327", // combining cedilla
  H: "\u030B", // combining double acute accent
  d: "\u0323", // combining dot below
  b: "\u0331", // combining macron below
  r: "\u030A", // combining ring above
  k: "\u0328", // combining ogonek
  t: "\u0361", // combining double inverted breve
};

// Inline markup: macro → markdown delimiter.
const INLINE_STYLES = {
  textbf: "**", bf: "**", strong: "**",
  emph: "*", textit: "*", it: "*", textsl: "*",
  texttt: "`", tt: "`", verb: "`",
  underline: "**", uline: "**", // no underline in markdown: bold by default
};

// "Transparent" environments: no rendering of their own, their content is emitted.
const TRANSPARENT_ENVS = new Set([
  "center", "flushleft", "flushright", "small", "footnotesize", "large",
  "quotation", "sloppypar", "spacing", "minipage", "samepage", "group",
]);

// Macros that interrupt the current paragraph (see isBlockNode).
const BLOCK_MACROS = new Set([
  "part", "chapter", "section", "subsection", "subsubsection",
  "paragraph", "subparagraph", "item", "hrule", "appendix",
]);

const MAX_EXPANSION_DEPTH = 8;
const SEP = "\u0001"; // delimiter of reference markers (absent from a .tex)

// --------------------------------------------------------------------------- //
// Text utilities
// --------------------------------------------------------------------------- //

/** LaTeX typographic ligatures applied to text outside math. */
function ligatures(s) {
  return s
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/`/g, "‘")
    .replace(/'/g, "’")
    .replace(/~/g, " ");
}

/**
 * Neutralizes, in text, the characters that markdown-it would interpret.
 * `$` becomes an entity: a literal `$` would break texmath's detection of
 * math delimiters.
 */
function escapeMd(s) {
  return s.replace(/[\\`*_[\]<>|]/g, (c) => "\\" + c).replace(/\$/g, "&#36;");
}

/**
 * Undoes `escapeMd` for inline code content: between backticks, markdown
 * interprets nothing and a backslash would remain visible (`B2B\_Market`).
 */
function unescapeMd(s) {
  return s.replace(/\\([\\`*_[\]<>|])/g, "$1").replace(/&#36;/g, "$");
}

/**
 * Columns of a `tabular` spec → markdown alignments. Token-based reading:
 * filtering by character would read the `c` of `p{5cm}` as a centered column.
 */
function columnAligns(spec) {
  const out = [];
  let i = 0;
  const group = () => {
    // `spec[i]` must be `{`; returns the content and advances past `}`.
    if (spec[i] !== "{") return "";
    let depth = 0;
    const start = i + 1;
    for (; i < spec.length; i++) {
      if (spec[i] === "{") depth++;
      else if (spec[i] === "}" && --depth === 0) {
        i++;
        return spec.slice(start, i - 1);
      }
    }
    return spec.slice(start);
  };
  const skipSpaces = () => {
    while (/\s/.test(spec[i] ?? "")) i++;
  };
  while (i < spec.length) {
    const c = spec[i++];
    if (c === "l" || c === "c" || c === "r") out.push(c);
    else if (c === "p" || c === "m" || c === "b") {
      out.push("l");
      skipSpaces();
      group();
    } else if (c === "X") out.push("l");
    else if (c === ">" || c === "<" || c === "@" || c === "!") {
      skipSpaces();
      group();
    } else if (c === "*") {
      skipSpaces();
      const n = Number(group()) || 0;
      skipSpaces();
      const inner = columnAligns(group());
      for (let k = 0; k < Math.min(n, 64); k++) out.push(...inner);
    }
  }
  return out;
}

/** Same for a table cell: `|` must disappear too. */
function escapeCell(s) {
  return s.replace(/\|/g, "\\|");
}

/**
 * Collapses onto a single line: a `\\` in a title or a cell would produce a
 * markdown line break that would split the title in two or break the
 * table.
 */
function oneLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** Name of an environment (`n.env` is a list of nodes). */
function envName(node) {
  try {
    return printRaw(node.env).trim();
  } catch {
    return "";
  }
}

/** 0-based source line of a node, or null. */
function srcLine(node) {
  const l = node?.position?.start?.line;
  return typeof l === "number" ? Math.max(0, l - 1) : null;
}

/** Safe HTML attribute value — a LaTeX label is free text. */
function attrValue(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safe HTML identifier, derived from a number or a title. */
function slug(prefix, key) {
  const body = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${body || "x"}`;
}

/** Content of an argument, as raw LaTeX. */
function argRaw(node, i) {
  const a = node.args?.[i];
  return a ? printRaw(a.content).trim() : "";
}

/** Nodes of an argument (empty list if absent). */
function argNodes(node, i) {
  return node.args?.[i]?.content ?? [];
}

/** True if the argument exists and was delimited (tells an absent `[]` from an empty one). */
function hasArg(node, i) {
  const a = node.args?.[i];
  return !!a && a.openMark !== "";
}

// --------------------------------------------------------------------------- //
// Preamble: user macros and theorem environments
// --------------------------------------------------------------------------- //

/**
 * Collects the document's definitions. Called on a first "bare" parse
 * (unknown signatures): `\newcommand` & co. have a signature built into the
 * parser, so they are correctly split even at this stage.
 */
function collectDefs(nodes, defs) {
  for (const n of nodes) {
    if (n.type === "environment" && envName(n) !== "document") {
      collectDefs(n.content ?? [], defs);
      continue;
    }
    if (n.type === "environment") {
      collectDefs(n.content ?? [], defs); // \newtheorem after \begin{document}: legal
      continue;
    }
    if (n.type !== "macro") continue;
    const name = n.content;

    if (name === "newcommand" || name === "renewcommand" || name === "providecommand") {
      // args: [starred, ?, {\name}, [nargs], [default], {body}]
      const target = argRaw(n, 2).replace(/^\\/, "");
      if (!target || !/^[A-Za-z@]+$/.test(target)) continue;
      const nargs = Number(argRaw(n, 3)) || 0;
      defs.macros.set(target, {
        nargs,
        optional: hasArg(n, 4) ? argRaw(n, 4) : null,
        body: argRaw(n, 5),
      });
    } else if (name === "DeclareMathOperator") {
      const target = argRaw(n, 1).replace(/^\\/, "");
      if (!target) continue;
      const star = argRaw(n, 0) === "*";
      defs.macros.set(target, {
        nargs: 0,
        optional: null,
        body: `\\operatorname${star ? "*" : ""}{${argRaw(n, 2)}}`,
      });
    } else if (name === "newtheorem") {
      // args: [*, {env}, [shared counter], {label}, [parent counter]]
      const env = argRaw(n, 1);
      if (!env) continue;
      const shared = hasArg(n, 2) ? argRaw(n, 2) : "";
      defs.theorems.set(env, {
        label: argRaw(n, 3) || env,
        counter: shared || env,
        parent: hasArg(n, 4) ? argRaw(n, 4) : null,
        numbered: argRaw(n, 0) !== "*",
        style: defs.theoremStyle,
      });
    } else if (name === "theoremstyle") {
      // Applies to every `\newtheorem` that follows (amsthm).
      defs.theoremStyle = argRaw(n, n.args?.length ? n.args.length - 1 : 0) || "plain";
    } else if (name === "def") {
      // `\def\x{...}`: only the form without delimited parameters is handled.
      const raw = printRaw(n.args?.map((a) => a.content) ?? []);
      const m = /^\\([A-Za-z@]+)\{([\s\S]*)\}$/.exec(raw.trim());
      if (m) defs.macros.set(m[1], { nargs: 0, optional: null, body: m[2] });
    } else if (name === "title" || name === "author" || name === "date") {
      const v = argRaw(n, n.args?.length > 1 ? n.args.length - 1 : 0);
      if (v) defs.meta[name] = v;
    }
    for (const a of n.args ?? []) collectDefs(a.content ?? [], defs);
  }
}

/**
 * Expander for user macros, applied to **textual** LaTeX (formulas, macro
 * bodies). Works by scanning: read the name, then as many `{…}` groups as the
 * definition expects, and substitute `#1`…`#9`.
 */
function makeExpander(macros) {
  // Reads a balanced group starting at `i` (which must point at `{`).
  const readGroup = (s, i) => {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return { body: s.slice(i + 1, j), next: j + 1 };
    }
    return null;
  };

  const expand = (text, depth) => {
    if (depth > MAX_EXPANSION_DEPTH || !text.includes("\\")) return text;
    let out = "";
    let i = 0;
    let changed = false;
    while (i < text.length) {
      const c = text[i];
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
      const m = /^\\([A-Za-z@]+)/.exec(text.slice(i));
      if (!m) {
        out += text.slice(i, i + 2); // `\{`, `\\`, `\%`…: left intact
        i += 2;
        continue;
      }
      const def = macros.get(m[1]);
      if (!def) {
        out += m[0];
        i += m[0].length;
        continue;
      }
      let j = i + m[0].length;
      while (text[j] === " ") j++; // LaTeX swallows the spaces after a macro name
      const args = [];
      // Optional argument `[…]` in first position, if declared.
      if (def.optional !== null && text[j] === "[") {
        const close = text.indexOf("]", j);
        if (close > 0) {
          args.push(text.slice(j + 1, close));
          j = close + 1;
        } else args.push(def.optional);
      } else if (def.optional !== null) args.push(def.optional);
      while (args.length < def.nargs) {
        if (text[j] === "{") {
          const g = readGroup(text, j);
          if (!g) break;
          args.push(g.body);
          j = g.next;
        } else if (j < text.length && text[j] !== "\\") {
          args.push(text[j]); // single-character argument, without braces
          j++;
        } else if (text[j] === "\\") {
          const mm = /^\\([A-Za-z@]+|.)/.exec(text.slice(j));
          if (!mm) break;
          args.push(mm[0]);
          j += mm[0].length;
        } else break;
      }
      if (args.length < def.nargs) {
        out += m[0]; // missing arguments: do not expand rather than break
        i += m[0].length;
        continue;
      }
      const body = def.body.replace(/#(\d)/g, (_, d) => args[Number(d) - 1] ?? "");
      // A command name ends at the first non-letter: without a space,
      // `\sum\Kdiff` would become `\sumK_{…}` and `\foo x` (body `\alpha`)
      // would become `\alphax` — two unknown commands.
      if (/\\[A-Za-z@]+$/.test(out) && /^[A-Za-z@]/.test(body)) out += " ";
      out += body;
      if (/\\[A-Za-z@]+$/.test(body) && /^[A-Za-z@]/.test(text[j] ?? "")) out += " ";
      i = j;
      changed = true;
    }
    return changed ? expand(out, depth + 1) : out;
  };

  return (text) => (macros.size ? expand(String(text), 0) : String(text));
}

// --------------------------------------------------------------------------- //
// Generation of the derived markdown
// --------------------------------------------------------------------------- //

// Declarations that `collectDefs` knows how to recognize. Used to decide whether
// the document body must be included in the collection parse (see `defsScope`):
// a false positive only costs the original behavior, never fidelity.
const DEF_MARKERS = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|newtheorem|def|title|author|date)\b/;

/**
 * Scope of the **first** parse, the one that only serves to collect definitions.
 * They almost always live in the preamble: parsing the few KB that precede
 * `\begin{document}` is then enough, instead of the whole document — the PEG
 * parser dominates the cost of rendering and this pass pays it twice.
 * Falls back to the full source as soon as a declaration lingers in the body
 * (`\newtheorem` after `\begin{document}` is legal, see collectDefs).
 */
function defsScope(source) {
  const cut = source.indexOf("\\begin{document}");
  if (cut < 0) return source; // fragment: no delimitable preamble
  return DEF_MARKERS.test(source.slice(cut)) ? source : source.slice(0, cut);
}

// --------------------------------------------------------------------------- //
// TikZ figures: standalone document compiled by the host
// --------------------------------------------------------------------------- //

// Preamble packages carried over into a figure's document. A whitelist rather
// than a blacklist: a layout package (`geometry`, `hyperref`, `fancyhdr`…) is
// useless there, and a package missing from the workstation's distribution
// makes the whole compilation fail — the host disables MiKTeX's automatic
// installation. `babel` is excluded for the same reason (French is rarely
// installed by default) and because its active characters (`;`, `:`, `!`)
// break TikZ syntax.
const TIKZ_PACKAGES = new Set([
  "inputenc", "fontenc", "lmodern", "amsmath", "amssymb", "amsfonts", "mathtools",
  "bm", "textcomp", "eurosym", "upgreek", "mathrsfs", "stmaryrd", "xcolor", "color",
  "graphicx", "array", "booktabs", "siunitx", "tikz", "pgf", "pgfplots", "tikz-cd",
  "circuitikz",
]);

// Preamble declarations useful to a figure. Macro definitions are lazy:
// carrying over an unused `\newcommand` costs nothing.
const TIKZ_DECLARATIONS =
  /\\(usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|tikzset|pgfplotsset|tikzstyle|newcommand|renewcommand|providecommand|DeclareMathOperator|definecolor|colorlet)(?![A-Za-z@])(\*?)/g;

/** Reads a balanced group (`{…}` or `[…]`) opened at `i`; returns the index that follows it. */
function skipGroup(s, i) {
  const open = s[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "{" && open === "[") j = skipGroup(s, j) - 1;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return s.length;
}

/**
 * Preamble lines of a standalone TikZ figure, drawn from the document's
 * preamble: whitelisted packages, TikZ libraries and styles, user macros and
 * colors. A fragment without a preamble yields none.
 */
function tikzPreamble(source) {
  const cut = source.indexOf("\\begin{document}");
  const pre = (cut < 0 ? "" : source.slice(0, cut)).replace(/(^|[^\\])%.*$/gm, "$1");
  const size = /\\documentclass\s*\[([^\]]*)\]/.exec(pre)?.[1].match(/\b1[012]pt\b/)?.[0];
  const lines = [`\\documentclass[${size ? size + "," : ""}tikz,border=4pt]{standalone}`];
  TIKZ_DECLARATIONS.lastIndex = 0;
  for (let m; (m = TIKZ_DECLARATIONS.exec(pre)); ) {
    const name = m[1];
    const groups = [];
    let i = m.index + m[0].length;
    for (;;) {
      let j = i;
      while (/\s/.test(pre[j] ?? "")) j++;
      if (pre[j] === "{" || pre[j] === "[") {
        const end = skipGroup(pre, j);
        groups.push(pre.slice(j, end));
        i = end;
      } else if (pre[j] === "\\" && !groups.length && /command|Operator/.test(name)) {
        const cs = /^\\([A-Za-z@]+|.)/.exec(pre.slice(j)); // `\newcommand\foo{…}`
        groups.push(`{${cs[0]}}`);
        i = j + cs[0].length;
      } else if (pre[j] === "=" && name === "tikzstyle") {
        i = j + 1; // `\tikzstyle{name}=[…]`
      } else break;
    }
    TIKZ_DECLARATIONS.lastIndex = i;
    const declaration = pre.slice(m.index, i).trim();
    if (name === "usepackage" || name === "RequirePackage") {
      const opts = groups.find((g) => g[0] === "[") ?? "";
      const names = (groups.find((g) => g[0] === "{") ?? "{}").slice(1, -1).split(",").map((s) => s.trim());
      const kept = names.filter((p) => TIKZ_PACKAGES.has(p));
      if (kept.length) lines.push(`\\usepackage${kept.length === names.length ? opts : ""}{${kept.join(",")}}`);
    } else if (name === "renewcommand") {
      // A command that the `standalone` class does not define (`\contentsname`
      // depends on the original class) would make `\renewcommand` fail.
      const target = (groups.find((g) => g[0] === "{") ?? "").slice(1, -1).trim();
      if (/^\\[A-Za-z@]+$/.test(target)) lines.push(`\\providecommand{${target}}{}${declaration}`);
    } else {
      lines.push(declaration);
    }
  }
  return lines;
}

/**
 * Labels the plugin writes into the rendering itself (LaTeX's `\proofname`,
 * `\partname`, `\abstractname`), in the document's language — as LaTeX does.
 */
const LABELS = {
  en: {
    proof: "Proof",
    part: "Part",
    abstract: "Abstract",
    untitled: "(untitled)",
    tikzSource: "TikZ source",
    tikzNodesAndSource: "Node text and TikZ source",
  },
  fr: {
    proof: "Démonstration",
    part: "Partie",
    abstract: "Résumé",
    untitled: "(sans titre)",
    tikzSource: "Source TikZ",
    tikzNodesAndSource: "Texte des nœuds et source TikZ",
  },
};
/**
 * Messages addressed to the user — warnings shown in the host's banner and the
 * degraded-rendering banner — in the language of the **interface** (`locale`
 * given by the host, protocol §6.1), not of the document: they talk about the
 * rendering, not about the text.
 */
const MESSAGES = {
  en: {
    unknownCommand: (name) => `unknown command \\${name} ignored`,
    unformattedEnv: (name) => `environment "${name}" rendered without formatting`,
    unresolved: (n, list) =>
      `unresolved reference${n > 1 ? "s" : ""}: ${list}` + (n > 5 ? `… (${n} in total)` : ""),
    degraded: "degraded rendering: the source is displayed as-is",
    degradedBanner: "Degraded LaTeX rendering",
    defaultTitle: "LaTeX document",
  },
  fr: {
    unknownCommand: (name) => `commande inconnue \\${name} ignorée`,
    unformattedEnv: (name) => `environnement « ${name} » rendu sans mise en forme`,
    unresolved: (n, list) =>
      `référence${n > 1 ? "s" : ""} non résolue${n > 1 ? "s" : ""} : ${list}` +
      (n > 5 ? `… (${n} au total)` : ""),
    degraded: "rendu dégradé : le source est affiché tel quel",
    degradedBanner: "Rendu LaTeX dégradé",
    defaultTitle: "Document LaTeX",
  },
};

/** Interface language given by the host (`"fr"`, `"en"`…) → message set. */
export function uiMessages(locale) {
  return String(locale ?? "").toLowerCase().startsWith("fr") ? MESSAGES.fr : MESSAGES.en;
}

const FRENCH = new Set(["french", "francais", "frenchb", "acadian", "canadien"]);
// Babel language options other than French: they can only select English
// labels, but they must be told apart from class options (`a4paper`, `11pt`).
const OTHER_LANGUAGES = new Set([
  "english", "american", "british", "usenglish", "ukenglish", "canadian", "australian",
  "newzealand", "german", "ngerman", "austrian", "naustrian", "swissgerman", "spanish",
  "catalan", "italian", "portuguese", "brazilian", "dutch", "danish", "swedish", "norsk",
  "nynorsk", "finnish", "polish", "czech", "slovak", "russian", "ukrainian", "greek",
  "turkish", "hungarian", "romanian", "croatian", "serbian", "slovene", "japanese",
]);

/**
 * Main language of the document, read from the preamble: polyglossia's
 * `\setdefaultlanguage`/`\setmainlanguage`, else babel's `main=` option, else
 * the last language among the babel and class options (babel's own rule —
 * class options are passed on to it). English when nothing is declared or
 * the language is not one the plugin has labels for.
 */
export function docLanguage(source) {
  const pre = String(source).split(/\\begin\s*\{document\}/)[0].replace(/(?<!\\)%.*$/gm, "");
  const toLang = (name) => (FRENCH.has(name.trim().toLowerCase()) ? "fr" : "en");
  const poly = /\\set(?:default|main)language\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(pre);
  if (poly) return toLang(poly[1]);
  const babel = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{[^}]*\bbabel\b[^}]*\}/.exec(pre);
  if (!babel) return "en";
  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?/.exec(pre);
  const opts = [cls?.[1], babel[1]].filter(Boolean).join(",").split(",").map((o) => o.trim());
  const main = opts.find((o) => o.startsWith("main="));
  if (main) return toLang(main.slice(5));
  const isLang = (o) => FRENCH.has(o.toLowerCase()) || OTHER_LANGUAGES.has(o.toLowerCase());
  const langs = opts.filter(isLang);
  return langs.length ? toLang(langs[langs.length - 1]) : "en";
}

function generate(source, { title, fragment, M }) {
  const L = LABELS[docLanguage(source)];
  const defs = { macros: new Map(), theorems: new Map(), meta: {}, theoremStyle: "plain" };
  const nude = getParser().parse(defsScope(source));
  collectDefs(nude.content, defs);

  // Second parse: the parser now knows the signature of user macros, so
  // their arguments are correctly attached.
  const signatures = {};
  for (const [name, def] of defs.macros) {
    const sig = (def.optional !== null ? "o" : "") + "m".repeat(def.nargs - (def.optional !== null ? 1 : 0));
    signatures[name] = { signature: sig };
  }
  // Same for theorem environments: the parser only knows the usual names
  // (`theorem`, `remark`…). Without a signature, the title of a
  // `\begin{hypothese}[Title]` would stay in the body, brackets included.
  const envSignatures = {};
  for (const name of defs.theorems.keys()) envSignatures[name] = { signature: "o" };
  // `longtable` is unknown to the parser: without a signature, its column spec
  // (`{p{1.7cm} …}`) would stay in the first cell.
  envSignatures.longtable = { signature: "o m" };
  const parser = getParser({ macros: signatures, environments: envSignatures });
  const ast = parser.parse(source);
  const docEnv = ast.content.find((n) => n.type === "environment" && envName(n) === "document");
  const body = docEnv ? docEnv.content : ast.content;

  const expand = makeExpander(defs.macros);
  const out = []; // one entry = one line of markdown
  const anchors = [[0, 0]];
  const warnings = new Set();
  const labels = new Map(); // LaTeX label → { text, anchor }
  const anchorLines = new Map(); // anchor id → index of its line in `out`
  const footnotes = [];
  const counters = new Map();
  let sectionNums = [0, 0, 0, 0];
  let inAppendix = false; // after `\appendix`: lettered sections (A, B.2…)
  let partNum = 0;
  // `\part` sits above the sections: their headings go down one level so
  // that the outline reflects the hierarchy.
  const levelShift = body.some((n) => n.type === "macro" && n.content === "part") ? 1 : 0;
  let lastAnchoredSrc = -1;

  const push = (line) => out.push(line);
  const blank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };
  /**
   * Removes an already emitted line **while realigning the anchors**: those
   * that follow it would otherwise point one line too low (the preview ↔ source
   * sync would drift across everything after a list).
   */
  const removeLine = (i) => {
    if (i < 0 || i >= out.length) return;
    out.splice(i, 1);
    for (const a of anchors) if (a[0] > i) a[0] -= 1;
    for (const [id, l] of anchorLines) if (l > i) anchorLines.set(id, l - 1);
  };
  const anchorAt = (node) => {
    const l = srcLine(node);
    if (l === null || l === lastAnchoredSrc) return;
    anchors.push([out.length, l]);
    lastAnchoredSrc = l;
  };

  const bump = (name) => {
    const v = (counters.get(name) ?? 0) + 1;
    counters.set(name, v);
    return v;
  };
  const sectionPrefix = (depth) =>
    sectionNums
      .slice(0, depth)
      .map((v, k) => (k === 0 && inAppendix && v >= 1 && v <= 26 ? String.fromCharCode(64 + v) : v))
      .join(".");

  // --- references ------------------------------------------------------- //
  const ref = (kind, key) => `${SEP}${kind}${SEP}${key}${SEP}`;
  const defineLabel = (key, text, anchor) => {
    if (key) labels.set(key, { text, anchor });
  };
  // Current target of a `\label`: updated by each numbered object.
  let pendingLabel = null;
  const openLabelTarget = (text, anchor) => {
    pendingLabel = { text, anchor };
  };
  const takeLabel = (key) => {
    if (pendingLabel) defineLabel(key, pendingLabel.text, pendingLabel.anchor);
    else defineLabel(key, "", "");
  };

  // Places an invisible HTML anchor (block: no stray paragraph). The line
  // is remembered so that `\label` aliases can be grafted onto it later (see the
  // end of `generate`) — grafting onto the existing line, hence without shifting `anchors`.
  const anchorDiv = (id) => {
    anchorLines.set(id, out.length);
    push(`<div id="${id}"></div>`);
    push("");
  };

  // --- expansion of user macros in the inline flow ----------------------- //
  const expandCache = new Map();
  const expandMacroNode = (n) => {
    const key = n.content + "\u0000" + (n.args ?? []).map((a) => a.openMark + printRaw(a.content) + a.closeMark).join("");
    let nodes = expandCache.get(key);
    if (!nodes) {
      const raw = expand(
        "\\" + n.content + (n.args ?? []).map((a) => a.openMark + printRaw(a.content) + a.closeMark).join(""),
      );
      nodes = parser.parse(raw).content;
      expandCache.set(key, nodes);
    }
    return nodes;
  };

  // --- math -------------------------------------------------------------- //
  /**
   * Prepares a formula's content for KaTeX: extraction of `\label`s
   * (meaningless to a renderer) then expansion of the preamble's macros,
   * which KaTeX does not know.
   */
  const prepareMath = (raw) => {
    const found = [];
    let s = raw.replace(/\\label\{([^}]*)\}/g, (_, k) => {
      found.push(k);
      return "";
    });
    s = expand(s);
    // What KaTeX cannot read, in math mode as well as in `\text{}` (list
    // established by probing the vendored KaTeX, see tests/test_latex_plugin.mjs):
    // without this cleanup the whole formula would be displayed in red.
    s = s
      .replace(/\\(?:hspace|vspace)\*?\s*\{[^{}]*\}/g, "")
      .replace(/(?<!\\)\\([-/])/g, "") // hyphenation and italic correction
      .replace(/(?<!\\)\\\*/g, "*")
      .replace(/\\(?:euro|texteuro)(?![A-Za-z])\s*(?:\{\})?/g, "\\text{€}")
      .replace(/\\textbullet(?![A-Za-z])\s*(?:\{\})?/g, "\\text{•}")
      .replace(/\\textperiodcentered(?![A-Za-z])\s*(?:\{\})?/g, "\\cdot ")
      .replace(/\\LaTeXe(?![A-Za-z])\s*(?:\{\})?/g, "\\text{LaTeX2ε}")
      .replace(/\\l(?![A-Za-z])/g, "\\text{ł}")
      .replace(/\\L(?![A-Za-z])/g, "\\text{Ł}")
      // A reference inside a formula (typically via a user macro such as
      // `\hyp{…}` = `H\ref{…}`): the number is inserted as text, without a
      // link — a markdown link has no meaning inside a `$…$`.
      .replace(/\\(ref|eqref)\s*\{([^}]*)\}/g, (_, kind, key) =>
        `\\text{${kind === "eqref" ? "(" + ref("t", key) + ")" : ref("t", key)}}`,
      );
    return { math: s.trim(), labels: found };
  };

  const emitDisplayMath = (node, content, env) => {
    const { math, labels: found } = prepareMath(content);
    const numbered = env ? NUMBERED_MATH.has(env) : false;
    let tag = "";
    let anchor = "";
    if (numbered) {
      const num = bump("equation");
      anchor = `eq-${num}`;
      tag = `\\tag{${num}}`;
      openLabelTarget(String(num), anchor);
    }
    for (const k of found) takeLabel(k);
    if (!math) return;
    blank();
    anchorAt(node);
    if (anchor) anchorDiv(anchor);
    const inner = env && MATH_ENVS_WRAPPED.has(env)
      ? `\\begin{${env}}${math}\\end{${env}}`
      : math;
    push("$$");
    for (const line of `${inner}${tag}`.split("\n")) push(line);
    push("$$");
    push("");
  };

  // --- inline ------------------------------------------------------------ //
  /**
   * Renders a list of nodes as inline markdown text. Raw text is
   * accumulated so that ligatures then escaping are applied in one go (the
   * ligatures cross node boundaries: `-`, `-`, `-` are three distinct
   * `string` nodes).
   */
  const emitInline = (nodes, depth = 0) => {
    let res = "";
    let buf = "";
    const flush = () => {
      if (buf) {
        res += escapeMd(ligatures(buf));
        buf = "";
      }
    };
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      switch (n.type) {
        case "string":
          buf += n.content;
          break;
        case "whitespace":
          buf += " ";
          break;
        case "comment":
          break;
        case "parbreak":
          flush();
          res += " ";
          break;
        case "inlinemath": {
          flush();
          const { math, labels: found } = prepareMath(printRaw(n.content));
          for (const k of found) takeLabel(k);
          // A line end (`\` + return, common in a long formula) would become
          // a markdown line break and cut the formula.
          if (math) res += `$${math.replace(/\s*\n\s*/g, " ")}$`;
          break;
        }
        case "displaymath":
        case "mathenv": {
          // Display formula met in an inline context (cell, title…):
          // degraded to inline rather than lost.
          flush();
          const { math } = prepareMath(printRaw(n.content));
          if (math) res += `$${math.replace(/\s*\n\s*/g, " ")}$`;
          break;
        }
        case "group":
          flush();
          res += emitInline(n.content ?? [], depth);
          break;
        case "verbatim":
          flush();
          res += "`" + String(n.content ?? "").replace(/`/g, "ʼ") + "`";
          break;
        case "environment": {
          flush();
          res += emitInline(n.content ?? [], depth);
          break;
        }
        case "macro": {
          flush();
          const r = emitInlineMacro(n, nodes, i, depth);
          res += r.text;
          if (r.next !== undefined) i = r.next;
          else if (/^[A-Za-z@]+$/.test(n.content) && !n.args?.some((a) => a.openMark || a.content?.length)) {
            // TeX swallows the spaces that follow a command word without an
            // argument: `c\oe ur` is written "cœur", not "cœ ur".
            while (nodes[i + 1]?.type === "whitespace") i++;
          }
          break;
        }
        default:
          break;
      }
    }
    flush();
    return res;
  };

  /**
   * Renders a macro in an inline context. Returns the text and, if the macro
   * consumed following nodes (accents `\'e`), the index reached.
   */
  const emitInlineMacro = (n, siblings, i, depth) => {
    const name = n.content;

    if (defs.macros.has(name) && depth < MAX_EXPANSION_DEPTH) {
      return { text: emitInline(expandMacroNode(n), depth + 1) };
    }
    if (INLINE_STYLES[name]) {
      const inner = emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0), depth).trim();
      if (!inner) return { text: "" };
      const d = INLINE_STYLES[name];
      return { text: d === "`" ? "`" + unescapeMd(inner).replace(/`/g, "ʼ") + "`" : d + inner + d };
    }
    if (name === "multicolumn") {
      // {n}{spec}{content}: markdown has no cell merging, only the
      // content is kept (in the first of the covered columns).
      return { text: emitInline(argNodes(n, 2), depth) };
    }
    if (BOX_MACROS.has(name)) {
      return { text: emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0), depth) };
    }
    if (name === "ref" || name === "autoref" || name === "pageref" || name === "cref" || name === "Cref") {
      return { text: ref("r", argRaw(n, n.args?.length > 1 ? n.args.length - 1 : 0)) };
    }
    if (name === "eqref") {
      return { text: ref("e", argRaw(n, n.args?.length > 1 ? n.args.length - 1 : 0)) };
    }
    if (name === "label") {
      takeLabel(argRaw(n, n.args?.length > 1 ? n.args.length - 1 : 0));
      return { text: "" };
    }
    if (name === "cite" || name === "citep" || name === "citet") {
      const keys = argRaw(n, n.args?.length ? n.args.length - 1 : 0);
      return { text: keys ? `\\[${escapeMd(keys)}\\]` : "" };
    }
    if (name === "footnote") {
      const num = footnotes.length + 1;
      footnotes.push(emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0), depth).trim());
      return { text: `<sup id="fnref-${num}">[${num}](#fn-${num})</sup>` };
    }
    if (name === "url") {
      const u = argRaw(n, n.args?.length ? n.args.length - 1 : 0);
      return { text: u ? `<${u}>` : "" };
    }
    if (name === "href") {
      const u = argRaw(n, n.args?.length > 1 ? n.args.length - 2 : 0);
      const t = emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0), depth) || u;
      return { text: u ? `[${t}](${u})` : t };
    }
    if (name === "includegraphics") {
      const p = argRaw(n, n.args?.length ? n.args.length - 1 : 0);
      return { text: p ? `![](${encodeURI(p)})` : "" };
    }
    if (name === "text" || name === "mbox" || name === "textnormal" || name === "textrm") {
      return { text: emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0), depth) };
    }
    if (TEXT_SYMBOLS[name] !== undefined) {
      return { text: escapeMd(TEXT_SYMBOLS[name]) };
    }
    if (ACCENTS[name] !== undefined) {
      // The accented letter is either an argument or the next node.
      let letter = argRaw(n, 0);
      let next = i;
      if (!letter) {
        let j = i + 1;
        while (j < siblings.length && siblings[j].type === "whitespace") j++;
        const s = siblings[j];
        if (s?.type === "string" && s.content) {
          letter = s.content[0];
          if (s.content.length > 1) {
            // Only the first letter is consumed: the rest of the node is
            // fed back through a synthetic node.
            siblings[j] = { ...s, content: s.content.slice(1) };
            next = j - 1;
          } else next = j;
        } else if (s?.type === "group") {
          letter = printRaw(s.content);
          next = j;
        }
      }
      return { text: escapeMd((letter + ACCENTS[name]).normalize("NFC")), next };
    }
    if (SPACING_MACROS.has(name)) return { text: " " };
    if (name === "\\" || name === "newline") return { text: "  \n" };
    if (name === "-" || name === "/") return { text: "" }; // hyphenation, italic correction
    if (IGNORED_MACROS.has(name)) return { text: "" };

    // Unknown macro: keep its arguments, the only information it carries.
    const inner = (n.args ?? []).map((a) => emitInline(a.content ?? [], depth)).join(" ").trim();
    if (!inner) warnings.add(M.unknownCommand(name));
    return { text: inner };
  };

  // --- blocks ------------------------------------------------------------- //

  /** Emits a paragraph from accumulated inline nodes. */
  const flushPara = (nodes, indent) => {
    if (!nodes.length) return;
    // Spaces are normalized, but **not** line breaks: the only ones present
    // are the `  \n` produced by a `\\`, which must remain a markdown line
    // break.
    const text = emitInline(nodes)
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "  \n")
      .trim();
    if (!text) return;
    blank();
    anchorAt(nodes[0]);
    // A line that starts with a markdown marker would be misinterpreted. A
    // number only is one when followed by `.`/`)` **then a space** — and it is
    // the punctuation that gets escaped: `\0.92` would display the backslash.
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^([#>+-])/, "\\$1").replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2"));
    for (const line of lines) push(indent + line);
    push("");
  };

  const isBlockNode = (n) =>
    n.type === "environment" ||
    n.type === "mathenv" ||
    n.type === "displaymath" ||
    n.type === "verbatim" ||
    (n.type === "macro" && BLOCK_MACROS.has(n.content));

  /** Meaningful nodes (excluding spaces, comments and pure layout). */
  const meaningful = (nodes) =>
    nodes.filter(
      (x) =>
        x.type !== "whitespace" &&
        x.type !== "comment" &&
        x.type !== "parbreak" &&
        !(x.type === "macro" && IGNORED_MACROS.has(x.content)),
    );

  /**
   * Raw text of a box in a monospace font (`\fbox{\parbox{…}{\ttfamily …}}`,
   * a common idiom for a JSON or code example): rendered as a code block,
   * `\\` line endings and `\hspace{…em}` indentation included.
   */
  const codeText = (nodes) => {
    let s = "";
    const walk = (list) => {
      for (const x of list) {
        if (x.type === "string") s += x.content;
        else if (x.type === "whitespace") {
          if (s && !s.endsWith("\n") && !s.endsWith(" ")) s += " ";
        } else if (x.type === "parbreak") s += "\n\n";
        else if (x.type === "group") walk(x.content ?? []);
        else if (x.type === "inlinemath") s += "$" + printRaw(x.content) + "$";
        else if (x.type === "verbatim") s += String(x.content ?? "");
        else if (x.type === "macro") {
          const name = x.content;
          if (name === "\\" || name === "newline") s = s.replace(/ +$/, "") + "\n";
          else if (name === "hspace") {
            const m = /([\d.]+)\s*em/.exec(argRaw(x, x.args?.length ? x.args.length - 1 : 0));
            s += " ".repeat(m ? Math.round(Number(m[1]) * 2) : 1);
          } else if (name === " ") s += " ";
          else if (TEXT_SYMBOLS[name] !== undefined) s += TEXT_SYMBOLS[name];
          else if (x.args?.length && !IGNORED_MACROS.has(name)) walk(argNodes(x, x.args.length - 1));
        }
      }
    };
    walk(nodes);
    return s
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  };

  /** Quote prefix on the lines emitted since `start` (blank lines included). */
  const quoteFrom = (start, indent) => {
    let end = out.length;
    while (end > start && out[end - 1] === "") end--;
    for (let i = start; i < end; i++) {
      out[i] = out[i] ? indent + "> " + out[i].slice(indent.length) : indent + ">";
    }
  };

  /**
   * Paragraph reduced to a framed box (`\fbox{\parbox{…}{…}}`, often centered):
   * rendered as a quote — or as a code block if the content is in `\ttfamily`.
   * Returns false if the paragraph is not of this form.
   */
  const emitBoxed = (nodes, indent) => {
    const sole = meaningful(nodes);
    if (sole.length !== 1 || sole[0].type !== "macro" || !["fbox", "framebox", "fcolorbox", "colorbox"].includes(sole[0].content)) {
      return false;
    }
    let inner = argNodes(sole[0], sole[0].args.length - 1);
    const wrapped = meaningful(inner);
    if (wrapped.length === 1 && wrapped[0].type === "macro" && wrapped[0].content === "parbox") {
      inner = argNodes(wrapped[0], wrapped[0].args.length - 1);
    } else if (wrapped.length === 1 && wrapped[0].type === "environment" && envName(wrapped[0]) === "minipage") {
      inner = wrapped[0].content ?? [];
    }
    const first = inner.find((x) => x.type !== "whitespace" && x.type !== "comment");
    blank();
    anchorAt(sole[0]);
    if (first?.type === "macro" && first.content === "ttfamily") {
      const text = codeText(inner);
      const fence = fenceFor(text);
      push(indent + fence);
      for (const line of text.split("\n")) push(indent + line);
      push(indent + fence);
      push("");
      return true;
    }
    const start = out.length;
    emitBlocks(inner, indent);
    quoteFrom(start, indent);
    blank();
    return true;
  };

  const emitBlocks = (nodes, indent = "") => {
    let inline = [];
    const flushInline = () => {
      if (!emitBoxed(inline, indent)) flushPara(inline, indent);
      inline = [];
    };
    for (const n of nodes) {
      if (n.type === "parbreak") {
        flushInline();
      } else if (isBlockNode(n)) {
        flushInline();
        emitBlockNode(n, indent);
      } else if (n.type === "group" && (n.content ?? []).some(isBlockNode)) {
        // `{\small \begin{longtable}…}`: the group only serves to bound layout
        // declarations — inline, the environment would be flattened into
        // text (column spec and `&` included).
        flushInline();
        emitBlocks(n.content, indent);
      } else if (n.type === "comment") {
        continue;
      } else {
        inline.push(n);
      }
    }
    flushInline();
  };

  const SECTION_LEVELS = {
    part: 1, chapter: 1, section: 1, subsection: 2, subsubsection: 3,
    paragraph: 4, subparagraph: 4,
  };

  const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  const roman = (v) => ROMAN.reduce((s, [k, r]) => {
    for (; v >= k; v -= k) s += r;
    return s;
  }, "");

  /**
   * `\part`: own roman counter (`\ref` → "II"), which does **not** touch
   * the sections — in the `article` class, their numbering continues from one
   * part to the next.
   */
  const emitPart = (n) => {
    const starred = argRaw(n, 0) === "*";
    const text = oneLine(emitInline(argNodes(n, n.args?.length ? n.args.length - 1 : 0)));
    const num = starred ? "" : roman(++partNum);
    blank();
    anchorAt(n);
    const anchor = num ? slug("part", num) : slug("part", text || String(out.length));
    anchorDiv(anchor);
    openLabelTarget(num || text, anchor);
    push("## " + (num ? `${L.part} ${num} — ` : "") + (text || L.untitled));
    push("");
  };

  const emitSection = (n, name) => {
    const depth = SECTION_LEVELS[name];
    const starred = argRaw(n, 0) === "*";
    const titleNodes = argNodes(n, n.args?.length ? n.args.length - 1 : 0);
    const text = oneLine(emitInline(titleNodes));
    let num = "";
    if (!starred && depth <= 3) {
      sectionNums[depth - 1] += 1;
      for (let k = depth; k < sectionNums.length; k++) sectionNums[k] = 0;
      num = sectionPrefix(depth);
      // The equation counter is not reset (continuous numbering,
      // default behavior of the `article` class).
      // Theorem counters declared `[section]`: reset to zero.
      for (const t of defs.theorems.values()) {
        if (t.parent === "section") counters.set(t.counter, 0);
      }
    }
    blank();
    anchorAt(n);
    // Slug of the number: `sec-2-1`, and `sec-b-1` in an appendix — never the same
    // identifier as a body section.
    const anchor = num ? slug("sec", num) : slug("sec", text || String(out.length));
    anchorDiv(anchor);
    openLabelTarget(num || text, anchor);
    // +1: markdown level 1 is reserved for the document title (one more
    // under `\part`s).
    push("#".repeat(Math.min(6, depth + 1 + levelShift)) + " " + (num ? num + " " : "") + (text || L.untitled));
    push("");
  };

  /**
   * Environment header (theorem, proof) merged into the first paragraph of
   * the body, as amsthm typesets it: "**Proposition 8** (Title). Under H1…".
   * If the body starts with something other than a paragraph (formula, list,
   * table), the header stays on its own line.
   */
  const runInHeader = (h) => {
    const p = h + 2;
    const line = out[p];
    if (out[h + 1] !== "" || !line || /^(\$\$|\||<|[-*+] |\d+[.)] |>|```|#|\s)/.test(line)) return;
    out[p] = out[h] + " " + line;
    removeLine(h + 1);
    removeLine(h);
  };

  const emitTheorem = (n, name, spec) => {
    const titleNodes = hasArg(n, 0) ? argNodes(n, 0) : [];
    let num = "";
    if (spec.numbered) {
      const v = bump(spec.counter);
      num = spec.parent === "section" ? `${sectionPrefix(1)}.${v}` : String(v);
    }
    const anchor = slug(name, num || String(out.length));
    blank();
    anchorAt(n);
    anchorDiv(anchor);
    openLabelTarget(num, anchor);
    // amsthm: bold head (`plain`, `definition` styles) or italic
    // (`remark`), note in parentheses in roman, trailing period.
    const d = spec.style === "remark" ? "*" : "**";
    const head = `${escapeMd(spec.label)}${num ? " " + num : ""}`;
    const note = titleNodes.length ? oneLine(emitInline(titleNodes)) : "";
    const h = out.length;
    push(note ? `${d}${head}${d} (${note}).` : `${d}${head}.${d}`);
    push("");
    emitBlocks(n.content ?? []);
    runInHeader(h);
  };

  const emitProof = (n) => {
    blank();
    anchorAt(n);
    const title = hasArg(n, 0) ? oneLine(emitInline(argNodes(n, 0))) : L.proof;
    const h = out.length;
    push(`*${title}.*`);
    push("");
    emitBlocks(n.content ?? []);
    runInHeader(h);
    blank();
    push("<div align=\"right\">∎</div>");
    push("");
  };

  /**
   * Emits list items. An explicit marker (`\item[(a)]`) replaces the
   * numbered bullet — the "1. (a)" duplicate does not exist in LaTeX; it is
   * bold in `description`, roman elsewhere.
   */
  const emitItems = (items, ordered, indent, boldMarkers) => {
    const numbered = ordered && items.every((it) => !it.marker);
    items.forEach((it, idx) => {
      const bullet = numbered ? `${idx + 1}. ` : "- ";
      const child = indent + " ".repeat(bullet.length);
      const start = out.length;
      emitBlocks(it.nodes, child);
      // Removes the leading blank lines produced by `blank()` at the start of an item.
      while (out.length > start && out[start] === "") removeLine(start);
      const label = it.marker ? (boldMarkers ? `**${it.marker}** ` : `${it.marker} `) : "";
      if (out.length > start) {
        out[start] = indent + bullet + label + out[start].slice(child.length);
      } else {
        out.push(indent + bullet + label);
      }
      // A blank line at the end of an item would split the list into two blocks.
      while (out.length > start && out[out.length - 1] === "") removeLine(out.length - 1);
    });
    push("");
  };

  const emitList = (n, ordered, indent, boldMarkers = false) => {
    const items = [];
    let cur = null;
    for (const c of n.content ?? []) {
      if (c.type === "macro" && c.content === "item") {
        // The parser attaches the item body to `\item`: the optional marker
        // is the bracketed argument, the body is the last argument. The nodes
        // that follow (paragraphs separated by a blank line) belong to the
        // same item and are concatenated.
        const args = c.args ?? [];
        const optional = args.find((a) => a.openMark === "[");
        const bodyArg = args.filter((a) => a.openMark !== "[").pop();
        cur = {
          node: c,
          marker: optional ? emitInline(optional.content ?? []).trim() : "",
          nodes: [...(bodyArg?.content ?? [])],
        };
        items.push(cur);
      } else if (cur) cur.nodes.push(c);
      else if (c.type !== "whitespace" && c.type !== "parbreak" && c.type !== "comment") {
        // Content before the first \item: rare, but must not disappear.
        cur = { node: c, marker: "", nodes: [c] };
        items.push(cur);
      }
    }
    if (!items.length) return;
    blank();
    anchorAt(n);
    emitItems(items, ordered, indent, boldMarkers);
  };

  /** Shifts the positions of a subtree re-parsed in isolation (source lines). */
  const shiftLines = (nodes, delta) => {
    for (const x of nodes) {
      if (x.position) {
        x.position = {
          start: { ...x.position.start, line: x.position.start.line + delta },
          end: { ...x.position.end, line: x.position.end.line + delta },
        };
      }
      if (Array.isArray(x.content)) shiftLines(x.content, delta);
      for (const a of x.args ?? []) shiftLines(a.content ?? [], delta);
    }
    return nodes;
  };

  /**
   * `tikzpicture`: the plugin does not draw. It emits a ```tikz fence
   * containing a **standalone LaTeX document** — the form Kroki expects —,
   * which the host compiles with the workstation's TeX distribution, or hands
   * over to the configured Kroki server. The document carries over from the
   * preamble what a figure can use (see `tikzPreamble`) and fixes, through
   * `\newlabel`, the number of the `\ref`/`\eqref` it contains, resolved like
   * the other markers.
   *
   * Without a TeX engine, the host displays an error in place of the drawing:
   * the text of each `\node` (in source order) and the TikZ source therefore
   * remain available, folded under the figure.
   */
  let tikzLines = null;
  const emitTikz = (n, indent) => {
    const off = n.position?.start?.offset;
    const endOff = n.position?.end?.offset;
    const raw = typeof off === "number" && typeof endOff === "number" ? source.slice(off, endOff) : printRaw(n);
    tikzLines ??= tikzPreamble(source);
    const expanded = expand(raw); // `\hyp{h:iid}` → `H\ref{h:iid}`
    const keys = new Set();
    for (const m of expanded.matchAll(/\\(?:ref|eqref|autoref|pageref)\*?\s*\{([^}]*)\}/g)) keys.add(m[1].trim());
    const figure = [
      ...tikzLines,
      ...(/\\eqref\b/.test(expanded) && !tikzLines.some((l) => /amsmath/.test(l)) ? ["\\usepackage{amsmath}"] : []),
      ...(/\\autoref\b/.test(expanded) ? ["\\providecommand{\\autoref}[1]{\\ref{#1}}"] : []),
      ...[...keys].map((k) => `\\newlabel{${k}}{{${ref("t", k)}}{}}`),
      "\\begin{document}",
      ...raw.split("\n"),
      "\\end{document}",
    ];
    const baseLine = srcLine(n) ?? 0;
    const items = [];
    const re = /\\node(?![A-Za-z@])/g;
    for (let m; (m = re.exec(raw)); ) {
      // Options `[…]`, name `(…)` and position `at (…)` precede the text `{…}`.
      let i = m.index + m[0].length;
      let sq = 0;
      let par = 0;
      for (; i < raw.length; i++) {
        const c = raw[i];
        if (c === "\\") i++;
        else if (c === "[") sq++;
        else if (c === "]") sq--;
        else if (c === "(" && !sq) par++;
        else if (c === ")" && !sq) par--;
        else if (c === ";" && !sq && !par) break;
        else if (c === "{") {
          if (!sq && !par) break;
          // braces of an option value (`font={\small}`): skipped
          for (let depth = 0; i < raw.length; i++) {
            if (raw[i] === "\\") i++;
            else if (raw[i] === "{") depth++;
            else if (raw[i] === "}" && --depth === 0) break;
          }
        }
      }
      if (raw[i] !== "{") continue;
      let depth = 0;
      let j = i;
      for (; j < raw.length; j++) {
        if (raw[j] === "\\") j++;
        else if (raw[j] === "{") depth++;
        else if (raw[j] === "}" && --depth === 0) break;
      }
      const text = raw.slice(i + 1, j);
      re.lastIndex = j;
      if (!text.trim()) continue;
      const line = baseLine + (raw.slice(0, i).match(/\n/g) ?? []).length;
      items.push({ marker: "", nodes: shiftLines(parser.parse(text).content, line) });
    }
    blank();
    anchorAt(n);
    const figureFence = fenceFor(figure.join("\n"));
    push(indent + figureFence + "tikz");
    for (const l of figure) push(indent + l);
    push(indent + figureFence);
    push("");
    push(indent + `<details><summary>${items.length ? L.tikzNodesAndSource : L.tikzSource}</summary>`);
    push("");
    if (items.length) emitItems(items, false, indent, false);
    const fence = fenceFor(raw);
    push(indent + fence + "tex");
    for (const l of raw.split("\n")) push(indent + l);
    push(indent + fence);
    push("");
    push(indent + "</details>");
    push("");
  };

  /**
   * `tabular` → markdown table. Mind the AST asymmetry: the **cell separator**
   * `&` is a `string` node, whereas the literal `\&` is a macro — confusing the
   * two would split the cells in the wrong place. The `\\` line end, on the
   * other hand, is indeed a macro.
   * The first row becomes the header: markdown has no header-less table, and a
   * table whose first row is content remains readable.
   */
  const emitTabular = (n, indent) => {
    const spec = argRaw(n, n.args?.length ? n.args.length - 1 : 0);
    const aligns = columnAligns(spec).map((c) => (c === "c" ? ":---:" : c === "r" ? "---:" : "---"));
    const rows = [];
    let row = [];
    let cell = [];
    // `longtable`: the rows that precede `\endfoot`/`\endlastfoot` are page
    // footers, and those between `\endfirsthead` and `\endhead` the repeated
    // header of the following pages — a markdown table has only one header.
    let mark = 0;
    let firstHead = -1;
    const endCell = () => {
      row.push(escapeCell(oneLine(emitInline(cell))));
      cell = [];
    };
    const endRow = () => {
      endCell();
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    };
    for (const c of n.content ?? []) {
      if (c.type === "string" && c.content.includes("&")) {
        // The parser isolates `&` in its own node, but we split anyway:
        // a glued cell (`a&b`) must not be lost.
        const parts = c.content.split("&");
        parts.forEach((p, k) => {
          if (k) endCell();
          if (p) cell.push({ ...c, content: p });
        });
      } else if (c.type === "macro" && (c.content === "\\" || c.content === "tabularnewline" || c.content === "cr")) {
        endRow();
      } else if (c.type === "macro" && ["endfirsthead", "endhead", "endfoot", "endlastfoot"].includes(c.content)) {
        if (c.content === "endfirsthead") firstHead = rows.length;
        else if (c.content === "endhead" && firstHead >= 0) rows.splice(firstHead);
        else if (c.content !== "endhead") rows.splice(mark);
        mark = rows.length;
        cell = [];
      } else if (
        c.type === "macro" &&
        ["hline", "toprule", "midrule", "bottomrule", "cline", "rowcolor", "noalign"].includes(c.content)
      ) {
        continue;
      } else {
        cell.push(c);
      }
    }
    endRow();
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const sep = Array.from({ length: width }, (_, i) => aligns[i] ?? "---");
    blank();
    anchorAt(n);
    push(indent + "| " + pad(rows[0]).join(" | ") + " |");
    push(indent + "| " + sep.join(" | ") + " |");
    for (const r of rows.slice(1)) push(indent + "| " + pad(r).join(" | ") + " |");
    push("");
  };

  const emitFloat = (n, kind) => {
    // `table`/`figure`: the float itself does not exist in markdown, we render
    // its content then its caption, numbered as LaTeX would.
    const num = bump(kind);
    const anchor = `${kind}-${num}`;
    blank();
    anchorAt(n);
    anchorDiv(anchor);
    openLabelTarget(String(num), anchor);
    const caption = [];
    const rest = [];
    const split = (nodes) => {
      for (const c of nodes) {
        if (c.type === "macro" && c.content === "caption") caption.push(c);
        else rest.push(c);
      }
    };
    split(n.content ?? []);
    emitBlocks(rest);
    for (const c of caption) {
      const text = oneLine(emitInline(argNodes(c, c.args?.length ? c.args.length - 1 : 0)));
      blank();
      push(`*${kind === "table" ? "Table" : "Figure"} ${num}${text ? " — " + text : ""}*`);
      push("");
    }
  };

  const emitVerbatim = (n, indent, lang = "") => {
    // The line end that follows `\begin{verbatim}` and the one that precedes
    // `\end{verbatim}` are not part of the content.
    const text = String(n.content ?? "").replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
    blank();
    anchorAt(n);
    push(indent + "```" + lang);
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) push(indent + line);
    push(indent + "```");
    push("");
  };

  const emitBlockNode = (n, indent = "") => {
    if (n.type === "mathenv" || n.type === "displaymath") {
      const env = n.type === "mathenv" ? envName(n) : "";
      emitDisplayMath(n, printRaw(n.content), env);
      return;
    }
    if (n.type === "verbatim") {
      emitVerbatim(n, indent);
      return;
    }
    if (n.type === "environment") {
      const name = envName(n);
      const spec = defs.theorems.get(name);
      if (spec) return emitTheorem(n, name, spec);
      if (MATH_ENVS.has(name)) return emitDisplayMath(n, printRaw(n.content), name);
      switch (name) {
        case "document":
          return emitBlocks(n.content ?? [], indent);
        case "itemize":
          return emitList(n, false, indent);
        case "enumerate":
          return emitList(n, true, indent);
        case "description":
          return emitList(n, false, indent, true);
        case "tikzpicture":
          return emitTikz(n, indent);
        case "proof":
          return emitProof(n);
        case "abstract": {
          blank();
          anchorAt(n);
          push(`**${L.abstract}**`);
          push("");
          return emitBlocks(n.content ?? [], indent);
        }
        case "tabular":
        case "tabularx":
        case "array":
        case "longtable":
          return emitTabular(n, indent);
        case "table":
          return emitFloat(n, "table");
        case "figure":
          return emitFloat(n, "figure");
        case "verbatim":
        case "lstlisting":
        case "alltt":
          return emitVerbatim(n, indent, name === "lstlisting" ? "text" : "");
        case "quote":
        case "quotation": {
          const start = out.length;
          emitBlocks(n.content ?? [], indent);
          for (let i = start; i < out.length; i++) if (out[i]) out[i] = "> " + out[i];
          return;
        }
        case "thebibliography":
          return emitBlocks(n.content ?? [], indent);
        default:
          if (!TRANSPARENT_ENVS.has(name)) warnings.add(M.unformattedEnv(name));
          return emitBlocks(n.content ?? [], indent);
      }
    }
    if (n.type === "macro") {
      const name = n.content;
      if (name === "part") return emitPart(n);
      if (SECTION_LEVELS[name]) return emitSection(n, name);
      if (name === "hrule") {
        blank();
        push("---");
        push("");
        return;
      }
      if (name === "item") return; // `\item` outside a list: ignored
      if (name === "appendix") {
        sectionNums = [0, 0, 0, 0];
        inAppendix = true;
        return;
      }
      // Block macro without dedicated handling: rendered as inline.
      return flushPara([n], indent);
    }
  };

  // --- document title ----------------------------------------------------- //
  if (!fragment) {
    // `\title{Title \\ \large Subtitle}`: a segment opened by a size change
    // is a subtitle, rendered under the h1; a bare `\\` only breaks an
    // overly long line and stays folded into the title.
    const lines = [[]];
    for (const x of defs.meta.title ? parser.parse(defs.meta.title).content : []) {
      if (x.type === "macro" && (x.content === "\\" || x.content === "newline")) lines.push([]);
      else lines[lines.length - 1].push(x);
    }
    const segments = [];
    for (const nodes of lines) {
      const first = nodes.find((x) => x.type !== "whitespace" && x.type !== "comment");
      if (!segments.length || (first?.type === "macro" && SIZE_MACROS.has(first.content))) segments.push([...nodes]);
      else segments[segments.length - 1].push({ type: "whitespace" }, ...nodes);
    }
    const [docTitle = "", ...subtitles] = segments.map((s) => oneLine(emitInline(s)));
    push(`# ${docTitle || escapeMd(title)}`);
    push("");
    const subs = subtitles.filter(Boolean);
    if (subs.length) {
      // one entry of `out` = one line: the anchors count entries
      subs.forEach((s, k) => push(k < subs.length - 1 ? s + "  " : s));
      push("");
    }
    const by = [defs.meta.author, defs.meta.date]
      .filter(Boolean)
      .map((v) => emitInline(parser.parse(v).content).trim())
      .filter(Boolean);
    if (by.length) {
      push(`*${by.join(" — ")}*`);
      push("");
    }
  }

  emitBlocks(body);

  // --- footnotes ---------------------------------------------------------- //
  if (footnotes.length) {
    blank();
    push("---");
    push("");
    push("**Notes**");
    push("");
    footnotes.forEach((t, i) => {
      push(`${i + 1}. <span id="fn-${i + 1}"></span>${t} [↩](#fnref-${i + 1})`);
    });
    push("");
  }

  // --- anchor aliases: the LaTeX label itself ------------------------------ //
  // The anchors placed so far carry a **number** (`eq-3`, `sec-2-1`) that
  // moves with the slightest insertion upstream: unusable as a stable target
  // from another document. Each anchor is therefore doubled with the `\label{}`(s)
  // that target it, **verbatim** — `\label{eq:sigmaU}` ↔ `doc.tex#eq:sigmaU`,
  // 1:1 correspondence, no transformation rule to remember (a slug
  // would force the case: `sigmaU` → `sigmau`).
  // Grafting happens *onto* the existing anchor line: no line is
  // created, `anchors` (preview ↔ source sync) stays exact.
  const aliases = new Map(); // line index → labels to graft onto it
  for (const [key, target] of labels) {
    const line = target.anchor ? anchorLines.get(target.anchor) : undefined;
    // Target without an anchor (orphan label, empty equation) or identifier already taken
    // by a numbered anchor: nothing to graft, a duplicated `id` would be worse.
    if (line === undefined || anchorLines.has(key)) continue;
    aliases.set(line, [...(aliases.get(line) ?? []), key]);
  }
  for (const [line, keys] of aliases) {
    out[line] += keys.map((k) => `<div id="${attrValue(k)}"></div>`).join("");
  }

  // --- consecutive blank lines -------------------------------------------- //
  // Merged **before** the join, through `removeLine`: a merge on the final
  // text would shift all the anchors located downstream. The content of code
  // blocks (TikZ source, verbatim) is left intact.
  for (let i = out.length - 1, fence = null; i > 0; i--) {
    const f = /^\s*(`{3,})/.exec(out[i]);
    if (f && (!fence || f[1].length >= fence.length)) fence = fence ? null : f[1];
    else if (!fence && out[i] === "" && out[i - 1] === "") removeLine(i);
  }

  // --- reference resolution ------------------------------------------------ //
  const unresolved = new Set();
  // `r` = \ref, `e` = \eqref, `t` = reference that appeared in a formula (rendered
  // as bare text: a markdown link would not survive inside a `$…$`).
  const pattern = new RegExp(`${SEP}([ret])${SEP}([^${SEP}]*)${SEP}`, "g");
  const markdown = out
    .join("\n")
    .replace(pattern, (_, kind, key) => {
      const target = labels.get(key);
      if (!target || !target.text) {
        unresolved.add(key);
        return kind === "e" ? "(?)" : kind === "t" ? "?" : "**?**";
      }
      if (kind === "t") return target.text;
      const text = kind === "e" ? `(${target.text})` : target.text;
      return target.anchor ? `[${text}](#${target.anchor})` : text;
    });

  if (unresolved.size) {
    const list = [...unresolved].slice(0, 5).join(", ");
    warnings.add(M.unresolved(unresolved.size, list));
  }

  return { markdown, anchors, warnings: [...warnings] };
}

// --------------------------------------------------------------------------- //
// Plugin API
// --------------------------------------------------------------------------- //

/** Fence long enough to contain the source without delimiter collision. */
function fenceFor(source) {
  const longest = Math.max(2, ...[...String(source).matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Transforms a LaTeX source into a markdown document ready for the host's
 * rendering pipeline. Never throws: in case of the unexpected, the whole
 * source goes into a fence under a banner (guaranteed visual feedback during
 * live editing). The fallback fence is ```tex and not ```latex: the latter
 * is claimed by the plugin, it would be re-rendered in a loop.
 *
 * `locale` is the interface language given by the host: it selects the
 * language of the warnings, the degraded banner and the default title — the
 * labels written into the rendering follow the document's language instead.
 *
 * Returns `{ markdown, anchors, warnings }` — see remapLine (`ui/js/anchors.js`).
 */
export function texToMarkdown(source, { title, fragment = false, locale } = {}) {
  const M = uiMessages(locale);
  title ??= M.defaultTitle;
  const src = String(source ?? "").replace(/\r\n?/g, "\n");
  try {
    return generate(src, { title, fragment, M });
  } catch (err) {
    const fence = fenceFor(src);
    const markdown = [
      ...(fragment ? [] : [`# ${title}`, ""]),
      `> ⚠️ **${M.degradedBanner}** — ${err && err.message ? err.message : String(err)}`,
      "",
      `${fence}tex`,
      src,
      fence,
      "",
    ].join("\n");
    return { markdown, anchors: [[0, 0]], warnings: [M.degraded] };
  }
}
