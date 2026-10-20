// Orchestration de la fenêtre : état des onglets, vues, raccourcis, liens.

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

const viewsEl = document.getElementById("views");
const emptyEl = document.getElementById("empty-state");

let zoom = 1; // zoom texte (Ctrl+molette) : l'échelle change, la colonne reflue
let pageZoom = 1; // zoom de page (Maj+molette) : vrai zoom, sans reflux (cf. setPageZoom)
let fitWidth = false; // préférence globale d'affichage : preview pleine largeur (cf. setFitWidth)
let appVersion = ""; // version de l'app (tauri.conf.json), récupérée au boot

function applyTabs(payload) {
  state.tabs = payload.tabs;
  state.active = payload.active ?? null;
  renderTabbar();
  syncViews();
  emptyEl.hidden = state.tabs.length > 0;
  updateTitle();
  if (state.active != null) showActive();
  else updateViewActions();
  refreshGlobalSearch(); // onglets ouverts/fermés : les résultats de recherche suivent
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
      el.tabIndex = -1; // focusable : PgUp/PgDn/flèches défilent sans clic préalable
      el.style.display = "none";
      viewsEl.appendChild(el);
      state.views.set(t.id, { el, rendered: false, seq: 0 });
    }
  }
}

async function showActive() {
  const id = state.active;
  closeToc(); // le sommaire référence l'onglet précédent : on le ferme au changement
  for (const [vid, v] of state.views) {
    v.el.style.display = vid === id ? "" : "none";
  }
  const v = state.views.get(id);
  if (!v) return;
  v.el.focus({ preventScroll: true });
  if (!v.rendered || state.stale.has(id)) {
    state.stale.delete(id);
    await renderActive(v, id);
  }
  updateViewActions();
  // Rattrape les figures Plotly d'un onglet rendu pendant qu'il était masqué, ou
  // dont le zoom a changé pendant son inactivité (largeur alors non mesurable).
  resizePlotlyFigures(v.el);
  consumePendingAnchor(v);
  onActiveViewShown(v, id); // saut de recherche en attente / surlignage qui suit l'onglet
  refreshDocSearch(); // le DOM cherché par Ctrl+F vient de changer
}

// --- Deep-link inter-fichiers : `[..](fichier.md#section)` ---
// Le fragment d'un lien relatif vers un autre document est mémorisé ici : le
// backend (`open_link`) ouvre/active l'onglet, puis `showActive` scrolle vers
// l'ancre une fois le document cible rendu.
let pendingAnchor = null; // { path (normalisé), fragment, expires }

// Chemin absolu normalisé pour comparaison Windows (séparateurs, `..`, casse).
function normPath(dir, rel = "") {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("\\").toLowerCase();
}

// Fragment « numéro de ligne » à la GitHub / VS Code : `#L75`, plage `#L75-L80`
// (seul le début compte). Renvoie la ligne 0-based (convention des
// `data-line`/`data-source-line`), ou null si le fragment n'en est pas un.
function lineFragment(fragment) {
  const m = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment);
  return m ? Math.max(0, Number(m[1]) - 1) : null;
}

// Amène la ligne `line` du source réel en haut de la vue, quel que soit son mode.
function scrollToSourceLine(v, line) {
  if (v.mode === "source") scrollToLine(v.el, "data-line", line);
  else if (v.mode === "derived")
    scrollToLine(v.el, "data-line", v.lineMap ? mdLineForSource(v.lineMap, line) : line);
  else scrollToLine(v.el, "data-source-line", line); // preview : déjà en lignes du source réel
}

// Saute vers un fragment dans la vue `v` : un `id` existant prime, sinon un
// fragment `L<n>` vaut numéro de ligne. Renvoie false si rien ne correspond.
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

function consumePendingAnchor(v) {
  if (!pendingAnchor) return;
  if (Date.now() > pendingAnchor.expires) {
    pendingAnchor = null;
    return;
  }
  // Vue HTML (iframe) : document hors de portée du querySelector, pas de saut.
  if (v.kind === "html" || !v.path || normPath(v.path) !== pendingAnchor.path) return;
  // Fragment inconnu dans ce document : on garde l'ouverture simple.
  if (jumpToFragment(v, pendingAnchor.fragment)) pendingAnchor = null;
}

