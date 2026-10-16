# latex-doc plugin

Renders **standalone LaTeX documents** (`.tex`, `.latex`) for Kroki Desk, using
the plugin protocol v1 format (`doc/plugin-protocol.md` at the root of the
application repository). This folder is meant to become a standalone repository.

The plugin does not render any formula itself: it produces a **derived markdown**
in which the mathematics are delimited by `$…$` / `$$…$$` and handed to the KaTeX
already bundled with the application. The rest of the pipeline (table of
contents, source view, global search, theme, HTML export) comes for free.

## Contents

| File | Role |
| --- | --- |
| `manifest.json` | declaration: `.tex`/`.latex` extensions, ` ```latex ` fence, capabilities |
| `main.js` | worker entry — wires up `document/transform` and `fence/render` |
| `tex.js` | the whole LaTeX → markdown transformation |
| `vendor/unified-latex.esm.js` | LaTeX parser (esbuild bundle, ~245 KB) |
| `build_vendor.py` | regenerates the vendor bundle from npm |

## What is rendered

- **Structure**: numbered `\section`/`\subsection`/`\subsubsection` (starred
  ones are not numbered), `abstract`, `\title`/`\author`/`\date` — a title
  segment opened by a size change (`\\ \large …`) becomes a subtitle. `\part`
  is numbered in Roman numerals ("Part II", which `\ref` picks up) without
  interrupting the section numbering, which then drops one
  level in the table of contents; after `\appendix`, sections are lettered
  (A, B.2…).
- **Boxes**: a paragraph reduced to `\fbox{\parbox{…}{…}}` becomes a quote, or
  a code block if its content is in `\ttfamily` (JSON example, pseudo-code) —
  `\\` breaks and `\hspace{…em}` indentation are preserved.
- **Mathematics**: `$…$`, `\[…\]`, `equation`, `align`, `gather`, `multline`,
  `cases`, `pmatrix`… Non-starred environments are **numbered** and get a
  `\tag{n}` rendered by KaTeX.
- **`amsthm` theorems**: every `\newtheorem` in the preamble is honored,
  including the **shared counter** (`\newtheorem{proposition}[theorem]{…}`) and
  the parent counter (`[section]` → `2.1` numbering), as well as the optional
  title of custom environments (`\begin{hypothese}[Title]`). As in amsthm, the
  header opens the first paragraph — "**Proposition 8** (Title). Under H1…" —,
  in bold or italic depending on the `\theoremstyle`. `proof` becomes
  "*Proof.*" and ends with a ∎.
- **Document language**: the few words the plugin writes itself — "Proof",
  "Part", "Abstract", "(untitled)", the "TikZ source" fold — follow the
  document's main language, as LaTeX does: French ("Démonstration", "Partie",
  "Résumé", "(sans titre)", "Source TikZ") when
  the preamble selects it through `babel` (`main=`, or the last language
  option, class options included) or `polyglossia`
  (`\setdefaultlanguage{french}`); English otherwise, including for languages
  the plugin has no labels for. Theorem names come from your `\newtheorem`
  declarations and are never translated. The warnings and the
  degraded-rendering banner, which talk about the rendering rather than the
  text, follow the **interface** language of Kroki Desk instead (≥ 3.25.0;
  English with older versions).
- **Cross-references**: `\label`, `\ref`, `\eqref`, `\autoref`, `\pageref` are
  resolved into **clickable links** to an anchor in the document — forward
  references included. A reference appearing *inside* a formula (typically via a
  user macro) is rendered as plain text: a markdown link does not survive inside
  `$…$`.
- **Named anchors**: every numbered object carries its numbered anchor (`#eq-3`,
  `#sec-2-1`) **and** an anchor repeating verbatim the `\label{}`(s) that point
  to it (`#eq:sigmaU`) — see "Linking to a `.tex` from another document".
- **Preamble macros**: `\newcommand` (with arguments and optional argument) and
  `\DeclareMathOperator` are **expanded** before the formula reaches KaTeX, which
  does not know them.
- **Lists** (`itemize`, `enumerate`, `description`, nested), **tables**
  (`tabular`, `array`, `longtable` — spec alignment preserved), `table`/`figure`
  floats with numbered caption, `verbatim`/`lstlisting`, `quote`.
- **Text**: bold/italic/monospace, LaTeX accents (`\'e` → é), ligatures
  (`---` → —, ` `` ` → “), `textcomp` symbols (`\euro` → €), footnotes
  gathered at the end of the document, `\url`/`\href`, `\includegraphics`.

