// @ts-check

// Uncommitted-change marks: what differs from the repository's `HEAD`
// (`git_changes`, git.rs) is highlighted in the rendered document and in the
// source view — green for added lines, yellow for modified ones — and a dot
// flags the tab with the state of the **file**: green when it is new (absent
// from `HEAD`: nothing is marked inside, every line would be green), yellow
// when it is modified, red when the file of `HEAD` was deleted. Deleted lines
// mark nothing in the document (no element to carry them), but they still
// turn the dot yellow.
//
// Pure decoration laid **after** rendering, as two classes on existing
// elements: no node is added, so the three searches, the preview ↔ source
// alignment and the scroll position are untouched, and a commit only
// re-reads the marks (`git-changed`) without re-rendering anything.

import { invoke, state } from "./app.js";

/** @typedef {import("../../types/ipc").GitChanges} GitChanges */
/** @typedef {import("../../types/app").View} View */

const ADDED = 1;
const MODIFIED = 2;
const CLASSES = ["git-added", "git-modified"];

let enabled = true;
/** @type {Map<number, GitChanges | null>} last answer per document */
const changes = new Map();
/** @type {Map<number, number>} request number per document: a late answer is dropped */
const requests = new Map();

/**
 * State of a tab for its dot: `deleted` (file gone from disk), `added` (new
 * file, absent from `HEAD`), `modified` as soon as one line of a known file is
 * added, modified or deleted, otherwise `null` (nothing to report).
 * @param {number} id
 * @returns {"added" | "modified" | "deleted" | null}
 */
export function gitStatusOf(id) {
  const c = changes.get(id);
  if (!c) return null;
  if (c.deleted) return "deleted";
  if (c.created) return "added";
  return c.added.length || c.modified.length || c.removed ? "modified" : null;
}

/** @param {boolean} on */
export function setGitMarksEnabled(on) {
  if (on === enabled) return;
  enabled = on;
  if (on) refreshAllGitMarks();
  else {
    changes.clear();
    for (const t of state.tabs) paint(t.id);
  }
}

/** Re-reads the marks of every tab of the window (commit, focus, setting). */
export function refreshAllGitMarks() {
  for (const t of state.tabs) refreshGitMarks(t.id);
}

/**
 * Re-reads the marks of a document, then repaints its tab and its view.
 * @param {number} id
 */
export async function refreshGitMarks(id) {
  if (!enabled) return;
  const req = (requests.get(id) ?? 0) + 1;
  requests.set(id, req);
  /** @type {GitChanges | null} */
  let c = null;
  try {
    c = await invoke("git_changes", { docId: id });
  } catch {
    /* tab closed in the meantime, unreadable file: no marks */
  }
  if (requests.get(id) !== req || !state.tabs.some((t) => t.id === id)) return;
  changes.set(id, c);
  paint(id);
}

/** @param {number} id closed tab */
export function forgetGitMarks(id) {
  changes.delete(id);
  requests.delete(id);
}

/**
 * Lays the known marks on a view's DOM — every mode it keeps in cache, so
 * that a cached DOM reattached later is never behind (cf. `renderMode`).
 * @param {number} id
 */
export function paintView(id) {
  const v = state.views.get(id);
  if (!v || v.kind === "html") return;
  const roots = new Set(Object.values(v.domCache ?? {}));
  if (v.el.firstElementChild) roots.add(v.el.firstElementChild);
  for (const root of roots) if (root) markRoot(root, v, changes.get(id) ?? null);
}

/**
 * `paintView` for a view object (`renderMode` knows the view, not its id).
 * @param {View} v
 */
export function paintViewOf(v) {
  for (const [id, x] of state.views) if (x === v) paintView(id);
}

/** @param {number} id */
function paint(id) {
  const tab = /** @type {HTMLElement | null} */ (document.querySelector(`#tabs .tab[data-id="${id}"]`));
  if (tab) paintTab(tab, id);
  paintView(id);
}

/**
 * @param {HTMLElement} el `.tab` element
 * @param {number} id
 */
export function paintTab(el, id) {
  const status = gitStatusOf(id);
  if (status) el.dataset.git = status;
  else delete el.dataset.git;
}