// Référence passée en ligne de commande (`kroki_deskapp.exe doc.tex#eq:x`) :
// le backend l'empile (`manager::open_file_args`) et ne fait que signaler —
// au lancement, elle précède l'écouteur. Seule la dernière compte : c'est le
// dernier fichier ouvert qui devient actif. Délai large : un démarrage à froid
// charge les moteurs et le worker du plugin avant le premier rendu.
async function drainPendingAnchors() {
  const last = (await invoke("take_pending_anchors")).at(-1);
  if (!last) return;
  pendingAnchor = {
    path: normPath(last.path),
    fragment: last.fragment,
    expires: Date.now() + 30000,
  };
  // Onglet déjà rendu (document déjà ouvert) : `showActive` est passé sans
  // rien à consommer. En cours de rendu, c'est lui qui consommera.
  const v = state.views.get(state.active);
  if (v && v.rendered && !v.rendering) consumePendingAnchor(v);
}

/** La vue rend-elle la preview (seul mode qui traverse markdown-it + KaTeX) ? */
function isPreview(v) {
  return v.mode !== "source" && v.mode !== "derived";
}

async function renderActive(v, id) {
  const seq = ++v.seq;
  v.rendering = true; // cf. drainPendingAnchors : pas de saut dans un DOM en chantier
  beginLoading();
  try {
    await renderActiveInner(v, id, seq);
  } finally {
    if (v.seq === seq) v.rendering = false;
    endLoading();
  }
}

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
  v.path = doc.path; // chemin absolu : ciblage des deep-links inter-fichiers
  // Page HTML statique (dont les exports de l'app) : hors pipeline markdown —
  // affichée telle quelle dans une iframe sandboxée. `v.markdown` reste null,
  // ce qui désarme naturellement source/sommaire/export/recherche ; la pile
  // d'actions de vue est masquée (cf. updateViewActions).
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
  v.sourceText = doc.markdown; // source réel (markdown brut ou format d'un plugin), pour la vue source
  v.lineMap = null;
  // Extension revendiquée par un plugin (`document:markdown`) : le worker du
  // plugin transforme le source en markdown dérivé avant le pipeline habituel
  // (circuit des .tex via latex-doc, par exemple). En
  // panne/erreur, rendu dégradé §7.3 : bandeau + source en fence — jamais
  // d'onglet vide.
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
      // Avertissements non bloquants du plugin : bandeau en fin de document
      // (en tête, ils décaleraient toutes les ancres).
      if (gen.warnings.length) {
        gen.markdown += `\n\n> ⚠️ ${gen.warnings.map((w) => String(w)).join(" · ")}\n`;
      }
    } catch (err) {
      gen = { markdown: degradedDocMarkdown(doc.title, err, doc.markdown), anchors: [[0, 0]] };
    }
    if (v.seq !== seq) return;
    doc = { ...doc, markdown: gen.markdown, lineMap: gen.anchors };
    v.lineMap = gen.anchors;
  }
  v.markdown = doc.markdown; // conservé pour la bascule preview ↔ source sans relecture
  v.dir = doc.dir;
  v.domCache = null; // nouveau contenu : tout DOM mémorisé par renderMode est périmé
  if (v.mode === "derived" && !v.lineMap) v.mode = "preview"; // plus de transform (plugin retiré)
  // Les trois rendus qui suivent sont synchrones (hors hydratation des
  // diagrammes) : sans ce point de respiration, le voile de chargement ne
  // serait peint qu'une fois le rendu terminé. Seule la preview le mérite —
  // elle seule traverse markdown-it + KaTeX + DOMPurify. Les vues source et
  // dérivée se contentent de découper et colorer du texte : ~115 ms là où la
  // preview en demande ~765 sur le même document, soit un voile qui
  // clignoterait au lieu d'informer.
  await beforeHeavyRender(isPreview(v) ? doc.markdown : "");
  if (v.seq !== seq) return;
  await renderMode(v, v.mode);
}

// Vue debug « markdown intermédiaire » : le markdown généré par le plugin
// (document:markdown), affiché brut avec la mécanique de la vue source.
function renderDerived(v) {
  // Toujours du markdown, quel que soit le format du fichier d'origine.
  renderSource(v.el, v.markdown, { lang: "markdown", plugin: null });
  v.el.querySelector(".source-view")?.classList.add("derived-view");
}

