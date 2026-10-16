// Rendu Markdown (markdown-it) + diagrammes Kroki + sécurisation DOMPurify.

import { invoke, convertFileSrc, b64encode, b64decode, escapeHtml } from "./app.js";
import { docIsDark } from "./theme.js";
import { t } from "./i18n.js";
import { remapLine } from "./anchors.js";
import {
  fencePluginFor,
  highlightPluginFor,
  pluginRenderFence,
  pluginHighlight,
} from "./plugins.js";
import { paintSource } from "./sourcehl.js";

// Tous les types de diagrammes supportés par Kroki (https://kroki.io).
const KROKI_TYPES = new Set([
  "actdiag", "blockdiag", "bpmn", "bytefield", "c4plantuml", "d2", "dbml",
  "diagramsnet", "ditaa", "erd", "excalidraw", "graphviz", "mermaid",
  "nomnoml", "nwdiag", "packetdiag", "pikchr", "plantuml", "rackdiag",
  "seqdiag", "structurizr", "svgbob", "symbolator", "tikz", "umlet",
  "vega", "vegalite", "wavedrom", "wireviz",
]);

const KROKI_ALIASES = {
  dot: "graphviz",
  gv: "graphviz",
  c4: "c4plantuml",
  "vega-lite": "vegalite",
  vl: "vegalite",
  drawio: "diagramsnet",
  puml: "plantuml",
  "plant-uml": "plantuml",
};

// Les colorations de langages applicatifs (```tex-source…) viennent
// des plugins (capacité `highlight:code`, cf. hydratePluginHighlights) —
// plus aucune grammaire hljs applicative enregistrée ici.

const md = window.markdownit({
  html: true,
  linkify: true,
  highlight(code, lang) {
    if (lang && window.hljs.getLanguage(lang)) {
      try {
        return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* retombe sur l'échappement par défaut */
      }
    }
    return "";
  },
});

// --- Formules mathématiques : $…$ (inline) et $$…$$ (display) ---
// markdown-it-texmath parse les délimiteurs au niveau tokens (le mode `dollars`
// ignore les faux positifs type devise « $5 ») et KaTeX rend en HTML+MathML sans
// réseau ni eval. La sortie traverse ensuite DOMPurify (cf. sanitizeHtml).
if (window.texmath && window.katex) {
  md.use(window.texmath, {
    engine: window.katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false, output: "htmlAndMathml" },
  });
}

// --- Frontmatter YAML (`---` … `---` en tête de document) ---
// Sans règle dédiée, markdown-it lit le `---` d'ouverture comme un trait
// horizontal et le bloc `clé: valeur` comme un paragraphe (puis titre setext à
// cause du `---` de fermeture) → bouillie illisible. On le capte en un token de
// bloc unique, rendu en table clé/valeur. Le `token.map` couvre tout le bloc
// pour ne pas décaler les numéros de ligne source (alignement preview ↔ source).
function frontMatterRule(state, startLine, endLine, silent) {
  // Uniquement tout en haut du document, sans indentation.
  if (startLine !== 0 || state.blkIndent !== 0) return false;
  const open = state.bMarks[startLine] + state.tShift[startLine];
  if (state.tShift[startLine] !== 0) return false;
  if (state.src.slice(open, state.eMarks[startLine]).trim() !== "---") return false;

  // Ligne de fermeture `---` ou `...`, en colonne 0.
  let nextLine = startLine + 1;
  let found = false;
  for (; nextLine < endLine; nextLine++) {
    if (state.tShift[nextLine] !== 0) continue;
    const t = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]).trim();
    if (t === "---" || t === "...") {
      found = true;
      break;
    }
  }
  if (!found) return false;
  if (silent) return true;

  const token = state.push("front_matter", "", 0);
  token.markup = "---";
  token.content = state.getLines(startLine + 1, nextLine, 0, false);
  token.map = [startLine, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}
md.block.ruler.before("table", "front_matter", frontMatterRule);

