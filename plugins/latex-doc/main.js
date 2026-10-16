// latex-doc plugin — worker entry (Kroki Desk protocol v1, see
// doc/plugin-protocol.md in the application repository).
//
// Capabilities:
// - `document:markdown`: a standalone .tex file becomes a derived markdown
//   document via texToMarkdown — formulas stay as `$…$` / `$$…$$` and are
//   rendered by the host's KaTeX;
// - `fence:markdown`   : a ```latex fence in a .md gets the same rendering,
//   without a heading title (the content is fed back into the host's full
//   pipeline, KaTeX included);
// - `highlight:code`   : highlighting of the **whole file**, requested by the
//   application's "source code" view. Two names for the same grammar,
//   `tex-source` and `latex-source`: the host looks for `<ext>-source`, and the
//   plugin serves both extensions `.tex` and `.latex`.
//
// The global `kd` is provided by the host runtime (kd_runtime.js), injected
// before this module in the sandboxed worker.

import { texToMarkdown } from "./tex.js";
import { highlightLatex } from "./texhl.js";

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("document/transform", ({ text, title }) =>
  texToMarkdown(String(text ?? ""), { title: String(title ?? "LaTeX document") }),
);

// In a fence, the source is a fragment: neither preamble nor `\begin{document}`
// required, and no `#` title (it would split the host document in two).
kd.onRequest("fence/render", ({ source }) => {
  const { markdown } = texToMarkdown(String(source ?? ""), { fragment: true });
  return { format: "markdown", content: markdown };
});

kd.onRequest("highlight/render", ({ code }) => ({ html: highlightLatex(String(code ?? "")) }));
