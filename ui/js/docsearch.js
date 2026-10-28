// @ts-check
// Search in the displayed document (Ctrl+F) — replaces the webview's native
// find bar, which was neither themed, nor translated the same way, nor
// consistent with the multi-document search (globalsearch.js). Same layout as
// that one: field, `Aa` `ab` `.*` options stuck to the right of the field,
// close button.
//
// The search runs on what is RENDERED (the active view's DOM), not on the
// source: it therefore follows the current display mode (preview, source code,
// intermediate markdown) without re-reading anything from disk. Highlighting
// goes through the CSS Custom Highlight API (no DOM change, cf. findword.js)
// under two names: all occurrences, and the current one on top.
//
// The current occurrence is remembered PER DOCUMENT (`positions`): going back to
// a tab finds the one reached there, instead of inheriting the rank reached in
// the previous tab. Folded content (closed `<details>` accordions) is not
// searched (cf. textmatch.js); opening or closing an accordion therefore
// re-runs the search, staying on the same occurrence.
//
// Markers (VS Code style): one tick per occurrence on the view's scrollbar
// (`#find-ruler`), at the occurrence's relative height in the document.
// Overlaid on the bar, `pointer-events: none`: the thumb stays grabbable
// through it.

import { state } from "./app.js";
import { t, onLocaleChange } from "./i18n.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher, initSearchToggles } from "./searchopts.js";

/** @typedef {import("../../types/app").View} View */
/** @typedef {import("./searchopts.js").SearchOptions} SearchOptions */

const ALL_NAME = "find-occurrences";
const CURRENT_NAME = "find-current";
const DEBOUNCE_MS = 120;
const MAX_SEED_LEN = 120; // selection taken as the query on open
const RULER_MIN_W = 8; // marker width without a classic scrollbar

const hlSupported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

// Elements from index.html, set by initDocSearch. Before it runs, `bar` and
// `ruler` are undefined: the entry points test for them (`!bar`, `!ruler`).
/** @type {HTMLElement} */
let bar;
/** @type {HTMLInputElement} */
let input;
/** @type {HTMLElement} */
let countEl;
/** @type {HTMLButtonElement} */
let prevBtn;
/** @type {HTMLButtonElement} */
let nextBtn;
/** @type {HTMLButtonElement} */
let closeBtn;
/** @type {HTMLElement} */
let ruler;
/** @type {SearchOptions} */
let opts = { caseSensitive: false, wholeWord: false, regex: false };
/** @type {(() => void) | null} */
let onBeforeOpen = null; // main.js hook: closes the panels sharing the same anchor
let debounceTimer = 0;
/** @type {Range[]} */
let matches = []; // Ranges, in document order
let current = -1;
/** @type {View | null} */
let matchesView = null; // view that `matches` belongs to
// Current occurrence of each document: view → { sig, index }. Only reused for
// the same query and the same options (`sig`).
/** @type {WeakMap<View, { sig: string, index: number }>} */
const positions = new WeakMap();
/** @type {ResizeObserver | null} */
let rulerObserver = null;
let rulerFrame = 0;
let toggleFrame = 0;

function signature() {
  return JSON.stringify([input.value, opts.caseSensitive, opts.wholeWord, opts.regex]);
}

function remember() {
  if (matchesView && current >= 0) positions.set(matchesView, { sig: signature(), index: current });
}

function clearHighlights() {
  if (!hlSupported) return;
  window.CSS.highlights.delete(ALL_NAME);
  window.CSS.highlights.delete(CURRENT_NAME);
}

// The active tab's view, if it is searchable. HTML documents are rendered in a
// sandboxed iframe: its content is unreachable from here (and the
// multi-document search already excludes them).
/** @returns {View | null} */
function searchableView() {
  // `active` null: `get` returns undefined, discarded right after.
  const v = state.views.get(/** @type {number} */ (state.active));
  if (!v || !v.rendered || v.kind === "html") return null;
  return v;
}

function paint() {
  if (!hlSupported) return;
  if (!matches.length) {
    clearHighlights();
    return;
  }
  window.CSS.highlights.set(ALL_NAME, new window.Highlight(...matches));
  const cur = matches[current];
  if (cur) {
    const hl = new window.Highlight(cur);
    hl.priority = 1; // painted on top of the general highlight
    window.CSS.highlights.set(CURRENT_NAME, hl);
  } else {
    window.CSS.highlights.delete(CURRENT_NAME);
  }
}

// "3/12": rank of the current occurrence out of the total.
function counter() {
  return t("docsearch.counter", { current: current + 1, total: matches.length });
}

/**
 * @param {string} text
 * @param {boolean} [error]
 */
function setStatus(text, error = false) {
  countEl.textContent = text;
  countEl.classList.toggle("error", error);
  input.classList.toggle("invalid", error);
}