// Découpe le YAML en lignes clé/valeur de premier niveau ; les lignes indentées
// (YAML imbriqué, ex. `hooks:`) sont rattachées à la valeur précédente. Suffisant
// pour un affichage lisible sans embarquer un parseur YAML complet.
function parseFrontMatterRows(yaml) {
  const rows = [];
  for (const raw of yaml.split("\n")) {
    if (!raw.trim()) continue;
    if (/^\s/.test(raw)) {
      if (rows.length) rows[rows.length - 1][1] += `\n${raw.replace(/\s+$/, "")}`;
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    rows.push([m[1].trim(), m[2].trim().replace(/^["']|["']$/g, "")]);
  }
  return rows;
}

md.renderer.rules.front_matter = (tokens, idx) => {
  const token = tokens[idx];
  const rows = parseFrontMatterRows(token.content);
  if (!rows.length) return "";
  const line = token.attrGet("data-source-line");
  const attr = line != null ? ` data-source-line="${escapeHtml(line)}"` : "";
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("");
  return `<table class="frontmatter"${attr}><tbody>${body}</tbody></table>\n`;
};

// --- Ancres de titres façon GitHub (permet les sommaires [..](#section)) ---
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-"); // 1 tiret par espace (comme GitHub) : ne PAS collapser,
  // sinon « Titre — sous-titre » (espace-cadratin-espace) donne un seul tiret au
  // lieu du double tiret de l'ancre du sommaire → le lien ne pointe sur rien.
}

md.core.ruler.push("heading_ids", (mdState) => {
  const seen = new Map();
  const tokens = mdState.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "heading_open" && tokens[i + 1]?.type === "inline") {
      let slug = slugify(tokens[i + 1].content) || "section";
      const n = seen.get(slug) ?? 0;
      seen.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      tokens[i].attrSet("id", slug);
    }
  }
});

// --- Numéros de ligne source sur les blocs (alignement preview ↔ code source) ---
// Chaque token de bloc de niveau racine porte `token.map = [début, fin]` (lignes
// 0-based dans le source). On expose le début en attribut `data-source-line` pour
// pouvoir, lors d'une bascule preview ↔ source, repérer la ligne affichée en haut
// et réaccorder l'autre vue dessus (cf. readTopLine / scrollToLine, main.js).
md.core.ruler.push("source_lines", (mdState) => {
  for (const token of mdState.tokens) {
    if (token.level === 0 && token.map) {
      token.attrSet("data-source-line", String(token.map[0]));
    }
  }
});

// --- Cases à cocher GitHub : - [ ] / - [x] ---
md.core.ruler.push("task_lists", (mdState) => {
  const tokens = mdState.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== "inline" ||
      !inline.children?.length ||
      tokens[i - 1].type !== "paragraph_open" ||
      tokens[i - 2].type !== "list_item_open"
    ) {
      continue;
    }
    const first = inline.children[0];
    if (first.type !== "text") continue;
    const m = /^\[( |x|X)\] /.exec(first.content);
    if (!m) continue;
    first.content = first.content.slice(m[0].length);
    const cb = new mdState.Token("html_inline", "", 0);
    cb.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${
      m[1] === " " ? "" : " checked"
    }> `;
    inline.children.unshift(cb);
    tokens[i - 2].attrJoin("class", "task-list-item");
  }
});

// --- Blocs ``` : un type Kroki devient un diagramme, le reste du code surligné ---
function parseDiagramOptions(rest) {
  const opts = {};
  for (const part of rest.replace(/[{}]/g, " ").split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      opts[part.slice(0, eq)] = part.slice(eq + 1).replace(/^["']|["']$/g, "");
    }
  }
  return opts;
}

const defaultFence =
  md.renderer.rules.fence ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim();
  const firstWord = (info.split(/\s+/)[0] || "").toLowerCase();
  // « plotly » est un moteur « live » rendu côté front (cf. hydrateDiagrams),
  // pas un type Kroki : il accepte une spec JSON inline OU un fichier via `src=`
  // (donc un bloc sans contenu inline reste valide).
  const isPlotly = firstWord === "plotly";
  let type = isPlotly
    ? "plotly"
    : KROKI_TYPES.has(firstWord)
      ? firstWord
      : KROKI_ALIASES[firstWord];
  // Fence revendiquée par un plugin (`fence:svg`/`fence:html`/`fence:markdown`) : le natif prime
  // (spec §8.1) — on n'y arrive que si le type n'est ni Kroki ni plotly. Comme
  // plotly, un bloc vide reste valide (données via `src=`).
  const isPluginFence = !type && !!fencePluginFor(firstWord);
  if (isPluginFence) type = firstWord;
  if (type && (token.content.trim() || isPlotly || isPluginFence)) {
    const rest = info.slice(info.indexOf(firstWord) + firstWord.length);
    const opts = parseDiagramOptions(rest);
    const srcLine = token.map ? token.map[0] : 0;
    return (
      `<div class="kroki-diagram" data-source-line="${srcLine}" data-kroki-type="${type}"` +
      (isPluginFence ? ` data-plugin-fence="1"` : "") +
      ` data-kroki-src="${b64encode(token.content)}"` +
      ` data-kroki-opts="${b64encode(JSON.stringify(opts))}">` +
      `<div class="kroki-loading">${t("render.loading", { type: escapeHtml(type) })}</div></div>`
    );
  }
  return defaultFence(tokens, idx, options, env, self);
};

/** Le langage de fence est-il servi nativement (types Kroki, alias, plotly) ?
 *  Utilisé par l'UI des plugins pour signaler les revendications ignorées. */
export function isNativeFence(lang) {
  const l = String(lang || "").toLowerCase();
  return l === "plotly" || KROKI_TYPES.has(l) || l in KROKI_ALIASES;
}

function sanitizeHtml(html) {
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ["xmlns", "xmlns:xlink", "xlink:href"],
  });
}

// Les SVG Kroki sont insérés tels quels : DOMPurify vide systématiquement les
// <foreignObject> (labels HTML de mermaid & co), or ils viennent du serveur
// Kroki choisi par l'utilisateur. La CSP de l'app (script-src 'self', aucun
// inline) neutralise scripts et handlers d'événements qu'un SVG pourrait
// contenir, et innerHTML n'exécute jamais les <script> insérés.

// Résolution de chemins relatifs Windows pour les images locales du document.
function joinPath(dir, rel) {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("\\");
}

function rewriteLocalImages(root, dir) {
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (!src || /^(https?:|data:|blob:|asset:)/i.test(src)) continue;
    let p = src.replace(/^file:\/{2,3}/i, "");
    try {
      p = decodeURIComponent(p);
    } catch {
      /* chemin brut */
    }
    const isAbs = /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
    img.src = convertFileSrc(isAbs ? p : joinPath(dir, p));
  }
}

