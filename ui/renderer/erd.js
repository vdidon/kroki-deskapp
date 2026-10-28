// @ts-check

// erd: in-house parser for the "erd" DSL (BurntSushi/erd, written in Haskell, no
// JS port) → Graphviz DOT. The DOT is then rendered by the already-loaded
// graphviz WASM (cf. renderDbml in renderer.js). Exposes window.erdToDot.
//
// Supported subset:
//   - full-line comment `# ...`
//   - `title { label: "..." }`
//   - entity header `[Name]` (+ options block `{ bgcolor: "...", ... }`)
//   - attributes: leading markers `*` (PK), `+` (FK), `*+`/`+*` (PK+FK), then the
//     name; optional `{ ... }` block ignored
//   - relations `A <c1>--<c2> B`, cardinalities in { ? 1 * + }; optional `{ label: "..." }`
// Not supported (documented): mid-line `#`, multi-line blocks, pass-through of
// arbitrary Graphviz attributes, crow's foot (cardinalities rendered as a text label).

// Internal AST (classic script: these typedefs are global, hence the Erd prefix).
/**
 * Options block `{ key: value }`: lowercase keys, unquoted values.
 * @typedef {Record<string, string>} ErdOpts
 */
/**
 * @typedef {object} ErdAttr
 * @property {string} name
 * @property {boolean} pk primary key (`*` marker)
 * @property {boolean} fk foreign key (`+` marker)
 */
/**
 * @typedef {object} ErdEntity
 * @property {string} name
 * @property {ErdOpts} opts read: `bgcolor`
 * @property {ErdAttr[]} attrs
 */
/**
 * Raw erd cardinality (`?`, `1`, `*`, `+`).
 * @typedef {"?" | "1" | "*" | "+"} ErdCard
 */
/**
 * @typedef {object} ErdRel
 * @property {string} from
 * @property {ErdCard} c1 `from` side
 * @property {ErdCard} c2 `to` side
 * @property {string} to
 * @property {ErdOpts} opts read: `label`
 */

