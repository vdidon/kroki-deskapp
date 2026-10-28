// @ts-check
// Info (« Informations ») dialog: app version, state of the runtimes/engines on
// the current machine, access to the changelog (« Nouveautés ») and on-demand
// update check (updates.js), access to the log (journal.js) and to the
// third-party licenses (notices.js). The engine data comes from the backend
// (`get_runtimes`); each group carries a status: ok (app + system), blocked
// (app, missing system prerequisite), unsupported (not supported by the
// application).

import { invoke } from "./app.js";
import { openChangelog } from "./changelog.js";
import { t } from "./i18n.js";
import { openJournal } from "./journal.js";
import { openNotices } from "./notices.js";
import { checkForUpdate, openDownload, openRelease } from "./updates.js";

/** @typedef {import("../../types/ipc").UpdateInfo} UpdateInfo */
/** @typedef {import("../../types/ipc").RuntimeGroup} RuntimeGroup */

// Elements of index.html, present by construction.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("info-dialog"));
const groupsEl = /** @type {HTMLElement} */ (document.getElementById("info-groups"));
const versionEl = /** @type {HTMLElement} */ (document.getElementById("info-version"));
const updateBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-check"));
const downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-download"));
const releaseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("info-update-release"));
const updateStatus = /** @type {HTMLElement} */ (document.getElementById("info-update-status"));
/** @type {UpdateInfo | null} */
let updateInfo = null; // last result, target of the Download (« Télécharger ») / Release notes (« Notes de version ») buttons

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

// Label of a status, translated at display time (the dialog is rendered on every open).
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
  // Result of a previous open: stale (and in the old language).
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
  // The changelog stacks above the dialog (nested modals, like the trust
  // dialog above the Plugins dialog).
  /** @type {HTMLElement} */ (document.getElementById("info-changelog")).addEventListener("click", openChangelog);
  // Full log (application + plugins); filtered by plugin from the Plugins
  // dialog.
  /** @type {HTMLElement} */ (document.getElementById("info-journal")).addEventListener("click", () => openJournal());
  // License notices of third-party components (notices.js), same stacking.
  /** @type {HTMLElement} */ (document.getElementById("info-notices")).addEventListener("click", openNotices);
  updateBtn.addEventListener("click", checkUpdate);
  // Buttons hidden until a check has succeeded: `updateInfo` is then set
  // (cf. checkUpdate).
  downloadBtn.addEventListener("click", () => openDownload(/** @type {UpdateInfo} */ (updateInfo)));
  releaseBtn.addEventListener("click", () => openRelease(/** @type {UpdateInfo} */ (updateInfo)));
}
