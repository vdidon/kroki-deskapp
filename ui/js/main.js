// @ts-check

// Window orchestration: tab state, views, shortcuts, links.

import { invoke, listen, currentLabel, state, isHtmlPath } from "./app.js";
import {
  renderDocument,
  renderHtmlDocument,
  renderReadError,
  renderSource,
  readTopLine,
  scrollToLine,
  extractHeadings,
} from "./render.js";
import { renderTabbar, initTabbar } from "./tabs.js";
import { initTearDrag } from "./teardrag.js";
import { initFileDrop } from "./filedrop.js";
import { initSession } from "./session.js";
import { initSettings, openSettings } from "./settings.js";
import { initInfo, openInfo } from "./info.js";
import { initUpdates } from "./updates.js";
import { initChangelog } from "./changelog.js";
import { initJournal } from "./journal.js";
import { initNotices } from "./notices.js";
import { exportActiveView } from "./export.js";
import { applyTheme, initTheme } from "./theme.js";
import { initI18n, loadLocale, onLocaleChange, t } from "./i18n.js";
import { initFindWord } from "./findword.js";
import {
  initGlobalSearch,
  toggleGlobalSearch,
  closeGlobalSearch,
  isGlobalSearchOpen,
  refreshGlobalSearch,
  onActiveViewShown,
} from "./globalsearch.js";
import {
  initDocSearch,
  openDocSearch,
  closeDocSearch,
  isDocSearchOpen,
  refreshDocSearch,
  findNext,
} from "./docsearch.js";
import { remapLine } from "./anchors.js";
import {
  initPlugins,
  documentPluginFor,
  pluginTransformDocument,
  degradedDocMarkdown,
  notifyThemeChanged,
  sourceHighlightFor,
} from "./plugins.js";
import { initPluginsUi } from "./plugins_ui.js";
import { applyIcons, iconEnabled } from "./icons.js";
import { beginLoading, endLoading, beforeHeavyRender } from "./loading.js";

/** @typedef {import("../../types/ipc").Anchor} Anchor */
/** @typedef {import("../../types/ipc").TabsPayload} TabsPayload */
/** @typedef {import("../../types/app").View} View */
/** @typedef {import("../../types/app").ViewMode} ViewMode */
/** @typedef {ReturnType<typeof extractHeadings>[number]} Heading */

const viewsEl = /** @type {HTMLElement} */ (document.getElementById("views"));
const emptyEl = /** @type {HTMLElement} */ (document.getElementById("empty-state"));

let zoom = 1; // text zoom (Ctrl+wheel): the scale changes, the column reflows
let pageZoom = 1; // page zoom (Shift+wheel): true zoom, no reflow (cf. setPageZoom)
let fitWidth = false; // global display preference: full-width preview (cf. setFitWidth)
let appVersion = ""; // app version (tauri.conf.json), fetched at boot

/** @param {TabsPayload} payload */
function applyTabs(payload) {
  state.tabs = payload.tabs;
  state.active = payload.active ?? null;
  renderTabbar();
  syncViews();
  emptyEl.hidden = state.tabs.length > 0;
  updateTitle();
  if (state.active != null) showActive();
  else updateViewActions();
  refreshGlobalSearch(); // tabs opened/closed: the search results follow
}

function syncViews() {
  const alive = new Set(state.tabs.map((t) => t.id));
  for (const [id, v] of state.views) {
    if (!alive.has(id)) {
      v.el.remove();
      state.views.delete(id);
      state.stale.delete(id);
    }
  }
  for (const t of state.tabs) {
    if (!state.views.has(t.id)) {
      const el = document.createElement("div");
      el.className = "doc-view";
      el.tabIndex = -1; // focusable: PgUp/PgDn/arrows scroll without a prior click
      el.style.display = "none";
      viewsEl.appendChild(el);
      state.views.set(t.id, { el, rendered: false, seq: 0 });
    }
  }
}

async function showActive() {
  // Typed non-null: `null` (no active tab) has no view, exit at the `if (!v)`.
  const id = /** @type {number} */ (state.active);
  closeToc(); // the TOC references the previous tab: close it on change
  for (const [vid, v] of state.views) {
    v.el.style.display = vid === id ? "" : "none";
  }
  const v = state.views.get(id);
  if (!v) return;
  consumePendingOrigin();
  v.el.focus({ preventScroll: true });
  if (!v.rendered || state.stale.has(id)) {
    state.stale.delete(id);
    await renderActive(v, id);
  }
  updateViewActions();
  // Catches up the Plotly figures of a tab rendered while it was hidden, or
  // whose zoom changed while it was inactive (width then not measurable).
  resizePlotlyFigures(v.el);
  consumePendingPlace(v, id);
  consumePendingAnchor(v);
  onActiveViewShown(v, id); // pending search jump / highlighting that follows the tab
  refreshDocSearch(); // the DOM searched by Ctrl+F has just changed
}

