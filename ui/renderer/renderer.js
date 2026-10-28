// @ts-check

// Webview cachée : exécute les moteurs de rendu JS/WASM et répond aux jobs
// envoyés par le backend (event "render-job" → invoke render_job_done).
//
// Chargement à la demande : aucun moteur n'est chargé au boot. Chaque type de
// diagramme charge ses vendors au premier usage (`loadScript`/`import()`),
// mémoïsés. La webview signale `renderer_ready` immédiatement → la 1re fenêtre
// n'attend pas le parse de ~6 Mo de JS, et un document n'amorce que les moteurs
// qu'il utilise réellement.

import { t, initI18n } from "./i18n.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Exposé au parseur erd (script classique, hors modules) : ses messages d'erreur
// suivent la langue de l'interface comme ceux d'ici.
window.rendererT = t;

// ---------- chargement à la demande des vendors ----------
// Injecte un <script> classique (non-module) et résout au chargement. Mémoïsé
// par URL : un vendor partagé (graphre, vega…) n'est chargé qu'une fois.
/** @type {Map<string, Promise<void>>} */
const SCRIPTS = new Map();
/**
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  let p = SCRIPTS.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(t("renderer.script_load_failed", { src })));
      document.head.appendChild(s);
    });
    SCRIPTS.set(src, p);
  }
  return p;
}
// Charge plusieurs scripts classiques en SÉQUENCE (ordre d'exécution imposé par
// leurs dépendances : graphre avant nomnoml, shims autour de bytefield…).
/** @param {...string} srcs */
async function loadInOrder(...srcs) {
  for (const src of srcs) await loadScript(src);
}

// ---------- mermaid ----------
/** @type {string | null} */
let mermaidTheme = null;
let mermaidSeq = 0;
/** @type {Engine} */
async function renderMermaid(source, options) {
  await loadScript("./vendor/mermaid.min.js");
  const theme = options.theme || "default";
  if (mermaidTheme !== theme) {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
    mermaidTheme = theme;
  }
  const { svg } = await window.mermaid.render(`m${++mermaidSeq}`, source);
  return svg;
}

// ---------- graphviz (WASM officiel, import dynamique) ----------
/** @type {Promise<import("../../types/renderer").Graphviz> | null} */
let gvPromise = null;
async function getGraphviz() {
  // Cast : tsc n'infère du bundle minifié qu'une surface sans garantie.
  gvPromise ??= /** @type {Promise<import("../../types/renderer").GraphvizModule>} */ (
    import("./vendor/graphviz.es.js")
  ).then(({ Graphviz }) => Graphviz.load());
  return gvPromise;
}
/** @type {Engine} */
async function renderGraphviz(source, options) {
  const gv = await getGraphviz();
  const engine = options.layout || options.engine || "dot";
  return gv.layout(source, "svg", engine);
}

// ---------- vega / vega-lite (mode interpréteur : compatible CSP sans eval) ----------
function loadVega() {
  return loadInOrder("./vendor/vega.min.js", "./vendor/vega-interpreter.min.js");
}
function exprInterpreter() {
  return (
    window.vega?.expressionInterpreter ||
    window.vegaInterpreter?.expressionInterpreter ||
    window.vegaInterpreter ||
    undefined
  );
}

