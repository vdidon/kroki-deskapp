// @ts-check
// Recherche plein-texte dans TOUS les documents ouverts (les onglets de la
// fenêtre) — complète findword.js, qui ne surligne que dans la vue active.
// La requête est cherchée dans le SOURCE réel de chaque document, relu via
// `read_document` (lecture pure, sans effet de bord) : les onglets jamais
// affichés ou modifiés sur disque sont couverts, sans toucher à l'état de
// rendu des vues. Les numéros de ligne obtenus s'alignent directement sur la
// vue source (`data-line`) et sur le preview (`data-source-line`, déjà
// exprimé dans le source réel pour les documents transformés par un plugin).
// Le surlignage des occurrences réutilise la CSS Custom Highlight API
// (aucune modification du DOM, cf. findword.js) sous un nom dédié.

import { invoke, state, isHtmlPath } from "./app.js";
import { t, getLocale, onLocaleChange } from "./i18n.js";
import { scrollToLine } from "./render.js";
import { collectMatchRanges } from "./textmatch.js";
import { buildMatcher, initSearchToggles, iterMatches } from "./searchopts.js";

/** @typedef {import("../../types/app").View} View */
/** @typedef {import("../../types/ipc").TabInfo} TabInfo */
/** @typedef {import("../../types/ipc").Anchor} Anchor */
/** @typedef {import("./searchopts.js").SearchOptions} SearchOptions */
/** @typedef {{ line: number, text: string, spans: [number, number][] }} Hit  ligne 0-based */
/** @typedef {{ hits: Hit[], total: number, capped: boolean, truncated: boolean }} Hits */
/** @typedef {{ tab: TabInfo, error: true } | (Hits & { tab: TabInfo, error?: undefined })} DocResult */

const HIGHLIGHT_NAME = "search-occurrences";
const MIN_LEN = 2; // même seuil que findword : en dessous, trop de bruit
const MAX_LINES_PER_DOC = 200; // lignes de résultat affichées par document
const MAX_PER_LINE = 200; // occurrences comptées sur une même ligne
const MAX_TOTAL_PER_DOC = 5000; // garde-fou : `.` ou `\\s` en mode regex
const EXCERPT_LEN = 88; // longueur max d'un extrait, fenêtré sur la 1ʳᵉ occurrence
const DEBOUNCE_MS = 180;

const hlSupported =
  typeof window.CSS !== "undefined" &&
  !!window.CSS.highlights &&
  typeof window.Highlight !== "undefined";

// Éléments d'index.html, renseignés par initGlobalSearch. Avant elle, `panel`
// est undefined : les points d'entrée le testent (`!panel`).
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
let onBeforeOpen = null; // hook de main.js (ferme le sommaire, exclusif du panneau)
let seq = 0; // anti-course : seule la dernière recherche lancée peut afficher
let debounceTimer = 0;
/** @type {RegExp | null} */
let shownRe = null; // motif des résultats affichés, réutilisé pour le surlignage
// Saut vers un onglet pas encore actif : mémorisé ici, consommé par
// `onActiveViewShown` une fois l'onglet cible rendu (même mécanique que
// `pendingAnchor` pour les deep-links).
/** @type {{ docId: number, line: number, expires: number } | null} */
let pendingJump = null;
let searchedTabsKey = ""; // onglets couverts par les résultats affichés (ids)

function clearHighlight() {
  if (hlSupported) window.CSS.highlights.delete(HIGHLIGHT_NAME);
}

// Surligne toutes les occurrences de la requête courante dans une vue (mêmes
// Ranges que findword.js, cf. textmatch.js, sous un nom de highlight distinct).
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

// Occurrences dans un source : une entrée par ligne matchée (positions retenues
// pour l'extrait), total toutes occurrences confondues.
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

// Extrait d'une ligne, fenêtré autour de la première occurrence, occurrences
// marquées en <mark> (DOM construit par textContent : aucun HTML interprété).
/**
 * @param {string} lineText
 * @param {[number, number][]} spans  non vide
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

// Ligne du markdown généré correspondant à une ligne source (vue debug
// « dérivée » : les data-line y sont dans le markdown du plugin).
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

// Amène la ligne source `line` en haut de la vue, quel que soit son mode.
/**
 * @param {View | undefined} v
 * @param {number} line
 */
function scrollToHit(v, line) {
  if (!v || !v.rendered) return;
  let attr = "data-source-line"; // preview : déjà exprimé dans le source réel
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

// Appelé par showActive (main.js) une fois l'onglet actif rendu : consomme un
// saut en attente, sinon fait suivre le surlignage à la vue affichée.
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
  const scrollTop = resultsEl.scrollTop; // rafraîchissement : ne pas perdre la position
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

// Nombre affiché, séparateurs de milliers de la langue courante.
/** @param {number} n */
function formatCount(n) {
  return n.toLocaleString(getLocale());
}

// Bilan « N occurrences dans M documents (note) ». Une phrase par combinaison
// (document unique ou non × note) : le pluriel du catalogue ne porte que sur
// `count` (les occurrences), et on ne recolle jamais de fragments traduits.
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

// Vide les résultats ; `status` non vide = message d'erreur (motif invalide).
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
  // Une expression régulière utile tient parfois en un caractère (`.`) ; un
  // littéral d'un seul caractère, lui, ne ferait que du bruit.
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
  // Les onglets HTML (iframe) sont exclus : chercher dans leur balisage brut
  // serait du bruit, et le saut vers une ligne n'a pas de sens dans l'iframe.
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
  if (mySeq !== seq || panel.hidden) return; // recherche plus récente ou panneau fermé
  shownRe = re;
  renderResults(results);
  // `active` null : `get` rend undefined.
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
  seq++; // invalide une recherche encore en vol
  clearTimeout(debounceTimer);
  pendingJump = null;
  shownRe = null;
  clearHighlight();
  // Rend le focus à la vue active : PgUp/PgDn/flèches y défilent à nouveau.
  state.views.get(/** @type {number} */ (state.active))?.el.focus({ preventScroll: true });
}

export function toggleGlobalSearch() {
  if (isGlobalSearchOpen()) closeGlobalSearch();
  else openGlobalSearch();
}

// Onglets ouverts/fermés pendant que le panneau est affiché : les résultats
// suivent (appelé par applyTabs). Un simple changement d'onglet actif ne
// relance rien : la liste des documents couverts n'a pas bougé.
export function refreshGlobalSearch() {
  if (!isGlobalSearchOpen()) return;
  if (state.tabs.map((t) => t.id).join(",") === searchedTabsKey) return;
  scheduleSearch(0); // runSearch gère aussi la requête trop courte
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
  // Statut, notes et bilan affichés : une nouvelle recherche les reconstruit
  // dans la langue courante (résultats rafraîchis, position de défilement gardée).
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