(function () {
  // `rendererT` is set by renderer.js (module, ui/renderer/i18n.js) before this
  // script is loaded.
  /** @type {import("../../types/renderer").RendererT} */
  const t = (key, params) => window.rendererT(key, params);

  // erd cardinality → label carried by the edge.
  /** @type {Record<ErdCard, string>} */
  const CARD = { "?": "0,1", "1": "1", "*": "0,N", "+": "1,N" };
  const HEADER_BG = "#ececff";

  /** @param {unknown} s */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Node identifier: DOT-quoted entity name (Graphviz accepts any quoted
  // string), inner quotes escaped. No sanitization required.
  /** @param {string} name */
  function dotId(name) {
    return `"${String(name).replace(/"/g, '\\"')}"`;
  }

  // Extracts an optional `{ ... }` options block at the end of the string.
  // Returns { head, opts } where opts is a key→value object (unquoted values).
  /**
   * @param {string} text
   * @returns {{ head: string, opts: ErdOpts }}
   */
  function splitOptions(text) {
    const m = /\{([^}]*)\}\s*$/.exec(text);
    if (!m) return { head: text.trim(), opts: {} };
    /** @type {ErdOpts} */
    const opts = {};
    const body = m[1];
    const re = /([A-Za-z_][\w-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)/g;
    let mm;
    while ((mm = re.exec(body)) !== null) {
      let v = mm[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      opts[mm[1].toLowerCase()] = v;
    }
    return { head: text.slice(0, m.index).trim(), opts };
  }

  /** @param {ErdAttr} attr */
  function attrCell(attr) {
    let inner = escapeHtml(attr.name);
    if (attr.pk) inner = `<u>${inner}</u>`;
    if (attr.fk) inner = `<i>${inner}</i>`;
    if (attr.pk || attr.fk) inner = `<b>${inner}</b>`;
    return `      <tr><td align="left">${inner}</td></tr>`;
  }

  /** @param {ErdEntity} ent */
  function entityNode(ent) {
    const bg = ent.opts.bgcolor || HEADER_BG;
    const rows = [
      `      <tr><td bgcolor="${escapeHtml(bg)}"><b>${escapeHtml(ent.name)}</b></td></tr>`,
      ...ent.attrs.map(attrCell),
    ];
    return (
      `  ${dotId(ent.name)} [label=<\n` +
      `    <table border="0" cellborder="1" cellspacing="0" cellpadding="4">\n` +
      `${rows.join("\n")}\n` +
      `    </table>>];`
    );
  }

  /** @param {ErdRel} rel */
  function edgeLine(rel) {
    const tail = CARD[rel.c1] ?? rel.c1;
    const head = CARD[rel.c2] ?? rel.c2;
    const parts = [
      "dir=both",
      "arrowhead=none",
      "arrowtail=none",
      `taillabel="${escapeHtml(tail)}"`,
      `headlabel="${escapeHtml(head)}"`,
      'fontsize="10"',
    ];
    if (rel.opts.label) parts.push(`label="${escapeHtml(rel.opts.label)}"`);
    return `  ${dotId(rel.from)} -> ${dotId(rel.to)} [${parts.join(", ")}];`;
  }

  /**
   * @param {string} src
   * @returns {{ entities: ErdEntity[], rels: ErdRel[], title: string | null }}
   */
  function parse(src) {
    /** @type {ErdEntity[]} */
    const entities = [];
    /** @type {Map<string, ErdEntity>} */
    const byName = new Map();
    /** @type {ErdRel[]} */
    const rels = [];
    /** @type {string | null} */
    let title = null;
    /** @type {ErdEntity | null} */
    let current = null;

    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      // title { label: "..." }
      const tm = /^title\s*(\{.*\})\s*$/i.exec(line);
      if (tm) {
        title = splitOptions(tm[1]).opts.label || null;
        continue;
      }

      // relation: contains `--` flanked by two cardinalities
      if (line.includes("--")) {
        const { head, opts } = splitOptions(line);
        const rm = /^(.+?)\s*([?1*+])--([?1*+])\s*(.+?)$/.exec(head);
        if (rm) {
          rels.push({
            from: rm[1].trim().replace(/^["'`]|["'`]$/g, ""),
            // The regex only captures `[?1*+]`.
            c1: /** @type {ErdCard} */ (rm[2]),
            c2: /** @type {ErdCard} */ (rm[3]),
            to: rm[4].trim().replace(/^["'`]|["'`]$/g, ""),
            opts,
          });
          continue;
        }
      }

      // entity header [Name] { ... }
      const hm = /^\[([^\]]+)\]\s*(\{.*\})?\s*$/.exec(line);
      if (hm) {
        const name = hm[1].trim();
        const opts = hm[2] ? splitOptions(hm[2]).opts : {};
        current = { name, opts, attrs: [] };
        entities.push(current);
        byName.set(name, current);
        continue;
      }

      // attribute of the current entity
      const { head } = splitOptions(line);
      const am = /^([*+]{0,2})\s*(.+?)$/.exec(head);
      if (!am) continue;
      if (!current) {
        throw new Error(t("erd.attr_outside_entity", { attr: head }));
      }
      const marks = am[1] || "";
      current.attrs.push({
        name: am[2].trim(),
        pk: marks.includes("*"),
        fk: marks.includes("+"),
      });
    }

    if (!entities.length) {
      throw new Error(t("erd.no_entity"));
    }
    return { entities, rels, title };
  }

  /**
   * @param {string} src
   * @returns {string} DOT
   */
  function erdToDot(src) {
    const { entities, rels, title } = parse(src);
    const out = ["digraph erd {"];
    out.push('  graph [rankdir="LR"];');
    if (title) out.push(`  graph [label=<<b>${escapeHtml(title)}</b>>, labelloc="t"];`);
    out.push('  node  [shape=none, fontname="Helvetica"];');
    out.push('  edge  [fontname="Helvetica"];');
    for (const ent of entities) out.push(entityNode(ent));
    for (const rel of rels) out.push(edgeLine(rel));
    out.push("}");
    return out.join("\n");
  }

  window.erdToDot = erdToDot;
})();
