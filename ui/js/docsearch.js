// @ts-check
// Recherche dans le document affiché (Ctrl+F) — remplace la barre de recherche
// native de la webview, qui n'était ni thémée, ni traduite de la même façon, ni
// cohérente avec la recherche multi-documents (globalsearch.js). Même mise en
// forme que celle-ci : champ, options `Aa` `ab` `.*` collées à droite du champ,
// bouton de fermeture.
//
// La recherche porte sur ce qui est RENDU (le DOM de la vue active), pas sur le
// source : elle suit donc le mode d'affichage courant (preview, code source,
// markdown intermédiaire) sans rien relire du disque. Le surlignage passe par la
// CSS Custom Highlight API (aucune modification du DOM, cf. findword.js) sous
// deux noms : toutes les occurrences, et l'occurrence courante par-dessus.
//
// L'occurrence courante est mémorisée PAR DOCUMENT (`positions`) : revenir sur
// un onglet retrouve celle qu'on y avait atteinte, au lieu d'hériter du rang
// atteint dans l'onglet précédent. Le contenu replié (accordéons `<details>`
// fermés) n'est pas cherché (cf. textmatch.js) ; ouvrir ou fermer un accordéon
// relance donc la recherche, en restant sur la même occurrence.
//
// Repères (à la VS Code) : un trait par occurrence sur la barre de défilement
// de la vue (`#find-ruler`), à la hauteur relative de l'occurrence dans le
// document. Superposé à la barre, `pointer-events: none` : le pouce reste
// saisissable au travers.

import { state } from "./app.js";
import { t, onLocaleChange } from "./i18n.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher, initSearchToggles } from "./searchopts.js";

/** @typedef {import("../../types/app").View} View */
/** @typedef {import("./searchopts.js").SearchOptions} SearchOptions */

const ALL_NAME = "find-occurrences";
const CURRENT_NAME = "find-current";
const DEBOUNCE_MS = 120;
const MAX_SEED_LEN = 120; // sélection reprise comme requête à l'ouverture
const RULER_MIN_W = 8; // largeur des repères sans barre de défilement classique

const hlSupported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

// Éléments d'index.html, renseignés par initDocSearch. Avant elle, `bar` et
// `ruler` sont undefined : les points d'entrée les testent (`!bar`, `!ruler`).
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
let onBeforeOpen = null; // hook de main.js : ferme les panneaux de la même ancre
let debounceTimer = 0;
/** @type {Range[]} */
let matches = []; // Range, dans l'ordre du document
let current = -1;
/** @type {View | null} */
let matchesView = null; // vue sur laquelle portent `matches`
// Occurrence courante de chaque document : vue → { sig, index }. N'est reprise
// que pour la même requête et les mêmes options (`sig`).
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

// La vue de l'onglet actif, si elle est cherchable. Les documents HTML sont
// rendus dans une iframe sandboxée : son contenu est inaccessible d'ici (et la
// recherche multi-documents les exclut déjà).
/** @returns {View | null} */
function searchableView() {
  // `active` null : `get` rend undefined, écarté juste après.
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
    hl.priority = 1; // peinte par-dessus le surlignage général
    window.CSS.highlights.set(CURRENT_NAME, hl);
  } else {
    window.CSS.highlights.delete(CURRENT_NAME);
  }
}

// « 3/12 » : rang de l'occurrence courante sur le total.
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

// Repères des occurrences. Rects en pixels écran, `scrollTop`/`scrollHeight`
// en pixels logiques (zoom CSS sur `#views`, cf. revealCurrent) : la position
// d'une occurrence est ramenée au repère logique avant d'être rapportée à la
// hauteur totale du document, puis à celle de la piste.
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
  const barW = box.width - el.clientWidth * scale; // 0 : barre en surimpression
  const width = barW >= 4 ? barW : RULER_MIN_W;
  const trackH = el.clientHeight * scale; // hors barre horizontale (zoom de page)
  ruler.style.top = `${box.top - host.top}px`;
  ruler.style.left = `${box.right - host.left - width}px`;
  ruler.style.width = `${width}px`;
  ruler.style.height = `${trackH}px`;
  const full = el.scrollHeight || 1;
  /** @type {Set<number>} */
  const rows = new Set(); // un trait par pixel de piste, pas par occurrence
  /** @type {HTMLElement[]} */
  const ticks = [];
  /** @type {HTMLElement | null} */
  let currentTick = null; // posé en dernier : par-dessus un trait de même rangée
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

// Les repères suivent la mise en page : redimensionnement de la fenêtre, zooms,
// figures hydratées après coup, accordéons. La vue est observée avec ses enfants
// directs — sa propre boîte ne change pas quand le contenu grandit.
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

// Rang de départ après une recherche. `anchor` (accordéon ouvert ou fermé, DOM
// inchangé) : la même occurrence, ou la suivante si elle vient d'être repliée.
// `keepIndex` (changement d'onglet, re-rendu) : celle mémorisée pour ce
// document, si la requête n'a pas changé depuis.
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

// Amène l'occurrence courante au centre de la vue si elle n'y est pas déjà.
// `#views` porte un `zoom` CSS : les rects sont en pixels écran, `scrollTop` en
// pixels logiques — d'où le facteur d'échelle mesuré sur la vue elle-même.
// Les deux axes sont traités : sous zoom de page (Maj+molette) la vue défile
// aussi horizontalement, et une occurrence peut être hors champ à droite.
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

// Relance la recherche sur la vue active. `keepIndex` reprend l'occurrence
// mémorisée pour ce document (changement d'onglet, re-rendu), `anchor` reste
// sur une occurrence donnée (cf. startIndex) ; sinon on repart de la 1ʳᵉ.
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

/** @param {number} dir  1 suivante, -1 précédente */
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
  // Sélection courante comme requête, à la façon d'un éditeur : un seul
  // fragment de ligne, jamais un paragraphe entier.
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
  // Rend le focus à la vue active : PgUp/PgDn/flèches y défilent à nouveau.
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

// Le DOM cherché vient d'être remplacé (changement d'onglet, bascule de mode,
// re-rendu) : les `Range` mémorisés pointent des nœuds détachés, on recalcule.
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
  // Le statut affiché (« Aucun résultat »…) suit la langue : on relance la
  // recherche sur la même occurrence plutôt que de mémoriser un message figé.
  onLocaleChange(() => refreshDocSearch());
  // Accordéon ouvert ou fermé dans la vue : l'ensemble cherchable a changé.
  // `toggle` ne remonte pas, d'où la capture ; regroupé par frame, plusieurs
  // `<details>` pouvant basculer d'un coup.
  document.addEventListener(
    "toggle",
    (e) => {
      if (!isDocSearchOpen() || toggleFrame) return;
      if (!(e.target instanceof HTMLDetailsElement)) return;
      if (!searchableView()?.el.contains(e.target)) return;
      toggleFrame = requestAnimationFrame(() => {
        toggleFrame = 0;
        // Ancre détachée (re-rendu dans l'intervalle) : rang mémorisé à la place.
        const anchor = matches[current];
        run({ reveal: false, keepIndex: true, anchor: anchor?.startContainer.isConnected ? anchor : null });
      });
    },
    true,
  );
}