/**
 * Affiche un mode dans la vue, en réutilisant le DOM déjà construit s'il existe.
 *
 * Reconstruire la preview d'un gros document coûte ~500 ms — markdown-it, KaTeX,
 * DOMPurify puis l'insertion de dizaines de milliers de nœuds — et chaque
 * aller-retour vers la vue source repayait ce prix pour un contenu identique.
 * Le DOM de chaque mode est donc conservé et simplement réattaché. Effet de
 * bord bienvenu : les diagrammes déjà hydratés survivent à la bascule.
 *
 * Le cache est vidé par `renderActive`, seul endroit où le contenu change :
 * modification sur disque, changement de thème ou d'icônes y passent tous via
 * `state.stale`.
 */
async function renderMode(v, mode) {
  // Une vue neuve n'a pas encore de `mode` : partout ailleurs `undefined` se
  // comporte comme "preview", mais ici il servirait de clé de cache distincte —
  // le DOM du premier rendu serait rangé sous `undefined` et jamais retrouvé.
  const key = mode === "source" || mode === "derived" ? mode : "preview";
  const cached = v.domCache?.[key];
  if (cached) {
    v.el.replaceChildren(cached);
    return;
  }
  // Phase synchrone : le voile doit être peint avant qu'elle démarre. Seule la
  // preview le mérite (cf. renderActive).
  await beforeHeavyRender(key === "preview" ? v.markdown : "");
  if (key === "source") renderSource(v.el, v.sourceText ?? v.markdown, sourceHighlightFor(v.path));
  else if (key === "derived") renderDerived(v);
  else await renderDocument(v.el, { markdown: v.markdown, dir: v.dir, lineMap: v.lineMap });
  (v.domCache ??= {})[key] = v.el.firstElementChild;
}

// --- Actions de vue (sommaire + bascule code source) de l'onglet actif ---
const viewActions = document.getElementById("view-actions");
const sourceBtn = document.getElementById("btn-source-toggle");
const derivedBtn = document.getElementById("btn-derived");
const fitBtn = document.getElementById("btn-fit-width");
const tocBtn = document.getElementById("btn-toc");
const tocPanel = document.getElementById("toc-panel");

// Affiche/masque la pile de boutons selon qu'un onglet rendu est actif, et reflète
// le mode courant sur le bouton source. Chaque bouton croise deux conditions : sa
// pertinence pour le document affiché, et son activation dans les réglages
// (`iconEnabled`) ; la pile entière disparaît quand il ne reste rien à montrer.
function updateViewActions() {
  const v = state.views.get(state.active);
  // Vue HTML (iframe) : aucune action ne s'applique (ni source, ni sommaire,
  // ni export, ni pleine largeur) — toute la pile est masquée.
  const show = !!v && v.rendered && v.kind !== "html";
  let any = false;
  for (const [id, relevant] of [
    ["btn-toc", true],
    ["btn-source-toggle", true],
    // Vue « markdown intermédiaire » : seulement pour un document passé par un
    // transform de plugin (lineMap présent). Désactivée par défaut (cf. icons.js).
    ["btn-derived", !!v?.lineMap],
    ["btn-fit-width", true],
    ["btn-export", true],
  ]) {
    const on = show && relevant && iconEnabled(id);
    document.getElementById(id).hidden = !on;
    any = any || on;
  }
  viewActions.hidden = !any;
  // Sans bouton pour le refermer, le sommaire ne doit pas rester ouvert.
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

// Titre du bouton source : suit le mode de la vue active et la langue.
function updateSourceTitle() {
  if (state.views.get(state.active)?.mode === "source") {
    sourceBtn.title = t("toolbar.source_hide");
  } else {
    sourceBtn.title = t("toolbar.source_show");
  }
}

// Titre du bouton pleine largeur : suit la préférence et la langue.
function updateFitTitle() {
  if (fitWidth) fitBtn.title = t("toolbar.fit_on");
  else fitBtn.title = t("toolbar.fit_off");
}

// --- Sommaire (table des matières) de l'onglet actif ---
function closeToc() {
  if (tocPanel.hidden) return;
  tocPanel.hidden = true;
  tocBtn.classList.remove("active");
  tocBtn.setAttribute("aria-expanded", "false");
}

// Va au titre cliqué : en preview, scroll vers l'élément par son id (comme les
// ancres) ; en mode source, aligne la ligne du titre en haut (cf. scrollToLine).
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
  // Même ancre à l'écran : sommaire et recherches sont exclusifs.
  closeGlobalSearch();
  closeDocSearch();
  const v = state.views.get(state.active);
  if (!v || !v.rendered || v.markdown == null) return;
  let headings = extractHeadings(v.markdown);
  // Document dérivé d'un plugin : réaccorde les lignes des titres sur le source réel.
  if (v.lineMap) headings = headings.map((h) => ({ ...h, line: remapLine(v.lineMap, h.line) }));
  buildToc(headings);
  tocPanel.hidden = false;
  tocBtn.classList.add("active");
  tocBtn.setAttribute("aria-expanded", "true");
}

