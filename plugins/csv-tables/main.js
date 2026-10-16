// Plugin d'exemple csv-tables — §12.1 de doc/plugin-protocol.md : capacité
// `document:markdown` seule. Un fichier .csv (séparateur `;`) devient un
// document markdown dérivé (titre + table), avec une ancre par ligne de
// données pour le remap sommaire/vue source.
//
// Le global `kd` est fourni par le runtime de l'hôte (kd_runtime.js).

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("document/transform", ({ text, title }) => {
  const src = String(text ?? "");
  // Contrat de robustesse §6.2 : contenu inexploitable → markdown dégradé
  // (bandeau + source en fence), jamais d'`error`.
  if (!src.trim()) {
    return {
      markdown: `> ⚠️ Fichier CSV vide.\n\n\`\`\`\n${src}\n\`\`\``,
      anchors: [[0, 0]],
    };
  }
  const rows = src.trim().split(/\r?\n/).map((l) => l.split(",").map(cell));
  const md = [
    `# ${title}`,
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    // ancre par ligne de données : ligne markdown → ligne du .csv source
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  const anchors = [[0, 0], ...rows.slice(1).map((_, i) => [4 + i, 1 + i])];
  return { markdown: md.join("\n"), anchors };
});

// Un `|` dans une cellule casserait la structure de la table.
const cell = (s) => s.replace(/\|/g, "\\|");
