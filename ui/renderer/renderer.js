// Webview cachée : exécute les moteurs de rendu JS/WASM et répond aux jobs
// envoyés par le backend (event "render-job" → invoke render_job_done).
//
// Chargement à la demande : aucun moteur n'est chargé au boot. Chaque type de
// diagramme charge ses vendors au premier usage (`loadScript`/`import()`),
// mémoïsés. La webview signale `renderer_ready` immédiatement → la 1re fenêtre
// n'attend pas le parse de ~6 Mo de JS, et un document n'amorce que les moteurs
// qu'il utilise réellement.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ---------- chargement à la demande des vendors ----------
// Injecte un <script> classique (non-module) et résout au chargement. Mémoïsé
// par URL : un vendor partagé (graphre, vega…) n'est chargé qu'une fois.
const SCRIPTS = new Map();
function loadScript(src) {
  let p = SCRIPTS.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`chargement échoué : ${src}`));
      document.head.appendChild(s);
    });
    SCRIPTS.set(src, p);
  }
  return p;
}
// Charge plusieurs scripts classiques en SÉQUENCE (ordre d'exécution imposé par
// leurs dépendances : graphre avant nomnoml, shims autour de bytefield…).
async function loadInOrder(...srcs) {
  for (const src of srcs) await loadScript(src);
}

// ---------- mermaid ----------
let mermaidTheme = null;
let mermaidSeq = 0;
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
let gvPromise = null;
async function getGraphviz() {
  gvPromise ??= import("./vendor/graphviz.es.js").then(({ Graphviz }) => Graphviz.load());
  return gvPromise;
}
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

function parseJsonStrict(source, label) {
  try {
    return JSON.parse(source);
  } catch (e) {
    throw new Error(`${label} : la source doit être du JSON valide — ${e.message}`);
  }
}

// ---------- wavedrom ----------
let waveSeq = 0;
async function renderWavedrom(source) {
  await loadInOrder("./vendor/wavedrom-default.js", "./vendor/wavedrom.min.js");
  const obj = parseJsonStrict(source, "WaveDrom");
  const idx = ++waveSeq;
  const el = document.createElement("div");
  el.id = `WaveDrom_Display_${idx}`;
  document.body.appendChild(el);
  try {
    const wd = window.WaveDrom;
    const render = wd.renderWaveForm || wd.RenderWaveForm;
    render.call(wd, idx, obj, "WaveDrom_Display_");
    const svg = el.querySelector("svg") || el.firstElementChild;
    if (!svg) throw new Error("WaveDrom n'a rien produit");
    return svg.outerHTML;
  } finally {
    el.remove();
  }
}

// ---------- bytefield ----------
// shim-pre installe un pseudo-Node (window.module), bytefield-svg s'y exporte,
// shim-post récupère l'export : ordre strict garanti par loadInOrder.
async function renderBytefield(source) {
  await loadInOrder("./shim-pre.js", "./vendor/bytefield-svg.js", "./shim-post.js");
  const fn = window.__bytefield;
  if (typeof fn !== "function") {
    throw new Error("bytefield-svg n'a pas pu être initialisé");
  }
  return fn(source);
}

// ---------- d2 (WASM officiel @terrastruct/d2, chargé à la demande) ----------
// Import dynamique : le bundle fait ~8 Mo, inutile de le parser tant qu'aucun
// diagramme d2 n'est demandé.
let d2Promise = null;
async function getD2() {
  if (!d2Promise) {
    d2Promise = import("./vendor/d2.esm.js").then(({ D2 }) => new D2());
  }
  return d2Promise;
}
// Le wrapper D2 ne suit qu'un seul échange (compile/render) à la fois sur son
// worker : deux appels concurrents écraseraient leurs callbacks. On les
// sérialise (le document rend tous les diagrammes via Promise.all).
let d2Queue = Promise.resolve();
function renderD2(source, options) {
  const task = d2Queue.then(() => d2CompileRender(source, options));
  d2Queue = task.then(
    () => {},
    () => {},
  );
  return task;
}
async function d2CompileRender(source, options) {
  const d2 = await getD2();
  const compileOpts = {};
  if (options.layout) compileOpts.layout = options.layout; // "dagre" (défaut) | "elk"
  if (options.theme != null) compileOpts.themeID = Number(options.theme);
  if (options.sketch != null) compileOpts.sketch = options.sketch === true || options.sketch === "true";
  const result = await d2.compile(source, compileOpts);
  return d2.render(result.diagram, result.renderOptions);
}

