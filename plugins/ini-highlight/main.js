// ini-highlight example plugin — §12.3 of doc/plugin-protocol.md: the
// `highlight:code` capability only, with no hljs dependency (home-made
// line-by-line grammar). Two protocol rules are illustrated here: the plugin
// escapes the code itself (its output is HTML, re-sanitized by the host:
// hljs-* spans only) and only emits existing `hljs-*` classes — the colors
// come from the host's hljs theme, a plugin ships no CSS.
//
// The global `kd` is provided by the host runtime (kd_runtime.js).

kd.onRequest("initialize", () => ({ ok: true }));

kd.onRequest("highlight/render", ({ code }) => {
  const html = String(code ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const e = esc(line);
      if (/^\s*[;#]/.test(line)) return `<span class="hljs-comment">${e}</span>`;
      if (/^\s*\[.*\]\s*$/.test(line)) return `<span class="hljs-section">${e}</span>`;
      const m = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.*)$/);
      if (!m) return e;
      return `${m[1]}<span class="hljs-attr">${esc(m[2])}</span>${esc(m[3])}` +
             `<span class="hljs-string">${esc(m[4])}</span>`;
    })
    .join("\n");
  return { html };
});

const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
