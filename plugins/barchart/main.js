// Plugin d'exemple barchart — §12.2 de doc/plugin-protocol.md : capacités
// `fence:svg` + `read:siblings`. Une fence ```barchart (lignes `label;valeur`,
// option `max=`) est rendue en barres horizontales SVG ; données inline ou
// externes via `src=fichier.csv` (lu par `host/readFile`, confiné au dossier
// du document + allowlist `siblingExtensions` — l'image de fallback jumelle
// de l'hôte, §6.3, joue alors automatiquement).
//
// Le global `kd` est fourni par le runtime de l'hôte (kd_runtime.js).

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("fence/render", async ({ source, options, theme }) => {
  // bloc vide + src= : données lues via l'hôte (confinement read:siblings)
  let text = String(source ?? "").trim();
  if (!text && options?.src) text = (await kd.request("host/readFile", { rel: options.src })).text;
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(";"))
    .filter(([, v]) => Number.isFinite(Number(v)));
  // Une fence peut lever : l'hôte affiche son bloc d'erreur standard (§6.3).
  if (!rows.length) throw new Error("aucune ligne « label;valeur » exploitable");
  const max = Number(options?.max) || Math.max(...rows.map(([, v]) => Number(v)));
  // Thème effectif fourni par l'hôte — jamais de prefers-color-scheme ici,
  // sinon le forçage auto/light/dark du réglage serait ignoré.
  const fg = theme === "dark" ? "#e6e6e6" : "#1f1f1f";
  const bars = rows.map(
    ([label, v], i) =>
      `<text x="0" y="${i * 24 + 15}" fill="${fg}" font-size="12">${esc(label)}</text>` +
      `<rect x="90" y="${i * 24 + 4}" width="${(300 * Number(v)) / max}" height="14" fill="#4c8dd6"/>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${rows.length * 24}">${bars.join("")}</svg>`;
  return { format: "svg", content: svg };
});

const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
