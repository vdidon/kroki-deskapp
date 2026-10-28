// @ts-check
// Markdown rendering (markdown-it) + Kroki diagrams + DOMPurify sanitizing.

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

/** @typedef {import("../../types/ipc").Anchor} Anchor */
/** @typedef {import("../../types/vendor").MarkdownItStateBlock} MarkdownItStateBlock */
/** @typedef {import("../../types/vendor").MarkdownItToken} MarkdownItToken */
/** @typedef {import("../../types/vendor").Plotly} Plotly */
/** @typedef {import("../../types/vendor").PlotlyHTMLElement} PlotlyHTMLElement */
/** @typedef {import("./sourcehl.js").SourceHighlight} SourceHighlight */
/**
 * Document to render: markdown (derived where applicable), folder used to
 * resolve relative images, anchors of the derived markdown (`null` = native document).
 * @typedef {{ markdown: string, dir: string, lineMap?: Anchor[] | null }} RenderDoc
 */
/** Table of contents entry (cf. `extractHeadings`).
 * @typedef {{ level: number, text: string, slug: string, line: number }} Heading */

// All the diagram types supported by Kroki (https://kroki.io).
const KROKI_TYPES = new Set([
  "actdiag", "blockdiag", "bpmn", "bytefield", "c4plantuml", "d2", "dbml",
  "diagramsnet", "ditaa", "erd", "excalidraw", "graphviz", "mermaid",
  "nomnoml", "nwdiag", "packetdiag", "pikchr", "plantuml", "rackdiag",
  "seqdiag", "structurizr", "svgbob", "symbolator", "tikz", "umlet",
  "vega", "vegalite", "wavedrom", "wireviz",
]);

/** @type {Partial<Record<string, string>>} */
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

// Highlighting of application languages (```tex-source…) comes
// from plugins (`highlight:code` capability, cf. hydratePluginHighlights) —
// no application hljs grammar is registered here anymore.

const md = window.markdownit({
  html: true,
  linkify: true,
  highlight(code, lang) {
    if (lang && window.hljs.getLanguage(lang)) {
      try {
        return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* falls back to the default escaping */
      }
    }
    return "";
  },
});

// --- Math formulas: $…$ (inline) and $$…$$ (display) ---
// markdown-it-texmath parses the delimiters at token level (`dollars` mode
// ignores false positives such as currency « $5 ») and KaTeX renders to HTML+MathML with no
// network or eval. The output then goes through DOMPurify (cf. sanitizeHtml).
if (window.texmath && window.katex) {
  md.use(window.texmath, {
    engine: window.katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false, output: "htmlAndMathml" },
  });
}

// --- YAML frontmatter (`---` … `---` at the top of the document) ---
// Without a dedicated rule, markdown-it reads the opening `---` as a horizontal
// rule and the `key: value` block as a paragraph (then a setext heading because
// of the closing `---`) → unreadable mess. We capture it as a single block
// token, rendered as a key/value table. `token.map` covers the whole block
// so as not to shift the source line numbers (preview ↔ source alignment).
/**
 * @param {MarkdownItStateBlock} state
 * @param {number} startLine
 * @param {number} endLine
 * @param {boolean} silent
 * @returns {boolean}
 */
