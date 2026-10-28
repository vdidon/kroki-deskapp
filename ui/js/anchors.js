// @ts-check
// Anchors of derived documents (plugins → markdown): remapping of the
// generated markdown's lines to the real source's lines. Format common to all
// transformers: `[[markdownLine, sourceLine], …]`, sorted by ascending
// markdown line (plugin protocol §6.2).

/** @typedef {import("../../types/ipc").Anchor} Anchor */

/**
 * Remaps a line of the generated markdown to the source line: largest anchor
 * ≤ `line` (both 0-based). Per-section granularity — enough for the
 * preview ↔ source sync and the table of contents.
 *
 * @param {Anchor[]} anchors
 * @param {number} line
 * @returns {number}
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
 * Validates anchors coming from a plugin (untrusted data): pairs of finite
 * numbers ≥ 0, sorted; failing that `[[0, 0]]` (the whole rendering points to
 * the source's first line).
 *
 * @param {unknown} anchors
 * @returns {Anchor[]}
 */
export function sanitizeAnchors(anchors) {
  if (!Array.isArray(anchors)) return [[0, 0]];
  /** @type {Anchor[]} */
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
