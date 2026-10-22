// @ts-check

// Barre d'onglets : rendu (diff minimal pour ne pas casser un drag en cours) et actions.

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
  title.textContent = tab.title; // noms de fichiers = contenu non fiable : jamais d'innerHTML
  el.appendChild(title);

  const close = document.createElement("button");
  close.className = "tab-close";
  close.dataset.i18nTitle = "tabs.close"; // retraduit par applyLocale(tabsEl) au changement de langue
  close.title = t("tabs.close");
  close.textContent = "×";
  el.appendChild(close);

  return el;
}

/**
 * Synchronise le DOM avec `state.tabs`. Si la liste d'ids n'a pas changé,
 * met à jour classes et titres sur place : un rebuild détacherait l'onglet
 * en cours de drag (perte de la capture du pointeur).
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
 * Les onglets gardent leur largeur naturelle et débordent en 2ᵉ ligne via le
 * layout inline de `#tabs` (CSS) : la 1ʳᵉ ligne contourne le float des
 * boutons d'action, les suivantes occupent toute la largeur. Ici on ne gère
 * que la saturation : si les largeurs naturelles — titres entiers, plafonnés
 * par le max-width CSS — demanderaient plus de 2 lignes, on pose `--tab-max`
 * (la plus grande largeur uniforme qui fait tenir tous les onglets en glouton
 * sur les 2 lignes, à largeurs inégales) et la troncature des titres reprend,
 * sur exactement 2 lignes. Les mesures partent toujours des largeurs
 * naturelles (cap retiré d'abord) : le seuil ne dépend pas de l'état courant,
 * pas d'oscillation.
 */
export function updateTabbarWrap() {
  if (document.body.classList.contains("tab-dragging")) return; // géométrie figée pendant un drag
  tabsEl.style.removeProperty("--tab-max");
  const tabs = /** @type {HTMLElement[]} */ ([...tabsEl.children]);
  if (!tabs.length) return;

  const maxTab = parseFloat(getComputedStyle(tabs[0]).maxWidth) || Infinity;
  const gap = parseFloat(getComputedStyle(tabs[0]).marginRight) || 0;
  const naturals = tabs.map((el) => {
    const title = /** @type {HTMLElement} */ (el.querySelector(".tab-title"));
    // Largeur hors-titre (paddings + croix) : constante que l'onglet soit
    // compressé ou non, le titre absorbant seul la compression (flex: 1).
    const chrome = el.getBoundingClientRect().width - title.getBoundingClientRect().width;
    return Math.min(maxTab, chrome + title.scrollWidth + 1); // +1 : scrollWidth tronqué à l'entier
  });

  // Largeurs de ligne : la 1ʳᵉ est amputée du float des boutons, les autres pleines.
  const fullW = tabsEl.clientWidth;
  const firstW = fullW - actionsEl.getBoundingClientRect().width;

  // Nombre de lignes qu'occuperait le placement inline (glouton). Un onglet
  // trop large pour l'espace restant à côté du float passe sous lui.
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

  // Plus grand cap uniforme qui tient en 2 lignes : pour chaque répartition
  // (k onglets en ligne 1, n−k en ligne 2), le cap est borné par la ligne la
  // plus serrée ; on garde le meilleur. Le glouton respecte ensuite ces
  // bornes : la ligne 1 accueille au moins k onglets (cap ≤ sa borne), le
  // reste — au plus n−k — tient en ligne 2 ; les onglets plus courts que le
  // cap laissent seulement plus de place.
  const n = naturals.length;
  let cap = 0;
  for (let k = 1; k < n; k++) {
    const c = Math.min((firstW - (k - 1) * gap) / k, (fullW - (n - k - 1) * gap) / (n - k));
    if (c > cap) cap = c;
  }
  tabsEl.style.setProperty("--tab-max", `${Math.floor(Math.min(cap, maxTab))}px`);
}

export function initTabbar() {
  // Redimensionnement de la fenêtre (et retour d'un drag) : réévaluer le wrap.
  new ResizeObserver(updateTabbarWrap).observe(tabbarEl);
  tabsEl.addEventListener("click", (e) => {
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (!tabEl) return;
    const docId = Number(tabEl.dataset.id);
    if (/** @type {Element} */ (e.target).closest(".tab-close")) {
      invoke("close_tab", { docId });
    }
    // L'activation se fait au pointerdown (voir teardrag.js), comme Chrome.
  });
  // Clic molette : fermer.
  tabsEl.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (tabEl) invoke("close_tab", { docId: Number(tabEl.dataset.id) });
  });
  initTabMenu();
  // Les croix des onglets sont construites par le JS : le HTML statique n'est
  // pas concerné par applyLocale(document), on leur applique donc à part.
  onLocaleChange(() => applyLocale(tabsEl));
}

// --- Menu contextuel d'onglet (clic droit) ---

const menuEl = /** @type {HTMLElement} */ (document.getElementById("tab-menu"));
/** @type {number | null} */
let menuDocId = null;

/** Presse-papiers : API asynchrone, repli execCommand si la webview la refuse
 *  (contexte jugé non sécurisé, cas possible sous WebKitGTK).
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
    detach: count === 1, // seul onglet : la nouvelle fenêtre serait la même
    left: idx === 0,
    right: idx === count - 1,
    others: count === 1,
  };
  for (const item of menuEl.querySelectorAll("button")) {
    item.disabled = !!disabled[/** @type {string} */ (item.dataset.action)]; // data-action sur chaque bouton (index.html)
  }
  menuEl.hidden = false;
  // Mesuré une fois affiché : recalé dans la fenêtre près des bords droit et bas.
  const { width, height } = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(0, Math.min(x, innerWidth - width - 4))}px`;
  menuEl.style.top = `${Math.max(0, Math.min(y, innerHeight - height - 4))}px`;
}

function initTabMenu() {
  tabsEl.addEventListener("contextmenu", (e) => {
    const tabEl = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest(".tab"));
    if (!tabEl) return;
    e.preventDefault(); // pas de menu natif de la webview
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
    } else {
      invoke("close_tabs_around", { docId, side: action });
    }
  });
  menuEl.addEventListener("contextmenu", (e) => e.preventDefault());
  // Tout clic hors du menu le referme (capture : avant le drag d'onglet).
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!menuEl.hidden && !menuEl.contains(/** @type {Node | null} */ (e.target))) closeTabMenu();
    },
    true,
  );
  // Capture + stopPropagation : Échap ferme le menu sans fermer aussi la
  // recherche ou le sommaire (écouteur de main.js, en phase de bouillonnement).
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