A ` ```latex ` fence in an ordinary `.md` gets the **same rendering**, without a
leading title (`fence:markdown` capability). The ` ```tex ` language is
deliberately **not** claimed: it remains available to display syntax-highlighted
LaTeX code instead of rendering it.

## Linking to a `.tex` from another document

Any document open in the application (native markdown or produced by another
plugin) can point to a specific object of a `.tex` **by its label**, using a
path relative to the current document:

```markdown
Diffusion of the level [σ_U](../doc/modele.tex#eq:sigmaU),
defined in [appendix C](../doc/modele.tex#sec:annexeC).
```

The application opens the `.tex` in a tab, renders it, then scrolls to the
anchor. The label is taken **verbatim** — `\label{eq:sigmaU}` gives
`#eq:sigmaU`, case included: 1:1 mapping, no transformation rule to remember. In
the other direction, a `\href{../notes/plan.md#objectifs}{…}` in the `.tex`
likewise opens the target document.

Two precautions:

- **Target a label, never a numbered anchor.** `#eq-12` works but means "the
  twelfth equation": inserting an equation upstream silently makes it point
  elsewhere. Same for `#sec-c-5-table-de-synth-se`, the fallback slug of a
  starred section, which follows the title text.
- **A label without a numbered object has no anchor.** The `\label{}` must
  follow an object the plugin numbers — equation, section (starred included),
  theorem, float. Placed in running text, it cannot be anchored: the link will
  open the document but will not scroll (and a `\ref` to it is already flagged
  with a warning).

Outside the application, these links lead nowhere: neither GitHub nor an
ordinary markdown viewer renders a `.tex` as HTML.

## Known limitations

The rendering is **semantic**, not typographic. No markdown equivalent for:
`geometry` and all page layout, pagination, columns, float placement,
`\hspace`/`\vspace`, fine font styles.

- **Single file.** Imports (`\input`, `\include`) are not followed: the plugin
  does not declare the `read:siblings` capability. A document split across
  several files will render only its master file.
- **No bibliography.** `\cite{key}` displays the key in brackets;
  `thebibliography` is rendered as ordinary text.
- **TikZ drawn by the host, and only if the machine has a TeX distribution.**
  The plugin draws nothing: it emits a ` ```tikz ` fence containing a standalone
  document, which Kroki Desk ≥ 3.18.0 compiles with MiKTeX or TeX Live (`latex`
  and `dvisvgm` on the PATH), or which the configured Kroki server renders.
  From the preamble, this document keeps only a **whitelist** of packages
  (mathematics, `xcolor`, `tikz`, `pgfplots`…), plus `\usetikzlibrary`,
  `\tikzset`, macros and colors: a figure that depends on another package fails
  with a message naming it. `babel` is excluded (hyphenation is therefore
  English). Without TeX, the application displays an error in place of the
  drawing; the text of the `\node`s (in source order) and the TikZ source remain
  available, folded below. In a ` ```latex ` fence, with no preamble, only the
  libraries loaded by the figure itself are available. PSTricks is not
  supported.
- **Theorem bodies in roman**: amsthm's `plain` style sets the statement in
  italic; the rendering does not reproduce this (a markdown italic survives
  neither formulas nor paragraphs).
- **`\euro` in math mode** compiles but KaTeX has no metrics for "€": the glyph
  is borrowed from the system font (console warning, no notable visible
  consequence).
- Macros defined **outside the preamble** or by `\def` with delimited
  parameters are not expanded.
- A label **without a prefix** that bears the name of a DOM property
  (`\label{title}`, `\label{location}`…) has its anchor removed by the
  application's sanitizer (anti-*DOM clobbering* protection). The usual LaTeX
  convention — `eq:`, `sec:`, `tab:` — protects against it.

Content the plugin cannot handle never makes the rendering fail: the unknown
command is replaced by its arguments and reported in a warning banner; an
internal error displays the full source in a fence.

## Development

```bash
# 1. tests (standalone: no npm, no running application)
node tests/test_latex_plugin.mjs                    # regression suite
node tests/test_latex_plugin.mjs mon_doc.tex …      # + real documents

# 2. try it in the application: copy the folder then restart the app
#    (no rebuild needed — the plugin is not embedded in the binary)
cp -r plugins/latex-doc "$APPDATA/kroki-deskapp/plugins/"

# 3. distribution
python pack_plugin.py plugins/latex-doc             # → dist/latex-doc-<version>.kdext
```

The test compiles **all** the formulas produced with the repository's vendored
KaTeX: that is the check that matters, since a rejected formula is displayed in
red in the application.

To regenerate the vendored parser (updating `unified-latex`):

```bash
python plugins/latex-doc/build_vendor.py            # npm + esbuild, in a temporary folder
```
