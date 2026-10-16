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

const dialog = document.getElementById("plugins-dialog");
const listEl = document.getElementById("plugins-list");
const trustDialog = document.getElementById("plugin-trust-dialog");
const trustTitle = document.getElementById("plugin-trust-title");
const trustBody = document.getElementById("plugin-trust-body");
const trustError = document.getElementById("plugin-trust-error");
const trustInstall = document.getElementById("plugin-trust-install");

// Capacités du manifeste « en clair » pour le dialog de confiance (§9.2).
const CAP_LABELS = {
  "document:markdown": "transformer ses types de fichiers en markdown",
  "document:html": "produire une mise en page HTML (réservé, non servi)",
  "document:webview": "fournir une vue interactive (réservé, non servi)",
  "fence:svg": "rendre des blocs de code en SVG",
  "fence:html": "rendre des blocs de code en HTML (sanitizé)",
  "fence:markdown": "rendre des blocs de code en markdown (pipeline complet)",
  "fence:webview": "rendre des blocs interactifs (réservé, non servi)",
  "highlight:code": "colorer des blocs de code",
  "read:siblings": "lire des fichiers voisins des documents ouverts",
};

const STATUS_LABELS = {
  ok: ["ok", "Actif"],
  inert: ["blocked", "Inerte"],
  invalid: ["unsupported", "Invalide"],
  broken: ["unsupported", "En panne"],
};

function chip(text) {
  const el = document.createElement("span");
  el.className = "rt-chip";
  el.textContent = text;
  return el;
}

// Avertissements calculés côté frontend : fences/colorations masquées par le
// natif (le backend ne connaît ni KROKI_TYPES ni les grammaires hljs — §8.1).
function nativeClaimWarnings(p) {
  const out = [];
  for (const f of p.fences || []) {
    if (isNativeFence(f)) out.push(`la fence ${f} est gérée nativement — revendication ignorée`);
  }
  for (const h of p.highlights || []) {
    if (window.hljs.getLanguage(h)) {
      out.push(`la coloration ${h} est gérée nativement — revendication ignorée`);
    }
  }
  return out;
}

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
  badge.textContent = badgeLabel;
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
  for (const h of p.highlights || []) claims.append(chip(`coloration ${h}`));
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
    news.textContent = "Nouveautés";
    news.addEventListener("click", () => openPluginChangelog(p));
    actions.append(news);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "plugin-delete";
  del.textContent = "Supprimer";
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = "Confirmer la suppression ?";
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
      del.textContent = "Supprimer";
      alertError(card, err);
    }
  });
  actions.append(del);
  card.append(actions);
  return card;
}

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
    empty.textContent =
      "Aucun plugin installé. Déposez une archive .kdext sur la fenêtre ou utilisez le bouton ci-dessous.";
    listEl.append(empty);
    return;
  }
  listEl.replaceChildren(...plugins.map(renderCard));
}

export function openPlugins() {
  renderList();
  dialog.showModal();
}

// --------------------------------------------------------------------------- //
// Dialog de confiance (§9.2) — obligatoire, y compris en mise à jour
// --------------------------------------------------------------------------- //

function trustRow(label, value) {
  return `<div class="trust-row"><span class="trust-label">${escapeHtml(label)}</span>` +
    `<span>${escapeHtml(value)}</span></div>`;
}

/**
 * Point d'entrée commun des deux voies d'installation : lit le manifeste de
 * l'archive **sans exécuter le plugin**, affiche le dialog de confiance, puis
 * installe si l'utilisateur confirme.
 */
export async function requestPluginInstall(path) {
  if (!path) return;
  trustError.hidden = true;
  trustError.textContent = "";
  trustInstall.disabled = false;

  let preview = null;
  try {
    preview = await invoke("plugin_manifest_preview", { path });
  } catch (err) {
    trustTitle.textContent = "Archive de plugin refusée";
    trustBody.innerHTML = `<p class="settings-error">${escapeHtml(String(err))}</p>`;
    trustInstall.disabled = true;
    trustDialog.showModal();
    return;
  }

  const update = preview.installedVersion != null;
  trustTitle.textContent = update ? "Mettre à jour un plugin" : "Installer un plugin";
  const rows = [
    trustRow("Nom", `${preview.name} (${preview.id})`),
    trustRow("Éditeur", preview.publisher || "(non renseigné)"),
    trustRow(
      "Version",
      update ? `${preview.installedVersion} → ${preview.version}` : preview.version,
    ),
  ];
  if (preview.downgrade) {
    rows.push(
      `<p class="plugin-warning">⚠ Retour à une version antérieure à celle installée.</p>`,
    );
  }
  if (preview.description) rows.push(trustRow("Description", preview.description));
  const claims = [
    ...(preview.extensions || []).map((e) => `.${e}`),
    ...(preview.fences || []).map((f) => `\`\`\`${f}`),
    ...(preview.highlights || []).map((h) => `coloration ${h}`),
  ];
  if (claims.length) rows.push(trustRow("Prend en charge", claims.join(", ")));
  const caps = (preview.capabilities || []).map(
    (c) => CAP_LABELS[c] || `capacité inconnue « ${c} » (ignorée)`,
  );
  if (caps.length) {
    rows.push(
      `<div class="trust-row"><span class="trust-label">Peut</span><span>${caps
        .map(escapeHtml)
        .join("<br>")}</span></div>`,
    );
  }
  if ((preview.siblingExtensions || []).length) {
    rows.push(
      trustRow(
        "Fichiers lisibles",
        preview.siblingExtensions.map((e) => `.${e}`).join(", ") +
          " (dossier des documents ouverts uniquement)",
      ),
    );
  }
  rows.push(
    `<p class="settings-hint">Un plugin exécute du code (sandboxé) fourni par un tiers.` +
      ` N'installez que des plugins dont vous connaissez la provenance.</p>`,
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

export async function initPluginsUi() {
  document.getElementById("plugins-close").addEventListener("click", () => dialog.close());
  document
    .getElementById("plugin-add")
    .addEventListener("click", () => invoke("pick_plugin_archive"));
  document
    .getElementById("plugins-open-dir")
    .addEventListener("click", () => invoke("open_plugins_dir"));
  document
    .getElementById("plugin-trust-cancel")
    .addEventListener("click", () => trustDialog.close());
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
