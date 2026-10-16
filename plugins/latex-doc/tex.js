// Rendu des documents LaTeX autonomes (.tex) — cœur de la transformation.
//
// Un .tex passé tel quel au pipeline markdown ne donne rien : les commandes
// restent littérales et les formules ne sont pas reconnues. On génère donc un
// markdown dérivé, en s'appuyant sur ce que l'hôte sait déjà faire :
//   - les maths partent en `$…$` / `$$…$$` et sont rendues par le KaTeX de
//     l'application (markdown-it-texmath, mode `dollars`) — le plugin ne rend
//     aucune formule lui-même, il se contente de délimiter proprement ;
//   - les titres restent des titres markdown (`##`) pour alimenter le sommaire ;
//   - les ancres `<div id="…">` posées avant chaque objet numéroté rendent les
//     références croisées cliquables (initLinks, `ui/js/main.js`, résout les
//     `href="#id"` dans la vue courante).
//
// Trois mécanismes portent l'essentiel de la fidélité :
//
// 1. **Double parse.** Les signatures des macros utilisateur ne sont connues
//    qu'après lecture du préambule ; un premier parse collecte les
//    `\newcommand`/`\DeclareMathOperator`/`\newtheorem`, le second re-parse le
//    document en déclarant ces signatures au parseur — sans quoi `\hyp{h:iid}`
//    serait lu comme la macro `\hyp` suivie d'un groupe indépendant.
// 2. **Expansion des macros utilisateur.** KaTeX ignore `\E`, `\Var`, `\SigU`…
//    définis dans le préambule ; le plugin les expanse (corps LaTeX, paramètres
//    `#1`…`#9` substitués) avant d'émettre la formule.
// 3. **Placeholders de références.** La numérotation se fait en un seul
//    parcours ; les `\ref` en avant sont donc émises comme marqueurs opaques
//    (`\u0001`) résolus une fois tout le document numéroté.
//
// Le rendu est volontairement *sémantique*, pas typographique : la mise en page
// LaTeX (geometry, flottants, pagination, colonnes) n'a pas d'équivalent en
// markdown et n'est pas reproduite.

import { getParser, printRaw } from "./vendor/unified-latex.esm.js";

// --------------------------------------------------------------------------- //
// Tables de correspondance
// --------------------------------------------------------------------------- //

// Environnements mathématiques : leur contenu part tel quel à KaTeX, qui
// connaît ces environnements — on ne réécrit que les délimiteurs.
const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*",
  "gather", "gather*", "multline", "multline*", "flalign", "flalign*",
  "eqnarray", "eqnarray*", "displaymath", "math",
]);

// Environnements dont le contenu doit être ré-encapsulé dans `\begin{…}` :
// KaTeX les gère, mais seulement à l'intérieur d'un bloc math.
const MATH_ENVS_WRAPPED = new Set([
  "align", "align*", "alignat", "alignat*", "gather", "gather*",
  "multline", "multline*", "flalign", "flalign*", "eqnarray", "eqnarray*",
]);

// Environnements numérotés par LaTeX (compteur `equation`) — les étoilés ne le
// sont pas.
const NUMBERED_MATH = new Set([
  "equation", "align", "alignat", "gather", "multline", "flalign", "eqnarray",
]);

// Macros de mise en page sans contrepartie markdown : ignorées silencieusement
// (elles ne portent aucune information une fois la pagination abandonnée).
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
  // longueurs et filets : aucune information hors mise en page
  "rule", "textwidth", "linewidth", "columnwidth", "textheight", "paperwidth",
  "baselineskip", "parindent", "parskip", "tabcolsep", "arraystretch",
  "arraybackslash", "strut", "usetikzlibrary", "emergencystretch",
]);

// Boîtes dont seul le **dernier** argument porte du texte (les précédents sont
// des largeurs, positions ou couleurs — `\parbox{0.9\textwidth}{…}`).
const BOX_MACROS = new Set([
  "fbox", "framebox", "parbox", "makebox", "colorbox", "fcolorbox", "raisebox",
]);

// Changements de taille qui ouvrent un sous-titre dans `\title{… \\ \large …}`.
const SIZE_MACROS = new Set([
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large",
  "LARGE", "huge", "Huge",
]);

// Séparateurs et espaces LaTeX rendus en texte.
// `\` suivi d'une fin de ligne est une espace de contrôle, comme `\ `.
const SPACING_MACROS = new Set([",", ";", ":", "!", " ", "\n", "\t", "quad", "qquad", "thinspace", "enspace"]);

