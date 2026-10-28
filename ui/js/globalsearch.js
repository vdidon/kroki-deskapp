// @ts-check
// Full-text search across ALL open documents (the window's tabs) — complements
// findword.js, which only highlights in the active view.
// The query is searched in each document's real SOURCE, re-read via
// `read_document` (pure read, no side effects): tabs never displayed or
// modified on disk are covered, without touching the views' render state. The
// resulting line numbers align directly with the source view (`data-line`) and
// with the preview (`data-source-line`, already expressed in the real source
// for plugin-transformed documents).
// Occurrence highlighting reuses the CSS Custom Highlight API (no DOM change,
// cf. findword.js) under a dedicated name.

import { invoke, state, isHtmlPath } from "./app.js";
import { t, getLocale, onLocaleChange } from "./i18n.js";
import { scrollToLine } from "./render.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher, initSearchToggles, iterMatches } from "./searchopts.js";

/** @typedef {import("../../types/app").View} View */
/** @typedef {import("../../types/ipc").TabInfo} TabInfo */
/** @typedef {import("../../types/ipc").Anchor} Anchor */
/** @typedef {import("./searchopts.js").SearchOptions} SearchOptions */
/** @typedef {{ line: number, text: string, spans: [number, number][] }} Hit  0-based line */
/** @typedef {{ hits: Hit[], total: number, capped: boolean, truncated: boolean }} Hits */
/** @typedef {{ tab: TabInfo, error: true } | (Hits & { tab: TabInfo, error?: undefined })} DocResult */

const HIGHLIGHT_NAME = "search-occurrences";
const MIN_LEN = 2; // same threshold as findword: below it, too much noise
const MAX_LINES_PER_DOC = 200; // result lines shown per document
const MAX_PER_LINE = 200; // occurrences counted on a single line
const MAX_TOTAL_PER_DOC = 5000; // safeguard: `.` or `\\s` in regex mode
const EXCERPT_LEN = 88; // max excerpt length, windowed on the 1st occurrence
const DEBOUNCE_MS = 180;

const hlSupported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

// Elements from index.html, set by initGlobalSearch. Before it runs, `panel`
// is undefined: the entry points test for it (`!panel`).
/** @type {HTMLElement} */
let panel;
/** @type {HTMLInputElement} */
let input;
/** @type {HTMLElement} */
let statusEl;
/** @type {HTMLElement} */
let resultsEl;
/** @type {HTMLElement} */
let searchBtn;
/** @type {HTMLElement} */
let closeBtn;
/** @type {SearchOptions} */
let opts = { caseSensitive: false, wholeWord: false, regex: false };
/** @type {(() => void) | null} */
let onBeforeOpen = null; // main.js hook (closes the table of contents, mutually exclusive with the panel)
let seq = 0; // race guard: only the last search launched may display
let debounceTimer = 0;
/** @type {RegExp | null} */
let shownRe = null; // pattern of the displayed results, reused for highlighting
// Jump to a tab that is not active yet: remembered here, consumed by
// `onActiveViewShown` once the target tab is rendered (same mechanism as
// `pendingAnchor` for deep links).
/** @type {{ docId: number, line: number, expires: number } | null} */
let pendingJump = null;
let searchedTabsKey = ""; // tabs covered by the displayed results (ids)

function clearHighlight() {
  if (hlSupported) window.CSS.highlights.delete(HIGHLIGHT_NAME);
}

// Highlights all occurrences of the current query in a view (same Ranges as
// findword.js, cf. textmatch.js, under a distinct highlight name).
/** @param {HTMLElement} viewEl */
function highlightView(viewEl) {
  if (!hlSupported) return;
  if (!shownRe) {
    clearHighlight();
    return;
  }
  const ranges = collectMatchRanges(viewEl, shownRe);
  if (ranges.length === 0) clearHighlight();
  else window.CSS.highlights.set(HIGHLIGHT_NAME, new window.Highlight(...ranges));
}