// Occurrence markers. Rects are in screen pixels, `scrollTop`/`scrollHeight`
// in logical pixels (CSS zoom on `#views`, cf. revealCurrent): an occurrence's
// position is brought back to logical coordinates before being related to the
// document's total height, then to the track's.
function drawRuler() {
  rulerFrame = 0;
  const v = matchesView;
  if (!ruler) return;
  if (!v || !matches.length || v !== searchableView() || !v.el.offsetHeight) {
    ruler.hidden = true;
    ruler.replaceChildren();
    return;
  }
  const el = v.el;
  const box = el.getBoundingClientRect();
  const host = /** @type {HTMLElement} */ (ruler.parentElement).getBoundingClientRect(); // #content
  const scale = box.height / el.offsetHeight || 1;
  const barW = box.width - el.clientWidth * scale; // 0: overlay scrollbar
  const width = barW >= 4 ? barW : RULER_MIN_W;
  const trackH = el.clientHeight * scale; // excluding the horizontal bar (page zoom)
  ruler.style.top = `${box.top - host.top}px`;
  ruler.style.left = `${box.right - host.left - width}px`;
  ruler.style.width = `${width}px`;
  ruler.style.height = `${trackH}px`;
  const full = el.scrollHeight || 1;
  /** @type {Set<number>} */
  const rows = new Set(); // one tick per track pixel, not per occurrence
  /** @type {HTMLElement[]} */
  const ticks = [];
  /** @type {HTMLElement | null} */
  let currentTick = null; // placed last: on top of a tick in the same row
  matches.forEach((range, i) => {
    const r = range.getBoundingClientRect();
    if (!r.height && !r.width) return;
    const y = (r.top - box.top) / scale + el.scrollTop;
    const row = Math.min(Math.max(Math.round((y / full) * trackH), 0), trackH - 2);
    if (i === current) {
      currentTick = tick(row, true);
    } else if (!rows.has(row)) {
      rows.add(row);
      ticks.push(tick(row, false));
    }
  });
  if (currentTick) ticks.push(currentTick);
  ruler.replaceChildren(...ticks);
  ruler.hidden = false;
}

/**
 * @param {number} row
 * @param {boolean} isCurrent
 * @returns {HTMLElement}
 */
function tick(row, isCurrent) {
  const t = document.createElement("div");
  t.className = isCurrent ? "find-tick current" : "find-tick";
  t.style.top = `${row}px`;
  return t;
}

function scheduleRuler() {
  if (!rulerFrame) rulerFrame = requestAnimationFrame(drawRuler);
}

// The markers follow the layout: window resize, zooms, figures hydrated
// afterwards, accordions. The view is observed along with its direct children
// — its own box does not change when the content grows.
function watchRuler() {
  rulerObserver?.disconnect();
  if (!matchesView || !matches.length) {
    scheduleRuler();
    return;
  }
  rulerObserver ??= new ResizeObserver(scheduleRuler);
  rulerObserver.observe(matchesView.el);
  for (const child of matchesView.el.children) rulerObserver.observe(child);
}

// Starting rank after a search. `anchor` (accordion opened or closed, DOM
// unchanged): the same occurrence, or the next one if it was just folded.
// `keepIndex` (tab switch, re-render): the one remembered for this document,
// if the query has not changed since.
/**
 * @param {View} v
 * @param {{ keepIndex?: boolean, anchor?: Range | null }} options
 * @returns {number}
 */
function startIndex(v, { keepIndex, anchor }) {
  if (anchor) {
    const i = matches.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0);
    return i < 0 ? matches.length - 1 : i;
  }
  const saved = keepIndex ? positions.get(v) : null;
  return saved && saved.sig === signature() ? Math.min(saved.index, matches.length - 1) : 0;
}

// Brings the current occurrence to the center of the view if it is not already
// there. `#views` carries a CSS `zoom`: rects are in screen pixels, `scrollTop`
// in logical pixels — hence the scale factor measured on the view itself.
// Both axes are handled: under page zoom (Shift+wheel) the view also scrolls
// horizontally, and an occurrence can be out of view on the right.
/** @param {HTMLElement} viewEl */
function revealCurrent(viewEl) {
  const range = matches[current];
  if (!range) return;
  const rect = range.getBoundingClientRect();
  if (!rect.height && !rect.width) {
    range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "center" });
    return;
  }
  const box = viewEl.getBoundingClientRect();
  const margin = 40;
  const scale = viewEl.clientHeight ? box.height / viewEl.clientHeight : 1;
  if (rect.top < box.top + margin || rect.bottom > box.bottom - margin) {
    viewEl.scrollTop += (rect.top - box.top - (box.height - rect.height) / 2) / (scale || 1);
  }
  if (rect.left < box.left + margin || rect.right > box.right - margin) {
    viewEl.scrollLeft += (rect.left - box.left - (box.width - rect.width) / 2) / (scale || 1);
  }
}