// Symboles texte (hors mode math).
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
  // caractères réservés échappés en LaTeX : rendus littéralement
  "&": "&", "%": "%", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}",
};

// Accents LaTeX → diacritiques combinants (recomposés en NFC à l'émission).
// Notés en échappements Unicode : ces caractères sont invisibles dans un
// éditeur et se perdent au copier-coller.
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

// Balisage inline : macro → délimiteur markdown.
const INLINE_STYLES = {
  textbf: "**", bf: "**", strong: "**",
  emph: "*", textit: "*", it: "*", textsl: "*",
  texttt: "`", tt: "`", verb: "`",
  underline: "**", uline: "**", // pas de souligné en markdown : gras par défaut
};

// Environnements « transparents » : aucun rendu propre, on émet leur contenu.
const TRANSPARENT_ENVS = new Set([
  "center", "flushleft", "flushright", "small", "footnotesize", "large",
  "quotation", "sloppypar", "spacing", "minipage", "samepage", "group",
]);

// Macros qui interrompent le paragraphe courant (cf. isBlockNode).
const BLOCK_MACROS = new Set([
  "part", "chapter", "section", "subsection", "subsubsection",
  "paragraph", "subparagraph", "item", "hrule", "appendix",
]);

const MAX_EXPANSION_DEPTH = 8;
const SEP = "\u0001"; // délimiteur des marqueurs de référence (absent d'un .tex)

// --------------------------------------------------------------------------- //
// Utilitaires texte
// --------------------------------------------------------------------------- //

/** Ligatures typographiques LaTeX appliquées au texte hors math. */
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
 * Neutralise dans du texte les caractères que markdown-it interpréterait.
 * `$` devient une entité : un `$` littéral casserait la détection des
 * délimiteurs math de texmath.
 */
function escapeMd(s) {
  return s.replace(/[\\`*_[\]<>|]/g, (c) => "\\" + c).replace(/\$/g, "&#36;");
}

/**
 * Défait `escapeMd` pour un contenu de code inline : entre backticks, markdown
 * n'interprète rien et un antislash resterait affiché (`B2B\_Market`).
 */
function unescapeMd(s) {
  return s.replace(/\\([\\`*_[\]<>|])/g, "$1").replace(/&#36;/g, "$");
}

/**
 * Colonnes d'une spec `tabular` → alignements markdown. Lecture par jetons :
 * un filtrage par caractère lirait le `c` de `p{5cm}` comme une colonne centrée.
 */