/** @param {unknown} spec */
async function renderVega(spec) {
  await loadVega();
  const runtime = window.vega.parse(spec, null, { ast: true });
  const view = new window.vega.View(runtime, {
    renderer: "none",
    expr: exprInterpreter(),
  });
  try {
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}

/**
 * @param {string} source
 * @param {string} label
 * @returns {unknown}
 */
function parseJsonStrict(source, label) {
  try {
    return JSON.parse(source);
  } catch (e) {
    // JSON.parse ne lève que des SyntaxError.
    throw new Error(t("renderer.json_invalid", { label, detail: /** @type {SyntaxError} */ (e).message }));
  }
}

// ---------- wavedrom ----------
let waveSeq = 0;
/** @type {Engine} */
async function renderWavedrom(source) {
  await loadInOrder("./vendor/wavedrom-default.js", "./vendor/wavedrom.min.js");
  const obj = parseJsonStrict(source, "WaveDrom");
  const idx = ++waveSeq;
  const el = document.createElement("div");
  el.id = `WaveDrom_Display_${idx}`;
  document.body.appendChild(el);
  try {
    const wd = window.WaveDrom;
    // Le bundle n'expose que `RenderWaveForm` : `render` n'est jamais undefined.
    const render = /** @type {NonNullable<import("../../types/renderer").WaveDrom["RenderWaveForm"]>} */ (
      wd.renderWaveForm || wd.RenderWaveForm
    );
    render.call(wd, idx, obj, "WaveDrom_Display_");
    const svg = el.querySelector("svg") || el.firstElementChild;
    if (!svg) throw new Error(t("renderer.wavedrom_empty"));
    return svg.outerHTML;
  } finally {
    el.remove();
  }
}

// ---------- bytefield ----------
// shim-pre installe un pseudo-Node (window.module), bytefield-svg s'y exporte,
// shim-post récupère l'export : ordre strict garanti par loadInOrder.
/** @type {Engine} */
async function renderBytefield(source) {
  await loadInOrder("./shim-pre.js", "./vendor/bytefield-svg.js", "./shim-post.js");
  // Forme attendue de l'export CommonJS ; `typeof` ci-dessous en vérifie le seul point vérifiable.
  const fn = /** @type {((source: string) => string) | null | undefined} */ (window.__bytefield);
  if (typeof fn !== "function") {
    throw new Error(t("renderer.engine_init", { name: "bytefield-svg" }));
  }
  return fn(source);
}

// ---------- d2 (WASM officiel @terrastruct/d2, chargé à la demande) ----------
// Import dynamique : le bundle fait ~8 Mo, inutile de le parser tant qu'aucun
// diagramme d2 n'est demandé.
/** @type {Promise<import("../../types/renderer").D2> | null} */
let d2Promise = null;
async function getD2() {
  if (!d2Promise) {
    d2Promise = /** @type {Promise<import("../../types/renderer").D2Module>} */ (import("./vendor/d2.esm.js")).then(({ D2 }) => new D2());
  }
  return d2Promise;
}
// Le wrapper D2 ne suit qu'un seul échange (compile/render) à la fois sur son
// worker : deux appels concurrents écraseraient leurs callbacks. On les
// sérialise (le document rend tous les diagrammes via Promise.all).
/** @type {Promise<void>} */
let d2Queue = Promise.resolve();
/** @type {Engine} */
function renderD2(source, options) {
  const task = d2Queue.then(() => d2CompileRender(source, options));
  d2Queue = task.then(
    () => {},
    () => {},
  );
  return task;
}
/** @type {Engine} */
async function d2CompileRender(source, options) {
  const d2 = await getD2();
  /** @type {import("../../types/renderer").D2CompileOptions} */
  const compileOpts = {};
  if (options.layout) compileOpts.layout = options.layout; // "dagre" (défaut) | "elk"
  if (options.theme != null) compileOpts.themeID = Number(options.theme);
  // `=== true` jamais vrai : `render_diagram` ne transmet que des chaînes
  // (BTreeMap<String, String>) ; conservé tel quel, le cast ne fait que le taire.
  if (options.sketch != null)
    compileOpts.sketch = /** @type {unknown} */ (options.sketch) === true || options.sketch === "true";
  const result = await d2.compile(source, compileOpts);
  return d2.render(result.diagram, result.renderOptions);
}

// ---------- dbml : génère le DOT puis le rend via le moteur graphviz embarqué ----------
/** @type {Engine} */
async function renderDbml(source) {
  await loadScript("./vendor/dbml.js");
  if (typeof window.dbmlToDot !== "function") {
    throw new Error(t("renderer.engine_init", { name: "dbml-renderer" }));
  }
  const dot = window.dbmlToDot(source);
  return renderGraphviz(dot, { engine: "dot" });
}

// ---------- erd : parseur maison → DOT, rendu via le moteur graphviz embarqué ----------
/** @type {Engine} */
async function renderErd(source) {
  await loadScript("./erd.js");
  if (typeof window.erdToDot !== "function") {
    throw new Error(t("renderer.erd_init"));
  }
  return renderGraphviz(window.erdToDot(source), { engine: "dot" });
}

// ---------- nomnoml (nécessite graphre) ----------
/** @type {Engine} */
async function renderNomnoml(source) {
  await loadInOrder("./vendor/graphre.js", "./vendor/nomnoml.js");
  return window.nomnoml.renderSvg(source);
}

// ---------- bpmn (bpmn-js, rendu headless dans un conteneur hors écran) ----------
/** @type {Engine} */
async function renderBpmn(source) {
  await loadScript("./vendor/bpmn-viewer.min.js");
  const Bpmn = window.BpmnJS;
  if (typeof Bpmn !== "function") {
    throw new Error(t("renderer.engine_init", { name: "bpmn-js" }));
  }
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;left:-99999px;top:0;width:1600px;height:1200px";
  document.body.appendChild(container);
  const viewer = new Bpmn({ container });
  try {
    await viewer.importXML(source);
    viewer.get("canvas").zoom("fit-viewport");
    const { svg } = await viewer.saveSVG();
    return addBpmnWatermark(svg);
  } finally {
    viewer.destroy();
    container.remove();
  }
}

// Filigrane bpmn.io : la licence de bpmn-js exige qu'il reste « fully visible
// and not visually overlapped » quand la bibliothèque sert dans une
// application. Le viewer le pose dans son conteneur HTML, que `saveSVG()`
// n'exporte pas : on le remet dans le SVG, dans une bande ajoutée sous le
// diagramme (rien ne le chevauche), lien vers https://bpmn.io — ouvert dans le
// navigateur par `initLinks` (main.js). Tracés et couleur repris du logo
// `BPMNIO_IMG` de bpmn-js.
const BPMNIO_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14.02 5.57" width="53" height="21" color="#404040">' +
  '<path fill="currentColor" d="M1.88.92v.14c0 .41-.13.68-.4.8.33.14.46.44.46.86v.33c0 .61-.33.95-.95.95H0V0h.95c.65 0 .93.3.93.92zM.63.57v1.06h.24c.24 0 .38-.1.38-.43V.98c0-.28-.1-.4-.32-.4zm0 1.63v1.22h.36c.2 0 .32-.1.32-.39v-.35c0-.37-.12-.48-.4-.48H.63zM4.18.99v.52c0 .64-.31.98-.94.98h-.3V4h-.62V0h.92c.63 0 .94.35.94.99zM2.94.57v1.35h.3c.2 0 .3-.09.3-.37v-.6c0-.29-.1-.38-.3-.38h-.3zm2.89 2.27L6.25 0h.88v4h-.6V1.12L6.1 3.99h-.6l-.46-2.82v2.82h-.55V0h.87zM8.14 1.1V4h-.56V0h.79L9 2.4V0h.56v4h-.64zm2.49 2.29v.6h-.6v-.6zM12.12 1c0-.63.33-1 .95-1 .61 0 .95.37.95 1v2.04c0 .64-.34 1-.95 1-.62 0-.95-.37-.95-1zm.62 2.08c0 .28.13.39.33.39s.32-.1.32-.4V.98c0-.29-.12-.4-.32-.4s-.33.11-.33.4z"/>' +
  '<path fill="currentColor" d="M0 4.53h14.02v1.04H0zM11.08 0h.63v.62h-.63zm.63 4V1h-.63v2.98z"/></svg>';
const LOGO_W = 53;
const LOGO_H = 21;
const LOGO_PAD = 6;

/**
 * @param {string} svg sortie de `saveSVG()`
 * @returns {string}
 */
function addBpmnWatermark(svg) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const box = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (root.localName !== "svg" || box.length !== 4 || box.some(Number.isNaN)) {
    throw new Error("bpmn-js: unexpected SVG output, bpmn.io watermark not added");
  }
  const [x, y, w, h] = box;
  const band = LOGO_H + 2 * LOGO_PAD;
  const width = Math.max(w, LOGO_W + 2 * LOGO_PAD);
  root.setAttribute("viewBox", `${x} ${y} ${width} ${h + band}`);
  // saveSVG fixe width/height en unités utilisateur (= viewBox) : même agrandissement.
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(h + band));
  const logo = /** @type {Element} */ (
    doc.importNode(new DOMParser().parseFromString(BPMNIO_LOGO, "image/svg+xml").documentElement, true)
  );
  logo.setAttribute("x", String(x + width - LOGO_W - LOGO_PAD));
  logo.setAttribute("y", String(y + h + LOGO_PAD));
  const link = doc.createElementNS("http://www.w3.org/2000/svg", "a");
  link.setAttribute("href", "https://bpmn.io");
  link.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "https://bpmn.io");
  const title = doc.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = "Powered by bpmn.io";
  link.append(title, logo);
  root.append(link);
  return new XMLSerializer().serializeToString(doc);
}

