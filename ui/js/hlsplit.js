// @ts-check
// Découpe d'un flot HTML coloré en une entrée par ligne.
//
// Module **pur** (aucune dépendance DOM ni app) : c'est la seule partie risquée
// de la coloration de la vue source, elle est testée hors navigateur par
// `tests/test_hlsplit.mjs`.

/**
 * Découpe `html` à chaque `\n` en rééquilibrant les `<span>` à cheval : ceux
 * encore ouverts sont refermés en fin de ligne et rouverts à l'identique au
 * début de la suivante. Entrée attendue : uniquement des `<span …>`, `</span>`
 * et du texte échappé (`&lt;`) — la forme que produisent hljs et, après
 * sanitization DOMPurify, les plugins `highlight:code`.
 *
 * Le nombre d'entrées retournées vaut toujours `html.split("\n").length` côté
 * texte : l'appelant s'en sert comme garde-fou avant de peindre.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function splitHighlightedLines(html) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const open = []; // pile des balises ouvrantes, telles quelles (classes comprises)
  let cur = "";
  const re = /<span\b[^>]*>|<\/span>|[^<]+|</g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tok = m[0];
    if (tok[0] === "<") {
      if (tok === "<") continue; // `<` isolé : ni balise ni texte, on l'ignore
      if (tok[1] === "/") {
        if (open.length === 0) continue; // fermeture orpheline : ne pas déséquilibrer
        open.pop();
      } else {
        open.push(tok);
      }
      cur += tok;
      continue;
    }
    const parts = tok.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        cur += "</span>".repeat(open.length);
        lines.push(cur);
        cur = open.join("");
      }
      cur += parts[i];
    }
  }
  lines.push(cur + "</span>".repeat(open.length)); // flot tronqué : on referme
  return lines;
}
