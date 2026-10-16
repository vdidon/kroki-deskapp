// Sessions `.kdws` : bouton « Enregistrer la session » et retours utilisateur.
// L'ouverture d'une session est entièrement côté Rust (session.rs, routée par
// `manager::open_mixed_paths` quel que soit le canal : CLI, drop, dialog) ;
// ici on ne gère que la sauvegarde et l'affichage des rapports (toast).

import { invoke, listen } from "./app.js";
import { t } from "./i18n.js";

const toastEl = document.getElementById("toast");
let toastTimer = null;

/** Toast transitoire en bas de fenêtre. Les erreurs restent plus longtemps. */
export function showToast(message, error = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", !!error);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, error ? 8000 : 3500);
}

export async function initSession() {
  const btn = document.getElementById("btn-save-session");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      // `false` = dialogue annulé : pas de toast.
      if (await invoke("save_session")) showToast(t("session.saved"));
    } catch (err) {
      showToast(String(err), true);
    } finally {
      btn.disabled = false;
    }
  });
  // Rapport d'ouverture d'une session (fichiers ignorés, `.kdws` illisible…),
  // émis par le backend vers cette fenêtre uniquement (`emit_to`).
  await listen("session-report", (e) => {
    showToast(e.payload.message, e.payload.error);
  });
}