// ---------- excalidraw (@excalidraw/excalidraw exportToSvg, bundle vendoré) ----------
// Import dynamique : bundle ~8 Mo, inutile tant qu'aucune scène excalidraw n'est
// demandée.
/** @type {Promise<import("../../types/renderer").ExcalidrawModule> | null} */
let excalidrawPromise = null;
async function getExcalidraw() {
  if (!excalidrawPromise) {
    // La CSP bloque les polices CDN ; on pointe l'asset path en local pour
    // éviter tout fetch réseau (les manquantes 404 vite, sans pendre).
    window.EXCALIDRAW_ASSET_PATH = window.location.origin + "/";
    excalidrawPromise = /** @type {Promise<import("../../types/renderer").ExcalidrawModule>} */ (
      import("./vendor/excalidraw.esm.js")
    );
  }
  return excalidrawPromise;
}
// Les polices manuscrites d'excalidraw (Excalifont/Virgil…) ne sont pas embarquées
// (14 Mo, sous-ensembles hashés) : sans serveur d'assets, exportToSvg émet des
// @font-face à `src:data:…base64,` VIDE et un `font-family` qui ne correspond à
// aucune police système → fallback navigateur incontrôlé. On retire ces @font-face
// cassés et on réécrit chaque famille vers une pile système (texte lisible, hors-ligne).
// Familles excalidraw → piles système (guillemets SIMPLES en interne : la valeur
// est réinjectée dans un attribut `font-family="…"` à guillemets doubles).
/** @type {Record<string, string>} */
const EXCALIDRAW_FONT_MAP = {
  Excalifont: "'Segoe Print', 'Comic Sans MS', cursive",
  Virgil: "'Segoe Print', 'Comic Sans MS', cursive",
  "Comic Shanns Mono": "Consolas, monospace",
  "Comic Shanns": "Consolas, monospace",
  "Cascadia Code": "Consolas, monospace",
  Cascadia: "Consolas, monospace",
  "Lilita One": "'Segoe UI', sans-serif",
  Lilita: "'Segoe UI', sans-serif",
  Nunito: "'Segoe UI', sans-serif",
  Assistant: "'Segoe UI', sans-serif",
  Xiaolai: "'Segoe UI', sans-serif",
  "Liberation Sans": "'Segoe UI', sans-serif",
  Helvetica: "'Segoe UI', sans-serif",
};
// Mappe une valeur font-family (ex. "Virgil, Segoe UI Emoji") vers une pile système
// d'après son premier token ; inchangée si la police n'est pas une police excalidraw.
/** @param {string} value */
function mapExcalidrawFamily(value) {
  const first = value.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  return EXCALIDRAW_FONT_MAP[first] || value;
}
/** @param {string} svg */
function fixExcalidrawFonts(svg) {
  return svg
    .replace(/<style class="style-fonts">[\s\S]*?<\/style>/g, "")
    .replace(/font-family="([^"]*)"/g, (_m, /** @type {string} */ v) => `font-family="${mapExcalidrawFamily(v)}"`)
    .replace(/font-family:\s*([^;"}]+)/g, (_m, /** @type {string} */ v) => `font-family: ${mapExcalidrawFamily(v)}`);
}

/** @type {Engine} */
async function renderExcalidraw(source) {
  // Forme supposée, vérifiée juste après sur `elements` (seul champ requis).
  const scene = /** @type {Partial<import("../../types/renderer").ExcalidrawScene> | null} */ (
    parseJsonStrict(source, "Excalidraw")
  );
  if (!scene || !Array.isArray(scene.elements)) {
    throw new Error(t("renderer.excalidraw_invalid_scene"));
  }
  const { exportToSvg, restore } = await getExcalidraw();
  const data = restore(
    { elements: scene.elements, appState: scene.appState || {}, files: scene.files || {} },
    null,
    null,
  );
  const svg = await exportToSvg({
    elements: data.elements,
    appState: data.appState,
    files: data.files,
    exportPadding: 10,
  });
  return fixExcalidrawFonts(svg.outerHTML);
}

/**
 * Moteur : source (+ options du job, toujours des chaînes, cf. `render_diagram`)
 * → SVG sérialisé.
 * @typedef {(source: string, options: Record<string, string>) => Promise<string>} Engine
 */
/** @type {Record<string, Engine>} */
const ENGINES = {
  mermaid: renderMermaid,
  graphviz: renderGraphviz,
  vega: (s) => renderVega(parseJsonStrict(s, "Vega")),
  vegalite: async (s) => {
    await loadVega(); // vega (+ interpréteur) avant vega-lite, qui en dépend au chargement
    await loadScript("./vendor/vega-lite.min.js");
    const compiled = window.vegaLite.compile(parseJsonStrict(s, "Vega-Lite")).spec;
    return renderVega(compiled);
  },
  nomnoml: renderNomnoml,
  wavedrom: renderWavedrom,
  bytefield: renderBytefield,
  d2: renderD2,
  dbml: renderDbml,
  erd: renderErd,
  excalidraw: renderExcalidraw,
  bpmn: renderBpmn,
};

// Catalogue avant le premier job : les erreurs levées par les moteurs sont
// traduites à la volée (`initI18n` n'échoue jamais — repli sur les clés).
await initI18n();

await listen("render-job", async (e) => {
  const { id, dtype, source, options } = e.payload;
  try {
    const engine = /** @type {Engine | undefined} */ (ENGINES[dtype]);
    if (!engine) throw new Error(t("renderer.unknown_engine", { type: dtype }));
    const svg = await engine(source, options || {});
    if (typeof svg !== "string" || !svg.includes("<svg")) {
      throw new Error(t("renderer.no_svg", { type: dtype }));
    }
    await invoke("render_job_done", { id, svg, error: null });
  } catch (/** @type {any} */ err) {
    // `any` : un moteur peut lever n'importe quoi ; `?.`/`??` gèrent le non-Error.
    await invoke("render_job_done", {
      id,
      svg: null,
      error: String(err?.message ?? err),
    });
  }
});

// Signale la disponibilité dès que les listeners sont posés : les moteurs se
// chargent ensuite à la demande, le backend n'attend plus le parse des vendors.
await invoke("renderer_ready");
