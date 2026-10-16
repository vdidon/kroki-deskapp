// Test de la recherche dans tous les documents ouverts (ui/js/globalsearch.js).
// Usage : node tests/test_recherche_globale.mjs [port]
// Prérequis : app lancée avec WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
// Autonome : crée ses documents de test dans un dossier temporaire, les ouvre via
// les commandes Tauri (aucune simulation souris/clavier globale), referme leurs
// onglets à la fin. Les onglets déjà ouverts de l'app ne sont pas touchés (le
// panneau cherchera aussi dedans : les assertions ciblent les seuls documents test).

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] ?? "9222";

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.includes("renderer"));
if (!page) {
  console.error("page principale introuvable:", targets.map((t) => t.title).join(" | "));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "OK " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

// --- Fixtures : un doc court (alpha) et un doc long (beta, cible en fin de fichier)
const dir = mkdtempSync(join(tmpdir(), "kroki-search-test-"));
const alphaPath = join(dir, "recherche_alpha.md");
const betaPath = join(dir, "recherche_beta.md");
writeFileSync(
  alphaPath,
  "# Alpha\n\nPremière ligne avec zoxitron dedans.\n\nSans le mot.\n\n" +
    "## Suite\n\nEncore zoxitron ici, et même deux : zoxitron.\n",
);
const filler = Array.from(
  { length: 80 },
  (_, i) => `Ligne de remplissage numéro ${i + 1}.`,
).join("\n\n");
const betaContent = `# Beta\n\n${filler}\n\n## Zone cible\n\nLa ligne cible contient ZoXiTron en casse mélangée.\n`;
writeFileSync(betaPath, betaContent);
// Lignes 1-based attendues : alpha 3 et 9 ; beta dérivée du contenu (robuste).
const betaTargetLine = betaContent.split("\n").findIndex((l) => l.includes("ZoXiTron")) + 1;

const esc = (s) => JSON.stringify(s);
await evaluate(
  `window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'recherche_alpha.md' })`,
);
await evaluate(
  `window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'recherche_beta.md' })`,
);
await sleep(800);

try {
  // 1. Ouverture du panneau par le bouton loupe
  await evaluate(`document.getElementById('btn-search').click()`);
  const opened = await evaluate(`(() => ({
    hidden: document.getElementById('search-panel').hidden,
    focused: document.activeElement === document.getElementById('search-input'),
  }))()`);
  check("panneau ouvert au clic sur la loupe", opened.hidden === false);
  check("champ de recherche focus", opened.focused === true);

  // 2. Recherche insensible à la casse dans tous les onglets
  await evaluate(`(() => {
    const i = document.getElementById('search-input');
    i.value = 'zoxitron';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(800);
  const res = await evaluate(`(() =>
    [...document.querySelectorAll('.search-group')].map(g => ({
      doc: g.querySelector('.search-doc').firstChild.textContent,
      count: g.querySelector('.search-count')?.textContent,
      hits: [...g.querySelectorAll('.search-hit')].map(h => ({
        line: h.querySelector('.search-lineno').textContent,
        marks: h.querySelectorAll('mark').length,
      })),
    })))()`);
  const alpha = res.find((g) => g.doc === "recherche_alpha.md");
  const beta = res.find((g) => g.doc === "recherche_beta.md");
  check("alpha : 3 occurrences sur 2 lignes", alpha?.count === "3" && alpha?.hits.length === 2,
    JSON.stringify(alpha));
  check("alpha : lignes 1-based (3 et 9)",
    alpha?.hits[0]?.line === "3" && alpha?.hits[1]?.line === "9",
    JSON.stringify(alpha?.hits.map((h) => h.line)));
  check("alpha : 2 marques sur la ligne double", alpha?.hits[1]?.marks === 2);
  check("beta : 1 occurrence (casse mélangée)", beta?.count === "1" && beta?.hits.length === 1,
    JSON.stringify(beta));
  check(`beta : ligne cible ${betaTargetLine}`, beta?.hits[0]?.line === String(betaTargetLine),
    beta?.hits[0]?.line);

  // 3. Saut vers l'onglet beta (inactif) : activation + scroll + surlignage
  await evaluate(`(() => {
    const g = [...document.querySelectorAll('.search-group')]
      .find(g => g.querySelector('.search-doc').firstChild.textContent === 'recherche_beta.md');
    g.querySelector('.search-hit').click();
  })()`);
  await sleep(900);
  const afterJump = await evaluate(`(() => {
    const active = document.querySelector('.tab.active .tab-title').textContent;
    const view = [...document.querySelectorAll('.doc-view')].find(v => v.style.display !== 'none');
    const hl = CSS.highlights.get('search-occurrences');
    return { active, scrolled: view.scrollTop > 0, highlights: hl ? hl.size : 0,
             panelOpen: !document.getElementById('search-panel').hidden };
  })()`);
  check("onglet beta activé par le clic", afterJump.active === "recherche_beta.md", afterJump.active);
  check("vue scrollée vers la cible", afterJump.scrolled === true);
  check("occurrence surlignée dans la vue", afterJump.highlights === 1, `ranges=${afterJump.highlights}`);
  check("panneau toujours ouvert après le saut", afterJump.panelOpen === true);

  // 4. Échap : fermeture + surlignage effacé
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await sleep(200);
  const closed = await evaluate(`(() => ({
    hidden: document.getElementById('search-panel').hidden,
    hl: !!CSS.highlights.get('search-occurrences'),
  }))()`);
  check("Échap ferme le panneau", closed.hidden === true);
  check("surlignage effacé à la fermeture", closed.hl === false);

  // 5. Ctrl+Maj+F rouvre et relance la recherche mémorisée
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }))`,
  );
  await sleep(800);
  const reopened = await evaluate(`(() => ({
    hidden: document.getElementById('search-panel').hidden,
    groups: [...document.querySelectorAll('.search-doc')].map(d => d.firstChild.textContent),
  }))()`);
  check("Ctrl+Maj+F rouvre le panneau", reopened.hidden === false);
  check("recherche relancée à la réouverture",
    reopened.groups.includes("recherche_alpha.md") && reopened.groups.includes("recherche_beta.md"),
    JSON.stringify(reopened.groups));
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
} finally {
  // Referme les onglets de test puis supprime les fixtures.
  await evaluate(`(async () => {
    const st = await window.__TAURI__.core.invoke('get_window_state');
    for (const t of st.tabs) {
      if (t.title === 'recherche_alpha.md' || t.title === 'recherche_beta.md') {
        await window.__TAURI__.core.invoke('close_tab', { docId: t.id });
      }
    }
  })()`).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTOUS LES TESTS PASSENT" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