function frontMatterRule(state, startLine, endLine, silent) {
  // Only at the very top of the document, with no indentation.
  if (startLine !== 0 || state.blkIndent !== 0) return false;
  const open = state.bMarks[startLine] + state.tShift[startLine];
  if (state.tShift[startLine] !== 0) return false;
  if (state.src.slice(open, state.eMarks[startLine]).trim() !== "---") return false;

  // Closing line `---` or `...`, in column 0.
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

// Splits the YAML into top-level key/value lines; indented lines
// (nested YAML, e.g. `hooks:`) are attached to the previous value. Enough
// for a readable display without shipping a full YAML parser.
/**
 * @param {string} yaml
 * @returns {[string, string][]} `[key, value]` pairs
 */
function parseFrontMatterRows(yaml) {
  /** @type {[string, string][]} */
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

// --- GitHub-style heading anchors (enables [..](#section) tables of contents) ---
/** @param {string} text */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-"); // 1 hyphen per space (like GitHub): do NOT collapse,
  // otherwise « Title — subtitle » (space-em dash-space) gives a single hyphen
  // instead of the double hyphen of the table of contents anchor → the link points nowhere.
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

// --- Source line numbers on blocks (preview ↔ source code alignment) ---
// Each root-level block token carries `token.map = [start, end]` (0-based lines
// in the source). We expose the start as a `data-source-line` attribute so that,
// when toggling preview ↔ source, we can find the line shown at the top
// and realign the other view on it (cf. readTopLine / scrollToLine, main.js).
md.core.ruler.push("source_lines", (mdState) => {
  for (const token of mdState.tokens) {
    if (token.level === 0 && token.map) {
      token.attrSet("data-source-line", String(token.map[0]));
    }
  }
});

// --- GitHub checkboxes: - [ ] / - [x] ---
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

// --- ``` blocks: a Kroki type becomes a diagram, anything else is highlighted code ---
/**
 * @param {string} rest
 * @returns {Record<string, string>}
 */
function parseDiagramOptions(rest) {
  /** @type {Record<string, string>} */
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
  // "plotly" is a "live" engine rendered on the front side (cf. hydrateDiagrams),
  // not a Kroki type: it accepts an inline JSON spec OR a file via `src=`
  // (so a block with no inline content remains valid).
  const isPlotly = firstWord === "plotly";
  let type = isPlotly
    ? "plotly"
    : KROKI_TYPES.has(firstWord)
      ? firstWord
      : KROKI_ALIASES[firstWord];
  // Fence claimed by a plugin (`fence:svg`/`fence:html`/`fence:markdown`): native wins
  // (spec §8.1) — we only get here if the type is neither Kroki nor plotly. Like
  // plotly, an empty block remains valid (data via `src=`).
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

/** Is the fence language served natively (Kroki types, aliases, plotly)?
 *  Used by the plugins UI to flag ignored claims.
 *  @param {string} lang */
export function isNativeFence(lang) {
  const l = String(lang || "").toLowerCase();
  return l === "plotly" || KROKI_TYPES.has(l) || l in KROKI_ALIASES;
}

/**
 * @param {string} html
 * @returns {string}
 */
function sanitizeHtml(html) {
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ["xmlns", "xmlns:xlink", "xlink:href"],
  });
}

// Kroki SVGs are inserted as is: DOMPurify systematically empties
// <foreignObject>s (HTML labels of mermaid & co), yet they come from the Kroki
// server chosen by the user. The app's CSP (script-src 'self', no
// inline) neutralizes the scripts and event handlers an SVG might
// contain, and innerHTML never executes inserted <script>s.

// Resolution of Windows relative paths for the document's local images.
/**
 * @param {string} dir
 * @param {string} rel
 */
function joinPath(dir, rel) {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("\\");
}

/**
 * @param {ParentNode} root
 * @param {string} dir
 */
function rewriteLocalImages(root, dir) {
  for (const img of /** @type {NodeListOf<HTMLImageElement>} */ (root.querySelectorAll("img[src]"))) {
    const src = img.getAttribute("src");
    if (!src || /^(https?:|data:|blob:|asset:)/i.test(src)) continue;
    let p = src.replace(/^file:\/{2,3}/i, "");
    try {
      p = decodeURIComponent(p);
    } catch {
      /* raw path */
    }
    const isAbs = /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
    img.src = convertFileSrc(isAbs ? p : joinPath(dir, p));
  }
}

/**
 * @param {string} type
 * @param {unknown} err
 */
function diagramError(type, err) {
  return (
    `<div class="kroki-error"><strong>${t("render.diagram_error", { type: escapeHtml(type) })}</strong>` +
    `<pre>${escapeHtml(String(err))}</pre></div>`
  );
}

// --- Plotly "live" engine: interactive rendering on the front side (outside the SVG pipeline) ---
// Unlike the Kroki engines (backend → hidden webview → frozen SVG), Plotly
// must run in the displayed view to stay interactive. The bundle (~4.8 MB)
// is injected as <script src 'self'> at the first figure only. The CSP
// already allows 'unsafe-eval' (for d2); a same-origin script does not need
// 'unsafe-inline'.
/** @type {Promise<Plotly> | null} */
let plotlyPromise = null;
/** @returns {Promise<Plotly>} */
function ensurePlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (!plotlyPromise) {
    plotlyPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/plotly.min.js";
      // The UMD bundle sets `window.Plotly` as it executes, before `onload`.
      s.onload = () => resolve(/** @type {Plotly} */ (window.Plotly));
      s.onerror = () => {
        plotlyPromise = null;
        reject(new Error(t("render.plotly_load_failed")));
      };
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

// Fits the figure to the document theme: transparent background (it blends into the
// page, light or dark), fluid width, adapted text color. In dark mode we also
// lighten the grids/axis lines of ALL subplots. Explicit values from the spec
// keep priority (merged underneath via `...existing`).
/**
 * @param {PlotlyHTMLElement} el
 * @param {string} raw JSON spec `{data, layout, config}`
 */
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
  // Title, legend and axis labels inherit from font.color.
  layout.font = { color: dark ? "#c9d1d9" : "#1f2328", ...(layout.font || {}) };
  if (dark) {
    const axisDark = {
      gridcolor: "rgba(255,255,255,0.09)",
      zerolinecolor: "rgba(255,255,255,0.18)",
      linecolor: "rgba(255,255,255,0.25)",
    };
    // Ensures the base axes exist before iterating (single-plot figure).
    layout.xaxis = layout.xaxis || {};
    layout.yaxis = layout.yaxis || {};
    for (const key of Object.keys(layout)) {
      if (/^[xy]axis\d*$/.test(key)) layout[key] = { ...axisDark, ...layout[key] };
    }
  }
  const config = { displaylogo: false, ...(fig.config || {}), responsive: true };
  const Plotly = await ensurePlotly();
  el.replaceChildren(); // removes the « Rendu plotly… » placeholder before Plotly takes over
  await Plotly.newPlot(el, data, layout, config);
  // Base aspect ratio: under page zoom, main.js resizes the figure via
  // relayout(width, height) to stay 1:1 (hit-testing) without using Plots.resize,
  // which collapses the height of a container with no explicit CSS height.
  if (el._fullLayout?.width) {
    el.dataset.plotlyRatio = String(el._fullLayout.height / el._fullLayout.width);
  }
}

// Stem of a path (file name without folder or extension), case-insensitive
// and tolerant of paths already rewritten to asset: (percent-encoded).
/** @param {string | undefined} path */
function fileStem(path) {
  let s = path || "";
  try {
    s = decodeURIComponent(s);
  } catch {
    /* raw path */
  }
  s = s.split(/[\\/]+/).pop() || "";
  return s.replace(/\.[^.]+$/, "").toLowerCase();
}

// A report generator may emit an image (PNG/SVG…) right before a ```plotly
// block with the same stem: that is the static fallback, useful outside Kroki Desk or if
// Plotly fails. The interactive render makes it redundant -> we hide the twin image
// once Plotly has rendered (and only then). On failure, the PNG stays.
/**
 * @param {Element} el
 * @param {string | undefined} srcPath
 */
function hidePairedFallbackImage(el, srcPath) {
  const stem = fileStem(srcPath);
  if (!stem) return;
  const prev = el.previousElementSibling;
  if (!prev) return;
  const img = /** @type {HTMLElement | null} */ (
    prev.tagName === "IMG" ? prev : prev.querySelector?.("img")
  );
  if (img && fileStem(img.getAttribute("src") || "") === stem) {
    (img.closest("p") || img).style.display = "none";
  }
}

// `depth`: nesting depth of `fence:markdown` fences (a plugin whose derived
// markdown contains its own fence would otherwise loop forever).
/**
 * @param {ParentNode} root
 * @param {string} dir
 * @param {number} [depth]
 * @returns {Promise<void>}
 */
async function hydrateDiagrams(root, dir, depth = 0) {
  const nodes = [.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(".kroki-diagram"))];
  await Promise.all(
    nodes.map(async (el) => {
      // `data-kroki-type`/`-src` are set by the fence rule. A
      // `.kroki-diagram` imitated in inline HTML (DOMPurify keeps class and data-*)
      // may lack them: b64decode(undefined) throws (catch below),
      // a missing type makes `invoke` reject — error displayed, nothing more.
      const type = /** @type {string} */ (el.dataset.krokiType);
      let source, options;
      try {
        source = b64decode(/** @type {string} */ (el.dataset.krokiSrc));
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
      // Fence served by a plugin (`fence/render`, spec §6.3). The SVG is
      // inserted as is — same policy as the native engines: the CSP
      // (script-src without inline) neutralizes any embedded script. The HTML,
      // on the other hand, goes through DOMPurify. The markdown (`fence:markdown`)
      // goes back through the full pipeline (markdown-it + DOMPurify) then is
      // hydrated recursively (native diagrams, plugin highlighting) — bounded
      // depth. Successful `src=` → fallback image hidden.
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
            // The derived markdown's data-source-line values point into the
            // generated content, not the opened document: we remove them so as not to
            // skew the preview ↔ source sync (the container `el`'s own,
            // set by the fence rule, stays correct).
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
 * Renders a full document into a view, preserving the reading position
 * (re-render after the file is modified on disk).
 *
 * @param {HTMLElement} view
 * @param {RenderDoc} doc
 */
export async function renderDocument(view, doc) {
  const scrollTop = view.scrollTop;
  const html = sanitizeHtml(md.render(doc.markdown));
  view.innerHTML = `<article class="markdown-body">${html}</article>`;
  // Derived document (plugin → markdown): the data-source-line values point into the
  // generated markdown; we remap them onto the real source so that the
  // preview ↔ source sync and the table of contents stay consistent.
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
  // Only restores if there was no manual scrolling during hydration.
  if (Math.abs(view.scrollTop - before) < 4) view.scrollTop = scrollTop;
}

// Static HTML page (app export or third-party HTML): displayed as is
// in a sandboxed iframe — `sandbox=""` (no capability: no script, no
// navigation, no form) and the app's CSP inherited by the srcdoc document
// (no `'unsafe-inline'` in script-src) neutralize any active content.
// The app's exports are self-contained (inlined styles, data-URI images,
// inline SVG) and therefore render identically; relative resources of a
// third-party HTML are not resolved (about:srcdoc has no base).
/**
 * @param {HTMLElement} view
 * @param {string} html
 */
export function renderHtmlDocument(view, html) {
  const iframe = document.createElement("iframe");
  iframe.className = "html-view";
  iframe.setAttribute("sandbox", "");
  iframe.setAttribute("title", t("render.html_page_title"));
  iframe.srcdoc = String(html);
  view.replaceChildren(iframe);
}

// Plugin highlighting (`highlight:code`, spec §6.4): markdown-it rendered the
// fences of languages without an hljs grammar as escaped text; we re-color them
// after the fact. The plugin's output is third-party code: only
// `<span class="…">` survive (the `hljs-*` classes inherit from the active theme).
// Never blocking — on error, the fence stays uncolored.
/**
 * @param {ParentNode} root
 * @returns {Promise<void>}
 */
async function hydratePluginHighlights(root) {
  /** @type {Promise<void>[]} */
  const jobs = [];
  for (const code of root.querySelectorAll('pre > code[class*="language-"]')) {
    const cls = [...code.classList].find((c) => c.startsWith("language-"));
    const lang = cls ? cls.slice("language-".length).toLowerCase() : "";
    if (!lang || window.hljs.getLanguage(lang)) continue; // native grammar: already highlighted
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
 * Displays the raw Markdown source (read-only), one line = one
 * `[data-line]` element (0-based index) to allow alignment with the preview.
 * `white-space: pre` (cf. app.css) guarantees 1 logical line = 1 visual line,
 * hence a robust position mapping independent of the highlighting.
 *
 * `hl` (cf. `sourceHighlightFor`) requests syntax highlighting: it is
 * painted **on top of** the lines already laid down — deferred when it
 * comes from a plugin — without ever changing the line count or their height.
 *
 * @param {HTMLElement} view
 * @param {string} markdown
 * @param {SourceHighlight} [hl]
 */
export function renderSource(view, markdown, hl = null) {
  const scrollTop = view.scrollTop;
  const lines = String(markdown).split("\n");
  const frag = document.createDocumentFragment();
  const root = document.createElement("pre");
  root.className = "source-view";
  // Tightest gutter: digit count of the last number (+ half a character of
  // slack so that right alignment never pushes the code).
  root.style.setProperty("--src-gutter", `${String(lines.length).length + 0.5}ch`);
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "src-line";
    div.dataset.line = String(i);
    div.textContent = line || "​"; // ZWSP: preserves the height of empty lines
    root.appendChild(div);
  });
  frag.appendChild(root);
  view.replaceChildren(frag);
  view.scrollTop = scrollTop;
  paintSource(root, lines, hl);
}

// Finds the source line of the block currently stuck to the top of the viewport. We take
// the annotated element (`[attr]`) whose top is closest to the upper edge
// without going past it; if everything is lower (scrolled to the very top), the first line.
/**
 * @param {HTMLElement} view
 * @param {string} attr
 * @returns {number}
 */
export function readTopLine(view, attr) {
  const els = /** @type {NodeListOf<HTMLElement>} */ (view.querySelectorAll(`[${attr}]`));
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

// Scrolls `view` to bring the annotated element matching `line` to the top
// (the largest line ≤ `line`, otherwise the first).
/**
 * @param {HTMLElement} view
 * @param {string} attr
 * @param {number} line
 */
export function scrollToLine(view, attr, line) {
  const els = /** @type {NodeListOf<HTMLElement>} */ (view.querySelectorAll(`[${attr}]`));
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

// Plain text of an inline token (headings): we concatenate the text content of
// the children, ignoring formatting markers (`**`, `` ` ``, links…).
/**
 * @param {MarkdownItToken | undefined} inline
 * @returns {string}
 */
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
 * Extracts the Markdown headings for the table of contents. Parses via the same
 * `md` instance as the rendering: the slugs (`id`) and line numbers (`data-source-line`)
 * are therefore identical to those of the displayed DOM. Returns `[{level, text, slug, line}]`
 * in document order.
 *
 * @param {string} markdown
 * @returns {Heading[]}
 */
export function extractHeadings(markdown) {
  const tokens = md.parse(String(markdown), {});
  /** @type {Heading[]} */
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

/**
 * @param {HTMLElement} view
 * @param {unknown} message
 */
export function renderReadError(view, message) {
  view.innerHTML =
    `<article class="markdown-body"><div class="kroki-error">` +
    `<strong>${t("render.read_error")}</strong><pre>${escapeHtml(String(message))}</pre>` +
    `</div></article>`;
}
