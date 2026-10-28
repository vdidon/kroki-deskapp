// @ts-check
// Dialog « Informations » : version de l'app, état des runtimes/moteurs sur
// le poste courant, accès au changelog (« Nouveautés ») et vérification des
// mises à jour à la demande (updates.js), accès au journal (journal.js) et aux
// licences tierces (notices.js). Les données des
// moteurs viennent du backend (`get_runtimes`) ; chaque groupe porte un
// statut : ok (app + système), blocked (app, prérequis système manquant),
// unsupported (pas pris en charge par l'application).

import { invoke } from "./app.js";
import { openChangelog } from "./changelog.js";
import { t } from "./i18n.js";
import { openJournal } from "./journal.js";
import { openNotices } from "./notices.js";
import { checkForUpdate, openDownload, openRelease } from "./updates.js";

/** @typedef {import("../../types/ipc").UpdateInfo} UpdateInfo */
/** @typedef {import("../../types/ipc").RuntimeGroup} RuntimeGroup */

// Éléments d'index.html, présents par construction.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("info-dialog"));
const groupsEl = /** @type {HTMLElement} */ (document.getElementById("info-groups"));
const versionEl = /** @type {HTMLElement} */ (document.getElementById("info-version"));
const updateBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-check"));
const downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-download"));
const releaseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-release"));
const updateStatus = /** @type {HTMLElement} */ (document.getElementById("info-update-status"));
/** @type {UpdateInfo | null} */
let updateInfo = null; // dernier résultat, cible des boutons « Télécharger » / « Notes de version »

/**
 * @param {string} text
 * @param {boolean} [error]
 */
function setUpdateStatus(text, error = false) {
  updateStatus.textContent = text;
  updateStatus.classList.toggle("error", error);
}

/** @param {boolean} show */
function showUpdateLinks(show) {
  downloadBtn.hidden = !show;
  releaseBtn.hidden = !show;
}

async function checkUpdate() {
  updateBtn.disabled = true;
  showUpdateLinks(false);
  setUpdateStatus(t("update.checking"));
  try {
    updateInfo = await checkForUpdate();
    showUpdateLinks(updateInfo.newer);
    downloadBtn.title = updateInfo.download_file ?? "";
    setUpdateStatus(
      updateInfo.newer
        ? t("update.available", { version: updateInfo.latest })
        : t("update.up_to_date", { version: updateInfo.current }),
    );
  } catch (err) {
    setUpdateStatus(String(err), true);
  } finally {
    updateBtn.disabled = false;
  }
}

// Libellé d'un statut, traduit à l'affichage (le dialog est rendu à chaque ouverture).
/**
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  switch (status) {
    case "ok":
      return t("info.status.ok");
    case "blocked":
      return t("info.status.blocked");
    default:
      return t("info.status.unsupported");
  }
}

/**
 * @param {RuntimeGroup} g
 * @returns {HTMLElement}
 */
function renderGroup(g) {
  const status = ["ok", "blocked"].includes(g.status) ? g.status : "unsupported";

  const group = document.createElement("section");
  group.className = `rt-group ${status}`;

  const head = document.createElement("div");
  head.className = "rt-head";

  const titles = document.createElement("div");
  const title = document.createElement("div");
  title.className = "rt-title";
  title.textContent = g.label;
  const req = document.createElement("div");
  req.className = "rt-req";
  req.textContent = g.requirement;
  titles.append(title, req);

  const badge = document.createElement("span");
  badge.className = `rt-badge ${status}`;
  badge.textContent = statusLabel(status);

  head.append(titles, badge);
  group.append(head);

  if (g.note) {
    const note = document.createElement("p");
    note.className = "rt-note";
    note.textContent = g.note;
    group.append(note);
  }

  if (Array.isArray(g.types) && g.types.length) {
    const chips = document.createElement("div");
    chips.className = "rt-types";
    for (const type of g.types) {
      const chip = document.createElement("span");
      chip.className = "rt-chip";
      chip.textContent = type;
      chips.append(chip);
    }
    group.append(chips);
  }

  return group;
}

export async function openInfo() {
  // Résultat d'une ouverture précédente : périmé (et dans l'ancienne langue).
  showUpdateLinks(false);
  setUpdateStatus("");
  try {
    versionEl.textContent = `Kroki Desk v${await window.__TAURI__.app.getVersion()}`;
  } catch {
    versionEl.textContent = "Kroki Desk";
  }
  let groups;
  try {
    groups = await invoke("get_runtimes");
  } catch (err) {
    groups = [];
    groupsEl.replaceChildren();
    const error = document.createElement("p");
    error.className = "settings-error";
    error.textContent = String(err);
    groupsEl.append(error);
    dialog.showModal();
    return;
  }
  groupsEl.replaceChildren(...groups.map(renderGroup));
  dialog.showModal();
}

export function initInfo() {
  /** @type {HTMLElement} */ (document.getElementById("info-close")).addEventListener("click", () => dialog.close());
  // Le changelog s'empile au-dessus du dialog (modales imbriquées, comme le
  // dialog de confiance au-dessus du dialog Plugins).
  /** @type {HTMLElement} */ (document.getElementById("info-changelog")).addEventListener("click", openChangelog);
  // Journal complet (application + plugins) ; filtré par plugin depuis le
  // dialog Plugins.
  /** @type {HTMLElement} */ (document.getElementById("info-journal")).addEventListener("click", () => openJournal());
  // Mentions de licence des composants tiers (notices.js), même empilement.
  /** @type {HTMLElement} */ (document.getElementById("info-notices")).addEventListener("click", openNotices);
  updateBtn.addEventListener("click", checkUpdate);
  // Boutons masqués tant qu'aucune vérification n'a abouti : `updateInfo` est
  // alors renseigné (cf. checkUpdate).
  downloadBtn.addEventListener("click", () => openDownload(/** @type {UpdateInfo} */ (updateInfo)));
  releaseBtn.addEventListener("click", () => openRelease(/** @type {UpdateInfo} */ (updateInfo)));
}