function diagramError(type, err) {
  return (
    `<div class="kroki-error"><strong>${t("render.diagram_error", { type: escapeHtml(type) })}</strong>` +
    `<pre>${escapeHtml(String(err))}</pre></div>`
  );
}

// --- Moteur « live » Plotly : rendu interactif côté front (hors pipeline SVG) ---
// Contrairement aux moteurs Kroki (backend → webview cachée → SVG figé), Plotly
// doit s'exécuter dans la vue affichée pour rester interactif. Le bundle (~4,8 Mo)
// est injecté en <script src 'self'> à la première figure seulement. La CSP
// autorise déjà 'unsafe-eval' (pour d2) ; un script de même origine n'a pas besoin
// de 'unsafe-inline'.
let plotlyPromise = null;
function ensurePlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/plotly.min.js";
      s.onload = () => resolve(window.Plotly);
      s.onerror = () => {
        plotlyPromise = null;
        reject(new Error(t("render.plotly_load_failed")));
      };
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

// Intègre la figure au thème du document : fond transparent (elle se fond dans la
// page, claire ou sombre), largeur fluide, couleur de texte adaptée. En sombre on
// éclaircit aussi grilles/lignes d'axes de TOUS les sous-graphes. Les valeurs
// explicites de la spec restent prioritaires (merge en dessous via `...existant`).
async function renderPlotly(el, raw) {
  const fig = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!fig || typeof fig !== "object") throw new Error(t("render.plotly_invalid_spec"));
  const dark = docIsDark();
  const data = Array.isArray(fig.data) ? fig.data : [];
  const layout = { ...(fig.layout || {}) };
  layout.autosize = true;
  delete layout.width;
  if (layout.height == null) layout.height = 420;
  layout.paper_bgcolor = "rgba(0,0,0,0)";
  layout.plot_bgcolor = "rgba(0,0,0,0)";
  // Titre, légende et libellés d'axes héritent de font.color.
  layout.font = { color: dark ? "#c9d1d9" : "#1f2328", ...(layout.font || {}) };
  if (dark) {
    const axisDark = {
      gridcolor: "rgba(255,255,255,0.09)",
      zerolinecolor: "rgba(255,255,255,0.18)",
      linecolor: "rgba(255,255,255,0.25)",
    };
    // Garantit la présence des axes de base avant de parcourir (figure mono-graphe).
    layout.xaxis = layout.xaxis || {};
    layout.yaxis = layout.yaxis || {};
    for (const key of Object.keys(layout)) {
      if (/^[xy]axis\d*$/.test(key)) layout[key] = { ...axisDark, ...layout[key] };
    }
  }
  const config = { displaylogo: false, ...(fig.config || {}), responsive: true };
  const Plotly = await ensurePlotly();
  el.replaceChildren(); // retire le placeholder « Rendu plotly… » avant la prise en main par Plotly
  await Plotly.newPlot(el, data, layout, config);
  // Ratio d'aspect de base : sous zoom de page, main.js redimensionne la figure via
  // relayout(width, height) pour rester 1:1 (hit-testing) sans utiliser Plots.resize,
  // qui collapse la hauteur d'un conteneur dépourvu de hauteur CSS explicite.
  if (el._fullLayout?.width) {
    el.dataset.plotlyRatio = String(el._fullLayout.height / el._fullLayout.width);
  }
}

