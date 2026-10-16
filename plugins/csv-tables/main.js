// csv-tables example plugin — §12.1 of doc/plugin-protocol.md: the
// `document:markdown` capability only. A .csv file (separator `;`) becomes a
// derived markdown document (title + table), with one anchor per data row for
// the outline/source-view remap.
//
// The global `kd` is provided by the host runtime (kd_runtime.js).

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("document/transform", ({ text, title }) => {
  const src = String(text ?? "");
  // Robustness contract §6.2: unusable content → degraded markdown
  // (banner + source in a fence), never an `error`.
  if (!src.trim()) {
    return {
      markdown: `> ⚠️ Empty CSV file.\n\n\`\`\`\n${src}\n\`\`\``,
      anchors: [[0, 0]],
    };
  }
  const rows = src.trim().split(/\r?\n/).map((l) => l.split(",").map(cell));
  const md = [
    `# ${title}`,
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    // one anchor per data row: markdown line → line of the source .csv
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  const anchors = [[0, 0], ...rows.slice(1).map((_, i) => [4 + i, 1 + i])];
  return { markdown: md.join("\n"), anchors };
});

// A `|` in a cell would break the table structure.
const cell = (s) => s.replace(/\|/g, "\\|");