async function toggleSource() {
  const id = state.active;
  const v = state.views.get(id);
  if (!v || !v.rendered || v.markdown == null) return;
  // Ligne de référence : en preview elle est déjà exprimée dans le source réel
  // (data-source-line remappé) ; en vue dérivée (debug) c'est une ligne du
  // markdown généré, remappée vers le source via les ancres.
  const fromAttr = v.mode === "source" || v.mode === "derived" ? "data-line" : "data-source-line";
  let line = readTopLine(v.el, fromAttr);
  if (v.mode === "derived" && v.lineMap) line = remapLine(v.lineMap, line);
  v.mode = v.mode === "source" ? "preview" : "source";
  beginLoading();
  try {
    // renderMode sert le DOM déjà construit s'il existe, et ne pose le voile que
    // pour un vrai rendu de preview. hydrateDiagrams modifie les hauteurs : on
    // attend la fin avant de réaligner.
    await renderMode(v, v.mode);
  } finally {
    endLoading();
  }
  const toAttr = v.mode === "source" ? "data-line" : "data-source-line";
  scrollToLine(v.el, toAttr, line);
  updateViewActions();
  refreshDocSearch(); // vue reconstruite : les Range de Ctrl+F sont à recalculer
}

// --- Vue debug : markdown intermédiaire (builds debug, documents transformés) ---
// Bascule preview/source ↔ markdown généré par le plugin. L'alignement de
// position passe par les ancres : approximatif (granularité par section),
// suffisant pour un outil de débogage.
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
      const line = readTopLine(v.el, "data-line"); // ligne du markdown généré
      v.mode = "preview";
      await renderMode(v, "preview");
      scrollToLine(v.el, "data-source-line", remapLine(v.lineMap, line));
    } else {
      const fromAttr = v.mode === "source" ? "data-line" : "data-source-line";
      const srcLine = readTopLine(v.el, fromAttr); // ligne du source réel
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

// Une icône désactivée ne doit pas laisser une vue dans un état qu'on ne peut
// plus quitter (mode source ou markdown intermédiaire, preview pleine largeur) :
// ces vues repassent à l'état atteignable sans bouton. Idempotent : sans
// changement de réglage, cette passe ne fait rien.
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
  // Les workers de plugins vivants suivent le thème effectif (spec §6.6) ;
  // notification idempotente, sans coût quand rien n'a changé.
  notifyThemeChanged();
  for (const t of state.tabs) state.stale.add(t.id);
  if (state.active != null) showActive();
}

// Plotly est le seul rendu interactif (hover) ; son hit-testing casse sous le
// `zoom` CSS de page (cf. app.css). Le contre-zoom (var --plotly-inv-zoom) ramène
// l'échelle effective à 1 (coordonnées 1:1) ; il faut alors réaccorder le plan à la
// largeur réelle de la colonne pour éviter un débordement au dézoom. On le fait via
// relayout(width, height) en préservant le ratio d'aspect — surtout PAS via
// Plots.resize, qui prend la hauteur du conteneur (sans hauteur CSS) et l'écrase.
function resizePlotlyFigures(viewEl) {
  const P = window.Plotly;
  if (!P || !viewEl) return;
  // Plotly pose la classe `js-plotly-plot` sur l'élément cible lui-même (= le
  // .kroki-diagram), pas sur un enfant : on filtre donc dessus directement.
  for (const el of viewEl.querySelectorAll(
    '.kroki-diagram[data-kroki-type="plotly"].js-plotly-plot',
  )) {
    // offsetParent null = vue masquée (onglet inactif) : mesure de largeur
    // invalide, on la rattrape à la réactivation (showActive).
    if (el.offsetParent === null) continue;
    const w = el.clientWidth;
    const ratio = parseFloat(el.dataset.plotlyRatio);
    if (w > 0 && ratio > 0) P.relayout(el, { width: w, height: Math.round(w * ratio) });
  }
}

