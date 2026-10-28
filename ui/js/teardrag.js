// @ts-check

// Tab drag: reordering within the bar, detaching out of the bar (new window)
// and dropping onto another window of the application (transfer).
//
// Everything relies on pointer capture: Chromium keeps delivering
// pointermove/pointerup to the captured element even outside the window, as
// long as the button stays pressed. The final decision (transfer / detach) is
// made on the Rust side from the cursor's real screen position.

import { invoke } from "./app.js";

const TEAR_MARGIN = 36; // vertical exit from the bar beyond which we detach
const DRAG_THRESHOLD = 5;

const tabbarEl = /** @type {HTMLElement} */ (document.getElementById("tabbar"));
const hintEl = /** @type {HTMLElement} */ (document.getElementById("drag-hint"));

/**
 * Drag in progress. The reordering fields (`order` → `rowTops`) are set
 * by `beginReorder` and only read in the `reorder`/`tear` phases.
 * @typedef {object} DragState
 * @property {number} docId
 * @property {HTMLElement} el
 * @property {string} title
 * @property {number} pointerId
 * @property {number} startX
 * @property {number} startY
 * @property {"press" | "reorder" | "tear"} phase
 * @property {(string | undefined)[]} order
 * @property {DOMRect[]} rects
 * @property {number} startIndex
 * @property {number} curIndex
 * @property {number[]} rowTops
 */

// `null` outside a drag. Typed non-null: the functions below are only called
// during a drag (`if (!drag)` guards in the listeners and `cleanupVisuals`);
// a `DragState | null` type would require an assertion at each of their
// accesses, without checking anything more.
/** @type {DragState} */
let drag = /** @type {DragState} */ (/** @type {unknown} */ (null));

/** @param {PointerEvent} e */
function isInBand(e) {
  const bar = tabbarEl.getBoundingClientRect();
  return (
    e.clientY >= bar.top - TEAR_MARGIN &&
    e.clientY <= bar.bottom + TEAR_MARGIN &&
    e.clientX >= -80 &&
    e.clientX <= window.innerWidth + 80
  );
}

function suppressNextClick() {
  /** @param {Event} e */
  const swallow = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 250);
}