// Occurrences in a source: one entry per matched line (positions kept for the
// excerpt), total counting all occurrences.
/**
 * @param {string} text
 * @param {RegExp | null} re
 * @returns {Hits}
 */
function findHits(text, re) {
  const lines = String(text).split("\n");
  /** @type {Hit[]} */
  const hits = [];
  let total = 0;
  let matchedLines = 0;
  let capped = false;
  for (let i = 0; i < lines.length; i++) {
    /** @type {[number, number][]} */
    const spans = [];
    for (const m of iterMatches(re, lines[i], MAX_PER_LINE)) {
      spans.push([m.index, m.index + m[0].length]);
    }
    if (!spans.length) continue;
    matchedLines++;
    total += spans.length;
    if (hits.length < MAX_LINES_PER_DOC) hits.push({ line: i, text: lines[i], spans });
    if (total >= MAX_TOTAL_PER_DOC) {
      capped = true;
      break;
    }
  }
  return { hits, total, capped, truncated: matchedLines > MAX_LINES_PER_DOC };
}

// Excerpt of a line, windowed around the first occurrence, occurrences wrapped
// in <mark> (DOM built via textContent: no HTML interpreted).
/**
 * @param {string} lineText
 * @param {[number, number][]} spans  non-empty
 * @returns {HTMLElement}
 */
function excerptEl(lineText, spans) {
  let start = 0;
  if (lineText.length > EXCERPT_LEN) {
    start = Math.max(0, Math.min(spans[0][0] - 24, lineText.length - EXCERPT_LEN));
  }
  const end = start + EXCERPT_LEN;
  const el = document.createElement("span");
  el.className = "search-excerpt";
  if (start > 0) el.append("…");
  let pos = start;
  for (const [s, e] of spans) {
    if (e <= start) continue;
    if (s >= end) break;
    const from = Math.max(s, pos);
    const to = Math.min(e, end);
    if (to <= from) continue;
    el.append(lineText.slice(pos, from));
    const mark = document.createElement("mark");
    mark.textContent = lineText.slice(from, to);
    el.append(mark);
    pos = to;
  }
  el.append(lineText.slice(pos, end));
  if (end < lineText.length) el.append("…");
  return el;
}

// Line of the generated markdown matching a source line (debug "derived" view:
// the data-line values there refer to the plugin's markdown).
/**
 * @param {Anchor[]} anchors
 * @param {number} srcLine
 * @returns {number}
 */
function mdLineForSource(anchors, srcLine) {
  let best = 0;
  for (const [mdLine, s] of anchors) {
    if (s <= srcLine) best = mdLine;
  }
  return best;
}

// Brings source line `line` to the top of the view, whatever its mode.
/**
 * @param {View | undefined} v
 * @param {number} line
 */
function scrollToHit(v, line) {
  if (!v || !v.rendered) return;
  let attr = "data-source-line"; // preview: already expressed in the real source
  if (v.mode === "source") attr = "data-line";
  else if (v.mode === "derived") {
    attr = "data-line";
    if (v.lineMap) line = mdLineForSource(v.lineMap, line);
  }
  scrollToLine(v.el, attr, line);
  highlightView(v.el);
}

/**
 * @param {number} docId
 * @param {number} line
 */
function jumpTo(docId, line) {
  if (docId === state.active) {
    scrollToHit(state.views.get(docId), line);
    return;
  }
  pendingJump = { docId, line, expires: Date.now() + 10000 };
  invoke("activate_tab", { docId });
}

// Called by showActive (main.js) once the active tab is rendered: consumes a
// pending jump, otherwise makes the highlight follow the displayed view.
/**
 * @param {View} v
 * @param {number} id
 */
export function onActiveViewShown(v, id) {
  if (!panel || panel.hidden) return;
  if (pendingJump && pendingJump.docId === id) {
    const { line, expires } = pendingJump;
    pendingJump = null;
    if (Date.now() <= expires) {
      scrollToHit(v, line);
      return;
    }
  }
  if (shownRe) highlightView(v.el);
}