// Stem d'un chemin (nom de fichier sans dossier ni extension), insensible à la
// casse et tolérant aux chemins déjà réécrits en asset: (percent-encodés).
function fileStem(path) {
  let s = path || "";
  try {
    s = decodeURIComponent(s);
  } catch {
    /* chemin brut */
  }
  s = s.split(/[\\/]+/).pop() || "";
  return s.replace(/\.[^.]+$/, "").toLowerCase();
}

// Un générateur de rapport peut émettre une image (PNG/SVG…) juste avant un bloc
// ```plotly de même stem : c'est le fallback statique, utile hors Kroki Desk ou si
// Plotly échoue. Le rendu interactif le rend redondant -> on masque l'image jumelle
// une fois que Plotly a rendu (et seulement alors). En cas d'échec, le PNG reste.
function hidePairedFallbackImage(el, srcPath) {
  const stem = fileStem(srcPath);
  if (!stem) return;
  const prev = el.previousElementSibling;
  if (!prev) return;
  const img = prev.tagName === "IMG" ? prev : prev.querySelector?.("img");
  if (img && fileStem(img.getAttribute("src") || "") === stem) {
    (img.closest("p") || img).style.display = "none";
  }
}

// `depth` : profondeur d'imbrication des fences `fence:markdown` (un plugin
// dont le markdown dérivé contient sa propre fence boucle sinon à l'infini).
async function hydrateDiagrams(root, dir, depth = 0) {
  const nodes = [...root.querySelectorAll(".kroki-diagram")];
  await Promise.all(
    nodes.map(async (el) => {
      const type = el.dataset.krokiType;
      let source, options;
      try {
        source = b64decode(el.dataset.krokiSrc);
        options = JSON.parse(b64decode(el.dataset.krokiOpts || "") || "{}");
      } catch {
        return;
      }
      if (type === "plotly") {
        try {
          let raw = source.trim();
          if (!raw && options.src) {
            raw = await invoke("read_data_file", { baseDir: dir || "", rel: options.src });
          }
          if (!raw) throw new Error(t("render.plotly_missing_spec"));
          await renderPlotly(el, raw);
          el.classList.add("ok");
          hidePairedFallbackImage(el, options.src);
        } catch (err) {
          el.classList.remove("ok");
          el.innerHTML = diagramError(type, err);
        }
        return;
      }
      // Fence servie par un plugin (`fence/render`, spec §6.3). Le SVG est
      // inséré tel quel — même politique que les moteurs natifs : la CSP
      // (script-src sans inline) neutralise tout script embarqué. Le HTML,
      // lui, passe par DOMPurify. Le markdown (`fence:markdown`) repasse par
      // le pipeline complet (markdown-it + DOMPurify) puis est hydraté
      // récursivement (diagrammes natifs, colorations plugin) — profondeur
      // bornée. `src=` réussi → image de fallback masquée.
      if (el.dataset.pluginFence) {
        const plugin = fencePluginFor(type);
        try {
          if (!plugin) throw new Error(t("render.no_fence_plugin"));
          const r = await pluginRenderFence(plugin, {
            lang: type,
            source,
            options,
            dir: dir || "",
          });
          if (r.format === "markdown") {
            if (depth >= 2) throw new Error(t("render.fence_nesting_too_deep"));
            el.innerHTML = sanitizeHtml(md.render(r.content));
            // Les data-source-line du markdown dérivé pointent dans le contenu
            // généré, pas dans le document ouvert : on les retire pour ne pas
            // fausser la synchro preview ↔ source (celui du conteneur `el`,
            // posé par la règle fence, reste correct).
            for (const n of el.querySelectorAll("[data-source-line]")) {
              n.removeAttribute("data-source-line");
            }
            el.classList.add("kroki-markdown");
            await Promise.all([hydrateDiagrams(el, dir, depth + 1), hydratePluginHighlights(el)]);
          } else {
            el.innerHTML = r.format === "svg" ? r.content : sanitizeHtml(r.content);
          }
          el.classList.add("ok");
          if (options.src) hidePairedFallbackImage(el, options.src);
        } catch (err) {
          el.classList.remove("ok");
          el.classList.remove("kroki-markdown");
          el.innerHTML = diagramError(type, err);
        }
        return;
      }
      try {
        const svg = await invoke("render_diagram", {
          diagramType: type,
          source,
          options,
        });
        el.innerHTML = svg;
        el.classList.add("ok");
      } catch (err) {
        el.classList.remove("ok");
        el.innerHTML = diagramError(type, err);
      }
    }),
  );
}