/** @param {HTMLElement} tabsEl */
function beginReorder(tabsEl) {
  const tabs = /** @type {HTMLElement[]} */ ([...tabsEl.children]);
  drag.order = tabs.map((el) => el.dataset.id);
  drag.rects = tabs.map((el) => el.getBoundingClientRect());
  drag.startIndex = tabs.indexOf(drag.el);
  drag.curIndex = drag.startIndex;
  // Bar rows (flex-wrap): distinct tab tops, sorted.
  drag.rowTops = [...new Set(drag.rects.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
  drag.phase = "reorder";
  drag.el.classList.add("dragging");
  document.body.classList.add("tab-dragging");
}

// Index of the row closest to a y coordinate (all tabs have the same height:
// the closest by row center is enough).
/** @param {number} y */
function rowAt(y) {
  const h = drag.rects[0].height;
  let best = 0;
  for (let i = 1; i < drag.rowTops.length; i++) {
    if (Math.abs(y - (drag.rowTops[i] + h / 2)) < Math.abs(y - (drag.rowTops[best] + h / 2))) {
      best = i;
    }
  }
  return best;
}

/** @param {PointerEvent} e */
function updateReorder(e) {
  if (drag.rowTops.length > 1) {
    // Multi-row bar: the tab follows the cursor freely and the target
    // position is the pointer's reading order (row, then x) — no preview by
    // shifting the neighbors, which is wrong as soon as a tab changes row.
    drag.el.style.transform = `translate(${e.clientX - drag.startX}px, ${e.clientY - drag.startY}px)`;
    const pRow = rowAt(e.clientY);
    let target = 0;
    for (let i = 0; i < drag.rects.length; i++) {
      if (i === drag.startIndex) continue;
      const r = drag.rects[i];
      const row = rowAt(r.top + r.height / 2);
      if (row < pRow || (row === pRow && r.left + r.width / 2 < e.clientX)) target++;
    }
    drag.curIndex = target;
    return;
  }

  const dx = e.clientX - drag.startX;
  drag.el.style.transform = `translateX(${dx}px)`;

  const myRect = drag.rects[drag.startIndex];
  const myCenter = myRect.left + myRect.width / 2 + dx;
  let target = 0;
  for (let i = 0; i < drag.rects.length; i++) {
    if (i === drag.startIndex) continue;
    const center = drag.rects[i].left + drag.rects[i].width / 2;
    if (myCenter > center) target++;
  }
  if (target !== drag.curIndex) {
    drag.curIndex = target;
    shiftSiblings();
  }
}

function shiftSiblings() {
  const w = drag.rects[drag.startIndex].width;
  const tabs = /** @type {HTMLElement[]} */ ([.../** @type {HTMLElement} */ (drag.el.parentElement).children]);
  tabs.forEach((el, i) => {
    if (el === drag.el) return;
    let offset = 0;
    if (i < drag.startIndex && i >= drag.curIndex) offset = w;
    else if (i > drag.startIndex && i <= drag.curIndex) offset = -w;
    el.style.transform = offset ? `translateX(${offset}px)` : "";
  });
}

function enterTear() {
  drag.phase = "tear";
  drag.el.style.transform = "";
  for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (/** @type {HTMLElement} */ (drag.el.parentElement).children))
    el.style.transform = "";
  drag.el.classList.add("tearing");
  hintEl.textContent = drag.title;
  hintEl.hidden = false;
}

function exitTear() {
  drag.phase = "reorder";
  drag.el.classList.remove("tearing");
  hintEl.hidden = true;
}

/** @param {PointerEvent} e */
function moveHint(e) {
  // The hint is only visible while the cursor is inside the source window;
  // beyond it, only the system cursor remains (accepted limitation).
  const inside =
    e.clientX >= 0 && e.clientX <= window.innerWidth &&
    e.clientY >= 0 && e.clientY <= window.innerHeight;
  hintEl.hidden = !inside;
  if (inside) {
    hintEl.style.left = `${e.clientX + 14}px`;
    hintEl.style.top = `${e.clientY + 18}px`;
  }
}

function cleanupVisuals() {
  if (!drag) return;
  drag.el.classList.remove("dragging", "tearing");
  drag.el.style.transform = "";
  if (drag.el.parentElement) {
    for (const el of /** @type {HTMLCollectionOf<HTMLElement>} */ (drag.el.parentElement.children)) {
      el.style.transform = "";
    }
  }
  document.body.classList.remove("tab-dragging");
  hintEl.hidden = true;
}

export function initTearDrag() {
  const tabsEl = /** @type {HTMLElement} */ (document.getElementById("tabs"));

  tabsEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    if (/** @type {Element} */ (e.target).closest(".tab-close")) return;
    const tab = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (!tab) return;
    const docId = Number(tab.dataset.id);
    if (!tab.classList.contains("active")) invoke("activate_tab", { docId });
    drag = /** @type {DragState} */ ({
      docId,
      el: tab,
      title: tab.querySelector(".tab-title")?.textContent ?? "",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      phase: "press",
    });
    try {
      tab.setPointerCapture(e.pointerId);
    } catch {
      drag = /** @type {DragState} */ (/** @type {unknown} */ (null));
    }
  });

  tabsEl.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.phase === "press") {
      if (
        Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD &&
        Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      beginReorder(tabsEl);
    }
    if (drag.phase === "reorder") {
      if (!isInBand(e)) enterTear();
      else updateReorder(e);
    }
    if (drag.phase === "tear") {
      if (isInBand(e)) {
        exitTear();
        updateReorder(e);
      } else {
        moveHint(e);
      }
    }
  });

  tabsEl.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    cleanupVisuals();
    drag = /** @type {DragState} */ (/** @type {unknown} */ (null));
    if (d.phase === "reorder" && d.curIndex !== d.startIndex) {
      suppressNextClick();
      invoke("reorder_tab", { docId: d.docId, index: d.curIndex });
    } else if (d.phase === "tear") {
      suppressNextClick();
      invoke("finish_tab_drag", { docId: d.docId });
    }
  });

  const cancel = () => {
    if (!drag) return;
    cleanupVisuals();
    drag = /** @type {DragState} */ (/** @type {unknown} */ (null));
  };
  tabsEl.addEventListener("pointercancel", cancel);
  // A rebuild of the bar during a drag detaches the captured element:
  // the capture is lost, so we cancel cleanly.
  tabsEl.addEventListener("lostpointercapture", (e) => {
    if (drag && e.pointerId === drag.pointerId) cancel();
  });
}
