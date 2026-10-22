// @ts-check
// UI de gestion des plugins (spec §9.4) : dialog « Plugins » (cartes, bouton
// Supprimer, bouton « Ajouter un plugin… ») et dialog de confiance à
// l'installation (§9.2). Les deux voies d'ajout — drop d'un `.kdext` sur la
// fenêtre, double-clic sur un `.kdext` associé, ligne de commande et sélecteur
// natif — convergent ici. Côté Rust elles empilent l'archive puis émettent
// `plugin-install-request` comme simple signal ; la charge utile se récupère
// par `take_pending_plugin_installs` (une archive arrivée au lancement précède
// l'enregistrement de l'écouteur — cf. `drainPendingInstalls`). Le drop Tauri
// (Linux) appelle `requestPluginInstall` en direct, cf. filedrop.js.

import { invoke, listen, escapeHtml } from "./app.js";
import { allPlugins, pluginRuntimeState } from "./plugins.js";
import { openPluginChangelog } from "./changelog.js";
import { isNativeFence } from "./render.js";
import { onLocaleChange, t } from "./i18n.js";

/** @typedef {import("../../types/ipc").PluginInfo} PluginInfo */
/** @typedef {import("../../types/ipc").ManifestPreview} ManifestPreview */

// Éléments statiques de ui/index.html.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("plugins-dialog"));
const listEl = /** @type {HTMLDivElement} */ (document.getElementById("plugins-list"));
const trustDialog = /** @type {HTMLDialogElement} */ (document.getElementById("plugin-trust-dialog"));
const trustTitle = /** @type {HTMLHeadingElement} */ (document.getElementById("plugin-trust-title"));
const trustBody = /** @type {HTMLDivElement} */ (document.getElementById("plugin-trust-body"));
const trustError = /** @type {HTMLParagraphElement} */ (document.getElementById("plugin-trust-error"));
const trustInstall = /** @type {HTMLButtonElement} */ (document.getElementById("plugin-trust-install"));

// Capacités du manifeste « en clair » pour le dialog de confiance (§9.2) :
// des fonctions, résolues à l'affichage dans la langue courante.
/** @type {Record<string, () => string>} */
const CAP_LABELS = {
  "document:markdown": () => t("trust.cap.document_markdown"),
  "document:html": () => t("trust.cap.document_html"),
  "document:webview": () => t("trust.cap.document_webview"),
  "fence:svg": () => t("trust.cap.fence_svg"),
  "fence:html": () => t("trust.cap.fence_html"),
  "fence:markdown": () => t("trust.cap.fence_markdown"),
  "fence:webview": () => t("trust.cap.fence_webview"),
  "highlight:code": () => t("trust.cap.highlight_code"),
  "read:siblings": () => t("trust.cap.read_siblings"),
};

// statut -> [classe du badge, libellé]
/** @type {Record<string, [badgeClass: string, label: () => string]>} */
const STATUS_LABELS = {
  ok: ["ok", () => t("plugins.status.ok")],
  inert: ["blocked", () => t("plugins.status.inert")],
  invalid: ["unsupported", () => t("plugins.status.invalid")],
  broken: ["unsupported", () => t("plugins.status.broken")],
};

/**
 * @param {string} text
 * @returns {HTMLSpanElement}
 */
function chip(text) {
  const el = document.createElement("span");
  el.className = "rt-chip";
  el.textContent = text;
  return el;
}

// Avertissements calculés côté frontend : fences/colorations masquées par le
// natif (le backend ne connaît ni KROKI_TYPES ni les grammaires hljs — §8.1).
/**
 * @param {PluginInfo} p
 * @returns {string[]}
 */
function nativeClaimWarnings(p) {
  const out = [];
  for (const f of p.fences || []) {
    if (isNativeFence(f)) out.push(t("plugins.native_fence", { name: f }));
  }
  for (const h of p.highlights || []) {
    if (window.hljs.getLanguage(h)) {
      out.push(t("plugins.native_highlight", { name: h }));
    }
  }
  return out;
}

/**
 * @param {PluginInfo} p
 * @returns {HTMLElement}
 */