/**
 * Rend un document complet dans une vue, en préservant la position de lecture
 * (re-render suite à une modification du fichier sur disque).
 */
export async function renderDocument(view, doc) {
  const scrollTop = view.scrollTop;
  const html = sanitizeHtml(md.render(doc.markdown));
  view.innerHTML = `<article class="markdown-body">${html}</article>`;
  // Document dérivé (plugin → markdown) : les data-source-line pointent dans le
  // markdown généré ; on les réaccorde sur le source réel pour que la
  // synchro preview ↔ source et le sommaire restent cohérents.
  if (doc.lineMap) {
    for (const el of view.querySelectorAll("[data-source-line]")) {
      const line = Number(el.getAttribute("data-source-line")) || 0;
      el.setAttribute("data-source-line", String(remapLine(doc.lineMap, line)));
    }
  }
  view.dataset.dir = doc.dir;
  rewriteLocalImages(view, doc.dir);
  view.scrollTop = scrollTop;
  const before = view.scrollTop;
  await Promise.all([hydrateDiagrams(view, doc.dir), hydratePluginHighlights(view)]);
  // Ne restaure qu'en l'absence de défilement manuel pendant l'hydratation.
  if (Math.abs(view.scrollTop - before) < 4) view.scrollTop = scrollTop;
}

// Page HTML statique (export de l'app ou HTML tiers) : affichée telle quelle
// dans une iframe sandboxée — `sandbox=""` (aucune capacité : ni script, ni
// navigation, ni formulaire) et la CSP de l'app héritée par le document srcdoc
// (pas de `'unsafe-inline'` en script-src) neutralisent tout contenu actif.
// Les exports de l'app sont autonomes (styles inlinés, images en data-URI,
// SVG inline) et se rendent donc à l'identique ; les ressources relatives d'un
// HTML tiers ne sont pas résolues (about:srcdoc n'a pas de base).
export function renderHtmlDocument(view, html) {
  const iframe = document.createElement("iframe");
  iframe.className = "html-view";
  iframe.setAttribute("sandbox", "");
  iframe.setAttribute("title", t("render.html_page_title"));
  iframe.srcdoc = String(html);
  view.replaceChildren(iframe);
}

// Coloration par plugin (`highlight:code`, spec §6.4) : markdown-it a rendu les
// fences des langages sans grammaire hljs en texte échappé ; on les re-colore
// après coup. La sortie du plugin est du code tiers : seuls les
// `<span class="…">` survivent (les classes `hljs-*` héritent du thème actif).
// Jamais bloquant — en erreur, la fence reste non colorée.
async function hydratePluginHighlights(root) {
  const jobs = [];
  for (const code of root.querySelectorAll('pre > code[class*="language-"]')) {
    const cls = [...code.classList].find((c) => c.startsWith("language-"));
    const lang = cls ? cls.slice("language-".length).toLowerCase() : "";
    if (!lang || window.hljs.getLanguage(lang)) continue; // grammaire native : déjà colorée
    const plugin = highlightPluginFor(lang);
    if (!plugin) continue;
    jobs.push(
      pluginHighlight(plugin, { lang, code: code.textContent })
        .then((html) => {
          code.innerHTML = window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ["span"],
            ALLOWED_ATTR: ["class"],
          });
        })
        .catch(() => {}),
    );
  }
  await Promise.all(jobs);
}

