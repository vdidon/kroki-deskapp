// Mises à jour (updates.rs) : notification seule, rien n'est installé. Au boot
// de chaque fenêtre, une vérification automatique dont le backend décide si
// elle a lieu (réglage, une fois par jour, première fenêtre seulement) ; à la
// demande depuis le dialog « Informations » (info.js). Deux liens, ouverts dans
// le navigateur : le fichier adapté à cette installation, et la page de la
// release (notes de version).

import { invoke } from "./app.js";
import { t } from "./i18n.js";
import { showToast } from "./session.js";

function openUrl(href) {
  invoke("open_link", { baseDir: "", href });
}

/** Fichier de la release adapté à cette installation (ou, à défaut, sa page). */
export function openDownload(info) {
  openUrl(info.download_url);
}

export function openRelease(info) {
  openUrl(info.release_url);
}

/** Résultat de `check_update` forcé ; l'erreur est déjà un message traduit. */
export function checkForUpdate() {
  return invoke("check_update", { automatic: false });
}

/** Non attendue par le boot : la requête peut prendre jusqu'à 10 s. */
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
