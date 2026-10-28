// @ts-check
// Updates (updates.rs): notification only, nothing is installed. At each
// window's boot, an automatic check whose occurrence the backend decides
// (setting, once a day, first window only); on demand from the Info
// (« Informations ») dialog (info.js). Two links, opened in the browser: the
// file suited to this installation, and the release page (release notes).

import { invoke } from "./app.js";
import { t } from "./i18n.js";
import { showToast } from "./session.js";

/** @typedef {import("../../types/ipc").UpdateInfo} UpdateInfo */

/** @param {string} href */
function openUrl(href) {
  invoke("open_link", { baseDir: "", href });
}

/**
 * Release file suited to this installation (or, failing that, its page).
 * @param {UpdateInfo} info
 */
export function openDownload(info) {
  openUrl(info.download_url);
}

/** @param {UpdateInfo} info */
export function openRelease(info) {
  openUrl(info.release_url);
}

/**
 * Result of a forced `check_update`; the error is already a translated message.
 * Never null: only the automatic check returns `None` (updates.rs).
 * @returns {Promise<UpdateInfo>}
 */
export function checkForUpdate() {
  return /** @type {Promise<UpdateInfo>} */ (invoke("check_update", { automatic: false }));
}

/** Not awaited by the boot: the request can take up to 10 s. */
export async function initUpdates() {
  let info;
  try {
    info = await invoke("check_update", { automatic: true });
  } catch {
    return;
  }
  if (!info) return;
  showToast(t("update.available", { version: info.latest }), false, [
    { label: t("update.download"), title: info.download_file, run: () => openDownload(info) },
    { label: t("update.release_notes"), secondary: true, run: () => openRelease(info) },
  ]);
}
