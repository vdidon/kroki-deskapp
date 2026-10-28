// @ts-check

// Tab bar: rendering (minimal diff so as not to break a drag in progress) and actions.

import { invoke, state } from "./app.js";
import { showToast } from "./session.js";
import { t, applyLocale, onLocaleChange } from "./i18n.js";

/** @typedef {import("../../types/ipc").TabInfo} TabInfo */

const tabsEl = /** @type {HTMLElement} */ (document.getElementById("tabs"));
const tabbarEl = /** @type {HTMLElement} */ (document.getElementById("tabbar"));
const actionsEl = /** @type {HTMLElement} */ (document.getElementById("tabbar-actions"));

/** @param {TabInfo} tab */
function buildTab(tab) {
  const el = document.createElement("div");
  el.className = "tab";
  el.dataset.id = String(tab.id);
  el.title = tab.path;

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title; // file names = untrusted content: never innerHTML
  el.appendChild(title);

  const close = document.createElement("button");
  close.className = "tab-close";
  close.dataset.i18nTitle = "tabs.close"; // re-translated by applyLocale(tabsEl) on language change
  close.title = t("tabs.close");
  close.textContent = "×";
  el.appendChild(close);

  return el;
}

/**
 * Syncs the DOM with `state.tabs`. If the list of ids has not changed,
 * updates classes and titles in place: a rebuild would detach the tab being
 * dragged (losing the pointer capture).
 */
export function renderTabbar() {
  const current = /** @type {HTMLElement[]} */ ([...tabsEl.children]).map((el) => el.dataset.id);
  const wanted = state.tabs.map((t) => String(t.id));
  const sameStructure =
    current.length === wanted.length && current.every((id, i) => id === wanted[i]);

  if (!sameStructure) {
    tabsEl.replaceChildren(...state.tabs.map(buildTab));
  }
  for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (tabsEl.children)) {
    const tab = state.tabs.find((t) => String(t.id) === el.dataset.id);
    if (!tab) continue;
    el.classList.toggle("active", state.active === tab.id);
    const title = /** @type {HTMLElement} */ (el.querySelector(".tab-title"));
    if (title.textContent !== tab.title) title.textContent = tab.title;
    if (el.title !== tab.path) el.title = tab.path;
  }
  updateTabbarWrap();
}

/**
 * Tabs keep their natural width and overflow onto a 2nd line via the inline
 * layout of `#tabs` (CSS): the 1st line wraps around the float of the action
 * buttons, the following ones take the full width. Here we only handle
 * saturation: if the natural widths — full titles, capped by the CSS
 * max-width — would need more than 2 lines, we set `--tab-max` (the largest
 * uniform width that makes all the tabs fit greedily on the 2 lines, with
 * unequal widths) and title truncation kicks in, on exactly 2 lines.
 * Measurements always start from the natural widths (cap removed first): the
 * threshold does not depend on the current state, so no oscillation.
 */
export function updateTabbarWrap() {
  if (document.body.classList.contains("tab-dragging")) return; // geometry frozen during a drag
  tabsEl.style.removeProperty("--tab-max");
  const tabs = /** @type {HTMLElement[]} */ ([...tabsEl.children]);
  if (!tabs.length) return;

  const maxTab = parseFloat(getComputedStyle(tabs[0]).maxWidth) || Infinity;
  const gap = parseFloat(getComputedStyle(tabs[0]).marginRight) || 0;
  const naturals = tabs.map((el) => {
    const title = /** @type {HTMLElement} */ (el.querySelector(".tab-title"));
    // Non-title width (paddings + cross): constant whether the tab is
    // compressed or not, the title alone absorbing the compression (flex: 1).
    const chrome = el.getBoundingClientRect().width - title.getBoundingClientRect().width;
    return Math.min(maxTab, chrome + title.scrollWidth + 1); // +1: scrollWidth is truncated to an integer
  });

  // Line widths: the 1st is reduced by the buttons' float, the others are full.
  const fullW = tabsEl.clientWidth;
  const firstW = fullW - actionsEl.getBoundingClientRect().width;

  // Number of lines the inline (greedy) placement would take. A tab too wide
  // for the space left next to the float goes below it.
  let lines = 1;
  let x = 0;
  for (const w of naturals) {
    const lineW = lines === 1 ? firstW : fullW;
    if (x + (x > 0 ? gap : 0) + w > lineW && (x > 0 || lines === 1)) {
      lines++;
      x = w;
    } else {
      x += (x > 0 ? gap : 0) + w;
    }
  }
  if (lines <= 2) return;

  // Largest uniform cap that fits in 2 lines: for each split (k tabs on
  // line 1, n−k on line 2), the cap is bounded by the tightest line; we keep
  // the best. The greedy placement then respects these bounds: line 1 takes
  // at least k tabs (cap ≤ its bound), the rest — at most n−k — fits on
  // line 2; tabs shorter than the cap only leave more room.
  const n = naturals.length;
  let cap = 0;
  for (let k = 1; k < n; k++) {
    const c = Math.min((firstW - (k - 1) * gap) / k, (fullW - (n - k - 1) * gap) / (n - k));
    if (c > cap) cap = c;
  }
  tabsEl.style.setProperty("--tab-max", `${Math.floor(Math.min(cap, maxTab))}px`);
}