// --- Cross-file deep link: `[..](file.md#section)` ---
// The fragment of a relative link to another document is remembered here: the
// backend (`open_link`) opens/activates the tab, then `showActive` scrolls to
// the anchor once the target document is rendered.
/** @type {{ path: string, fragment: string, expires: number } | null} */
let pendingAnchor = null; // { path (normalized), fragment, expires }

// Normalized absolute path for Windows comparison (separators, `..`, case).
/**
 * @param {string} dir
 * @param {string} [rel]
 */
function normPath(dir, rel = "") {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("\\").toLowerCase();
}

// "Line number" fragment, GitHub / VS Code style: `#L75`, range `#L75-L80`
// (only the start counts). Returns the 0-based line (convention of
// `data-line`/`data-source-line`), or null if the fragment is not one.
/**
 * @param {string} fragment
 * @returns {number | null}
 */
function lineFragment(fragment) {
  const m = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment);
  return m ? Math.max(0, Number(m[1]) - 1) : null;
}

// Brings line `line` of the real source to the top of the view, whatever its mode.
/**
 * @param {View} v
 * @param {number} line
 */
function scrollToSourceLine(v, line) {
  if (v.mode === "source") scrollToLine(v.el, "data-line", line);
  else if (v.mode === "derived")
    scrollToLine(v.el, "data-line", v.lineMap ? mdLineForSource(v.lineMap, line) : line);
  else scrollToLine(v.el, "data-source-line", line); // preview: already in real-source lines
}

// Jumps to a fragment in view `v`: an existing `id` wins, otherwise an
// `L<n>` fragment is a line number. Returns false if nothing matches.
/**
 * @param {View} v
 * @param {string} fragment
 * @returns {boolean}
 */
