// erd : parseur maison de la DSL « erd » (BurntSushi/erd, écrite en Haskell, sans
// portage JS) → Graphviz DOT. Le DOT est ensuite rendu par le graphviz WASM déjà
// chargé (cf. renderDbml dans renderer.js). Expose window.erdToDot.
//
// Sous-ensemble couvert :
//   - commentaire pleine ligne `# ...`
//   - `title { label: "..." }`
//   - en-tête d'entité `[Name]` (+ bloc d'options `{ bgcolor: "...", ... }`)
//   - attributs : marqueurs en tête `*` (PK), `+` (FK), `*+`/`+*` (PK+FK), puis le
//     nom ; bloc `{ ... }` optionnel ignoré
//   - relations `A <c1>--<c2> B`, cardinalités ∈ { ? 1 * + } ; `{ label: "..." }` optionnel
// Non couvert (documenté) : `#` en milieu de ligne, blocs multi-lignes, pass-through
// d'attributs Graphviz arbitraires, patte d'oie (cardinalités rendues en libellé texte).

(function () {
  // `rendererT` est posé par renderer.js (module, ui/renderer/i18n.js) avant tout
  // chargement de ce script.
  const t = (key, params) => window.rendererT(key, params);

  // Cardinalité erd → libellé porté par l'arête.
  const CARD = { "?": "0,1", "1": "1", "*": "0,N", "+": "1,N" };
  const HEADER_BG = "#ececff";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Identifiant de nœud : nom d'entité DOT-quoté (Graphviz accepte toute chaîne
  // entre guillemets), guillemets internes échappés. Pas de sanitisation requise.
  function dotId(name) {
    return `"${String(name).replace(/"/g, '\\"')}"`;
  }

  // Extrait un éventuel bloc d'options `{ ... }` en fin de chaîne.
  // Retourne { head, opts } où opts est un objet clé→valeur (valeurs déquotées).
  function splitOptions(text) {
    const m = /\{([^}]*)\}\s*$/.exec(text);
    if (!m) return { head: text.trim(), opts: {} };
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

  function attrCell(attr) {
    let inner = escapeHtml(attr.name);
    if (attr.pk) inner = `<u>${inner}</u>`;
    if (attr.fk) inner = `<i>${inner}</i>`;
    if (attr.pk || attr.fk) inner = `<b>${inner}</b>`;
    return `      <tr><td align="left">${inner}</td></tr>`;
  }

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

  function parse(src) {
    const entities = [];
    const byName = new Map();
    const rels = [];
    let title = null;
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

      // relation : contient `--` encadré de deux cardinalités
      if (line.includes("--")) {
        const { head, opts } = splitOptions(line);
        const rm = /^(.+?)\s*([?1*+])--([?1*+])\s*(.+?)$/.exec(head);
        if (rm) {
          rels.push({
            from: rm[1].trim().replace(/^["'`]|["'`]$/g, ""),
            c1: rm[2],
            c2: rm[3],
            to: rm[4].trim().replace(/^["'`]|["'`]$/g, ""),
            opts,
          });
          continue;
        }
      }

      // en-tête d'entité [Name] { ... }
      const hm = /^\[([^\]]+)\]\s*(\{.*\})?\s*$/.exec(line);
      if (hm) {
        const name = hm[1].trim();
        const opts = hm[2] ? splitOptions(hm[2]).opts : {};
        current = { name, opts, attrs: [] };
        entities.push(current);
        byName.set(name, current);
        continue;
      }

      // attribut de l'entité courante
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