export function initTabbar() {
  // Window resize (and end of a drag): re-evaluate the wrap.
  new ResizeObserver(updateTabbarWrap).observe(tabbarEl);
  tabsEl.addEventListener("click", (e) => {
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (!tabEl) return;
    const docId = Number(tabEl.dataset.id);
    if (/** @type {Element} */ (e.target).closest(".tab-close")) {
      invoke("close_tab", { docId });
    }
    // Activation happens on pointerdown (see teardrag.js), like Chrome.
  });
  // Middle click: close.
  tabsEl.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (tabEl) invoke("close_tab", { docId: Number(tabEl.dataset.id) });
  });
  initTabMenu();
  // The tabs' close buttons are built by JS: they are not covered by
  // applyLocale(document) on the static HTML, so we apply it to them separately.
  onLocaleChange(() => applyLocale(tabsEl));
}

// --- Tab context menu (right click) ---

const menuEl = /** @type {HTMLElement} */ (document.getElementById("tab-menu"));
/** @type {number | null} */
let menuDocId = null;

/** Clipboard: async API, execCommand fallback if the webview refuses it
 *  (context deemed insecure, possible under WebKitGTK).
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) {
      showToast(t("tabs.copy_failed"), true);
      return;
    }
  }
  showToast(t("tabs.path_copied"));
}

function closeTabMenu() {
  menuEl.hidden = true;
  menuDocId = null;
}

/**
 * @param {HTMLElement} tabEl
 * @param {number} x
 * @param {number} y
 */
function openTabMenu(tabEl, x, y) {
  const idx = [...tabsEl.children].indexOf(tabEl);
  const count = tabsEl.children.length;
  menuDocId = Number(tabEl.dataset.id);
  /** @type {Record<string, boolean>} */
  const disabled = {
    detach: count === 1, // only tab: the new window would be the same
    left: idx === 0,
    right: idx === count - 1,
    others: count === 1,
  };
  for (const item of menuEl.querySelectorAll("button")) {
    item.disabled = !!disabled[/** @type {string} */ (item.dataset.action)]; // data-action on every button (index.html)
  }
  menuEl.hidden = false;
  // Measured once displayed: repositioned inside the window near the right and bottom edges.
  const { width, height } = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(0, Math.min(x, innerWidth - width - 4))}px`;
  menuEl.style.top = `${Math.max(0, Math.min(y, innerHeight - height - 4))}px`;
}

function initTabMenu() {
  tabsEl.addEventListener("contextmenu", (e) => {
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (!tabEl) return;
    e.preventDefault(); // no native webview menu
    openTabMenu(tabEl, e.clientX, e.clientY);
  });
  menuEl.addEventListener("click", (e) => {
    const item = /** @type {Element} */ (e.target).closest("button");
    if (!item || item.disabled || menuDocId == null) return;
    const docId = menuDocId;
    const action = /** @type {string} */ (item.dataset.action);
    closeTabMenu();
    if (action === "copy-path") {
      const tab = state.tabs.find((t) => t.id === docId);
      if (tab) copyText(tab.path);
    } else if (action === "reveal") {
      invoke("reveal_tab_file", { docId }).catch((err) => showToast(String(err), true));
    } else if (action === "detach") {
      invoke("detach_tab", { docId });
    } else if (action === "duplicate") {
      invoke("duplicate_tab", { docId });
    } else {
      invoke("close_tabs_around", { docId, side: action });
    }
  });
  menuEl.addEventListener("contextmenu", (e) => e.preventDefault());
  // Any click outside the menu closes it (capture: before the tab drag).
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!menuEl.hidden && !menuEl.contains(/** @type {Node | null} */ (e.target))) closeTabMenu();
    },
    true,
  );
  // Capture + stopPropagation: Escape closes the menu without also closing
  // the search or the table of contents (main.js listener, in the bubbling phase).
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || menuEl.hidden) return;
      e.stopPropagation();
      e.preventDefault();
      closeTabMenu();
    },
    true,
  );
  window.addEventListener("blur", closeTabMenu);
  window.addEventListener("resize", closeTabMenu);
}