// ---------- dbml : génère le DOT puis le rend via le moteur graphviz embarqué ----------
async function renderDbml(source) {
  await loadScript("./vendor/dbml.js");
  if (typeof window.dbmlToDot !== "function") {
    throw new Error("dbml-renderer n'a pas pu être initialisé");
  }
  const dot = window.dbmlToDot(source);
  return renderGraphviz(dot, { engine: "dot" });
}

// ---------- erd : parseur maison → DOT, rendu via le moteur graphviz embarqué ----------
async function renderErd(source) {
  await loadScript("./erd.js");
  if (typeof window.erdToDot !== "function") {
    throw new Error("le parseur erd n'a pas pu être initialisé");
  }
  return renderGraphviz(window.erdToDot(source), { engine: "dot" });
}

// ---------- nomnoml (nécessite graphre) ----------
async function renderNomnoml(source) {
  await loadInOrder("./vendor/graphre.js", "./vendor/nomnoml.js");
  return window.nomnoml.renderSvg(source);
}

// ---------- bpmn (bpmn-js, rendu headless dans un conteneur hors écran) ----------
async function renderBpmn(source) {
  await loadScript("./vendor/bpmn-viewer.min.js");
  const Bpmn = window.BpmnJS;
  if (typeof Bpmn !== "function") {
    throw new Error("bpmn-js n'a pas pu être initialisé");
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
    return svg;
  } finally {
    viewer.destroy();
    container.remove();
  }
}

// ---------- excalidraw (@excalidraw/excalidraw exportToSvg, bundle vendoré) ----------
// Import dynamique : bundle ~8 Mo, inutile tant qu'aucune scène excalidraw n'est
// demandée.
let excalidrawPromise = null;
async function getExcalidraw() {
  if (!excalidrawPromise) {
    // La CSP bloque les polices CDN ; on pointe l'asset path en local pour
    // éviter tout fetch réseau (les manquantes 404 vite, sans pendre).
    window.EXCALIDRAW_ASSET_PATH = window.location.origin + "/";
    excalidrawPromise = import("./vendor/excalidraw.esm.js");
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
function mapExcalidrawFamily(value) {
  const first = value.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  return EXCALIDRAW_FONT_MAP[first] || value;
}
function fixExcalidrawFonts(svg) {
  return svg
    .replace(/<style class="style-fonts">[\s\S]*?<\/style>/g, "")
    .replace(/font-family="([^"]*)"/g, (_m, v) => `font-family="${mapExcalidrawFamily(v)}"`)
    .replace(/font-family:\s*([^;"}]+)/g, (_m, v) => `font-family: ${mapExcalidrawFamily(v)}`);
}

async function renderExcalidraw(source) {
  const scene = parseJsonStrict(source, "Excalidraw");
  if (!scene || !Array.isArray(scene.elements)) {
    throw new Error("Excalidraw : JSON de scène invalide (clé 'elements' attendue)");
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

await listen("render-job", async (e) => {
  const { id, dtype, source, options } = e.payload;
  try {
    const engine = ENGINES[dtype];
    if (!engine) throw new Error(`moteur inconnu : ${dtype}`);
    const svg = await engine(source, options || {});
    if (typeof svg !== "string" || !svg.includes("<svg")) {
      throw new Error(`le moteur ${dtype} n'a pas produit de SVG`);
    }
    await invoke("render_job_done", { id, svg, error: null });
  } catch (err) {
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