function jumpToFragment(v, fragment) {
  const line = lineFragment(fragment);
  const target =
    v.mode === "source"
      ? null
      : v.el.querySelector(`[id="${CSS.escape(fragment)}"]`) ||
        v.el.querySelector(`[name="${CSS.escape(fragment)}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (line !== null) scrollToSourceLine(v, line);
  else return false;
  return true;
}

/** @param {View} v */
function consumePendingAnchor(v) {
  if (!pendingAnchor) return;
  if (Date.now() > pendingAnchor.expires) {
    pendingAnchor = null;
    return;
  }
  // HTML view (iframe): document out of querySelector's reach, no jump.
  if (v.kind === "html" || !v.path || normPath(v.path) !== pendingAnchor.path) return;
  // Unknown fragment in this document: keep the plain open.
  if (jumpToFragment(v, pendingAnchor.fragment)) pendingAnchor = null;
}

// Reference passed on the command line (`kroki_deskapp.exe doc.tex#eq:x`):
// the backend queues it (`manager::open_file_args`) and only signals — at
// launch, it precedes the listener. Only the last one counts: the last file
// opened becomes active. Generous delay: a cold start loads the engines and
// the plugin worker before the first render.
async function drainPendingAnchors() {
  const last = (await invoke("take_pending_anchors")).at(-1);
  if (!last) return;
  pendingAnchor = {
    path: normPath(last.path),
    fragment: last.fragment,
    expires: Date.now() + 30000,
  };
  // Tab already rendered (document already open): `showActive` ran with
  // nothing to consume. While rendering, it will be the one to consume.
  const v = state.views.get(state.active);
  if (v && v.rendered && !v.rendering) consumePendingAnchor(v);
}

// --- Navigation history: back / forward (mouse buttons 4/5, Alt+←/→) ---
// Each followed link pushes the position left (tab + scroll); going back in
// turn pushes the current position onto the "forward" side. Only the origin
// is remembered on click: the destination is remembered when we leave it,
// which covers a missing fragment or a document opened in a new tab.
/** @typedef {{ docId: number, top: number, left: number }} Place */
/** @type {Place[]} */
const navBack = [];
/** @type {Place[]} */
const navForward = [];
const NAV_MAX = 100;
// Link to another document: the position left is only pushed if a tab is
// displayed afterwards (`showActive`) — a file opened by the system
// application, or a dead link, leaves no entry that would lead nowhere.
/** @type {{ place: Place, expires: number } | null} */
let pendingOrigin = null;
/** @type {Place | null} */
let pendingPlace = null; // position to restore when the target tab is displayed

/** @returns {Place | null} */
function currentPlace() {
  const v = state.active != null ? state.views.get(state.active) : undefined;
  if (!v || state.active == null) return null;
  return { docId: state.active, top: v.el.scrollTop, left: v.el.scrollLeft };
}

/** @param {Place} place */
function pushBack(place) {
  navBack.push(place);
  if (navBack.length > NAV_MAX) navBack.shift();
  navForward.length = 0; // new branch: the old "forward" is void
}

function consumePendingOrigin() {
  if (!pendingOrigin) return;
  if (Date.now() <= pendingOrigin.expires) pushBack(pendingOrigin.place);
  pendingOrigin = null;
}

/** @param {number} dir -1 = back, 1 = forward */
function navigate(dir) {
  const from = dir < 0 ? navBack : navForward;
  const to = dir < 0 ? navForward : navBack;
  const alive = new Set(state.tabs.map((t) => t.id));
  /** @type {Place | undefined} */
  let target;
  // Tab closed or detached into another window since: entry skipped.
  while ((target = from.pop()) && !alive.has(target.docId));
  if (!target) return;
  const here = currentPlace();
  if (here) to.push(here);
  pendingAnchor = null; // a still-pending deep link must not win
  pendingOrigin = null;
  const v = state.views.get(target.docId);
  if (target.docId === state.active && v) {
    restorePlace(v, target);
  } else {
    pendingPlace = target;
    invoke("activate_tab", { docId: target.docId });
  }
}

/**
 * @param {View} v
 * @param {Place} place
 */
function restorePlace(v, place) {
  v.el.scrollTop = place.top;
  v.el.scrollLeft = place.left;
}

/**
 * @param {View} v
 * @param {number} id
 */
function consumePendingPlace(v, id) {
  if (!pendingPlace || pendingPlace.docId !== id) return;
  restorePlace(v, pendingPlace);
  pendingPlace = null;
}

/**
 * Does the view render the preview (the only mode going through markdown-it + KaTeX)?
 * @param {View} v
 */
function isPreview(v) {
  return v.mode !== "source" && v.mode !== "derived";
}

/**
 * @param {View} v
 * @param {number} id
 */
async function renderActive(v, id) {
  const seq = ++v.seq;
  v.rendering = true; // cf. drainPendingAnchors: no jump into a DOM under construction
  beginLoading();
  try {
    await renderActiveInner(v, id, seq);
  } finally {
    if (v.seq === seq) v.rendering = false;
    endLoading();
  }
}

/**
 * @param {View} v
 * @param {number} id
 * @param {number} seq
 */
async function renderActiveInner(v, id, seq) {
  let doc;
  try {
    doc = await invoke("read_document", { docId: id });
  } catch (err) {
    if (v.seq === seq) {
      renderReadError(v.el, err);
      v.rendered = true;
    }
    return;
  }
  if (v.seq !== seq) return;
  v.rendered = true;
  v.path = doc.path; // absolute path: targeting of cross-file deep links
  // Static HTML page (including the app's exports): outside the markdown
  // pipeline — displayed as is in a sandboxed iframe. `v.markdown` stays null,
  // which naturally disarms source/TOC/export/search; the view action stack
  // is hidden (cf. updateViewActions).
  if (isHtmlPath(doc.path)) {
    v.kind = "html";
    v.markdown = null;
    v.sourceText = null;
    v.lineMap = null;
    v.mode = "preview";
    v.dir = doc.dir;
    renderHtmlDocument(v.el, doc.markdown);
    return;
  }
  v.kind = "doc";
  v.sourceText = doc.markdown; // real source (raw markdown or a plugin's format), for the source view
  v.lineMap = null;
  // Extension claimed by a plugin (`document:markdown`): the plugin's worker
  // transforms the source into derived markdown before the usual pipeline
  // (the .tex path via latex-doc, for example). On failure/error, degraded
  // render §7.3: banner + source in a fence — never an empty tab.
  const docPlugin = documentPluginFor(doc.path);
  if (docPlugin) {
    let gen;
    try {
      gen = await pluginTransformDocument(docPlugin, {
        text: doc.markdown,
        path: doc.path,
        dir: doc.dir,
        title: doc.title,
      });
      // Non-blocking plugin warnings: banner at the end of the document
      // (at the top, they would shift all the anchors).
      if (gen.warnings.length) {
        gen.markdown += `\n\n> ⚠️ ${gen.warnings.map((w) => String(w)).join(" · ")}\n`;
      }
    } catch (err) {
      gen = {
        markdown: degradedDocMarkdown(doc.title, err, doc.markdown),
        anchors: /** @type {Anchor[]} */ ([[0, 0]]),
      };
    }
    if (v.seq !== seq) return;
    doc = { ...doc, markdown: gen.markdown, lineMap: gen.anchors };
    v.lineMap = gen.anchors;
  }
  v.markdown = doc.markdown; // kept for the preview ↔ source toggle without re-reading
  v.dir = doc.dir;
  v.domCache = null; // new content: any DOM remembered by renderMode is stale
  if (v.mode === "derived" && !v.lineMap) v.mode = "preview"; // no more transform (plugin removed)
  // The three renders that follow are synchronous (apart from diagram
  // hydration): without this breathing point, the loading overlay would only
  // be painted once the render is finished. Only the preview deserves it —
  // it alone goes through markdown-it + KaTeX + DOMPurify. The source and
  // derived views just split and color text: ~115 ms where the preview takes
  // ~765 on the same document, i.e. an overlay that would flicker instead of
  // informing.
  await beforeHeavyRender(isPreview(v) ? doc.markdown : "");
  if (v.seq !== seq) return;
  await renderMode(v, v.mode);
}

// "Intermediate markdown" debug view: the markdown generated by the plugin
// (document:markdown), displayed raw with the source view's machinery.
/** @param {View} v */
function renderDerived(v) {
  // Always markdown, whatever the original file's format.
  renderSource(v.el, /** @type {string} */ (v.markdown), { lang: "markdown", plugin: null });
  v.el.querySelector(".source-view")?.classList.add("derived-view");
}

/**
 * Displays a mode in the view, reusing the already-built DOM if it exists.
 *
 * Rebuilding the preview of a large document costs ~500 ms — markdown-it, KaTeX,
 * DOMPurify then the insertion of tens of thousands of nodes — and every
 * round trip to the source view paid that price again for identical content.
 * Each mode's DOM is therefore kept and simply reattached. Welcome side
 * effect: already-hydrated diagrams survive the toggle.
 *
 * The cache is cleared by `renderActive`, the only place where the content
 * changes: disk modification, theme or icon changes all go through there via
 * `state.stale`.
 * @param {View} v
 * @param {ViewMode | undefined} mode
 */
async function renderMode(v, mode) {
  // A new view has no `mode` yet: everywhere else `undefined` behaves like
  // "preview", but here it would serve as a distinct cache key — the first
  // render's DOM would be stored under `undefined` and never found again.
  const key = mode === "source" || mode === "derived" ? mode : "preview";
  const cached = v.domCache?.[key];
  if (cached) {
    v.el.replaceChildren(cached);
    return;
  }
  // Synchronous phase: the overlay must be painted before it starts. Only the
  // preview deserves it (cf. renderActive). `markdown`/`dir` are set: called
  // by renderActiveInner after them, or by the toggles that require them non-null.
  await beforeHeavyRender(key === "preview" ? v.markdown : "");
  if (key === "source")
    renderSource(v.el, /** @type {string} */ (v.sourceText ?? v.markdown), sourceHighlightFor(v.path));
  else if (key === "derived") renderDerived(v);
  else
    await renderDocument(v.el, {
      markdown: /** @type {string} */ (v.markdown),
      dir: /** @type {string} */ (v.dir),
      lineMap: v.lineMap,
    });
  (v.domCache ??= {})[key] = v.el.firstElementChild;
}

// --- View actions (TOC + source code toggle) of the active tab ---
const viewActions = /** @type {HTMLElement} */ (document.getElementById("view-actions"));
const sourceBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-source-toggle"));
const derivedBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-derived"));
const fitBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-fit-width"));
const tocBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-toc"));
const tocPanel = /** @type {HTMLElement} */ (document.getElementById("toc-panel"));

// Shows/hides the button stack depending on whether a rendered tab is active, and
// reflects the current mode on the source button. Each button crosses two
// conditions: its relevance for the displayed document, and its activation in
// the settings (`iconEnabled`); the whole stack disappears when there is
// nothing left to show.
function updateViewActions() {
  const v = state.views.get(state.active);
  // HTML view (iframe): no action applies (no source, TOC, export or full
  // width) — the whole stack is hidden.
  const show = !!v && v.rendered && v.kind !== "html";
  let any = false;
  for (const [id, relevant] of /** @type {[string, boolean][]} */ ([
    ["btn-toc", true],
    ["btn-source-toggle", true],
    // "Intermediate markdown" view: only for a document that went through a
    // plugin transform (lineMap present). Disabled by default (cf. icons.js).
    ["btn-derived", !!v?.lineMap],
    ["btn-fit-width", true],
    ["btn-export", true],
  ])) {
    const on = show && relevant && iconEnabled(id);
    /** @type {HTMLElement} */ (document.getElementById(id)).hidden = !on;
    any = any || on;
  }
  viewActions.hidden = !any;
  // Without a button to close it, the TOC must not stay open.
  if (!show || !iconEnabled("btn-toc")) closeToc();
  if (!show) return;
  const isSource = v.mode === "source";
  sourceBtn.classList.toggle("active", isSource);
  updateSourceTitle();
  sourceBtn.setAttribute("aria-pressed", String(isSource));
  const isDerived = v.mode === "derived";
  derivedBtn.classList.toggle("active", isDerived);
  derivedBtn.setAttribute("aria-pressed", String(isDerived));
}

// Source button title: follows the active view's mode and the language.
function updateSourceTitle() {
  if (state.views.get(state.active)?.mode === "source") {
    sourceBtn.title = t("toolbar.source_hide");
  } else {
    sourceBtn.title = t("toolbar.source_show");
  }
}

// Full-width button title: follows the preference and the language.
function updateFitTitle() {
  if (fitWidth) fitBtn.title = t("toolbar.fit_on");
  else fitBtn.title = t("toolbar.fit_off");
}

// --- Table of contents (« sommaire ») of the active tab ---
function closeToc() {
  if (tocPanel.hidden) return;
  tocPanel.hidden = true;
  tocBtn.classList.remove("active");
  tocBtn.setAttribute("aria-expanded", "false");
}

// Goes to the clicked heading: in preview, scrolls to the element by its id (like
// anchors); in source mode, aligns the heading's line at the top (cf. scrollToLine).
/** @param {Heading} h */
function gotoHeading(h) {
  const v = state.views.get(state.active);
  if (!v) return;
  if (v.mode === "source") {
    scrollToLine(v.el, "data-line", h.line);
  } else if (h.slug) {
    const target = v.el.querySelector(`[id="${CSS.escape(h.slug)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    scrollToLine(v.el, "data-source-line", h.line);
  }
}

/** @param {Heading[]} headings */
function buildToc(headings) {
  if (!headings.length) {
    const empty = document.createElement("div");
    empty.className = "toc-empty";
    empty.textContent = t("toc.empty");
    tocPanel.replaceChildren(empty);
    return;
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  const items = headings.map((h) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "toc-item";
    item.dataset.level = String(h.level);
    item.style.paddingLeft = `${8 + (h.level - minLevel) * 14}px`;
    const label = h.text || t("toc.untitled");
    item.textContent = label;
    item.title = label;
    item.addEventListener("click", () => {
      gotoHeading(h);
      closeToc();
    });
    return item;
  });
  tocPanel.replaceChildren(...items);
}

function toggleToc() {
  if (!tocPanel.hidden) {
    closeToc();
    return;
  }
  // Same on-screen anchor: the TOC and the searches are mutually exclusive.
  closeGlobalSearch();
  closeDocSearch();
  const v = state.views.get(state.active);
  if (!v || !v.rendered || v.markdown == null) return;
  let headings = extractHeadings(v.markdown);
  // Document derived by a plugin: realigns the headings' lines on the real source.
  if (v.lineMap) headings = headings.map((h) => ({ ...h, line: remapLine(/** @type {Anchor[]} */ (v.lineMap), h.line) }));
  buildToc(headings);
  tocPanel.hidden = false;
  tocBtn.classList.add("active");
  tocBtn.setAttribute("aria-expanded", "true");
}

async function toggleSource() {
  const id = state.active;
  const v = state.views.get(id);
  if (!v || !v.rendered || v.markdown == null) return;
  // Reference line: in preview it is already expressed in the real source
  // (remapped data-source-line); in the derived (debug) view it is a line of
  // the generated markdown, remapped to the source via the anchors.
  const fromAttr = v.mode === "source" || v.mode === "derived" ? "data-line" : "data-source-line";
  let line = readTopLine(v.el, fromAttr);
  if (v.mode === "derived" && v.lineMap) line = remapLine(v.lineMap, line);
  v.mode = v.mode === "source" ? "preview" : "source";
  beginLoading();
  try {
    // renderMode serves the already-built DOM if it exists, and only puts up
    // the overlay for a real preview render. hydrateDiagrams changes heights:
    // we wait for it to finish before realigning.
    await renderMode(v, v.mode);
  } finally {
    endLoading();
  }
  const toAttr = v.mode === "source" ? "data-line" : "data-source-line";
  scrollToLine(v.el, toAttr, line);
  updateViewActions();
  refreshDocSearch(); // view rebuilt: Ctrl+F's Ranges must be recomputed
}

// --- Debug view: intermediate markdown (debug builds, transformed documents) ---
// Toggles preview/source ↔ markdown generated by the plugin. Position
// alignment goes through the anchors: approximate (per-section granularity),
// good enough for a debugging tool.
/**
 * @param {Anchor[]} anchors
 * @param {number} srcLine
 */
function mdLineForSource(anchors, srcLine) {
  let best = 0;
  for (const [mdLine, s] of anchors) {
    if (s <= srcLine) best = mdLine;
  }
  return best;
}

async function toggleDerived() {
  const v = state.views.get(state.active);
  if (!v || !v.rendered || v.markdown == null || !v.lineMap) return;
  beginLoading();
  try {
    if (v.mode === "derived") {
      const line = readTopLine(v.el, "data-line"); // line of the generated markdown
      v.mode = "preview";
      await renderMode(v, "preview");
      scrollToLine(v.el, "data-source-line", remapLine(v.lineMap, line));
    } else {
      const fromAttr = v.mode === "source" ? "data-line" : "data-source-line";
      const srcLine = readTopLine(v.el, fromAttr); // line of the real source
      v.mode = "derived";
      await renderMode(v, "derived");
      scrollToLine(v.el, "data-line", mdLineForSource(v.lineMap, srcLine));
    }
  } finally {
    endLoading();
  }
  updateViewActions();
  refreshDocSearch();
}

function updateTitle() {
  const active = state.tabs.find((t) => t.id === state.active);
  const base = appVersion ? `Kroki Desk v${appVersion}` : "Kroki Desk";
  const title = active ? `${active.title} — ${base}` : base;
  document.title = title;
  invoke("set_title", { title });
}

// A disabled icon must not leave a view in a state that can no longer be left
// (source mode or intermediate markdown, full-width preview): these views go
// back to the state reachable without a button. Idempotent: without a
// setting change, this pass does nothing.
function enforceIconAvailability() {
  const sourceOn = iconEnabled("btn-source-toggle");
  const derivedOn = iconEnabled("btn-derived");
  for (const v of state.views.values()) {
    if ((v.mode === "source" && !sourceOn) || (v.mode === "derived" && !derivedOn)) {
      v.mode = "preview";
    }
  }
  if (fitWidth && !iconEnabled("btn-fit-width")) setFitWidth(false);
}

function rerenderAll() {
  enforceIconAvailability();
  // Live plugin workers follow the effective theme (spec §6.6);
  // idempotent notification, no cost when nothing changed.
  notifyThemeChanged();
  for (const t of state.tabs) state.stale.add(t.id);
  if (state.active != null) showActive();
}

// Plotly is the only interactive render (hover); its hit-testing breaks under the
// page's CSS `zoom` (cf. app.css). The counter-zoom (var --plotly-inv-zoom) brings
// the effective scale back to 1 (1:1 coordinates); the plot must then be re-fitted
// to the column's real width to avoid overflow when zooming out. This is done via
// relayout(width, height) preserving the aspect ratio — NOT via Plots.resize,
// which takes the container's height (no CSS height) and overwrites it.
/** @param {HTMLElement | undefined} viewEl */
function resizePlotlyFigures(viewEl) {
  const P = window.Plotly;
  if (!P || !viewEl) return;
  // Plotly puts the `js-plotly-plot` class on the target element itself (= the
  // .kroki-diagram), not on a child: so we filter on it directly.
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
    viewEl.querySelectorAll('.kroki-diagram[data-kroki-type="plotly"].js-plotly-plot')
  )) {
    // offsetParent null = hidden view (inactive tab): width measurement
    // invalid, caught up on reactivation (showActive).
    if (el.offsetParent === null) continue;
    const w = el.clientWidth;
    const ratio = parseFloat(/** @type {string} */ (el.dataset.plotlyRatio)); // absent → NaN → ignored
    if (w > 0 && ratio > 0) P.relayout(el, { width: w, height: Math.round(w * ratio) });
  }
}

// The two zooms compose into a single CSS `zoom` on #views. What distinguishes
// them is the views' layout width (`--page-zoom`, cf. app.css): the text zoom
// lets the logical column shrink with the scale (text grows and reflows, a
// full-width figure keeps its on-screen size), the page zoom keeps it at its
// scale-1 width (nothing reflows, everything grows and overflows into
// horizontal scrolling).
function applyZoom() {
  const scale = zoom * pageZoom;
  viewsEl.style.zoom = String(scale);
  viewsEl.style.setProperty("--plotly-inv-zoom", String(1 / scale));
  viewsEl.style.setProperty("--page-zoom", String(pageZoom));
  resizePlotlyFigures(state.views.get(state.active)?.el);
}

/** @param {number} z */
function setZoom(z) {
  zoom = Math.min(3, Math.max(0.4, z));
  applyZoom();
}

// Page zoom around a point: `anchor` = {view, x, y}, cursor position in screen
// pixels relative to the view. The view's layout in logical pixels is the same
// at every scale (cf. --page-w), so the content point under the cursor,
// c = scroll + screen / scale, is invariant: we reset the scroll to bring it
// back there after the scale change. Without an anchor (Ctrl+0), the top-left
// corner stays in place. Clamped to 1: below that, Ctrl+wheel already fits
// more content on screen.
/**
 * @param {number} p
 * @param {{ view: HTMLElement, x: number, y: number } | null} [anchor]
 */
function setPageZoom(p, anchor = null) {
  const next = Math.min(8, Math.max(1, p));
  if (next === pageZoom) return;
  const before = zoom * pageZoom;
  const after = zoom * next;
  const view = anchor?.view ?? state.views.get(state.active)?.el;
  const x = anchor?.x ?? 0;
  const y = anchor?.y ?? 0;
  const cx = view ? view.scrollLeft + x / before : 0;
  const cy = view ? view.scrollTop + y / before : 0;
  pageZoom = next;
  applyZoom();
  if (view) {
    view.scrollLeft = cx - x / after;
    view.scrollTop = cy - y / after;
  }
}

// Global "full width" toggle: the preview drops its reading cap (920px) to fill
// the column. Nothing to recompute on zoom-out — the CSS rule follows the logical
// width. The width change reflows the content (heights move): we remember the
// source line stuck at the top BEFORE, and realign on it AFTER, like the source
// code toggle. Plotly, which freezes its width at layout time, is re-fitted before
// the scroll so that heights are stable when measuring the target.
/** @param {boolean} on */
function setFitWidth(on) {
  fitWidth = on;
  const v = state.views.get(state.active);
  const attr = v?.mode === "source" ? "data-line" : "data-source-line";
  const line = v ? readTopLine(v.el, attr) : 0;
  viewsEl.classList.toggle("fit-width", fitWidth);
  fitBtn.classList.toggle("active", fitWidth);
  fitBtn.setAttribute("aria-pressed", String(fitWidth));
  updateFitTitle();
  if (v) {
    resizePlotlyFigures(v.el);
    scrollToLine(v.el, attr, line);
  }
}

/** @param {number} dir */
function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const idx = state.tabs.findIndex((t) => t.id === state.active);
  const next = state.tabs[(idx + dir + state.tabs.length) % state.tabs.length];
  invoke("activate_tab", { docId: next.id });
}

// --- Links in documents: web → browser, relative .md → tab, anchor → scroll ---

/**
 * Decoded fragment of a link. A `%` that does not introduce a valid sequence
 * (`#100%`, `#a%zz`) would make `decodeURIComponent` throw — the click, already
 * intercepted, would then do nothing: the fragment is kept raw.
 * @param {string} s
 * @returns {string}
 */
function decodeFragment(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function initLinks() {
  /** @type {HTMLElement} */ (document.getElementById("content")).addEventListener("click", (e) => {
    // `closest("a")` (not `a[href]`): graphviz SVGs carry their links as
    // `xlink:href` (diagram nodes linked to another document, clickable).
    const a = /** @type {Element} */ (e.target).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = (a.getAttribute("href") || a.getAttribute("xlink:href") || "").trim();
    if (!href) return;
    if (href.startsWith("#")) {
      const v = state.views.get(state.active);
      const place = currentPlace();
      if (v && jumpToFragment(v, decodeFragment(href.slice(1))) && place) pushBack(place);
      return;
    }
    const dir = state.views.get(state.active)?.el.dataset.dir ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) {
      const place = currentPlace();
      pendingOrigin = place && { place, expires: Date.now() + 5000 };
    }
    // Relative link with fragment (`file.md#section`, link from a diagram
    // node): the backend opens the document, the fragment is remembered to
    // scroll once the target tab is rendered (showActive).
    const hash = href.indexOf("#");
    if (hash > 0 && !/^(https?:|mailto:)/i.test(href)) {
      pendingAnchor = {
        path: normPath(dir, href.slice(0, hash)),
        fragment: decodeFragment(href.slice(hash + 1)),
        expires: Date.now() + 10000,
      };
      invoke("open_link", { baseDir: dir, href: href.slice(0, hash) });
      return;
    }
    invoke("open_link", { baseDir: dir, href });
  });
}

function initShortcuts() {
  window.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      invoke("open_file_dialog");
    } else if (ctrl && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (state.active != null) invoke("close_tab", { docId: state.active });
      else invoke("close_window");
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      invoke("new_window");
    } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggleGlobalSearch();
      // Ctrl+F / F3 / Ctrl+G would trigger the webview's native search bar
      // (unthemed, outside our tab model): we neutralize it by taking over
      // the three shortcuts.
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openDocSearch();
    } else if (e.key === "F3" || (ctrl && e.key.toLowerCase() === "g")) {
      e.preventDefault();
      findNext(e.shiftKey ? -1 : 1);
    } else if (e.altKey && !ctrl && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      navigate(e.key === "ArrowLeft" ? -1 : 1);
    } else if (ctrl && e.key === "Tab") {
      e.preventDefault();
      cycleTab(e.shiftKey ? -1 : 1);
    } else if (ctrl && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      setZoom(zoom * 1.1);
    } else if (ctrl && e.key === "-") {
      e.preventDefault();
      setZoom(zoom / 1.1);
    } else if (ctrl && e.key === "0") {
      e.preventDefault();
      setPageZoom(1);
      setZoom(1);
    } else if (e.key === "F5" || (ctrl && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      if (state.active != null) {
        state.stale.add(state.active);
        showActive();
      }
    } else if (e.key === "Escape" && isDocSearchOpen()) {
      e.preventDefault();
      closeDocSearch();
    } else if (e.key === "Escape" && isGlobalSearchOpen()) {
      e.preventDefault();
      closeGlobalSearch();
    } else if (e.key === "Escape" && !tocPanel.hidden) {
      e.preventDefault();
      closeToc();
    }
  });
  // Mouse side buttons ("back" = 3, "forward" = 4): without preventDefault,
  // the webview would attempt its own history navigation.
  window.addEventListener("mousedown", (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    navigate(e.button === 3 ? -1 : 1);
  });
  /** @type {HTMLElement} */ (document.getElementById("content")).addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(e.deltaY < 0 ? zoom * 1.08 : zoom / 1.08);
        return;
      }
      if (!e.shiftKey) return;
      // Shift+wheel: Chromium (Windows/Linux) then reports the notch on deltaX
      // (native horizontal scrolling, which we replace), other engines on
      // deltaY — we take whichever of the two carries the movement.
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      e.preventDefault();
      const view =
        /** @type {HTMLElement | null | undefined} */ (/** @type {Element} */ (e.target).closest?.(".doc-view")) ??
        state.views.get(state.active)?.el;
      /** @type {{ view: HTMLElement, x: number, y: number } | null} */
      let anchor = null;
      if (view) {
        const box = view.getBoundingClientRect();
        anchor = { view, x: e.clientX - box.left, y: e.clientY - box.top };
      }
      setPageZoom(delta < 0 ? pageZoom * 1.1 : pageZoom / 1.1, anchor);
    },
    { passive: false },
  );
}