/**
 * Kind of each source line (0 = unchanged). `skipBlank`: in the rendered
 * document a blank line is only a separator — an added or emptied blank line
 * would otherwise light up the block before it.
 * @param {GitChanges} c
 * @param {string[]} lines
 * @param {boolean} skipBlank
 */
function lineKinds(c, lines, skipBlank) {
  const kinds = new Uint8Array(lines.length);
  /** @param {[number, number][]} ranges @param {number} kind */
  const fill = (ranges, kind) => {
    for (const [s, e] of ranges) {
      for (let i = s; i < Math.min(e, lines.length); i++) {
        if (!skipBlank || lines[i].trim()) kinds[i] = kind;
      }
    }
  };
  fill(c.added, ADDED);
  fill(c.modified, MODIFIED);
  return kinds;
}

/**
 * Strongest kind over `[start, end)`, ignoring the sub-ranges in `holes`.
 * @param {Uint8Array} kinds
 * @param {number} start
 * @param {number} end
 * @param {[number, number][]} [holes]
 */
function kindOver(kinds, start, end, holes = []) {
  let k = 0;
  for (let i = Math.max(0, start); i < Math.min(end, kinds.length); i++) {
    if (kinds[i] > k && !holes.some(([s, e]) => i >= s && i < e)) {
      k = kinds[i];
      if (k === MODIFIED) break;
    }
  }
  return k;
}

/**
 * @param {Element} el
 * @param {number} kind
 */
function mark(el, kind) {
  if (kind) el.classList.add(CLASSES[kind - 1]);
}

/** @param {string | null} attr `"start end"` of `data-src-item` */
function itemRange(attr) {
  const [s, e] = String(attr).split(" ").map(Number);
  return /** @type {[number, number]} */ ([s || 0, e || 0]);
}

/**
 * @param {Element} root a view's top element (`article`, `.source-view`)
 * @param {View} v
 * @param {GitChanges | null} c
 */
function markRoot(root, v, c) {
  for (const el of root.querySelectorAll(".git-added, .git-modified")) el.classList.remove(...CLASSES);
  if (!c || (!c.added.length && !c.modified.length)) return;
  const lines = String(v.sourceText ?? "").split("\n");

  if (root.classList.contains("source-view")) {
    // The intermediate markdown is not the file: its lines are not git's.
    if (root.classList.contains("derived-view")) return;
    const kinds = lineKinds(c, lines, false);
    for (const el of root.children) {
      mark(el, kinds[Number(/** @type {HTMLElement} */ (el).dataset.line)] ?? 0);
    }
    return;
  }

  // Rendered document: a root-level block spans from its first line to the
  // next block's (blank separators included, they are skipped by lineKinds).
  const kinds = lineKinds(c, lines, true);
  const blocks = [...root.querySelectorAll("[data-source-line]")];
  const starts = blocks.map((b) => Number(b.getAttribute("data-source-line")) || 0);
  // End = start of the next block beginning further down. Remapped
  // documents (plugins) can give consecutive blocks the same start: they then
  // share the end of the next distinct one. Backward pass, linear.
  const ends = new Array(starts.length);
  for (let i = starts.length - 1; i >= 0; i--) {
    const next = i + 1 < starts.length ? starts[i + 1] : lines.length;
    ends[i] = next > starts[i] || i + 1 === starts.length ? next : ends[i + 1];
  }
  blocks.forEach((block, i) => {
    const start = starts[i];
    const end = ends[i];
    if (!kindOver(kinds, start, end)) return;
    // A list is marked item by item: each item on its own lines (its
    // sub-items excluded, they are marked themselves), the block only for
    // what lies outside its items.
    const items = [...block.querySelectorAll("[data-src-item]")];
    if (block.matches("[data-src-item]")) items.unshift(block);
    if (!items.length) {
      mark(block, kindOver(kinds, start, end));
      return;
    }
    /** @type {[number, number][]} */
    const outer = [];
    for (const item of items) {
      const range = itemRange(item.getAttribute("data-src-item"));
      const inner = [...item.querySelectorAll("[data-src-item]")].map((s) =>
        itemRange(s.getAttribute("data-src-item")),
      );
      mark(item, kindOver(kinds, range[0], range[1], inner));
      outer.push(range);
    }
    mark(block, kindOver(kinds, start, end, outer));
  });
}
