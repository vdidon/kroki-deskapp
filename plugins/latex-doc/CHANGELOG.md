# Changelog

All notable changes to this plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versioning follows [semver](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-10-16

### Added

- **Labels in the document's language.** The words the plugin writes itself
  — "Proof", "Part", "Abstract", "(untitled)", and the "TikZ source" /
  "Node text and TikZ source" folds under a figure — follow the main language
  selected by `babel` or `polyglossia`, as LaTeX does: French
  ("Démonstration", "Partie", "Résumé", "(sans titre)") for a French document,
  English otherwise. They used to be French for every document.

### Changed

- Warnings, the degraded-rendering banner, the default title and the plugin's
  name and description are now in English.

## [1.4.1] - 2026-10-09

### Fixed

- **Table wrapped in a group.** An environment placed inside a layout group
  (`{\small \begin{longtable}…}`) was flattened into text: the column spec
  and `&` were displayed as-is. The group is now unrolled.
- **`longtable`.** Its column spec (and its `[c]` option) no longer leaks into
  the first cell; `\endhead`/`\endfirsthead` no longer produce a warning, the
  repeated header of the following pages and the page footers
  (`\endfoot`, `\endlastfoot`) are removed.

## [1.4.0] - 2026-09-16

### Added

- **Drawn TikZ figures.** A `tikzpicture` becomes a ` ```tikz ` fence
  containing a standalone LaTeX document, which Kroki Desk ≥ 3.18.0 compiles
  with the workstation's TeX distribution (or which the configured Kroki
  server renders). The document carries over from the preamble what a figure
  can use — math and graphics packages, `\usetikzlibrary`, `\tikzset`,
  `\newcommand` macros, colors, the class font size — and fixes the number of
  the `\ref`/`\eqref` it contains (including through a macro such as
  `\hyp{…}`). `babel` and layout packages are dropped: they are of no use to
  the figure and may be missing from the workstation's distribution.
- The text of the nodes and the TikZ source remain available, folded under the
  figure: they take over on a workstation without a TeX distribution, where
  the application displays an error in place of the drawing. The
  "TikZ figure not drawn" warning disappears, since the plugin cannot know
  whether the host will draw it.

## [1.3.0] - 2026-09-16

Discrepancies found by comparing the rendering of a 40-page document with its PDF.

### Added

- **`\part`**: roman numbering ("Part II", picked up by `\ref`), without
  resetting the sections; these go down one heading level.
- **Framed boxes** `\fbox{\parbox{…}{…}}` rendered as a quote, or as a code
  block if the content is in `\ttfamily`.
- **`tikzpicture`**: visible warning, text of the `\node`s restored and TikZ
  source folded, instead of the drawing commands dumped as text.
- **Subtitles**: `\title{Title \\ \large Subtitle}` renders the subtitle
  under the h1 instead of folding everything into the title.

### Fixed

- **Section numbering broken by `\part`**: each part consumed a section number
  ("5 The model" instead of "Part II"), shifting all the sections and
  references that followed.
- **Appendices numbered 1, 2… instead of A, B…** — and their `sec-1` anchors
  overwrote those of the body sections: a link to "§3" opened appendix C.
- **Title of custom theorem environments** (`\begin{hypothese}[…]`)
  displayed in brackets in the body.
- **Theorem headers**: amsthm format "**Proposition 8** (Title)."
  merged into the first paragraph, italic head for `\theoremstyle{remark}`.
- **Macro expansion**: `\sum\Kdiff` produced `\sumK_{…}` (unknown command,
  formula in red); `\foo x` with body `\alpha` produced `\alphax`.
- **Space after a command word** not swallowed: `c\oe ur` was displayed
  "cœ ur".
- **Paragraph starting with a number** (`0.92 …`) prefixed with a visible
  backslash.
- **Visible backslashes in inline code**: `\texttt{B2B\_Market}`.
- **Column specification** read character by character: the `c` of
  `p{5cm}` was taken for a centered column.
- **`\multicolumn{3}{l}{…}`** rendered "3 l …"; **`\rule{…}{…}`** rendered as
  dimensions.
- **Double marker** "1. (a)" on the `\item[(a)]`s of an `enumerate`.
- **Inline formula cut** when it contains `\` + line end.
- **Shifted anchors**: the final merge of blank lines shifted the
  preview ↔ source synchronization of everything that followed (and emptied the
  blank lines of `verbatim` blocks).

## [1.2.1] - 2026-08-21

### Changed

- **Twice as fast transformation on large documents.** The first of the two
  parses only serves to collect the preamble definitions
  (`\newcommand`, `\newtheorem`, `\DeclareMathOperator`, `\title`…): it now
  covers only the few kilobytes that precede `\begin{document}`
  instead of the whole document. The LaTeX parser dominates the cost of
  rendering, and this pass paid it twice. Automatic fallback to the full
  source as soon as a declaration appears in the body (`\newtheorem` after
  `\begin{document}` is legal): the markdown produced is unchanged, byte for
  byte. Measured on a 100 KB document (2,340 lines, 933 formulas):
  `document/transform` goes from ~770 ms to ~390 ms, and the full rendering in
  the application from ~1,870 ms to ~1,400 ms.

## [1.2.0] - 2026-08-04

### Added

- **Anchors named after the `\label{}`s**: each numbered object (equation,
  section, theorem, float) now carries, in addition to its numbered anchor
  (`#eq-3`), an anchor reproducing **verbatim** the label(s) that target it
  (`#eq:sigmaU`). Another document can therefore point to a **stable** target
  of a `.tex` — `[σ_U](../doc/modele.tex#eq:sigmaU)` — where the numbered
  anchor used to shift with the slightest insertion upstream. The anchor is
  grafted onto the existing line: the preview ↔ source synchronization is
  unchanged.

## [1.1.0] - 2026-07-31

### Added

- `tex-source` / `latex-source` highlighting (`highlight:code` capability): the
  application's "source code" view now colors `.tex` files — comments, formulas
  (`$…$`, `$$…$$`, `\[…\]`), structure commands, environment names,
  ordinary commands, table separators. Home-made single-pass highlighter
  (`texhl.js`), without bundled highlight.js.

## [1.0.0] - 2026-07-22

### Added

- Rendering of standalone `.tex` / `.latex` documents (`document:markdown`
  capability) and of ` ```latex ` fences (`fence:markdown` capability).
- Structure: numbered sections, `abstract`, `\title`/`\author`/`\date`.
- Math delegated to the application's KaTeX; non-starred environments numbered
  with `\tag{n}`.
- `amsthm` theorems: shared counters (`[theorem]`) and parents
  (`[section]`), unnumbered starred environments, `proof` with ∎.
- `\label`/`\ref`/`\eqref` cross-references resolved into anchor links,
  including forward ones; reference inside a formula rendered as bare text.
- Expansion of preamble macros: `\newcommand` (arguments and optional
  argument) and `\DeclareMathOperator`.
- Lists, tables (`tabular`, `array`, `longtable`), floats with a numbered
  caption, `verbatim`, `quote`, footnotes.
- Text: LaTeX accents, typographic ligatures, `textcomp` symbols, links,
  images.

[1.0.0]: https://github.com/vdidon/kroki-deskapp/releases/tag/latex-doc-1.0.0
