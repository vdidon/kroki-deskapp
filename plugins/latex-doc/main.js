// Plugin latex-doc — entry du worker (protocole Kroki Desk v1, cf.
// doc/plugin-protocol.md du dépôt de l'application).
//
// Capacités :
// - `document:markdown` : un fichier .tex autonome devient un document markdown
//   dérivé via texToMarkdown — les formules restent en `$…$` / `$$…$$` et sont
//   rendues par le KaTeX de l'hôte ;
// - `fence:markdown`    : une fence ```latex dans un .md reçoit le même rendu,
//   sans titre de tête (le contenu est réinjecté dans le pipeline complet de
//   l'hôte, KaTeX compris) ;
// - `highlight:code`    : coloration du **fichier entier**, demandée par la vue
//   « code source » de l'application. Deux noms pour la même grammaire,
//   `tex-source` et `latex-source` : l'hôte cherche `<ext>-source`, et le
//   plugin sert les deux extensions `.tex` et `.latex`.
//
// Le global `kd` est fourni par le runtime de l'hôte (kd_runtime.js), injecté
// avant ce module dans le worker sandboxé.

import { texToMarkdown } from "./tex.js";
import { highlightLatex } from "./texhl.js";

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("document/transform", ({ text, title }) =>
  texToMarkdown(String(text ?? ""), { title: String(title ?? "Document LaTeX") }),
);

// En fence, le source est un fragment : ni préambule ni `\begin{document}`
// obligatoires, et pas de titre `#` (il couperait le document hôte en deux).
kd.onRequest("fence/render", ({ source }) => {
  const { markdown } = texToMarkdown(String(source ?? ""), { fragment: true });
  return { format: "markdown", content: markdown };
});

kd.onRequest("highlight/render", ({ code }) => ({ html: highlightLatex(String(code ?? "")) }));