/** @param {DocResult[]} results */
function renderResults(results) {
  const scrollTop = resultsEl.scrollTop; // refresh: do not lose the position
  const frag = document.createDocumentFragment();
  let total = 0;
  let docCount = 0;
  let anyTruncated = false;
  let anyCapped = false;
  for (const r of results) {
    if (r.error) {
      const group = document.createElement("div");
      group.className = "search-group";
      const head = document.createElement("div");
      head.className = "search-doc";
      head.textContent = r.tab.title;
      const note = document.createElement("div");
      note.className = "search-note";
      note.textContent = t("globalsearch.unreadable");
      group.append(head, note);
      frag.append(group);
      continue;
    }
    if (!r.hits.length) continue;
    total += r.total;
    docCount++;
    anyTruncated ||= r.truncated;
    anyCapped ||= r.capped;
    const group = document.createElement("div");
    group.className = "search-group";
    const head = document.createElement("div");
    head.className = "search-doc";
    head.title = r.tab.path || r.tab.title;
    head.textContent = r.tab.title;
    const count = document.createElement("span");
    count.className = "search-count";
    count.textContent = formatCount(r.total);
    head.append(count);
    group.append(head);
    for (const h of r.hits) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-hit";
      const lineNo = document.createElement("span");
      lineNo.className = "search-lineno";
      lineNo.textContent = String(h.line + 1);
      btn.append(lineNo, excerptEl(h.text, h.spans));
      btn.addEventListener("click", () => jumpTo(r.tab.id, h.line));
      group.append(btn);
    }
    if (r.truncated) {
      const note = document.createElement("div");
      note.className = "search-note";
      note.textContent = t("globalsearch.lines_limited", { max: MAX_LINES_PER_DOC });
      group.append(note);
    }
    frag.append(group);
  }
  resultsEl.replaceChildren(frag);
  resultsEl.scrollTop = scrollTop;
  if (!state.tabs.length) statusEl.textContent = t("globalsearch.no_open_document");
  else if (total === 0) statusEl.textContent = t("globalsearch.no_result");
  else statusEl.textContent = summaryText(total, docCount, anyCapped ? "capped" : anyTruncated ? "truncated" : "");
}

// Displayed number, with the current language's thousands separators.
/** @param {number} n */
function formatCount(n) {
  return n.toLocaleString(getLocale());
}

// Summary "N occurrences in M documents (note)". One sentence per combination
// (single document or not × note): the catalog's plural only applies to
// `count` (the occurrences), and translated fragments are never glued together.
/**
 * @param {number} total
 * @param {number} docCount
 * @param {"capped" | "truncated" | ""} note
 * @returns {string}
 */
function summaryText(total, docCount, note) {
  const p = { count: total, total: formatCount(total), docs: formatCount(docCount) };
  if (docCount === 1) {
    if (note === "capped") return t("globalsearch.summary_one_doc_capped", p);
    if (note === "truncated") return t("globalsearch.summary_one_doc_truncated", p);
    return t("globalsearch.summary_one_doc", p);
  }
  if (note === "capped") return t("globalsearch.summary_docs_capped", p);
  if (note === "truncated") return t("globalsearch.summary_docs_truncated", p);
  return t("globalsearch.summary_docs", p);
}

// Clears the results; a non-empty `status` = error message (invalid pattern).
/** @param {string} [status] */
function clearResults(status = "") {
  shownRe = null;
  resultsEl.replaceChildren();
  statusEl.textContent = status;
  statusEl.classList.toggle("error", !!status);
  input.classList.toggle("invalid", !!status);
  clearHighlight();
}