function columnAligns(spec) {
  const out = [];
  let i = 0;
  const group = () => {
    // `spec[i]` doit être `{` ; renvoie le contenu et avance après `}`.
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

/** Idem pour une cellule de table : les `|` doivent aussi disparaître. */
function escapeCell(s) {
  return s.replace(/\|/g, "\\|");
}

/**
 * Replie sur une seule ligne : un `\\` dans un titre ou une cellule produirait
 * un saut de ligne markdown qui couperait le titre en deux ou casserait la
 * table.
 */
function oneLine(s) {
  return s.replace(/\s+/g, " ").trim();
}

/** Nom d'un environnement (`n.env` est une liste de nœuds). */
function envName(node) {
  try {
    return printRaw(node.env).trim();
  } catch {
    return "";
  }
}

/** Ligne source 0-based d'un nœud, ou null. */
function srcLine(node) {
  const l = node?.position?.start?.line;
  return typeof l === "number" ? Math.max(0, l - 1) : null;
}

/** Valeur d'attribut HTML sûre — un label LaTeX est du texte libre. */
function attrValue(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Identifiant HTML sûr, dérivé d'un numéro ou d'un titre. */
function slug(prefix, key) {
  const body = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${body || "x"}`;
}

/** Contenu d'un argument, en LaTeX brut. */
function argRaw(node, i) {
  const a = node.args?.[i];
  return a ? printRaw(a.content).trim() : "";
}

/** Nœuds d'un argument (liste vide si absent). */
function argNodes(node, i) {
  return node.args?.[i]?.content ?? [];
}

/** Vrai si l'argument existe et a été délimité (distingue `[]` absent de vide). */
function hasArg(node, i) {
  const a = node.args?.[i];
  return !!a && a.openMark !== "";
}

// --------------------------------------------------------------------------- //
// Préambule : macros utilisateur et environnements de théorèmes
// --------------------------------------------------------------------------- //

/**
 * Collecte les définitions du document. Appelée sur un premier parse « nu »
 * (signatures inconnues) : `\newcommand` & co. ont une signature intégrée au
 * parseur, elles sont donc correctement découpées même à ce stade.
 */
function collectDefs(nodes, defs) {
  for (const n of nodes) {
    if (n.type === "environment" && envName(n) !== "document") {
      collectDefs(n.content ?? [], defs);
      continue;
    }
    if (n.type === "environment") {
      collectDefs(n.content ?? [], defs); // \newtheorem après \begin{document} : légal
      continue;
    }
    if (n.type !== "macro") continue;
    const name = n.content;

    if (name === "newcommand" || name === "renewcommand" || name === "providecommand") {
      // args : [starred, ?, {\nom}, [nargs], [défaut], {corps}]
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
      // args : [*, {env}, [compteur partagé], {libellé}, [compteur parent]]
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
      // Vaut pour tous les `\newtheorem` qui suivent (amsthm).
      defs.theoremStyle = argRaw(n, n.args?.length ? n.args.length - 1 : 0) || "plain";
    } else if (name === "def") {
      // `\def\x{...}` : seule la forme sans paramètres délimités est reprise.
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
 * Expanseur des macros utilisateur, appliqué au LaTeX **textuel** (formules,
 * corps de macro). Opère par balayage : on lit le nom, puis autant de groupes
 * `{…}` que la définition en attend, et on substitue `#1`…`#9`.
 */
function makeExpander(macros) {
  // Lit un groupe équilibré à partir de `i` (qui doit pointer sur `{`).
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
        out += text.slice(i, i + 2); // `\{`, `\\`, `\%`… : laissés intacts
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
      while (text[j] === " ") j++; // LaTeX absorbe les espaces après un nom de macro
      const args = [];
      // Argument optionnel `[…]` en première position, s'il est déclaré.
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
          args.push(text[j]); // argument d'un seul caractère, sans accolades
          j++;
        } else if (text[j] === "\\") {
          const mm = /^\\([A-Za-z@]+|.)/.exec(text.slice(j));
          if (!mm) break;
          args.push(mm[0]);
          j += mm[0].length;
        } else break;
      }
      if (args.length < def.nargs) {
        out += m[0]; // arguments manquants : on n'expanse pas plutôt que de casser
        i += m[0].length;
        continue;
      }
      const body = def.body.replace(/#(\d)/g, (_, d) => args[Number(d) - 1] ?? "");
      // Un nom de commande se termine à la première non-lettre : sans espace,
      // `\sum\Kdiff` deviendrait `\sumK_{…}` et `\foo x` (corps `\alpha`)
      // deviendrait `\alphax` — deux commandes inconnues.
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
// Génération du markdown dérivé
// --------------------------------------------------------------------------- //

// Déclarations que `collectDefs` sait reconnaître. Sert à décider si le corps
// du document doit être inclus dans le parse de collecte (cf. `defsScope`) :
// un faux positif ne coûte que le comportement d'origine, jamais la fidélité.
const DEF_MARKERS = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|newtheorem|def|title|author|date)\b/;

/**
 * Portée du **premier** parse, celui qui ne sert qu'à collecter les définitions.
 * Elles vivent presque toujours dans le préambule : parser les quelques Ko qui
 * précèdent `\begin{document}` suffit alors, au lieu du document entier — le
 * parseur PEG domine le coût du rendu et cette passe le paie deux fois.
 * Repli sur le source complet dès qu'une déclaration traîne dans le corps
 * (`\newtheorem` après `\begin{document}` est légal, cf. collectDefs).
 */
function defsScope(source) {
  const cut = source.indexOf("\\begin{document}");
  if (cut < 0) return source; // fragment : pas de préambule délimitable
  return DEF_MARKERS.test(source.slice(cut)) ? source : source.slice(0, cut);
}

// --------------------------------------------------------------------------- //
// Figures TikZ : document autonome compilé par l'hôte
// --------------------------------------------------------------------------- //

// Paquets du préambule repris dans le document d'une figure. Liste blanche et
// non liste noire : un paquet de mise en page (`geometry`, `hyperref`,
// `fancyhdr`…) n'y sert à rien, et un paquet absent de la distribution du
// poste fait échouer toute la compilation — l'hôte désactive l'installation
// automatique de MiKTeX. `babel` est exclu pour la même raison (le français
// est rarement installé par défaut) et parce que ses caractères actifs
// (`;`, `:`, `!`) cassent la syntaxe TikZ.
const TIKZ_PACKAGES = new Set([
  "inputenc", "fontenc", "lmodern", "amsmath", "amssymb", "amsfonts", "mathtools",
  "bm", "textcomp", "eurosym", "upgreek", "mathrsfs", "stmaryrd", "xcolor", "color",
  "graphicx", "array", "booktabs", "siunitx", "tikz", "pgf", "pgfplots", "tikz-cd",
  "circuitikz",
]);

// Déclarations du préambule utiles à une figure. Les définitions de macros
// sont paresseuses : reprendre une `\newcommand` inutilisée ne coûte rien.
const TIKZ_DECLARATIONS =
  /\\(usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|tikzset|pgfplotsset|tikzstyle|newcommand|renewcommand|providecommand|DeclareMathOperator|definecolor|colorlet)(?![A-Za-z@])(\*?)/g;

/** Lit un groupe équilibré (`{…}` ou `[…]`) ouvert en `i` ; renvoie l'indice qui le suit. */
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
 * Lignes de préambule d'une figure TikZ autonome, tirées du préambule du
 * document : paquets de la liste blanche, bibliothèques et styles TikZ,
 * macros utilisateur et couleurs. Un fragment sans préambule n'en donne aucune.
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
        i = j + 1; // `\tikzstyle{nom}=[…]`
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
      // Une commande que la classe `standalone` ne définit pas (`\contentsname`
      // en dépend selon la classe d'origine) ferait échouer `\renewcommand`.
      const target = (groups.find((g) => g[0] === "{") ?? "").slice(1, -1).trim();
      if (/^\\[A-Za-z@]+$/.test(target)) lines.push(`\\providecommand{${target}}{}${declaration}`);
    } else {
      lines.push(declaration);
    }
  }
  return lines;
}