function renderCard(p) {
  const runtime = pluginRuntimeState(p.id);
  const statusKey = runtime.broken ? "broken" : p.status;
  const [badgeClass, badgeLabel] = STATUS_LABELS[statusKey] || STATUS_LABELS.invalid;

  const card = document.createElement("section");
  card.className = "plugin-card";

  const head = document.createElement("div");
  head.className = "plugin-head";
  const titles = document.createElement("div");
  const name = document.createElement("div");
  name.className = "plugin-name";
  name.textContent = p.name || p.id;
  const version = document.createElement("span");
  version.className = "plugin-version";
  version.textContent = p.version ? `v${p.version}` : "";
  name.append(" ", version);
  const publisher = document.createElement("div");
  publisher.className = "plugin-publisher";
  publisher.textContent = p.publisher ? `${p.id} · ${p.publisher}` : p.id;
  titles.append(name, publisher);
  const badge = document.createElement("span");
  badge.className = `rt-badge ${badgeClass}`;
  badge.textContent = badgeLabel();
  head.append(titles, badge);
  card.append(head);

  if (p.description) {
    const desc = document.createElement("p");
    desc.className = "plugin-desc";
    desc.textContent = p.description;
    card.append(desc);
  }

  const reason = runtime.broken ? runtime.reason : p.statusReason;
  if (reason) {
    const r = document.createElement("p");
    r.className = "plugin-warning";
    r.textContent = reason;
    card.append(r);
  }

  const claims = document.createElement("div");
  claims.className = "rt-types";
  for (const e of p.extensions || []) claims.append(chip(`.${e}`));
  for (const f of p.fences || []) claims.append(chip(`\`\`\`${f}`));
  for (const h of p.highlights || []) claims.append(chip(t("plugins.claim_highlight", { name: h })));
  if (claims.childElementCount) card.append(claims);

  for (const w of [...(p.warnings || []), ...nativeClaimWarnings(p)]) {
    const warn = document.createElement("p");
    warn.className = "plugin-warning";
    warn.textContent = `⚠ ${w}`;
    card.append(warn);
  }

  // Suppression en deux temps (armement) plutôt qu'un dialog imbriqué.
  const actions = document.createElement("div");
  actions.className = "plugin-actions";
  // Changelog optionnel du plugin (CHANGELOG.md à la racine, spec §3.1) :
  // rendu par le dialog « Nouveautés » de l'hôte, le code du plugin ne
  // s'exécute pas.
  if (p.hasChangelog) {
    const news = document.createElement("button");
    news.type = "button";
    news.className = "plugin-changelog";
    news.textContent = t("changelog.title");
    news.addEventListener("click", () => openPluginChangelog(p));
    actions.append(news);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "plugin-delete";
  del.textContent = t("plugins.delete");
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = t("plugins.delete_confirm");
      del.classList.add("armed");
      return;
    }
    del.disabled = true;
    try {
      await invoke("uninstall_plugin", { id: p.id });
      // `plugins-changed` re-rend la liste ; rien d'autre à faire ici.
    } catch (err) {
      del.disabled = false;
      delete del.dataset.armed;
      del.classList.remove("armed");
      del.textContent = t("plugins.delete");
      alertError(card, err);
    }
  });
  actions.append(del);
  card.append(actions);
  return card;
}

/**
 * @param {HTMLElement} container
 * @param {unknown} err rejet d'`invoke` (chaîne d'erreur Rust)
 */
function alertError(container, err) {
  const p = document.createElement("p");
  p.className = "settings-error";
  p.textContent = String(err);
  container.append(p);
}

function renderList() {
  const plugins = allPlugins();
  listEl.replaceChildren();
  if (!plugins.length) {
    const empty = document.createElement("p");
    empty.className = "settings-hint plugins-empty";
    empty.textContent = t("plugins.empty");
    listEl.append(empty);
    return;
  }
  listEl.replaceChildren(...plugins.map(renderCard));
}

export function openPlugins() {
  renderList();
  dialog.showModal();
}

// Cartes écrites par le JS : refaites si la langue change, dialog ouvert.
onLocaleChange(() => {
  if (dialog.open) renderList();
});

// --------------------------------------------------------------------------- //
// Dialog de confiance (§9.2) — obligatoire, y compris en mise à jour
// --------------------------------------------------------------------------- //

/**
 * @param {string} label
 * @param {string} value
 * @returns {string} HTML échappé
 */
function trustRow(label, value) {
  return `<div class="trust-row"><span class="trust-label">${escapeHtml(label)}</span>` +
    `<span>${escapeHtml(value)}</span></div>`;
}