// Re-runs the search on the active view. `keepIndex` reuses the occurrence
// remembered for this document (tab switch, re-render), `anchor` stays on a
// given occurrence (cf. startIndex); otherwise we restart from the 1st.
/** @param {{ keepIndex?: boolean, reveal?: boolean, anchor?: Range | null }} [options] */
function run({ keepIndex = false, reveal = true, anchor = null } = {}) {
  if (!bar || bar.hidden) return;
  matches = [];
  current = -1;
  matchesView = null;
  watchRuler();
  const v = searchableView();
  const query = input.value;
  if (!query) {
    clearHighlights();
    setStatus("");
    updateNav();
    return;
  }
  if (!v) {
    clearHighlights();
    setStatus(state.active == null ? t("docsearch.no_document") : t("docsearch.unavailable_html"));
    updateNav();
    return;
  }
  let re;
  try {
    re = buildMatcher(query, opts);
  } catch {
    clearHighlights();
    setStatus(t("searchopts.invalid_regex"), true);
    updateNav();
    return;
  }
  matches = collectMatchRanges(v.el, re);
  matchesView = v;
  if (matches.length) current = startIndex(v, { keepIndex, anchor });
  remember();
  watchRuler();
  paint();
  setStatus(matches.length ? counter() : t("docsearch.no_result"));
  updateNav();
  if (reveal && matches.length) revealCurrent(v.el);
}

function updateNav() {
  const on = matches.length > 1;
  prevBtn.disabled = !on;
  nextBtn.disabled = !on;
}

/** @param {number} dir  1 next, -1 previous */
function step(dir) {
  if (!matches.length) {
    run();
    return;
  }
  current = (current + dir + matches.length) % matches.length;
  remember();
  paint();
  scheduleRuler();
  setStatus(counter());
  const v = searchableView();
  if (v) revealCurrent(v.el);
}

/** @param {number} [delay] */
function schedule(delay = DEBOUNCE_MS) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => run(), delay);
}

export function isDocSearchOpen() {
  return !!bar && !bar.hidden;
}

export function openDocSearch() {
  if (!bar) return;
  if (bar.hidden) {
    onBeforeOpen?.();
    bar.hidden = false;
  }
  // Current selection as the query, editor-style: a single line fragment,
  // never a whole paragraph.
  const sel = window.getSelection();
  const picked = sel && !sel.isCollapsed ? sel.toString().trim() : "";
  if (picked && picked.length <= MAX_SEED_LEN && !/[\r\n]/.test(picked)) {
    input.value = picked;
  }
  input.focus();
  input.select();
  run();
}

export function closeDocSearch() {
  if (!isDocSearchOpen()) return;
  bar.hidden = true;
  clearTimeout(debounceTimer);
  matches = [];
  current = -1;
  matchesView = null;
  watchRuler();
  clearHighlights();
  // Gives focus back to the active view: PgUp/PgDn/arrows scroll there again.
  state.views.get(/** @type {number} */ (state.active))?.el.focus({ preventScroll: true });
}

export function toggleDocSearch() {
  if (isDocSearchOpen()) closeDocSearch();
  else openDocSearch();
}

/** @param {number} [dir] */
export function findNext(dir = 1) {
  if (!isDocSearchOpen()) {
    openDocSearch();
    return;
  }
  step(dir);
}

// The searched DOM was just replaced (tab switch, mode toggle, re-render): the
// stored `Range`s point to detached nodes, so we recompute.
export function refreshDocSearch() {
  if (!isDocSearchOpen()) return;
  run({ keepIndex: true, reveal: false });
}

/** @param {{ beforeOpen?: () => void }} [hooks] */
export function initDocSearch({ beforeOpen } = {}) {
  onBeforeOpen = beforeOpen ?? null;
  bar = /** @type {HTMLElement} */ (document.getElementById("find-bar"));
  input = /** @type {HTMLInputElement} */ (document.getElementById("find-input"));
  countEl = /** @type {HTMLElement} */ (document.getElementById("find-count"));
  prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById("find-prev"));
  nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById("find-next"));
  closeBtn = /** @type {HTMLButtonElement} */ (document.getElementById("find-close"));
  ruler = /** @type {HTMLElement} */ (document.getElementById("find-ruler"));
  opts = initSearchToggles(/** @type {HTMLElement} */ (document.getElementById("find-opts")), () => run());
  input.addEventListener("input", () => schedule());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounceTimer);
      if (matches.length) step(e.shiftKey ? -1 : 1);
      else run();
    }
  });
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  closeBtn.addEventListener("click", closeDocSearch);
  // The displayed status ("No result"…) follows the language: we re-run the
  // search on the same occurrence rather than memorizing a frozen message.
  onLocaleChange(() => refreshDocSearch());
  // Accordion opened or closed in the view: the searchable set has changed.
  // `toggle` does not bubble, hence the capture; batched per frame, since
  // several `<details>` may flip at once.
  document.addEventListener(
    "toggle",
    (e) => {
      if (!isDocSearchOpen() || toggleFrame) return;
      if (!(e.target instanceof HTMLDetailsElement)) return;
      if (!searchableView()?.el.contains(e.target)) return;
      toggleFrame = requestAnimationFrame(() => {
        toggleFrame = 0;
        // Detached anchor (re-render in the meantime): remembered rank instead.
        const anchor = matches[current];
        run({ reveal: false, keepIndex: true, anchor: anchor?.startContainer.isConnected ? anchor : null });
      });
    },
    true,
  );
}
