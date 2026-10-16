// Ancres des documents dérivés (plugins → markdown) : remapping des
// lignes du markdown généré vers les lignes du source réel. Format commun à
// tous les transformateurs : `[[ligneMarkdown, ligneSource], …]`, trié par
// ligne markdown croissante (protocole de plugins §6.2).

/**
 * Remappe une ligne du markdown généré vers la ligne du source : plus grande
 * ancre ≤ `line` (les deux 0-based). Granularité par section — suffisant pour
 * la synchro preview ↔ source et le sommaire.
 */
export function remapLine(anchors, line) {
  let best = 0;
  for (const [mdLine, srcLine] of anchors) {
    if (mdLine <= line) best = srcLine;
    else break;
  }
  return best;
}

/**
 * Valide des ancres venues d'un plugin (données non fiables) : paires de
 * nombres finis ≥ 0, triées ; à défaut `[[0, 0]]` (tout le rendu pointe sur la
 * première ligne du source).
 */
export function sanitizeAnchors(anchors) {
  if (!Array.isArray(anchors)) return [[0, 0]];
  const out = [];
  for (const a of anchors) {
    if (!Array.isArray(a) || a.length < 2) continue;
    const md = Number(a[0]);
    const src = Number(a[1]);
    if (!Number.isFinite(md) || !Number.isFinite(src) || md < 0 || src < 0) continue;
    out.push([md, src]);
  }
  if (!out.length) return [[0, 0]];
  out.sort((x, y) => x[0] - y[0]);
  return out;
}