async function runSearch() {
  const raw = input.value.trim();
  const mySeq = ++seq;
  // A useful regular expression is sometimes a single character (`.`); a
  // single-character literal, on the other hand, would only be noise.
  if (raw.length < (opts.regex ? 1 : MIN_LEN)) {
    clearResults();
    return;
  }
  let re;
  try {
    re = buildMatcher(raw, opts);
  } catch {
    clearResults(t("searchopts.invalid_regex"));
    return;
  }
  statusEl.classList.remove("error");
  input.classList.remove("invalid");
  searchedTabsKey = state.tabs.map((t) => t.id).join(",");
  // HTML tabs (iframe) are excluded: searching their raw markup would be
  // noise, and jumping to a line makes no sense inside the iframe.
  const results = await Promise.all(
    state.tabs.filter((t) => !isHtmlPath(t.path)).map(
      /** @returns {Promise<DocResult>} */
      async (tab) => {
        try {
          const doc = await invoke("read_document", { docId: tab.id });
          return { tab, ...findHits(doc.markdown, re) };
        } catch {
          return { tab, error: true };
        }
      },
    ),
  );
  if (mySeq !== seq || panel.hidden) return; // newer search or panel closed
  shownRe = re;
  renderResults(results);
  // `active` null: `get` returns undefined.
  const v = state.views.get(/** @type {number} */ (state.active));
  if (v) highlightView(v.el);
}

/** @param {number} [delay] */
function scheduleSearch(delay = DEBOUNCE_MS) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, delay);
}

export function isGlobalSearchOpen() {
  return !!panel && !panel.hidden;
}

export function openGlobalSearch() {
  if (!panel.hidden) {
    input.focus();
    input.select();
    return;
  }
  onBeforeOpen?.();
  panel.hidden = false;
  searchBtn.classList.add("active");
  input.focus();
  input.select();
  if (input.value.trim()) scheduleSearch(0);
}

export function closeGlobalSearch() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  searchBtn.classList.remove("active");
  seq++; // invalidates a search still in flight
  clearTimeout(debounceTimer);
  pendingJump = null;
  shownRe = null;
  clearHighlight();
  // Gives focus back to the active view: PgUp/PgDn/arrows scroll there again.
  state.views.get(/** @type {number} */ (state.active))?.el.focus({ preventScroll: true });
}

export function toggleGlobalSearch() {
  if (isGlobalSearchOpen()) closeGlobalSearch();
  else openGlobalSearch();
}

// Tabs opened/closed while the panel is displayed: the results follow (called
// by applyTabs). A mere active-tab change re-runs nothing: the list of covered
// documents has not moved.
export function refreshGlobalSearch() {
  if (!isGlobalSearchOpen()) return;
  if (state.tabs.map((t) => t.id).join(",") === searchedTabsKey) return;
  scheduleSearch(0); // runSearch also handles a too-short query
}

/** @param {{ beforeOpen?: () => void }} [hooks] */
export function initGlobalSearch({ beforeOpen } = {}) {
  onBeforeOpen = beforeOpen ?? null;
  panel = /** @type {HTMLElement} */ (document.getElementById("search-panel"));
  input = /** @type {HTMLInputElement} */ (document.getElementById("search-input"));
  statusEl = /** @type {HTMLElement} */ (document.getElementById("search-status"));
  resultsEl = /** @type {HTMLElement} */ (document.getElementById("search-results"));
  searchBtn = /** @type {HTMLElement} */ (document.getElementById("btn-search"));
  closeBtn = /** @type {HTMLElement} */ (document.getElementById("search-close"));
  opts = initSearchToggles(/** @type {HTMLElement} */ (document.getElementById("search-opts")), () => scheduleSearch(0));
  searchBtn.addEventListener("click", toggleGlobalSearch);
  // Displayed status, notes and summary: a new search rebuilds them in the
  // current language (results refreshed, scroll position kept).
  onLocaleChange(() => {
    if (isGlobalSearchOpen()) scheduleSearch(0);
  });
  closeBtn.addEventListener("click", closeGlobalSearch);
  input.addEventListener("input", () => scheduleSearch());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      scheduleSearch(0);
    }
  });
}