// Les deux zooms se composent dans un seul `zoom` CSS sur #views. Ce qui les
// distingue est la largeur de mise en page des vues (`--page-zoom`, cf. app.css) :
// le zoom texte laisse la colonne logique rétrécir avec l'échelle (le texte
// grossit et reflue, une figure pleine largeur garde sa taille à l'écran), le zoom
// de page la maintient à sa largeur d'échelle 1 (rien ne reflue, tout grossit et
// déborde en défilement horizontal).
function applyZoom() {
  const scale = zoom * pageZoom;
  viewsEl.style.zoom = String(scale);
  viewsEl.style.setProperty("--plotly-inv-zoom", String(1 / scale));
  viewsEl.style.setProperty("--page-zoom", String(pageZoom));
  resizePlotlyFigures(state.views.get(state.active)?.el);
}

function setZoom(z) {
  zoom = Math.min(3, Math.max(0.4, z));
  applyZoom();
}

// Zoom de page autour d'un point : `anchor` = {view, x, y}, position du curseur
// en pixels écran relative à la vue. La mise en page en pixels logiques de la
// vue est la même à toute échelle (cf. --page-w), donc le point de contenu sous
// le curseur, c = scroll + écran / échelle, est invariant : on repose le
// défilement pour l'y ramener après le changement d'échelle. Sans ancre (Ctrl+0),
// le coin haut-gauche reste en place. Borné à 1 : en deçà, Ctrl+molette fait
// déjà tenir plus de contenu à l'écran.
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

// Bascule globale « pleine largeur » : le preview lâche son plafond de lecture (920px)
// pour remplir la colonne. Rien à recalculer au dézoom — la règle CSS suit la largeur
// logique. Le changement de largeur reflue le contenu (les hauteurs bougent) : on
// mémorise la ligne source collée en haut AVANT, et on réaligne dessus APRÈS, comme la
// bascule code source. Plotly, qui fige sa largeur au layout, est réaccordé avant le
// scroll pour que les hauteurs soient stables au moment de mesurer la cible.
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

function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const idx = state.tabs.findIndex((t) => t.id === state.active);
  const next = state.tabs[(idx + dir + state.tabs.length) % state.tabs.length];
  invoke("activate_tab", { docId: next.id });
}