function generate(source, { title, fragment }) {
  const defs = { macros: new Map(), theorems: new Map(), meta: {}, theoremStyle: "plain" };
  const nude = getParser().parse(defsScope(source));
  collectDefs(nude.content, defs);

  // Second parse : le parseur connaît maintenant la signature des macros
  // utilisateur, leurs arguments sont donc correctement rattachés.
  const signatures = {};
  for (const [name, def] of defs.macros) {
    const sig = (def.optional !== null ? "o" : "") + "m".repeat(def.nargs - (def.optional !== null ? 1 : 0));
    signatures[name] = { signature: sig };
  }
  // Idem pour les environnements de théorèmes : le parseur ne connaît que les
  // noms usuels (`theorem`, `remark`…). Sans signature, le titre d'un
  // `\begin{hypothese}[Titre]` resterait dans le corps, crochets compris.
  const envSignatures = {};
  for (const name of defs.theorems.keys()) envSignatures[name] = { signature: "o" };
  // `longtable` est inconnu du parseur : sans signature, sa spec de colonnes
  // (`{p{1.7cm} …}`) resterait dans la première cellule.
  envSignatures.longtable = { signature: "o m" };
  const parser = getParser({ macros: signatures, environments: envSignatures });
  const ast = parser.parse(source);
  const docEnv = ast.content.find((n) => n.type === "environment" && envName(n) === "document");
  const body = docEnv ? docEnv.content : ast.content;

  const expand = makeExpander(defs.macros);
  const out = []; // une entrée = une ligne de markdown
  const anchors = [[0, 0]];
  const warnings = new Set();
  const labels = new Map(); // label LaTeX → { text, anchor }
  const anchorLines = new Map(); // id d'ancre → index de sa ligne dans `out`
  const footnotes = [];
  const counters = new Map();
  let sectionNums = [0, 0, 0, 0];
  let inAppendix = false; // après `\appendix` : sections lettrées (A, B.2…)
  let partNum = 0;
  // `\part` s'insère au-dessus des sections : leurs titres descendent d'un
  // niveau pour que le sommaire reflète la hiérarchie.
  const levelShift = body.some((n) => n.type === "macro" && n.content === "part") ? 1 : 0;
  let lastAnchoredSrc = -1;

  const push = (line) => out.push(line);
  const blank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };
  /**
   * Retire une ligne déjà émise **en réaccordant les ancres** : celles qui la
   * suivent pointeraient sinon une ligne trop bas (la synchro preview ↔ source
   * dériverait dans tout ce qui suit une liste).
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

  // --- références ------------------------------------------------------- //
  const ref = (kind, key) => `${SEP}${kind}${SEP}${key}${SEP}`;
  const defineLabel = (key, text, anchor) => {
    if (key) labels.set(key, { text, anchor });
  };
  // Cible courante d'un `\label` : mise à jour par chaque objet numéroté.
  let pendingLabel = null;
  const openLabelTarget = (text, anchor) => {
    pendingLabel = { text, anchor };
  };
  const takeLabel = (key) => {
    if (pendingLabel) defineLabel(key, pendingLabel.text, pendingLabel.anchor);
    else defineLabel(key, "", "");
  };

  // Pose une ancre HTML invisible (bloc : pas de paragraphe parasite). La ligne
  // est mémorisée pour y greffer ensuite les alias de `\label` (cf. fin de
  // `generate`) — greffe sur la ligne existante, donc sans décaler `anchors`.
  const anchorDiv = (id) => {
    anchorLines.set(id, out.length);
    push(`<div id="${id}"></div>`);
    push("");
  };

  // --- expansion des macros utilisateur dans le flux inline -------------- //
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

  // --- maths ------------------------------------------------------------- //
  /**
   * Prépare le contenu d'une formule pour KaTeX : extraction des `\label`
   * (qui n'ont aucun sens pour un moteur de rendu) puis expansion des macros
   * du préambule, que KaTeX ne connaît pas.
   */
  const prepareMath = (raw) => {
    const found = [];
    let s = raw.replace(/\\label\{([^}]*)\}/g, (_, k) => {
      found.push(k);
      return "";
    });
    s = expand(s);
    // Ce que KaTeX ne sait pas lire, en mode math comme dans `\text{}` (liste
    // établie en sondant le KaTeX vendoré, cf. tests/test_latex_plugin.mjs) :
    // sans ce nettoyage la formule entière s'afficherait en rouge.
    s = s
      .replace(/\\(?:hspace|vspace)\*?\s*\{[^{}]*\}/g, "")
      .replace(/(?<!\\)\\([-/])/g, "") // césure et correction d'italique
      .replace(/(?<!\\)\\\*/g, "*")
      .replace(/\\(?:euro|texteuro)(?![A-Za-z])\s*(?:\{\})?/g, "\\text{€}")
      .replace(/\\textbullet(?![A-Za-z])\s*(?:\{\})?/g, "\\text{•}")
      .replace(/\\textperiodcentered(?![A-Za-z])\s*(?:\{\})?/g, "\\cdot ")
      .replace(/\\LaTeXe(?![A-Za-z])\s*(?:\{\})?/g, "\\text{LaTeX2ε}")
      .replace(/\\l(?![A-Za-z])/g, "\\text{ł}")
      .replace(/\\L(?![A-Za-z])/g, "\\text{Ł}")
      // Une référence dans une formule (typiquement via une macro utilisateur
      // du genre `\hyp{…}` = `H\ref{…}`) : le numéro est inséré en texte, sans
      // lien — un lien markdown n'a pas cours à l'intérieur d'un `$…$`.
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
   * Rend une liste de nœuds en texte markdown inline. Le texte brut est
   * accumulé pour appliquer ligatures puis échappement d'un seul tenant (les
   * ligatures traversent les frontières de nœuds : `-`, `-`, `-` sont trois
   * nœuds `string` distincts).
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
          // Une fin de ligne (`\` + retour, fréquent dans une formule longue)
          // deviendrait un saut de ligne markdown et couperait la formule.
          if (math) res += `$${math.replace(/\s*\n\s*/g, " ")}$`;
          break;
        }
        case "displaymath":
        case "mathenv": {
          // Formule display rencontrée en contexte inline (cellule, titre…) :
          // dégradée en inline plutôt que perdue.
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
            // TeX absorbe les espaces qui suivent un mot de commande sans
            // argument : `c\oe ur` s'écrit « cœur », pas « cœ ur ».
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
   * Rend une macro en contexte inline. Retourne le texte et, si la macro a
   * consommé des nœuds suivants (accents `\'e`), l'index atteint.
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
      // {n}{spec}{contenu} : le markdown n'a pas de fusion de cellules, seul
      // le contenu est repris (dans la première des colonnes couvertes).
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
      // La lettre accentuée est soit un argument, soit le nœud suivant.
      let letter = argRaw(n, 0);
      let next = i;
      if (!letter) {
        let j = i + 1;
        while (j < siblings.length && siblings[j].type === "whitespace") j++;
        const s = siblings[j];
        if (s?.type === "string" && s.content) {
          letter = s.content[0];
          if (s.content.length > 1) {
            // On ne consomme que la première lettre : le reste du nœud est
            // réinjecté via un nœud synthétique.
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
    if (name === "-" || name === "/") return { text: "" }; // césure, correction d'italique
    if (IGNORED_MACROS.has(name)) return { text: "" };

    // Macro inconnue : on conserve ses arguments, seule information portée.
    const inner = (n.args ?? []).map((a) => emitInline(a.content ?? [], depth)).join(" ").trim();
    if (!inner) warnings.add(`commande inconnue \\${name} ignorée`);
    return { text: inner };
  };

  // --- blocs -------------------------------------------------------------- //

  /** Émet un paragraphe à partir de nœuds inline accumulés. */
  const flushPara = (nodes, indent) => {
    if (!nodes.length) return;
    // Les espaces sont normalisés, mais **pas** les retours à la ligne : les
    // seuls présents sont les `  \n` produits par un `\\`, qui doit rester un
    // saut de ligne markdown.
    const text = emitInline(nodes)
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "  \n")
      .trim();
    if (!text) return;
    blank();
    anchorAt(nodes[0]);
    // Une ligne qui débute par un marqueur markdown serait mal interprétée. Un
    // nombre n'en est un que suivi de `.`/`)` **puis d'une espace** — et c'est
    // la ponctuation qu'on échappe : `\0.92` afficherait l'antislash.
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

  /** Nœuds porteurs de sens (hors espaces, commentaires et mise en page pure). */
  const meaningful = (nodes) =>
    nodes.filter(
      (x) =>
        x.type !== "whitespace" &&
        x.type !== "comment" &&
        x.type !== "parbreak" &&
        !(x.type === "macro" && IGNORED_MACROS.has(x.content)),
    );

  /**
   * Texte brut d'une boîte en police machine (`\fbox{\parbox{…}{\ttfamily …}}`,
   * idiome courant pour un exemple de JSON ou de code) : restitué en bloc de
   * code, fins de ligne `\\` et indentation `\hspace{…em}` comprises.
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

  /** Préfixe de citation sur les lignes émises depuis `start` (lignes vides comprises). */
  const quoteFrom = (start, indent) => {
    let end = out.length;
    while (end > start && out[end - 1] === "") end--;
    for (let i = start; i < end; i++) {
      out[i] = out[i] ? indent + "> " + out[i].slice(indent.length) : indent + ">";
    }
  };

  /**
   * Paragraphe réduit à un encadré (`\fbox{\parbox{…}{…}}`, souvent centré) :
   * rendu en citation — ou en bloc de code si le contenu est en `\ttfamily`.
   * Renvoie faux si le paragraphe n'est pas de cette forme.
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
        // `{\small \begin{longtable}…}` : le groupe ne sert qu'à borner des
        // déclarations de mise en page — inline, l'environnement serait aplati
        // en texte (spec de colonnes et `&` compris).
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
   * `\part` : compteur romain propre (`\ref` → « II »), qui ne touche **pas**
   * aux sections — en classe `article`, leur numérotation continue d'une partie
   * à l'autre.
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
    push("## " + (num ? `Partie ${num} — ` : "") + (text || "(sans titre)"));
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
      // Le compteur d'équations n'est pas remis à zéro (numérotation continue,
      // comportement par défaut de la classe `article`).
      // Compteurs de théorèmes déclarés `[section]` : remis à zéro.
      for (const t of defs.theorems.values()) {
        if (t.parent === "section") counters.set(t.counter, 0);
      }
    }
    blank();
    anchorAt(n);
    // Slug du numéro : `sec-2-1`, et `sec-b-1` en annexe — jamais le même
    // identifiant qu'une section du corps.
    const anchor = num ? slug("sec", num) : slug("sec", text || String(out.length));
    anchorDiv(anchor);
    openLabelTarget(num || text, anchor);
    // +1 : le niveau 1 markdown est réservé au titre du document (+1 encore
    // sous des `\part`).
    push("#".repeat(Math.min(6, depth + 1 + levelShift)) + " " + (num ? num + " " : "") + (text || "(sans titre)"));
    push("");
  };

  /**
   * En-tête d'environnement (théorème, démonstration) fondu dans le premier
   * paragraphe du corps, comme le compose amsthm : « **Proposition 8**
   * (Titre). Sous H1… ». Si le corps commence par autre chose qu'un
   * paragraphe (formule, liste, table), l'en-tête reste sur sa propre ligne.
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
    // amsthm : tête en gras (styles `plain`, `definition`) ou en italique
    // (`remark`), note entre parenthèses en romain, point final.
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
    const title = hasArg(n, 0) ? oneLine(emitInline(argNodes(n, 0))) : "Démonstration";
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
   * Émet des items de liste. Un marqueur explicite (`\item[(a)]`) remplace la
   * puce numérotée — le doublon « 1. (a) » n'existe pas en LaTeX ; il est en
   * gras dans `description`, en romain ailleurs.
   */
  const emitItems = (items, ordered, indent, boldMarkers) => {
    const numbered = ordered && items.every((it) => !it.marker);
    items.forEach((it, idx) => {
      const bullet = numbered ? `${idx + 1}. ` : "- ";
      const child = indent + " ".repeat(bullet.length);
      const start = out.length;
      emitBlocks(it.nodes, child);
      // Retire les lignes vides de tête produites par `blank()` en début d'item.
      while (out.length > start && out[start] === "") removeLine(start);
      const label = it.marker ? (boldMarkers ? `**${it.marker}** ` : `${it.marker} `) : "";
      if (out.length > start) {
        out[start] = indent + bullet + label + out[start].slice(child.length);
      } else {
        out.push(indent + bullet + label);
      }
      // Une ligne vide en fin d'item séparerait la liste en deux blocs.
      while (out.length > start && out[out.length - 1] === "") removeLine(out.length - 1);
    });
    push("");
  };

  const emitList = (n, ordered, indent, boldMarkers = false) => {
    const items = [];
    let cur = null;
    for (const c of n.content ?? []) {
      if (c.type === "macro" && c.content === "item") {
        // Le parseur rattache le corps de l'item à `\item` : le marqueur
        // facultatif est l'argument entre crochets, le corps le dernier
        // argument. Les nœuds qui suivent (paragraphes séparés par une ligne
        // vide) appartiennent au même item et sont concaténés.
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
        // Contenu avant le premier \item : rare, mais ne doit pas disparaître.
        cur = { node: c, marker: "", nodes: [c] };
        items.push(cur);
      }
    }
    if (!items.length) return;
    blank();
    anchorAt(n);
    emitItems(items, ordered, indent, boldMarkers);
  };

  /** Décale les positions d'un sous-arbre re-parsé isolément (lignes du source). */
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
   * `tikzpicture` : le plugin ne dessine pas. Il émet une fence ```tikz
   * contenant un **document LaTeX autonome** — la forme qu'attend Kroki —,
   * que l'hôte compile avec la distribution TeX du poste, ou confie au serveur
   * Kroki configuré. Le document reprend du préambule ce qu'une figure peut
   * utiliser (cf. `tikzPreamble`) et fixe par `\newlabel` le numéro des
   * `\ref`/`\eqref` qu'elle contient, résolus comme les autres marqueurs.
   *
   * Sans moteur TeX, l'hôte affiche une erreur à la place du dessin : le texte
   * de chaque `\node` (dans l'ordre du source) et le source TikZ restent donc
   * disponibles, repliés sous la figure.
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
      // Options `[…]`, nom `(…)` et position `at (…)` précèdent le texte `{…}`.
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
          // accolades d'une valeur d'option (`font={\small}`) : sautées
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
    push(indent + `<details><summary>${items.length ? "Texte des nœuds et source" : "Source"} TikZ</summary>`);
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
   * `tabular` → table markdown. Attention à la dissymétrie de l'AST : le `&`
   * **séparateur de cellule** est un nœud `string`, alors que le `\&` littéral
   * est une macro — confondre les deux découperait les cellules au mauvais
   * endroit. La fin de ligne `\\` est, elle, bien une macro.
   * La première ligne devient l'en-tête : le markdown n'a pas de table sans
   * en-tête, et une table dont la première ligne est du contenu reste lisible.
   */
  const emitTabular = (n, indent) => {
    const spec = argRaw(n, n.args?.length ? n.args.length - 1 : 0);
    const aligns = columnAligns(spec).map((c) => (c === "c" ? ":---:" : c === "r" ? "---:" : "---"));
    const rows = [];
    let row = [];
    let cell = [];
    // `longtable` : les lignes qui précèdent `\endfoot`/`\endlastfoot` sont des
    // pieds de page, et celles entre `\endfirsthead` et `\endhead` l'en-tête
    // répété des pages suivantes — une table markdown n'a qu'un en-tête.
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
        // Le parseur isole `&` dans son propre nœud, mais on découpe malgré
        // tout : une cellule collée (`a&b`) ne doit pas être perdue.
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
    // `table`/`figure` : le flottant lui-même n'existe pas en markdown, on rend
    // son contenu puis sa légende, numérotée comme LaTeX le ferait.
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
    // La fin de ligne qui suit `\begin{verbatim}` et celle qui précède
    // `\end{verbatim}` ne font pas partie du contenu.
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
          push("**Résumé**");
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
          if (!TRANSPARENT_ENVS.has(name)) warnings.add(`environnement « ${name} » rendu sans mise en forme`);
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
      if (name === "item") return; // `\item` hors liste : ignoré
      if (name === "appendix") {
        sectionNums = [0, 0, 0, 0];
        inAppendix = true;
        return;
      }
      // Macro bloc sans traitement dédié : rendue comme inline.
      return flushPara([n], indent);
    }
  };

  // --- titre du document -------------------------------------------------- //
  if (!fragment) {
    // `\title{Titre \\ \large Sous-titre}` : un segment ouvert par un changement
    // de taille est un sous-titre, rendu sous le h1 ; un `\\` nu ne fait que
    // couper une ligne trop longue et reste replié dans le titre.
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
      // une entrée de `out` = une ligne : les ancres comptent les entrées
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

  // --- notes de bas de page ----------------------------------------------- //
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

  // --- alias d'ancre : le label LaTeX lui-même ----------------------------- //
  // Les ancres posées jusqu'ici portent un **numéro** (`eq-3`, `sec-2-1`) qui
  // bouge à la moindre insertion en amont : inutilisable comme cible stable
  // depuis un autre document. Chaque ancre est donc doublée du ou des `\label{}`
  // qui la visent, **verbatim** — `\label{eq:sigmaU}` ↔ `doc.tex#eq:sigmaU`,
  // correspondance 1:1, aucune règle de transformation à retenir (un slug
  // forcerait la casse : `sigmaU` → `sigmau`).
  // La greffe se fait *sur* la ligne d'ancre existante : aucune ligne n'est
  // créée, `anchors` (synchro preview ↔ source) reste exact.
  const aliases = new Map(); // index de ligne → labels à y greffer
  for (const [key, target] of labels) {
    const line = target.anchor ? anchorLines.get(target.anchor) : undefined;
    // Cible sans ancre (label orphelin, équation vide) ou identifiant déjà pris
    // par une ancre numérotée : rien à greffer, un `id` dupliqué serait pire.
    if (line === undefined || anchorLines.has(key)) continue;
    aliases.set(line, [...(aliases.get(line) ?? []), key]);
  }
  for (const [line, keys] of aliases) {
    out[line] += keys.map((k) => `<div id="${attrValue(k)}"></div>`).join("");
  }

  // --- lignes vides consécutives ------------------------------------------ //
  // Fusionnées **avant** la jointure, par `removeLine` : une fusion sur le texte
  // final décalerait toutes les ancres situées en aval. Le contenu des blocs de
  // code (source TikZ, verbatim) est laissé intact.
  for (let i = out.length - 1, fence = null; i > 0; i--) {
    const f = /^\s*(`{3,})/.exec(out[i]);
    if (f && (!fence || f[1].length >= fence.length)) fence = fence ? null : f[1];
    else if (!fence && out[i] === "" && out[i - 1] === "") removeLine(i);
  }

  // --- résolution des références ------------------------------------------ //
  const unresolved = new Set();
  // `r` = \ref, `e` = \eqref, `t` = référence apparue dans une formule (rendue
  // en texte nu : un lien markdown ne survivrait pas à l'intérieur d'un `$…$`).
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
    warnings.add(
      `référence${unresolved.size > 1 ? "s" : ""} non résolue${unresolved.size > 1 ? "s" : ""} : ${list}` +
        (unresolved.size > 5 ? `… (${unresolved.size} au total)` : ""),
    );
  }

  return { markdown, anchors, warnings: [...warnings] };
}

// --------------------------------------------------------------------------- //
// API du plugin
// --------------------------------------------------------------------------- //

/** Fence assez longue pour contenir le source sans collision de délimiteurs. */
function fenceFor(source) {
  const longest = Math.max(2, ...[...String(source).matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Transforme un source LaTeX en document markdown prêt pour le pipeline de
 * rendu de l'hôte. Ne lève jamais : en cas d'imprévu, le source part
 * intégralement en fence sous un bandeau (retour visuel garanti pendant
 * l'édition live). La fence de repli est ```tex et non ```latex : cette
 * dernière est revendiquée par le plugin, elle serait re-rendue en boucle.
 *
 * Renvoie `{ markdown, anchors, warnings }` — cf. remapLine (`ui/js/anchors.js`).
 */
export function texToMarkdown(source, { title = "Document LaTeX", fragment = false } = {}) {
  const src = String(source ?? "").replace(/\r\n?/g, "\n");
  try {
    return generate(src, { title, fragment });
  } catch (err) {
    const fence = fenceFor(src);
    const markdown = [
      ...(fragment ? [] : [`# ${title}`, ""]),
      `> ⚠️ **Rendu LaTeX dégradé** — ${err && err.message ? err.message : String(err)}`,
      "",
      `${fence}tex`,
      src,
      fence,
      "",
    ].join("\n");
    return { markdown, anchors: [[0, 0]], warnings: ["rendu dégradé : le source est affiché tel quel"] };
  }
}
