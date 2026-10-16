// Plugin d'exemple ini-highlight — §12.3 de doc/plugin-protocol.md : capacité
// `highlight:code` seule, sans dépendance hljs (grammaire ligne à ligne
// maison). Deux règles du protocole illustrées ici : le plugin échappe
// lui-même le code (sa sortie est du HTML, re-sanitizé par l'hôte : spans
// hljs-* uniquement) et n'émet que des classes `hljs-*` existantes — les
// couleurs viennent du thème hljs de l'hôte, un plugin n'apporte pas de CSS.
//
// Le global `kd` est fourni par le runtime de l'hôte (kd_runtime.js).

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