// --- Liens dans les documents : web → navigateur, .md relatif → onglet, ancre → scroll ---
function initLinks() {
  document.getElementById("content").addEventListener("click", (e) => {
    // `closest("a")` (et non `a[href]`) : les SVG graphviz portent leurs liens
    // en `xlink:href` (nœuds de diagramme liés à un autre document, cliquables).
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const href = (a.getAttribute("href") || a.getAttribute("xlink:href") || "").trim();
    if (!href) return;
    if (href.startsWith("#")) {
      const v = state.views.get(state.active);
      if (v) jumpToFragment(v, decodeURIComponent(href.slice(1)));
      return;
    }
    const dir = state.views.get(state.active)?.el.dataset.dir ?? "";
    // Lien relatif avec fragment (`fichier.md#section`, lien
    // d'un nœud de diagramme) : le backend ouvre le document, le fragment est
    // mémorisé pour scroller une fois l'onglet cible rendu (showActive).
    const hash = href.indexOf("#");
    if (hash > 0 && !/^(https?:|mailto:)/i.test(href)) {
      pendingAnchor = {
        path: normPath(dir, href.slice(0, hash)),
        fragment: decodeURIComponent(href.slice(hash + 1)),
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
      // Ctrl+F / F3 / Ctrl+G déclencheraient la barre de recherche native de la
      // webview (non thémée, hors de notre modèle d'onglets) : on la neutralise en
      // prenant la main sur les trois raccourcis.
    } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openDocSearch();
    } else if (e.key === "F3" || (ctrl && e.key.toLowerCase() === "g")) {
      e.preventDefault();
      findNext(e.shiftKey ? -1 : 1);
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
  document.getElementById("content").addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(e.deltaY < 0 ? zoom * 1.08 : zoom / 1.08);
        return;
      }
      if (!e.shiftKey) return;
      // Maj+molette : Chromium (Windows/Linux) reporte alors le cran sur deltaX
      // (défilement horizontal natif, qu'on remplace), les autres moteurs sur
      // deltaY — on prend celui des deux qui porte le mouvement.
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      e.preventDefault();
      const view = e.target.closest?.(".doc-view") ?? state.views.get(state.active)?.el;
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
  // Langue en tout premier : le HTML statique est traduit (et la fenêtre
  // démasquée) avant le premier paint, et les modules initialisés ensuite
  // écrivent leurs textes directement dans la bonne langue.
  await initI18n();

  // Thème d'abord : applique l'override sauvegardé avant tout rendu. En « auto » il
  // n'altère rien (le premier paint suit déjà @media en pur CSS). initTheme réaccorde
  // les figures Plotly quand le système bascule en mode auto.
  try {
    applyTheme(await invoke("get_theme"));
  } catch {
    /* défaut : auto */
  }
  initTheme(rerenderAll);

  // Icônes désactivées : masquées avant le premier paint, comme le thème.
  try {
    applyIcons(await invoke("get_icons"));
  } catch {
    /* défaut : tout le registre à sa valeur par défaut */
  }

  try {
    appVersion = await window.__TAURI__.app.getVersion();
  } catch {
    appVersion = ""; // module app indisponible : on retombe sur le titre sans version
  }
  // Registre des plugins avant le premier rendu : le routage des extensions
  // et des fences en dépend. Un changement (install/suppression) re-rend tout.
  await initPlugins(rerenderAll);
  updateSourceTitle(); // titres dynamiques : pas de data-i18n-title (cf. index.html)
  updateFitTitle();
  onLocaleChange(() => {
    updateSourceTitle();
    updateFitTitle();
    closeToc(); // son contenu (« Aucun titre… », « (sans titre) ») est dans l'ancienne langue
  });
  initTabbar();
  initTearDrag();
  initLinks();
  initShortcuts();
  initSettings(rerenderAll);
  initInfo();
  initChangelog();
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
  initUpdates(); // non attendue : requête réseau, jusqu'à 10 s

  document.getElementById("btn-open").addEventListener("click", () => invoke("open_file_dialog"));
  // Délégation : le lien est dans un texte traduit par innerHTML (`welcome.open_hint`),
  // recréé à chaque changement de langue — un écouteur direct serait perdu.
  emptyEl.addEventListener("click", (e) => {
    if (e.target.closest("#btn-open-empty")) invoke("open_file_dialog");
  });
  document.getElementById("btn-refresh").addEventListener("click", rerenderAll);
  document.getElementById("btn-new-window").addEventListener("click", () => invoke("new_window"));
  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("btn-info").addEventListener("click", openInfo);
  // Export du rendu de l'onglet actif : désarmé pendant l'opération (un
  // re-rendu hors écran peut prendre quelques secondes sur un gros document).
  const exportBtn = document.getElementById("btn-export");
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    try {
      await exportActiveView();
    } catch (err) {
      console.error("export du rendu :", err);
    } finally {
      exportBtn.disabled = false;
    }
  });
  sourceBtn.addEventListener("click", toggleSource);
  derivedBtn.addEventListener("click", toggleDerived);
  fitBtn.addEventListener("click", () => setFitWidth(!fitWidth));
  tocBtn.addEventListener("click", toggleToc);
  // Fermer le sommaire dès qu'on clique en dehors (panneau et bouton exclus).
  document.addEventListener("click", (e) => {
    if (tocPanel.hidden) return;
    if (e.target.closest("#toc-panel") || e.target.closest("#btn-toc")) return;
    closeToc();
  });

  // S'abonner avant de lire l'état initial : aucune mise à jour ne peut se perdre
  // entre les deux (un détachement assigne l'onglet avant que la fenêtre ne boote).
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
  // Thème changé dans une AUTRE fenêtre : la fenêtre initiatrice s'est déjà mise à
  // jour localement (cf. settings.js), on ignore donc son propre echo via `from`.
  await listen("theme-changed", (e) => {
    if (e.payload.from === currentLabel) return;
    applyTheme(e.payload.mode);
    rerenderAll();
  });
  // Langue changée dans une AUTRE fenêtre : même protocole que le thème. Le
  // re-rendu traduit les messages insérés dans les documents (erreurs de rendu,
  // bannières des plugins).
  await listen("locale-changed", async (e) => {
    if (e.payload.from === currentLabel) return;
    await loadLocale();
    rerenderAll();
  });
  // Icônes changées dans une AUTRE fenêtre (réglage global) : même protocole
  // que le thème — la fenêtre initiatrice a déjà appliqué localement.
  await listen("icons-changed", (e) => {
    if (e.payload.from === currentLabel) return;
    applyIcons(e.payload.icons);
    rerenderAll();
  });

  // Avant l'état initial : le premier `showActive` trouve la référence d'un
  // lancement `kroki_deskapp.exe doc#ref`.
  await drainPendingAnchors();
  applyTabs(await invoke("get_window_state"));
}

boot();
