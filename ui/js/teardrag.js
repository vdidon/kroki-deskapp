// Drag d'onglets : réordonnancement dans la barre, détachement hors de la barre
// (nouvelle fenêtre) et dépôt sur une autre fenêtre de l'application (transfert).
//
// Tout repose sur la capture de pointeur : Chromium continue de délivrer les
// pointermove/pointerup à l'élément capturé même hors de la fenêtre, tant que
// le bouton reste enfoncé. La décision finale (transfert / détachement) est
// prise côté Rust à partir de la position écran réelle du curseur.

import { invoke } from "./app.js";

const TEAR_MARGIN = 36; // sortie verticale de la barre au-delà de laquelle on détache
const DRAG_THRESHOLD = 5;

const tabbarEl = document.getElementById("tabbar");
const hintEl = document.getElementById("drag-hint");

let drag = null;

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
  const swallow = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 250);
}

function beginReorder(tabsEl) {
  const tabs = [...tabsEl.children];
  drag.order = tabs.map((el) => el.dataset.id);
  drag.rects = tabs.map((el) => el.getBoundingClientRect());
  drag.startIndex = tabs.indexOf(drag.el);
  drag.curIndex = drag.startIndex;
  // Lignes de la barre (flex-wrap) : tops distincts des onglets, triés.
  drag.rowTops = [...new Set(drag.rects.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
  drag.phase = "reorder";
  drag.el.classList.add("dragging");
  document.body.classList.add("tab-dragging");
}

// Index de la ligne la plus proche d'une ordonnée (les onglets font tous la
// même hauteur : la plus proche par le centre de ligne suffit).
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

function updateReorder(e) {
  if (drag.rowTops.length > 1) {
    // Barre sur plusieurs lignes : l'onglet suit librement le curseur et la
    // position cible est l'ordre de lecture (ligne, puis x) du pointeur —
    // pas d'aperçu par décalage des voisins, faux dès qu'un onglet change
    // de ligne.
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
  const tabs = [...drag.el.parentElement.children];
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
  for (const el of drag.el.parentElement.children) el.style.transform = "";
  drag.el.classList.add("tearing");
  hintEl.textContent = drag.title;
  hintEl.hidden = false;
}

function exitTear() {
  drag.phase = "reorder";
  drag.el.classList.remove("tearing");
  hintEl.hidden = true;
}

function moveHint(e) {
  // Le hint n'est visible que lorsque le curseur est dans la fenêtre source ;
  // au-delà, seul le curseur système reste (limitation assumée).
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
    for (const el of drag.el.parentElement.children) el.style.transform = "";
  }
  document.body.classList.remove("tab-dragging");
  hintEl.hidden = true;
}

export function initTearDrag() {
  const tabsEl = document.getElementById("tabs");

  tabsEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    if (e.target.closest(".tab-close")) return;
    const tab = e.target.closest(".tab");
    if (!tab) return;
    const docId = Number(tab.dataset.id);
    if (!tab.classList.contains("active")) invoke("activate_tab", { docId });
    drag = {
      docId,
      el: tab,
      title: tab.querySelector(".tab-title")?.textContent ?? "",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      phase: "press",
    };
    try {
      tab.setPointerCapture(e.pointerId);
    } catch {
      drag = null;
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
    drag = null;
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
    drag = null;
  };
  tabsEl.addEventListener("pointercancel", cancel);
  // Un rebuild de la barre pendant un drag détache l'élément capturé :
  // la capture est perdue, on annule proprement.
  tabsEl.addEventListener("lostpointercapture", (e) => {
    if (drag && e.pointerId === drag.pointerId) cancel();
  });
}