/**
 * Point d'entrée commun des deux voies d'installation : lit le manifeste de
 * l'archive **sans exécuter le plugin**, affiche le dialog de confiance, puis
 * installe si l'utilisateur confirme.
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function requestPluginInstall(path) {
  if (!path) return;
  trustError.hidden = true;
  trustError.textContent = "";
  trustInstall.disabled = false;

  /** @type {ManifestPreview | null} */
  let preview = null;
  try {
    preview = await invoke("plugin_manifest_preview", { path });
  } catch (err) {
    trustTitle.textContent = t("trust.title_refused");
    trustBody.innerHTML = `<p class="settings-error">${escapeHtml(String(err))}</p>`;
    trustInstall.disabled = true;
    trustDialog.showModal();
    return;
  }

  const update = preview.installedVersion != null;
  trustTitle.textContent = update ? t("trust.title_update") : t("trust.title_install");
  const rows = [
    trustRow(t("trust.row.name"), `${preview.name} (${preview.id})`),
    trustRow(t("trust.row.publisher"), preview.publisher || t("trust.publisher_unset")),
    trustRow(
      t("trust.row.version"),
      update ? `${preview.installedVersion} → ${preview.version}` : preview.version,
    ),
  ];
  if (preview.downgrade) {
    rows.push(`<p class="plugin-warning">${escapeHtml(t("trust.downgrade"))}</p>`);
  }
  if (preview.description) rows.push(trustRow(t("trust.row.description"), preview.description));
  const claims = [
    ...(preview.extensions || []).map((e) => `.${e}`),
    ...(preview.fences || []).map((f) => `\`\`\`${f}`),
    ...(preview.highlights || []).map((h) => t("plugins.claim_highlight", { name: h })),
  ];
  if (claims.length) rows.push(trustRow(t("trust.row.supports"), claims.join(", ")));
  const caps = (preview.capabilities || []).map(
    (c) => (Object.hasOwn(CAP_LABELS, c) ? CAP_LABELS[c]() : t("trust.cap_unknown", { name: c })),
  );
  if (caps.length) {
    rows.push(
      `<div class="trust-row"><span class="trust-label">${escapeHtml(t("trust.row.can"))}</span><span>${caps
        .map(escapeHtml)
        .join("<br>")}</span></div>`,
    );
  }
  if ((preview.siblingExtensions || []).length) {
    rows.push(
      trustRow(
        t("trust.row.readable_files"),
        t("trust.readable_scope", {
          list: preview.siblingExtensions.map((e) => `.${e}`).join(", "),
        }),
      ),
    );
  }
  rows.push(
    `<p class="settings-hint">${escapeHtml(t("trust.warning"))}</p>`,
  );
  trustBody.innerHTML = rows.join("");

  trustInstall.onclick = async () => {
    trustInstall.disabled = true;
    try {
      await invoke("install_plugin", { path });
      trustDialog.close();
    } catch (err) {
      trustInstall.disabled = false;
      trustError.textContent = String(err);
      trustError.hidden = false;
    }
  };
  trustDialog.showModal();
}

/**
 * Vide la file des archives en attente côté Rust et les enchaîne dans le dialog
 * de confiance. Séquentiel : `showModal()` sur un dialog déjà ouvert lèverait —
 * on attend donc la fermeture avant la suivante.
 * @returns {Promise<void>}
 */
async function drainPendingInstalls() {
  const paths = await invoke("take_pending_plugin_installs");
  for (const path of paths) {
    await requestPluginInstall(path);
    if (trustDialog.open) {
      await new Promise((r) => trustDialog.addEventListener("close", r, { once: true }));
    }
  }
}

/** @returns {Promise<void>} */
export async function initPluginsUi() {
  /** @type {HTMLButtonElement} */ (document.getElementById("plugins-close")).addEventListener(
    "click",
    () => dialog.close(),
  );
  /** @type {HTMLButtonElement} */ (document.getElementById("plugin-add")).addEventListener(
    "click",
    () => invoke("pick_plugin_archive"),
  );
  /** @type {HTMLButtonElement} */ (document.getElementById("plugins-open-dir")).addEventListener(
    "click",
    () => invoke("open_plugins_dir"),
  );
  /** @type {HTMLButtonElement} */ (document.getElementById("plugin-trust-cancel")).addEventListener(
    "click",
    () => trustDialog.close(),
  );
  // Drop Windows (drop_target.rs), double-clic / ligne de commande
  // (open_mixed_paths) et sélecteur natif (pick_plugin_archive) convergent ici.
  // Le drop Tauri (Linux) appelle requestPluginInstall en direct depuis
  // filedrop.js.
  await listen("plugin-install-request", () => drainPendingInstalls());
  // Une archive passée au lancement (double-clic, application fermée) est
  // empilée pendant le `setup`, donc AVANT ce listen : l'événement seul serait
  // perdu. On vide la file une fois l'écouteur en place.
  await drainPendingInstalls();
  // Liste rafraîchie si le registre change pendant que le dialog est ouvert.
  await listen("plugins-changed", () => {
    if (dialog.open) renderList();
  });
}