async function boot() {
  // Language first of all: the static HTML is translated (and the window
  // unmasked) before the first paint, and the modules initialized afterwards
  // write their texts directly in the right language.
  await initI18n();

  // Theme first: applies the saved override before any render. In "auto" it
  // changes nothing (the first paint already follows @media in pure CSS).
  // initTheme re-tunes the Plotly figures when the system switches in auto mode.
  try {
    applyTheme(await invoke("get_theme"));
  } catch {
    /* default: auto */
  }
  initTheme(rerenderAll);

  // Disabled icons: hidden before the first paint, like the theme.
  try {
    applyIcons(await invoke("get_icons"));
  } catch {
    /* default: the whole registry at its default value */
  }

  try {
    appVersion = await window.__TAURI__.app.getVersion();
  } catch {
    appVersion = ""; // app module unavailable: fall back to the title without a version
  }
  // Plugin registry before the first render: the routing of extensions
  // and fences depends on it. A change (install/removal) re-renders everything.
  await initPlugins(rerenderAll);
  updateSourceTitle(); // dynamic titles: no data-i18n-title (cf. index.html)
  updateFitTitle();
  onLocaleChange(() => {
    updateSourceTitle();
    updateFitTitle();
    closeToc(); // its content (the empty-TOC and untitled-heading labels) is in the old language
  });
  initTabbar();
  initTearDrag();
  initLinks();
  initShortcuts();
  initSettings(rerenderAll);
  initInfo();
  initChangelog();
  initJournal(); // not awaited: off the display's critical path
  initNotices();
  initFindWord();
  initGlobalSearch({
    beforeOpen: () => {
      closeToc();
      closeDocSearch();
    },
  });
  initDocSearch({
    beforeOpen: () => {
      closeToc();
      closeGlobalSearch();
    },
  });
  await initPluginsUi();
  await initFileDrop();
  await initSession();
  initUpdates(); // not awaited: network request, up to 10 s

  /** @type {HTMLElement} */ (document.getElementById("btn-open")).addEventListener("click", () => invoke("open_file_dialog"));
  // Delegation: the link is inside a text translated via innerHTML (`welcome.open_hint`),
  // recreated on every language change — a direct listener would be lost.
  emptyEl.addEventListener("click", (e) => {
    if (/** @type {Element} */ (e.target).closest("#btn-open-empty")) invoke("open_file_dialog");
  });
  /** @type {HTMLElement} */ (document.getElementById("btn-refresh")).addEventListener("click", rerenderAll);
  /** @type {HTMLElement} */ (document.getElementById("btn-new-window")).addEventListener("click", () => invoke("new_window"));
  /** @type {HTMLElement} */ (document.getElementById("btn-settings")).addEventListener("click", openSettings);
  /** @type {HTMLElement} */ (document.getElementById("btn-info")).addEventListener("click", openInfo);
  // Export of the active tab's render: disarmed during the operation (an
  // offscreen re-render can take a few seconds on a large document).
  const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-export"));
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    try {
      await exportActiveView();
    } catch (err) {
      console.error("render export:", err);
    } finally {
      exportBtn.disabled = false;
    }
  });
  sourceBtn.addEventListener("click", toggleSource);
  derivedBtn.addEventListener("click", toggleDerived);
  fitBtn.addEventListener("click", () => setFitWidth(!fitWidth));
  tocBtn.addEventListener("click", toggleToc);
  // Close the TOC as soon as one clicks outside (panel and button excluded).
  document.addEventListener("click", (e) => {
    if (tocPanel.hidden) return;
    if (
      /** @type {Element} */ (e.target).closest("#toc-panel") ||
      /** @type {Element} */ (e.target).closest("#btn-toc")
    )
      return;
    closeToc();
  });

  // Subscribe before reading the initial state: no update can be lost
  // between the two (a detach assigns the tab before the window boots).
  await listen("tabs-updated", (e) => {
    if (e.payload.window !== currentLabel) return;
    applyTabs(e.payload);
  });
  await listen("anchor-request", () => drainPendingAnchors());
  await listen("doc-changed", (e) => {
    if (e.payload.window !== currentLabel) return;
    const id = e.payload.id;
    if (id === state.active) {
      const v = state.views.get(id);
      if (v) renderActive(v, id);
    } else {
      state.stale.add(id);
    }
  });
  // Theme changed in ANOTHER window: the initiating window has already updated
  // locally (cf. settings.js), so we ignore its own echo via `from`.
  await listen("theme-changed", (e) => {
    if (e.payload.from === currentLabel) return;
    applyTheme(e.payload.mode);
    rerenderAll();
  });
  // Language changed in ANOTHER window: same protocol as the theme. The
  // re-render translates the messages inserted into documents (render errors,
  // plugin banners).
  await listen("locale-changed", async (e) => {
    if (e.payload.from === currentLabel) return;
    await loadLocale();
    rerenderAll();
  });
  // Icons changed in ANOTHER window (global setting): same protocol as the
  // theme — the initiating window has already applied it locally.
  await listen("icons-changed", (e) => {
    if (e.payload.from === currentLabel) return;
    applyIcons(e.payload.icons);
    rerenderAll();
  });

  // Before the initial state: the first `showActive` finds the reference of a
  // `kroki_deskapp.exe doc#ref` launch.
  await drainPendingAnchors();
  applyTabs(await invoke("get_window_state"));
}

boot();
