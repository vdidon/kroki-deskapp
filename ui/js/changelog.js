// Dialog « Nouveautés » : affiche un changelog markdown rendu par une
// instance markdown-it dédiée — sans la fence Kroki de render.js : un
// changelog est de la prose, un moteur de diagrammes n'y a rien à hydrater —
// puis assaini par DOMPurify. Deux sources : le CHANGELOG.md de l'application
// embarqué dans le binaire (commande `get_changelog`) et le CHANGELOG.md
// optionnel d'un plugin installé (commande `plugin_changelog`, spec §3.1) —
// même dialog, en-tête ajusté.

import { invoke } from "./app.js";
import { onLocaleChange, t } from "./i18n.js";

const dialog = document.getElementById("changelog-dialog");
const title = document.getElementById("changelog-title");
const hint = document.getElementById("changelog-hint");
const body = document.getElementById("changelog-body");

const md = window.markdownit({ linkify: true });

// Clé de la source actuellement rendue dans le corps ("app" ou
// "plugin:<id>") : le changelog de l'app est figé à la compilation, ceux des
// plugins peuvent changer à chaque installation — on ne cache que le dernier
// rendu, suffisant pour les réouvertures successives du même contenu.
let shownKey = null;

// Source dont l'en-tête (titre + indication) est affiché : `null` pour
// l'application, l'entrée `list_plugins` pour un plugin. Le titre et
// l'indication sont dans la langue courante, refaits si elle change.
let headerPlugin = null;

function setHeader() {
  if (headerPlugin) {
    title.textContent = t("changelog.plugin_title", { name: headerPlugin.name || headerPlugin.id });
    hint.textContent = t("changelog.plugin_hint", { id: headerPlugin.id });
  } else {
    title.textContent = t("changelog.title");
    hint.textContent = t("changelog.hint");
  }
}

// Prépare le markdown de l'application : le titre et le préambule (déjà
// portés par l'en-tête du dialog) sont coupés — la liste démarre à la
// première section de version — et les définitions de liens de référence en
// pied (`[2.2.2]: #222--…`, ancres internes au fichier) sont retirées : sans
// cible dans le dialog, elles ne feraient que casser la navigation. `[2.2.2]`
// redevient du texte littéral dans les titres, fidèle au format
// Keep a Changelog.
function prepareApp(src) {
  const start = src.search(/^## /m);
  const versions = start >= 0 ? src.slice(start) : src;
  return versions.replace(/^\[[^\]]+\]:\s*#.*$/gm, "");
}

// Prépare le markdown d'un plugin : plus conservateur que `prepareApp` (un
// préambule peut porter du contenu), on ne coupe que le titre `# …` de tête
// — redondant avec l'en-tête du dialog — et les liens de référence en pied.
function preparePlugin(src) {
  return src.replace(/^# .*\n+/, "").replace(/^\[[^\]]+\]:\s*#.*$/gm, "");
}

function render(markdown) {
  body.innerHTML = window.DOMPurify.sanitize(md.render(markdown), {
    USE_PROFILES: { html: true },
  });
}

function renderError(err) {
  body.replaceChildren();
  const error = document.createElement("p");
  error.className = "settings-error";
  error.textContent = String(err);
  body.append(error);
}

function show() {
  dialog.showModal();
  body.scrollTop = 0;
}

export async function openChangelog() {
  if (shownKey !== "app") {
    try {
      render(prepareApp(await invoke("get_changelog")));
      shownKey = "app";
    } catch (err) {
      renderError(err);
      shownKey = null;
    }
  }
  headerPlugin = null;
  setHeader();
  show();
}

/** Changelog d'un plugin installé (`p` = entrée `list_plugins`). */
export async function openPluginChangelog(p) {
  const key = `plugin:${p.id}`;
  if (shownKey !== key) {
    try {
      render(preparePlugin(await invoke("plugin_changelog", { id: p.id })));
      shownKey = key;
    } catch (err) {
      renderError(err);
      shownKey = null;
    }
  }
  headerPlugin = p;
  setHeader();
  show();
}

export function initChangelog() {
  onLocaleChange(setHeader);
  document.getElementById("changelog-close").addEventListener("click", () => dialog.close());
  // Liens éventuels du corps (URL citées dans une entrée) : navigateur système
  // via le backend, jamais de navigation de la webview elle-même.
  body.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const href = (a.getAttribute("href") || "").trim();
    if (/^https?:/i.test(href)) invoke("open_link", { baseDir: "", href });
  });
}
