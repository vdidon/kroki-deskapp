// Test de la recherche dans le document affiché (ui/js/docsearch.js) et des
// options `Aa` / `ab` / `.*` communes aux deux recherches (ui/js/searchopts.js).
// Usage : node tests/test_document_search.mjs [port]
// Prérequis : app lancée avec WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
// Autonome : crée son document de test dans un dossier temporaire, l'ouvre via
// les commandes Tauri, referme son onglet à la fin.
//
// Angle mort assumé : que la barre de recherche NATIVE de la webview ne s'ouvre
// plus sur Ctrl+F ne se vérifie pas d'ici (elle vit hors du DOM de la page) —
// contrôle visuel.

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

// --- Fixture : casses mélangées, mots partiels, accents (pour « mot entier »)
const dir = mkdtempSync(join(tmpdir(), "kroki-find-test-"));
const docPath = join(dir, "recherche_doc.md");
writeFileSync(
  docPath,
  [
    "# Zoxitron",
    "",
    "Première ligne avec zoxitron dedans.",
    "",
    "Ensuite ZOXITRON en capitales, puis zoxitronique qui n'est pas le mot entier.",
    "",
    "## Accents",
    "",
    "Un été chaud, et un étex qui n'est pas été.",
    "",
    "Codes : ab12, cd34, ef56.",
    "",
  ].join("\n"),
);
// « zoxitron » insensible à la casse : titre + 3 dans le corps = 4.
// Sensible à la casse (« zoxitron ») : ligne 3 + zoxitronique = 2.
// Mot entier + insensible : 4 - 1 (zoxitronique) = 3.

const esc = (s) => JSON.stringify(s);
await evaluate(
  `window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'recherche_doc.md' })`,
);
await sleep(900);

const state = () => evaluate(`(() => ({
  hidden: document.getElementById('find-bar').hidden,
  focused: document.activeElement === document.getElementById('find-input'),
  count: document.getElementById('find-count').textContent,
  invalid: document.getElementById('find-input').classList.contains('invalid'),
  all: CSS.highlights.get('find-occurrences')?.size ?? 0,
  current: CSS.highlights.get('find-current')?.size ?? 0,
}))()`);

const setQuery = async (q) => {
  await evaluate(`(() => {
    const i = document.getElementById('find-input');
    i.value = ${esc(q)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
};
const toggle = async (bar, opt) => {
  await evaluate(`document.querySelector('#${bar}-opts button[data-opt="${opt}"]').click()`);
  await sleep(300);
};
const key = (k, mods = {}) =>
  evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...mods })}))`,
  );

try {
  // 1. Ctrl+F ouvre la barre
  await key("f", { ctrlKey: true });
  await sleep(200);
  let st = await state();
  check("Ctrl+F ouvre la barre", st.hidden === false);
  check("champ focus à l'ouverture", st.focused === true);

  // 2. Recherche insensible à la casse : 4 occurrences, la 1ʳᵉ courante
  await setQuery("zoxitron");
  st = await state();
  check("4 occurrences, compteur 1/4", st.count === "1/4", st.count);
  check("toutes les occurrences surlignées", st.all === 4, `all=${st.all}`);
  check("occurrence courante distincte", st.current === 1, `current=${st.current}`);

  // 3. Navigation : Entrée avance, Maj+Entrée recule, F3 avance, bouclage
  await evaluate(`document.getElementById('find-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(150);
  check("Entrée → occurrence suivante", (await state()).count === "2/4");
  await evaluate(`document.getElementById('find-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`);
  await sleep(150);
  check("Maj+Entrée → occurrence précédente", (await state()).count === "1/4");
  await key("F3", { shiftKey: true });
  await sleep(150);
  check("Maj+F3 boucle sur la dernière", (await state()).count === "4/4");
  await key("F3");
  await sleep(150);
  check("F3 reboucle sur la première", (await state()).count === "1/4");

  // 4. Option « respecter la casse »
  await toggle("find", "case");
  check("Aa : 2 occurrences", (await state()).count === "1/2", (await state()).count);
  await toggle("find", "case");

  // 5. Option « mot entier » (zoxitronique exclu)
  await toggle("find", "word");
  check("ab : 3 occurrences (zoxitronique exclu)", (await state()).count === "1/3",
    (await state()).count);
  // …et sur un mot accentué, là où `\b` d'ASCII échouerait
  await setQuery("été");
  check("ab : accents reconnus (2 « été » sur 3 formes)", (await state()).count === "1/2",
    (await state()).count);
  await toggle("find", "word");

  // 6. Expression régulière (valide puis invalide)
  await toggle("find", "regex");
  await setQuery("[a-f]{2}[0-9]{2}");
  check(".* : 3 codes trouvés", (await state()).count === "1/3", (await state()).count);
  await setQuery("a(");
  st = await state();
  // Indépendant de la langue de l'interface : « invalide » (fr) ou « Invalid » (en).
  check("motif invalide : message d'erreur", /invalid/i.test(st.count), st.count);
  check("motif invalide : champ en rouge", st.invalid === true);
  check("motif invalide : surlignage effacé", st.all === 0);
  await toggle("find", "regex");
  await setQuery("zoxitron");

  // 7. Exclusivité avec la recherche multi-documents (même ancre à l'écran)
  await key("F", { ctrlKey: true, shiftKey: true });
  await sleep(300);
  const excl = await evaluate(`(() => ({
    find: document.getElementById('find-bar').hidden,
    panel: document.getElementById('search-panel').hidden,
  }))()`);
  check("Ctrl+Maj+F ferme la barre Ctrl+F", excl.find === true && excl.panel === false,
    JSON.stringify(excl));

  // 8. Options du panneau multi-documents : casse + bouton de fermeture
  await evaluate(`(() => {
    const i = document.getElementById('search-input');
    i.value = 'zoxitron';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(900);
  const insensible = await evaluate(
    `document.querySelector('.search-group .search-count')?.textContent`,
  );
  check("panneau : 4 occurrences sans option", insensible === "4", String(insensible));
  await toggle("search", "case");
  await sleep(700);
  const sensible = await evaluate(
    `document.querySelector('.search-group .search-count')?.textContent`,
  );
  check("panneau : Aa → 2 occurrences", sensible === "2", String(sensible));
  await toggle("search", "case");
  await sleep(700);

  await evaluate(`document.getElementById('search-close').click()`);
  await sleep(200);
  check("panneau : bouton de fermeture", await evaluate(
    `document.getElementById('search-panel').hidden`,
  ));

  // 9. Échap ferme la barre et efface les surlignages
  await key("f", { ctrlKey: true });
  await sleep(200);
  await setQuery("zoxitron");
  await key("Escape");
  await sleep(200);
  st = await state();
  check("Échap ferme la barre", st.hidden === true);
  check("surlignages effacés à la fermeture", st.all === 0 && st.current === 0,
    `all=${st.all} current=${st.current}`);
} finally {
  await evaluate(`(async () => {
    const st = await window.__TAURI__.core.invoke('get_window_state');
    for (const t of st.tabs) {
      if (t.title === 'recherche_doc.md') {
        await window.__TAURI__.core.invoke('close_tab', { docId: t.id });
      }
    }
  })()`).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTOUS LES TESTS PASSENT" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
