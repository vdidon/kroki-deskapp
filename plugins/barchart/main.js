// barchart example plugin — §12.2 of doc/plugin-protocol.md: capabilities
// `fence:svg` + `read:siblings`. A ```barchart fence (`label;value` lines,
// option `max=`) is rendered as horizontal SVG bars; data inline or external
// via `src=file.csv` (read by `host/readFile`, confined to the document's
// folder + `siblingExtensions` allowlist — the host's twin fallback image,
// §6.3, then plays automatically).
//
// The global `kd` is provided by the host runtime (kd_runtime.js).

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("fence/render", async ({ source, options, theme }) => {
  // empty block + src=: data read through the host (read:siblings confinement)
  let text = String(source ?? "").trim();
  if (!text && options?.src) text = (await kd.request("host/readFile", { rel: options.src })).text;
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(";"))
    .filter(([, v]) => Number.isFinite(Number(v)));
  // A fence may throw: the host displays its standard error block (§6.3).
  if (!rows.length) throw new Error("no usable \"label;value\" row");
  const max = Number(options?.max) || Math.max(...rows.map(([, v]) => Number(v)));
  // Effective theme provided by the host — never prefers-color-scheme here,
  // otherwise the auto/light/dark override in the settings would be ignored.
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