/**
 * Affiche le code source Markdown brut (lecture seule), une ligne = un élément
 * `[data-line]` (index 0-based) pour permettre l'alignement avec le preview.
 * `white-space: pre` (cf. app.css) garantit 1 ligne logique = 1 ligne visuelle,
 * donc un mappage de position robuste indépendant de la coloration.
 *
 * `hl` (cf. `sourceHighlightFor`) demande la coloration syntaxique : elle est
 * peinte **par-dessus** les lignes déjà posées — de façon différée quand elle
 * vient d'un plugin — sans jamais changer le nombre de lignes ni leur hauteur.
 */
export function renderSource(view, markdown, hl = null) {
  const scrollTop = view.scrollTop;
  const lines = String(markdown).split("\n");
  const frag = document.createDocumentFragment();
  const root = document.createElement("pre");
  root.className = "source-view";
  // Gouttière au plus juste : nombre de chiffres du dernier numéro (+ un demi
  // caractère de garde pour que l'alignement à droite ne pousse jamais le code).
  root.style.setProperty("--src-gutter", `${String(lines.length).length + 0.5}ch`);
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "src-line";
    div.dataset.line = String(i);
    div.textContent = line || "​"; // ZWSP : préserve la hauteur des lignes vides
    root.appendChild(div);
  });
  frag.appendChild(root);
  view.replaceChildren(frag);
  view.scrollTop = scrollTop;
  paintSource(root, lines, hl);
}

// Repère la ligne source du bloc actuellement collé au haut du viewport. On prend
// l'élément annoté (`[attr]`) dont le sommet est le plus proche du bord supérieur
// sans le dépasser ; si tout est plus bas (défilé tout en haut), la première ligne.
export function readTopLine(view, attr) {
  const els = view.querySelectorAll(`[${attr}]`);
  if (!els.length) return 0;
  const top = view.scrollTop;
  let bestLine = Number(els[0].getAttribute(attr));
  let bestOff = -Infinity;
  for (const el of els) {
    const off = el.offsetTop;
    if (off <= top + 2 && off > bestOff) {
      bestOff = off;
      bestLine = Number(el.getAttribute(attr));
    }
  }
  return bestLine;
}

// Défile `view` pour amener au sommet l'élément annoté correspondant à `line`
// (la plus grande ligne ≤ `line`, à défaut la première).
export function scrollToLine(view, attr, line) {
  const els = view.querySelectorAll(`[${attr}]`);
  if (!els.length) return;
  let target = els[0];
  let bestLine = -1;
  for (const el of els) {
    const l = Number(el.getAttribute(attr));
    if (l <= line && l > bestLine) {
      bestLine = l;
      target = el;
    }
  }
  view.scrollTop = target.offsetTop;
}

// Texte brut d'un token inline (titres) : on concatène le contenu textuel des
// enfants en ignorant les marqueurs de mise en forme (`**`, `` ` ``, liens…).
function inlineText(inline) {
  if (!inline || inline.type !== "inline") return "";
  if (!inline.children?.length) return inline.content || "";
  let s = "";
  for (const c of inline.children) {
    if (c.type === "text" || c.type === "code_inline") s += c.content;
    else if (c.type === "softbreak" || c.type === "hardbreak") s += " ";
  }
  return s.trim() || inline.content || "";
}

/**
 * Extrait les titres du Markdown pour le sommaire. Parse via la même instance
 * `md` que le rendu : les slugs (`id`) et numéros de ligne (`data-source-line`)
 * sont donc identiques à ceux du DOM affiché. Renvoie `[{level, text, slug, line}]`
 * dans l'ordre du document.
 */
export function extractHeadings(markdown) {
  const tokens = md.parse(String(markdown), {});
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "heading_open") continue;
    out.push({
      level: Number(t.tag.slice(1)) || 1,
      text: inlineText(tokens[i + 1]),
      slug: t.attrGet("id") || "",
      line: t.map ? t.map[0] : 0,
    });
  }
  return out;
}

export function renderReadError(view, message) {
  view.innerHTML =
    `<article class="markdown-body"><div class="kroki-error">` +
    `<strong>${t("render.read_error")}</strong><pre>${escapeHtml(String(message))}</pre>` +
    `</div></article>`;
}
